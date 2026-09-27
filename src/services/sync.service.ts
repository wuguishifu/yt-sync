import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { CronJob, validateCronExpression } from 'cron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { APP_CONFIG, AppConfig } from '../config';
import { DatabaseService } from './database.service';
import { EventsService } from './events.service';
import { PlaylistsService } from './playlists.service';
import { YtdlpService } from './ytdlp.service';

const CRON_SETTING = 'sync_cron';

export interface SyncStatus {
  running: boolean;
  current: string | null;
  lastRunStartedAt: string | null;
  lastRunFinishedAt: string | null;
  lastRunSummary: string | null;
  nextRunAt: string | null;
  ytdlpVersion: string | null;
  ytdlpPath: string;
  ffmpegPath: string | null;
  downloadDir: string;
  tempDir: string;
}

@Injectable()
export class SyncService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SyncService.name);
  private job: CronJob | null = null;
  private running = false;
  private current: string | null = null;
  private lastRunStartedAt: string | null = null;
  private lastRunFinishedAt: string | null = null;
  private lastRunSummary: string | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly database: DatabaseService,
    private readonly playlists: PlaylistsService,
    private readonly ytdlp: YtdlpService,
    private readonly events: EventsService,
  ) {}

  onModuleInit() {
    const cron = this.getCron();
    if (!validateCronExpression(cron).valid) {
      this.logger.error(
        `Stored cron "${cron}" is invalid; falling back to ${this.config.defaultCron}`,
      );
      this.schedule(this.config.defaultCron);
    } else {
      this.schedule(cron);
    }
  }

  async onApplicationShutdown() {
    await this.job?.stop();
  }

  getCron(): string {
    return this.database.getSetting(CRON_SETTING) ?? this.config.defaultCron;
  }

  setCron(expression: string): void {
    const cron = (expression ?? '').trim();
    const { valid, error } = validateCronExpression(cron);
    if (!valid)
      throw new BadRequestException(
        `Invalid cron expression: ${error?.message ?? cron}`,
      );
    this.database.setSetting(CRON_SETTING, cron);
    this.schedule(cron);
  }

  async status(): Promise<SyncStatus> {
    return {
      running: this.running,
      current: this.current,
      lastRunStartedAt: this.lastRunStartedAt,
      lastRunFinishedAt: this.lastRunFinishedAt,
      lastRunSummary: this.lastRunSummary,
      nextRunAt: this.job?.nextDate().toISO() ?? null,
      ytdlpVersion: await this.ytdlp.version(),
      ytdlpPath: this.config.ytdlpPath,
      ffmpegPath: this.config.ffmpegPath,
      downloadDir: this.config.downloadDir,
      tempDir: this.config.tempDir,
    };
  }

  /** Pushes the current status to connected UIs. */
  private publishStatus(): void {
    void this.status().then((status) => this.events.emit('status', status));
  }

  private setCurrent(current: string | null): void {
    this.current = current;
    this.publishStatus();
  }

  /** Starts a sync in the background. Returns false if one is already running. */
  trigger(): boolean {
    if (this.running) return false;
    void this.run();
    return true;
  }

  private schedule(cron: string) {
    void this.job?.stop();
    this.job = CronJob.from({
      cronTime: cron,
      onTick: () => {
        if (!this.trigger()) {
          this.logger.warn(
            'Scheduled sync skipped: previous sync still running',
          );
          this.publishStatus();
        }
      },
      start: true,
    });
    this.logger.log(
      `Sync scheduled with cron "${cron}" (next: ${this.job.nextDate().toISO()})`,
    );
    this.publishStatus();
  }

  private async run() {
    this.running = true;
    this.lastRunStartedAt = new Date().toISOString();
    let added = 0;
    let downloaded = 0;
    let failed = 0;
    this.logger.log('Sync started');
    this.publishStatus();

    try {
      for (const playlist of this.playlists.listEnabled()) {
        const label = playlist.title ?? playlist.youtube_id;
        this.setCurrent(`Fetching ${label}`);
        let synced;
        try {
          const info = await this.ytdlp.getPlaylist(playlist.youtube_id);
          synced = this.playlists.updateMetadata(playlist, info.title);
          const newCount = this.playlists.addEntries(playlist.id, info.entries);
          added += newCount;
          if (newCount)
            this.logger.log(`${info.title}: ${newCount} new item(s)`);
        } catch (err) {
          const message = errorMessage(err);
          this.logger.error(`Failed to fetch playlist ${label}: ${message}`);
          this.playlists.setError(playlist.id, message);
          continue;
        }

        const outputDir = join(this.config.downloadDir, synced.folder!);
        mkdirSync(outputDir, { recursive: true });
        mkdirSync(this.config.tempDir, { recursive: true });

        const queue = this.playlists.downloadQueue(
          playlist.id,
          this.config.maxAttempts,
        );
        for (const [i, video] of queue.entries()) {
          const name = video.title ?? video.video_id;
          this.setCurrent(
            `Downloading ${name} (${i + 1}/${queue.length} in ${synced.title})`,
          );
          try {
            await this.ytdlp.download(video.video_id, outputDir);
            this.playlists.markDone(video.id);
            downloaded++;
            this.logger.log(`Downloaded ${name}`);
          } catch (err) {
            const message = errorMessage(err);
            this.playlists.markFailed(video.id, message);
            failed++;
            this.logger.warn(`Failed to download ${name}: ${message}`);
          }
        }
      }
    } catch (err) {
      this.logger.error(`Sync aborted: ${errorMessage(err)}`);
    } finally {
      this.lastRunSummary = `${added} new, ${downloaded} downloaded, ${failed} failed`;
      this.lastRunFinishedAt = new Date().toISOString();
      this.running = false;
      this.setCurrent(null);
      this.logger.log(`Sync finished: ${this.lastRunSummary}`);
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
