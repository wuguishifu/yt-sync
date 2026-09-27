import { resolve } from 'node:path';

export interface AppConfig {
  port: number;
  ytdlpPath: string;
  ffmpegPath: string | null;
  downloadDir: string;
  dataDir: string;
  defaultCron: string;
  format: string;
  maxAttempts: number;
  extraArgs: string[];
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function loadConfig(): AppConfig {
  return {
    port: Number(env('PORT') ?? 3000),
    ytdlpPath: env('YTDLP_PATH') ?? 'yt-dlp',
    ffmpegPath: env('FFMPEG_PATH') ?? null,
    downloadDir: resolve(env('DOWNLOAD_DIR') ?? './downloads'),
    dataDir: resolve(env('DATA_DIR') ?? './data'),
    defaultCron: env('SYNC_CRON') ?? '0 * * * *',
    format:
      env('YTDLP_FORMAT') ?? 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b',
    maxAttempts: Number(env('MAX_ATTEMPTS') ?? 3),
    // YouTube extraction needs a JS runtime; default to the Node binary running this app.
    extraArgs: (
      env('YTDLP_EXTRA_ARGS') ?? `--js-runtimes node:${process.execPath}`
    )
      .split(/\s+/)
      .filter(Boolean),
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
