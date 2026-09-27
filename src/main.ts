import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig } from './config';
import { LogService } from './services/log.service';
import { YtdlpService } from './services/ytdlp.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(LogService));
  app.enableShutdownHooks();
  app.useStaticAssets(join(__dirname, '..', 'public'));

  const config = app.get<AppConfig>(APP_CONFIG);
  const logger = new Logger('Bootstrap');
  const version = await app.get(YtdlpService).version();
  if (version) {
    logger.log(`Using yt-dlp ${version} at ${config.ytdlpPath}`);
  } else {
    logger.warn(
      `yt-dlp not runnable at "${config.ytdlpPath}" — set YTDLP_PATH`,
    );
  }
  logger.log(
    `Downloading to ${config.downloadDir} (temp: ${config.tempDir}), data in ${config.dataDir}`,
  );

  await app.listen(config.port);
  logger.log(`Web UI listening on http://localhost:${config.port}`);
}

void bootstrap();
