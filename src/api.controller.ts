import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Sse,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { APP_CONFIG, AppConfig } from './config';
import { LogEntry, LogService } from './services/log.service';
import { PlaylistsService } from './services/playlists.service';
import { SyncService } from './services/sync.service';
import { YtdlpService } from './services/ytdlp.service';

@Controller('api')
export class ApiController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly playlists: PlaylistsService,
    private readonly sync: SyncService,
    private readonly ytdlp: YtdlpService,
    private readonly logs: LogService,
  ) {}

  @Get('status')
  async status() {
    return {
      ...this.sync.status(),
      ytdlpVersion: await this.ytdlp.version(),
      ytdlpPath: this.config.ytdlpPath,
      ffmpegPath: this.config.ffmpegPath,
      downloadDir: this.config.downloadDir,
      tempDir: this.config.tempDir,
    };
  }

  @Post('sync')
  @HttpCode(202)
  triggerSync() {
    return { started: this.sync.trigger() };
  }

  @Get('settings')
  getSettings() {
    return { cron: this.sync.getCron() };
  }

  @Put('settings')
  updateSettings(@Body() body: { cron: string }) {
    this.sync.setCron(body?.cron);
    return this.getSettings();
  }

  @Get('playlists')
  listPlaylists() {
    return this.playlists.list();
  }

  @Post('playlists')
  addPlaylist(@Body() body: { url: string }) {
    const playlist = this.playlists.add(body?.url);
    this.sync.trigger();
    return playlist;
  }

  @Patch('playlists/:id')
  updatePlaylist(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { enabled: boolean },
  ) {
    return this.playlists.setEnabled(id, Boolean(body?.enabled));
  }

  @Delete('playlists/:id')
  @HttpCode(204)
  removePlaylist(@Param('id', ParseIntPipe) id: number) {
    this.playlists.remove(id);
  }

  @Get('playlists/:id/videos')
  listVideos(@Param('id', ParseIntPipe) id: number) {
    return this.playlists.videos(id);
  }

  @Post('playlists/:id/retry')
  @HttpCode(202)
  retryFailed(@Param('id', ParseIntPipe) id: number) {
    this.playlists.retryFailed(id);
    return { started: this.sync.trigger() };
  }

  @Get('logs')
  listLogs(@Query('limit') limit?: string, @Query('after') after?: string) {
    const n = Math.min(Math.max(Number(limit) || 500, 1), 5000);
    return this.logs.recent(n, after ? Number(after) : undefined);
  }

  @Sse('logs/stream')
  streamLogs(): Observable<{ data: LogEntry }> {
    return this.logs.stream.pipe(map((entry) => ({ data: entry })));
  }
}
