import { Inject, Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { APP_CONFIG, AppConfig } from '../config';

export interface PlaylistInfo {
  title: string;
  entries: { id: string; title: string | null }[];
}

const VERSION_TTL_MS = 5 * 60 * 1000;

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

@Injectable()
export class YtdlpService {
  private readonly logger = new Logger(YtdlpService.name);
  private readonly outputLogger = new Logger('yt-dlp');
  private cachedVersion: { value: string | null; at: number } | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Cached so status polling doesn't spawn yt-dlp; rechecked periodically in case the binary changes. */
  async version(): Promise<string | null> {
    if (
      this.cachedVersion &&
      Date.now() - this.cachedVersion.at < VERSION_TTL_MS
    ) {
      return this.cachedVersion.value;
    }
    let value: string | null = null;
    try {
      const result = await this.run(['--version']);
      if (result.code === 0) value = result.stdout.trim();
    } catch {
      // not runnable
    }
    this.cachedVersion = { value, at: Date.now() };
    return value;
  }

  async getPlaylist(youtubeId: string): Promise<PlaylistInfo> {
    const url = `https://www.youtube.com/playlist?list=${youtubeId}`;
    const result = await this.run([
      ...this.config.extraArgs,
      '--flat-playlist',
      '-J',
      url,
    ]);
    if (result.code !== 0) {
      throw new Error(
        lastLine(result.stderr) ?? `yt-dlp exited with code ${result.code}`,
      );
    }
    const json = JSON.parse(result.stdout) as {
      title?: string;
      entries?: { id?: string; title?: string }[];
    };
    return {
      title: json.title ?? youtubeId,
      entries: (json.entries ?? [])
        .filter(
          (e): e is { id: string; title?: string } => typeof e.id === 'string',
        )
        .map((e) => ({ id: e.id, title: e.title ?? null })),
    };
  }

  async download(videoId: string, outputDir: string): Promise<void> {
    const args = [
      ...this.config.extraArgs,
      '--no-playlist',
      '--no-progress',
      '--no-overwrites',
      '-f',
      this.config.format,
      '--merge-output-format',
      'mp4',
      '-P',
      `home:${outputDir}`,
      '-P',
      `temp:${this.config.tempDir}`,
      '-o',
      '%(title)s [%(id)s].%(ext)s',
    ];
    if (this.config.ffmpegPath) {
      args.push('--ffmpeg-location', this.config.ffmpegPath);
    }
    args.push(`https://www.youtube.com/watch?v=${videoId}`);

    const result = await this.run(args, { logStdout: true });
    if (result.code !== 0) {
      throw new Error(
        lastLine(result.stderr) ?? `yt-dlp exited with code ${result.code}`,
      );
    }
  }

  /**
   * Runs yt-dlp. stderr lines are always forwarded to the log; stdout lines only
   * when `logStdout` is set (it's JSON for playlist listings).
   */
  private run(args: string[], { logStdout = false } = {}): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      this.logger.debug(`${this.config.ytdlpPath} ${args.join(' ')}`);
      const child = spawn(this.config.ytdlpPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.stderr.on('data', (chunk) => (stderr += chunk));
      if (logStdout) {
        createInterface({ input: child.stdout }).on('line', (line) => {
          if (line.trim()) this.outputLogger.debug(line);
        });
      }
      createInterface({ input: child.stderr }).on('line', (line) => {
        if (line.startsWith('ERROR')) this.outputLogger.error(line);
        else if (line.trim()) this.outputLogger.warn(line);
      });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
  }
}

/** Prefer the last `ERROR:` line from yt-dlp's stderr, falling back to the last line at all. */
function lastLine(text: string): string | undefined {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.filter((l) => l.startsWith('ERROR')).pop() ?? lines.pop();
}
