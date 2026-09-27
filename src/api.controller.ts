import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Sse,
} from '@nestjs/common';
import { interval, map, merge, Observable } from 'rxjs';
import { EventsService } from './services/events.service';
import { LogService } from './services/log.service';
import { PlaylistsService } from './services/playlists.service';
import { SyncService } from './services/sync.service';

@Controller('api')
export class ApiController {
  constructor(
    private readonly playlists: PlaylistsService,
    private readonly sync: SyncService,
    private readonly logs: LogService,
    private readonly events: EventsService,
  ) {}

  @Get('status')
  status() {
    return this.sync.status();
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

  /**
   * Live updates for the web UI: `log` entries, `status` and `playlists`
   * snapshots, and a periodic `ping` so idle proxies don't drop the connection.
   */
  @Sse('events')
  stream(): Observable<{ type: string; data: unknown }> {
    return merge(
      this.logs.stream.pipe(map((entry) => ({ type: 'log', data: entry }))),
      this.events.stream,
      interval(25_000).pipe(map(() => ({ type: 'ping', data: '' }))),
    );
  }
}
