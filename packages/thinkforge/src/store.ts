import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { ThoughtNode } from './types.js';

function defaultThinkStorePath(): string {
  if (process.env.THINKFORGE_DB) return process.env.THINKFORGE_DB;
  const unified = join(homedir(), '.pilot', 'think', 'sessions.sqlite');
  const legacy = join(homedir(), '.thinkforge', 'thinkforge.sqlite');
  if (!existsSync(unified) && existsSync(legacy)) {
    return legacy;
  }
  return unified;
}

export class ThoughtStore {
  readonly db: DatabaseSync;

  constructor(path = defaultThinkStorePath()) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        problem TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS thoughts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        parent_id TEXT,
        kind TEXT NOT NULL,
        method TEXT,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id)
      );
      CREATE INDEX IF NOT EXISTS idx_thoughts_session ON thoughts(session_id, created_at);
    `);
  }

  hasSession(sessionId: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM sessions WHERE id=?').get(sessionId));
  }

  createSession(problem: string): string {
    const id = randomUUID();
    this.db.prepare('INSERT INTO sessions(id, problem, created_at) VALUES(?,?,?)')
      .run(id, problem, new Date().toISOString());
    return id;
  }

  addThought(
    sessionId: string,
    kind: string,
    method: string | null,
    payload: unknown,
    parentId: string | null = null,
  ): string {
    const id = randomUUID();
    this.db.prepare(
      'INSERT INTO thoughts(id, session_id, parent_id, kind, method, payload, created_at) VALUES(?,?,?,?,?,?,?)',
    ).run(id, sessionId, parentId, kind, method, JSON.stringify(payload), new Date().toISOString());
    return id;
  }

  listSessions(): Array<{ id: string; problem: string; createdAt: string }> {
    return this.db.prepare(
      'SELECT id, problem, created_at FROM sessions ORDER BY created_at DESC LIMIT 100',
    ).all().map((row: any) => ({
      id: row.id,
      problem: row.problem,
      createdAt: row.created_at,
    }));
  }

  getSession(sessionId: string): {
    session: { id: string; problem: string; createdAt: string };
    thoughts: ThoughtNode[];
  } | null {
    const session: any = this.db.prepare(
      'SELECT id, problem, created_at FROM sessions WHERE id=?',
    ).get(sessionId);
    if (!session) return null;

    const rows: any[] = this.db.prepare(
      'SELECT * FROM thoughts WHERE session_id=? ORDER BY created_at, id',
    ).all(sessionId);

    return {
      session: {
        id: session.id,
        problem: session.problem,
        createdAt: session.created_at,
      },
      thoughts: rows.map((row) => ({
        id: row.id,
        sessionId: row.session_id,
        parentId: row.parent_id,
        kind: row.kind,
        method: row.method,
        payload: JSON.parse(row.payload),
        createdAt: row.created_at,
      })),
    };
  }
}
