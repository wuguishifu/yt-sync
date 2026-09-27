# yt-sync

Self-hosted NestJS app that keeps local copies of public and unlisted YouTube playlists. On a cron schedule it lists each playlist with `yt-dlp` and downloads any new videos. When a video is removed from a playlist, nothing happens: its file stays.

## Configuration

| Env var            | Default                          | Purpose                                                                            |
| ------------------ | -------------------------------- | ---------------------------------------------------------------------------------- |
| `PORT`             | `3000`                           | Web UI and API port                                                                |
| `YTDLP_PATH`       | `yt-dlp`                         | Path to the yt-dlp binary                                                          |
| `FFMPEG_PATH`      | _(unset: yt-dlp searches PATH)_  | Path to ffmpeg, passed as `--ffmpeg-location`                                      |
| `DOWNLOAD_DIR`     | `./downloads`                    | Where videos are saved: `<DOWNLOAD_DIR>/<playlist title>/<video title> [<id>].mp4` |
| `DATA_DIR`         | `./data`                         | Location of the SQLite database (`yt-sync.db`)                                     |
| `TEMP_DIR`         | `<DATA_DIR>/tmp`                 | Working dir for partial downloads; only finished files reach `DOWNLOAD_DIR`        |
| `SYNC_CRON`        | `0 * * * *`                      | Default schedule. A schedule saved in the UI takes precedence over it              |
| `YTDLP_FORMAT`     | best mp4 video+audio             | yt-dlp `-f` selector                                                               |
| `MAX_ATTEMPTS`     | `3`                              | Download attempts per video before it stays `failed`                               |
| `YTDLP_EXTRA_ARGS` | `--js-runtimes node:<node path>` | Extra args for every yt-dlp call                                                   |
| `LOG_RETENTION`    | `10000`                          | Number of log entries kept in the database                                         |
| `PLEX_METADATA`    | `false`                          | Embed metadata and write a poster image for Plex (see below)                       |

yt-dlp needs a JavaScript runtime for YouTube, so by default it uses the Node binary that runs this app. If you set `YTDLP_EXTRA_ARGS` yourself, that default is replaced.

Partial downloads and pre-merge streams go to `TEMP_DIR`, so a media server like Plex watching `DOWNLOAD_DIR` only sees finished files. If `TEMP_DIR` is on a different filesystem from `DOWNLOAD_DIR`, the final move is a copy, and the file appears gradually while it's copied. To get an instant rename instead, put `TEMP_DIR` on the same volume but outside the library folder.

### Plex

With `PLEX_METADATA=true`, each download embeds the title, upload date, description, chapters and thumbnail in the mp4. It also saves the thumbnail as `<video title> [<id>].jpg` next to the video. That's the metadata an "Other Videos" library can read, since its Personal Media agent ignores `.nfo` files and online sources. In Plex, make sure the Personal Media agent has **Local Media Assets** enabled (Settings → Agents → Other Videos → Personal Media), then refresh the library's metadata.

Only new downloads get this metadata. Videos already on disk aren't changed.

The cron schedule uses the container's local time. Set `TZ` to change the time zone.

## Running

**Locally:** `pnpm install && pnpm build && pnpm start`, then open http://localhost:3000.

**Docker:** put Linux binaries in `./bin`: the standalone `yt-dlp_linux` (or `yt-dlp_linux_aarch64`) saved as `bin/yt-dlp`, and a static `ffmpeg`. Then run `docker compose up -d`. The image is Debian-based (glibc), which the standalone yt-dlp build needs. The plain `yt-dlp` zipapp won't work because the image has no Python.

## Behaviour

- Adding a playlist starts a sync straight away. The first sync downloads everything already in the playlist.
- Only one sync runs at a time. A scheduled run that fires while one is still going is skipped.
- A failed download is retried on later syncs, up to `MAX_ATTEMPTS` times. **Retry failed** in the UI resets the counter.
- Removing a playlist in the UI only stops syncing it. Files on disk are left alone.
- Logs go to stdout and to SQLite. The web UI shows them live and keeps the most recent `LOG_RETENTION` entries.
- A playlist's folder name is fixed at its first sync, so renaming the playlist on YouTube won't split its downloads across two folders.
