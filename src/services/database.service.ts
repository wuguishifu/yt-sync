import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { APP_CONFIG, AppConfig } from '../config';

export type VideoStatus = 'pending' | 'done' | 'failed';

export interface PlaylistRow {
  id: number;
  youtube_id: string;
  title: string | null;
  folder: string | null;
  enabled: number;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface VideoRow {
  id: number;
  playlist_id: number;
  video_id: string;
  title: string | null;
  status: VideoStatus;
  attempts: number;
  error: string | null;
  added_at: string;
  downloaded_at: string | null;
}

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly db: DatabaseSync;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    mkdirSync(config.dataDir, { recursive: true });
    this.db = new DatabaseSync(join(config.dataDir, 'yt-sync.db'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS playlists (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        youtube_id     TEXT NOT NULL UNIQUE,
        title          TEXT,
        folder         TEXT,
        enabled        INTEGER NOT NULL DEFAULT 1,
        last_synced_at TEXT,
        last_error     TEXT,
        created_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS videos (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        playlist_id   INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        video_id      TEXT NOT NULL,
        title         TEXT,
        status        TEXT NOT NULL DEFAULT 'pending',
        attempts      INTEGER NOT NULL DEFAULT 0,
        error         TEXT,
        added_at      TEXT NOT NULL DEFAULT (datetime('now')),
        downloaded_at TEXT,
        UNIQUE (playlist_id, video_id)
      );

      CREATE TABLE IF NOT EXISTS logs (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        ts      TEXT NOT NULL,
        level   TEXT NOT NULL,
        context TEXT,
        message TEXT NOT NULL
      );
    `);
  }

  getSetting(key: string): string | undefined {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }

  onModuleDestroy() {
    this.db.close();
  }
}
