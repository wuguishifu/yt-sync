import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService, PlaylistRow, VideoRow } from './database.service';
import { EventsService } from './events.service';

export interface PlaylistSummary extends PlaylistRow {
  total: number;
  done: number;
  pending: number;
  failed: number;
}

/** Accepts a bare playlist ID or any YouTube URL with a `list=` parameter. */
export function parsePlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[A-Za-z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  try {
    const list = new URL(trimmed).searchParams.get('list');
    return list && /^[A-Za-z0-9_-]+$/.test(list) ? list : null;
  } catch {
    return null;
  }
}

@Injectable()
export class PlaylistsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly events: EventsService,
  ) {}

  private get db() {
    return this.database.db;
  }

  list(): PlaylistSummary[] {
    return this.db
      .prepare(
        `SELECT p.*,
                COUNT(v.id) AS total,
                COALESCE(SUM(v.status = 'done'), 0)    AS done,
                COALESCE(SUM(v.status = 'pending'), 0) AS pending,
                COALESCE(SUM(v.status = 'failed'), 0)  AS failed
           FROM playlists p
           LEFT JOIN videos v ON v.playlist_id = p.id
          GROUP BY p.id
          ORDER BY p.created_at`,
      )
      .all() as unknown as PlaylistSummary[];
  }

  listEnabled(): PlaylistRow[] {
    return this.db
      .prepare('SELECT * FROM playlists WHERE enabled = 1 ORDER BY created_at')
      .all() as unknown as PlaylistRow[];
  }

  get(id: number): PlaylistRow {
    const row = this.db
      .prepare('SELECT * FROM playlists WHERE id = ?')
      .get(id) as PlaylistRow | undefined;
    if (!row) throw new NotFoundException(`Playlist ${id} not found`);
    return row;
  }

  add(input: string): PlaylistRow {
    const youtubeId = parsePlaylistId(input ?? '');
    if (!youtubeId)
      throw new BadRequestException('Not a valid YouTube playlist URL or ID');
    const existing = this.db
      .prepare('SELECT id FROM playlists WHERE youtube_id = ?')
      .get(youtubeId);
    if (existing)
      throw new ConflictException('Playlist is already being synced');
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO playlists (youtube_id) VALUES (?)')
      .run(youtubeId);
    this.changed();
    return this.get(Number(lastInsertRowid));
  }

  setEnabled(id: number, enabled: boolean): PlaylistRow {
    this.get(id);
    this.db
      .prepare('UPDATE playlists SET enabled = ? WHERE id = ?')
      .run(enabled ? 1 : 0, id);
    this.changed();
    return this.get(id);
  }

  /** Stops syncing a playlist. Downloaded files are left on disk. */
  remove(id: number): void {
    this.get(id);
    this.db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
    this.changed();
  }

  videos(id: number): VideoRow[] {
    this.get(id);
    return this.db
      .prepare(
        'SELECT * FROM videos WHERE playlist_id = ? ORDER BY added_at DESC, id DESC',
      )
      .all(id) as unknown as VideoRow[];
  }

  retryFailed(id: number): void {
    this.get(id);
    this.db
      .prepare(
        `UPDATE videos SET status = 'pending', attempts = 0, error = NULL WHERE playlist_id = ? AND status = 'failed'`,
      )
      .run(id);
    this.changed();
  }

  /** Records the playlist's metadata and assigns a stable download folder on first sync. */
  updateMetadata(playlist: PlaylistRow, title: string): PlaylistRow {
    let folder = playlist.folder;
    if (!folder) {
      folder = sanitizeFolderName(title) || playlist.youtube_id;
      const taken = this.db
        .prepare('SELECT 1 FROM playlists WHERE folder = ? AND id != ?')
        .get(folder, playlist.id);
      if (taken) folder = `${folder} [${playlist.youtube_id}]`;
    }
    this.db
      .prepare(
        `UPDATE playlists SET title = ?, folder = ?, last_synced_at = datetime('now'), last_error = NULL WHERE id = ?`,
      )
      .run(title, folder, playlist.id);
    this.changed();
    return this.get(playlist.id);
  }

  setError(id: number, error: string): void {
    this.db
      .prepare('UPDATE playlists SET last_error = ? WHERE id = ?')
      .run(error, id);
    this.changed();
  }

  /** Inserts entries not seen before as pending. Returns how many were new. */
  addEntries(
    playlistId: number,
    entries: { id: string; title: string | null }[],
  ): number {
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO videos (playlist_id, video_id, title) VALUES (?, ?, ?)',
    );
    let added = 0;
    this.db.exec('BEGIN');
    try {
      for (const entry of entries) {
        added += Number(insert.run(playlistId, entry.id, entry.title).changes);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    if (added) this.changed();
    return added;
  }

  downloadQueue(playlistId: number, maxAttempts: number): VideoRow[] {
    return this.db
      .prepare(
        `SELECT * FROM videos
          WHERE playlist_id = ? AND status != 'done' AND attempts < ?
          ORDER BY id`,
      )
      .all(playlistId, maxAttempts) as unknown as VideoRow[];
  }

  markDone(videoRowId: number): void {
    this.db
      .prepare(
        `UPDATE videos SET status = 'done', error = NULL, attempts = attempts + 1, downloaded_at = datetime('now') WHERE id = ?`,
      )
      .run(videoRowId);
    this.changed();
  }

  markFailed(videoRowId: number, error: string): void {
    this.db
      .prepare(
        `UPDATE videos SET status = 'failed', error = ?, attempts = attempts + 1 WHERE id = ?`,
      )
      .run(error, videoRowId);
    this.changed();
  }

  /** Pushes the updated playlist summaries to connected UIs. */
  private changed(): void {
    this.events.emit('playlists', this.list());
  }
}

function sanitizeFolderName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 150);
}
