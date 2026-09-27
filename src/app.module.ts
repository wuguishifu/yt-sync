import { Module } from '@nestjs/common';
import { ApiController } from './api.controller';
import { APP_CONFIG, loadConfig } from './config';
import { DatabaseService } from './services/database.service';
import { PlaylistsService } from './services/playlists.service';
import { SyncService } from './services/sync.service';
import { YtdlpService } from './services/ytdlp.service';

@Module({
  controllers: [ApiController],
  providers: [
    { provide: APP_CONFIG, useFactory: loadConfig },
    DatabaseService,
    PlaylistsService,
    SyncService,
    YtdlpService,
  ],
})
export class AppModule {}
