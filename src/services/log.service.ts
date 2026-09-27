import { ConsoleLogger, Inject, Injectable, LogLevel } from '@nestjs/common';
import { StatementSync } from 'node:sqlite';
import { inspect } from 'node:util';
import { Observable, Subject } from 'rxjs';
import { APP_CONFIG, AppConfig } from '../config';
import { DatabaseService } from './database.service';

export interface LogEntry {
  id: number;
  ts: string;
  level: LogLevel;
  context: string | null;
  message: string;
}

/** Nest bootstrap chatter that isn't worth keeping in the persisted log. */
const IGNORED_CONTEXTS = new Set([
  'InstanceLoader',
  'RoutesResolver',
  'RouterExplorer',
]);

const PRUNE_EVERY = 200;

/**
 * Console logger that also persists every entry to SQLite and publishes it
 * to live subscribers (the web UI's log stream).
 */
@Injectable()
export class LogService extends ConsoleLogger {
  private readonly entries = new Subject<LogEntry>();
  readonly stream: Observable<LogEntry> = this.entries.asObservable();
  private readonly insert: StatementSync;
  private insertsSincePrune = 0;

  constructor(
    private readonly database: DatabaseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    super();
    this.insert = database.db.prepare(
      'INSERT INTO logs (ts, level, context, message) VALUES (?, ?, ?, ?)',
    );
  }

  /** The most recent entries, or those after `afterId`, oldest first. */
  recent(limit: number, afterId?: number): LogEntry[] {
    const db = this.database.db;
    if (afterId !== undefined) {
      return db
        .prepare('SELECT * FROM logs WHERE id > ? ORDER BY id LIMIT ?')
        .all(afterId, limit) as unknown as LogEntry[];
    }
    return (
      db
        .prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ?')
        .all(limit) as unknown as LogEntry[]
    ).reverse();
  }

  protected printMessages(
    messages: unknown[],
    context = '',
    logLevel: LogLevel = 'log',
    writeStreamType?: 'stdout' | 'stderr',
    errorStack?: unknown,
    params?: Record<string, unknown>,
  ): void {
    super.printMessages(
      messages,
      context,
      logLevel,
      writeStreamType,
      errorStack,
      params,
    );
    if (IGNORED_CONTEXTS.has(context)) return;
    for (const message of messages) {
      let text = typeof message === 'string' ? message : inspect(message);
      if (typeof errorStack === 'string') text += `\n${errorStack}`;
      this.record(logLevel, context || null, text);
    }
  }

  private record(level: LogLevel, context: string | null, message: string) {
    const ts = new Date().toISOString();
    try {
      const { lastInsertRowid } = this.insert.run(ts, level, context, message);
      this.entries.next({
        id: Number(lastInsertRowid),
        ts,
        level,
        context,
        message,
      });
      if (++this.insertsSincePrune >= PRUNE_EVERY) this.prune();
    } catch (err) {
      // Never route through the logger here, or a DB failure would recurse.
      process.stderr.write(`Failed to persist log entry: ${String(err)}\n`);
    }
  }

  private prune() {
    this.insertsSincePrune = 0;
    this.database.db
      .prepare('DELETE FROM logs WHERE id <= (SELECT MAX(id) FROM logs) - ?')
      .run(this.config.logRetention);
  }
}
