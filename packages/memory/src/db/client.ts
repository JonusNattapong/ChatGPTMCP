import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

import { getDatabasePath } from '../client';
import * as schema from './schema';

export function createDatabaseClient(path = getDatabasePath()) {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const sqlite = new Database(path);
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('journal_mode = WAL');
  sqliteVec.load(sqlite);

  return sqlite;
}

export const sqlite = createDatabaseClient();
export const db = drizzle(sqlite, { schema });

export function runMigrations(database = sqlite) {
  const migrations = [
    {
      name: '0000_init',
      sql: `
        CREATE TABLE IF NOT EXISTS __ourbook_memory_migrations (
          name TEXT PRIMARY KEY,
          applied_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
        );

        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          summary TEXT,
          embedding BLOB NOT NULL,
          tags TEXT NOT NULL DEFAULT '[]',
          agent TEXT NOT NULL,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          project TEXT,
          client TEXT NOT NULL DEFAULT 'unknown',
          workspace_root TEXT,
          kind TEXT NOT NULL DEFAULT 'note',
          superseded_by TEXT REFERENCES memories(id) ON DELETE SET NULL,
          superseded_at INTEGER,
          superseded_reason TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          confidence REAL NOT NULL DEFAULT 1.0,
          decay_at INTEGER,
          importance REAL NOT NULL DEFAULT 0.5,
          access_count INTEGER NOT NULL DEFAULT 0,
          last_accessed_at INTEGER,
          decay_rate REAL NOT NULL DEFAULT 0.01
        );

        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          summary TEXT NOT NULL,
          agent TEXT NOT NULL,
          project TEXT,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS memory_tags (
          memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
          tag TEXT NOT NULL,
          PRIMARY KEY (memory_id, tag)
        );

        CREATE TABLE IF NOT EXISTS memory_trace (
          id TEXT PRIMARY KEY,
          tool_name TEXT NOT NULL,
          query TEXT,
          client TEXT NOT NULL DEFAULT 'unknown',
          project TEXT,
          result_count INTEGER NOT NULL DEFAULT 0,
          selected_ids_json TEXT NOT NULL DEFAULT '[]',
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS memory_timeline (
          id TEXT PRIMARY KEY,
          scope TEXT NOT NULL DEFAULT 'project',
          project TEXT,
          session_id TEXT,
          client TEXT NOT NULL DEFAULT 'unknown',
          actor TEXT NOT NULL DEFAULT 'agent',
          event_type TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT,
          entity_type TEXT,
          entity_id TEXT,
          tags_json TEXT NOT NULL DEFAULT '[]',
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS memory_feedback (
          id TEXT PRIMARY KEY,
          memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
          timeline_id TEXT,
          signal TEXT NOT NULL,
          note TEXT,
          client TEXT NOT NULL DEFAULT 'unknown',
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS working_memory (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          expires_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS memories_decay_at_idx
          ON memories (decay_at);

        CREATE INDEX IF NOT EXISTS memory_tags_memory_id_idx
          ON memory_tags (memory_id);

        CREATE INDEX IF NOT EXISTS memory_tags_tag_idx
          ON memory_tags (tag);

        CREATE INDEX IF NOT EXISTS memory_trace_created_at_idx
          ON memory_trace (created_at DESC);

        CREATE INDEX IF NOT EXISTS memory_timeline_created_at_idx
          ON memory_timeline (created_at DESC);

        CREATE INDEX IF NOT EXISTS memory_timeline_event_type_idx
          ON memory_timeline (event_type);

        CREATE INDEX IF NOT EXISTS memory_feedback_memory_id_idx
          ON memory_feedback (memory_id);

        CREATE INDEX IF NOT EXISTS memory_feedback_signal_idx
          ON memory_feedback (signal);

        CREATE INDEX IF NOT EXISTS working_memory_session_key_idx
          ON working_memory (session_id, key);

        CREATE INDEX IF NOT EXISTS working_memory_expires_at_idx
          ON working_memory (expires_at);

        CREATE VIRTUAL TABLE IF NOT EXISTS memory_timeline_fts USING fts5(
          id UNINDEXED,
          title,
          body,
          tags,
          tokenize = 'porter unicode61'
        );

        CREATE TRIGGER IF NOT EXISTS memory_timeline_fts_ai AFTER INSERT ON memory_timeline BEGIN
          INSERT INTO memory_timeline_fts(rowid, id, title, body, tags)
          VALUES (new.rowid, new.id, new.title, COALESCE(new.body, ''), COALESCE(new.tags_json, '[]'));
        END;

        CREATE TRIGGER IF NOT EXISTS memory_timeline_fts_ad AFTER DELETE ON memory_timeline BEGIN
          INSERT INTO memory_timeline_fts(memory_timeline_fts, rowid, id, title, body, tags)
          VALUES ('delete', old.rowid, old.id, old.title, COALESCE(old.body, ''), COALESCE(old.tags_json, '[]'));
        END;

        CREATE TRIGGER IF NOT EXISTS memory_timeline_fts_au AFTER UPDATE ON memory_timeline BEGIN
          INSERT INTO memory_timeline_fts(memory_timeline_fts, rowid, id, title, body, tags)
          VALUES ('delete', old.rowid, old.id, old.title, COALESCE(old.body, ''), COALESCE(old.tags_json, '[]'));
          INSERT INTO memory_timeline_fts(rowid, id, title, body, tags)
          VALUES (new.rowid, new.id, new.title, COALESCE(new.body, ''), COALESCE(new.tags_json, '[]'));
        END;

        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
          id UNINDEXED,
          content,
          summary,
          tokenize = 'porter unicode61'
        );

        CREATE TRIGGER IF NOT EXISTS memories_fts_ai AFTER INSERT ON memories BEGIN
          INSERT INTO memories_fts(rowid, id, content, summary)
          VALUES (new.rowid, new.id, new.content, COALESCE(new.summary, ''));
        END;

        CREATE TRIGGER IF NOT EXISTS memories_fts_ad AFTER DELETE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, id, content, summary)
          VALUES ('delete', old.rowid, old.id, old.content, COALESCE(old.summary, ''));
        END;

        CREATE TRIGGER IF NOT EXISTS memories_fts_au AFTER UPDATE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, id, content, summary)
          VALUES ('delete', old.rowid, old.id, old.content, COALESCE(old.summary, ''));
          INSERT INTO memories_fts(rowid, id, content, summary)
          VALUES (new.rowid, new.id, new.content, COALESCE(new.summary, ''));
        END;
      `,
    },
    {
      name: '0001_client_aware_memory',
      sql: `
        CREATE TABLE IF NOT EXISTS memory_trace (
          id TEXT PRIMARY KEY,
          tool_name TEXT NOT NULL,
          query TEXT,
          client TEXT NOT NULL DEFAULT 'unknown',
          project TEXT,
          result_count INTEGER NOT NULL DEFAULT 0,
          selected_ids_json TEXT NOT NULL DEFAULT '[]',
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS memory_trace_created_at_idx
          ON memory_trace (created_at DESC);

        CREATE TABLE IF NOT EXISTS memory_timeline (
          id TEXT PRIMARY KEY,
          scope TEXT NOT NULL DEFAULT 'project',
          project TEXT,
          session_id TEXT,
          client TEXT NOT NULL DEFAULT 'unknown',
          actor TEXT NOT NULL DEFAULT 'agent',
          event_type TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT,
          entity_type TEXT,
          entity_id TEXT,
          tags_json TEXT NOT NULL DEFAULT '[]',
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS memory_timeline_created_at_idx
          ON memory_timeline (created_at DESC);

        CREATE INDEX IF NOT EXISTS memory_timeline_event_type_idx
          ON memory_timeline (event_type);

        CREATE VIRTUAL TABLE IF NOT EXISTS memory_timeline_fts USING fts5(
          id UNINDEXED,
          title,
          body,
          tags,
          tokenize = 'porter unicode61'
        );

        CREATE TRIGGER IF NOT EXISTS memory_timeline_fts_ai AFTER INSERT ON memory_timeline BEGIN
          INSERT INTO memory_timeline_fts(rowid, id, title, body, tags)
          VALUES (new.rowid, new.id, new.title, COALESCE(new.body, ''), COALESCE(new.tags_json, '[]'));
        END;

        CREATE TRIGGER IF NOT EXISTS memory_timeline_fts_ad AFTER DELETE ON memory_timeline BEGIN
          INSERT INTO memory_timeline_fts(memory_timeline_fts, rowid, id, title, body, tags)
          VALUES ('delete', old.rowid, old.id, old.title, COALESCE(old.body, ''), COALESCE(old.tags_json, '[]'));
        END;

        CREATE TRIGGER IF NOT EXISTS memory_timeline_fts_au AFTER UPDATE ON memory_timeline BEGIN
          INSERT INTO memory_timeline_fts(memory_timeline_fts, rowid, id, title, body, tags)
          VALUES ('delete', old.rowid, old.id, old.title, COALESCE(old.body, ''), COALESCE(old.tags_json, '[]'));
          INSERT INTO memory_timeline_fts(rowid, id, title, body, tags)
          VALUES (new.rowid, new.id, new.title, COALESCE(new.body, ''), COALESCE(new.tags_json, '[]'));
        END;

        CREATE INDEX IF NOT EXISTS memories_agent_project_created_at_idx
          ON memories (client, agent, project, created_at DESC);

        CREATE INDEX IF NOT EXISTS memories_client_idx
          ON memories (client);

        CREATE INDEX IF NOT EXISTS memories_kind_idx
          ON memories (kind);

        CREATE INDEX IF NOT EXISTS memories_superseded_by_idx
          ON memories (superseded_by);

        CREATE TABLE IF NOT EXISTS memory_feedback (
          id TEXT PRIMARY KEY,
          memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
          timeline_id TEXT,
          signal TEXT NOT NULL,
          note TEXT,
          client TEXT NOT NULL DEFAULT 'unknown',
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS memory_feedback_memory_id_idx
          ON memory_feedback (memory_id);

        CREATE INDEX IF NOT EXISTS memory_feedback_signal_idx
          ON memory_feedback (signal);

        CREATE TABLE IF NOT EXISTS working_memory (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          expires_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS working_memory_session_key_idx
          ON working_memory (session_id, key);

        CREATE INDEX IF NOT EXISTS working_memory_expires_at_idx
          ON working_memory (expires_at);
      `,
    },
    {
      name: '0002_tree_path',
      sql: `
        CREATE INDEX IF NOT EXISTS memories_tree_path_idx
          ON memories (tree_path);
      `,
    },
    {
      name: '0003_fix_fts_triggers',
      sql: `
        DROP TRIGGER IF EXISTS memories_fts_ai;
        DROP TRIGGER IF EXISTS memories_fts_ad;
        DROP TRIGGER IF EXISTS memories_fts_au;

        CREATE TRIGGER memories_fts_ai AFTER INSERT ON memories BEGIN
          INSERT INTO memories_fts(rowid, id, content, summary)
          VALUES (new.rowid, new.id, new.content, COALESCE(new.summary, ''));
        END;

        CREATE TRIGGER memories_fts_ad AFTER DELETE ON memories BEGIN
          DELETE FROM memories_fts WHERE rowid = old.rowid;
        END;

        CREATE TRIGGER memories_fts_au AFTER UPDATE OF content, summary ON memories BEGIN
          DELETE FROM memories_fts WHERE rowid = old.rowid;
          INSERT INTO memories_fts(rowid, id, content, summary)
          VALUES (new.rowid, new.id, new.content, COALESCE(new.summary, ''));
        END;

        DROP TRIGGER IF EXISTS memory_timeline_fts_ai;
        DROP TRIGGER IF EXISTS memory_timeline_fts_ad;
        DROP TRIGGER IF EXISTS memory_timeline_fts_au;

        CREATE TRIGGER memory_timeline_fts_ai AFTER INSERT ON memory_timeline BEGIN
          INSERT INTO memory_timeline_fts(rowid, id, title, body, tags)
          VALUES (new.rowid, new.id, new.title, COALESCE(new.body, ''), COALESCE(new.tags_json, '[]'));
        END;

        CREATE TRIGGER memory_timeline_fts_ad AFTER DELETE ON memory_timeline BEGIN
          DELETE FROM memory_timeline_fts WHERE rowid = old.rowid;
        END;

        CREATE TRIGGER memory_timeline_fts_au AFTER UPDATE OF title, body, tags_json ON memory_timeline BEGIN
          DELETE FROM memory_timeline_fts WHERE rowid = old.rowid;
          INSERT INTO memory_timeline_fts(rowid, id, title, body, tags)
          VALUES (new.rowid, new.id, new.title, COALESCE(new.body, ''), COALESCE(new.tags_json, '[]'));
        END;
      `,
    },
  ];

  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA journal_mode = WAL');
  database.exec(`
    CREATE TABLE IF NOT EXISTS __ourbook_memory_migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
    );
  `);
  sqliteVec.load(database);

  const applied = new Set(
    database
      .prepare('SELECT name FROM __ourbook_memory_migrations')
      .all()
      .map((row) => (row as { name: string }).name),
  );

  function hasColumn(table: string, column: string): boolean {
    const cols = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return cols.some((c) => c.name === column);
  }

  function addColumnIfMissing(table: string, column: string, definition: string) {
    if (!hasColumn(table, column)) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  for (const migration of migrations) {
    if (applied.has(migration.name)) {
      continue;
    }

    database.transaction(() => {
      // SQLite does not support ALTER TABLE ... ADD COLUMN IF NOT EXISTS.
      // Add compatibility columns explicitly before running index/table SQL.
      if (migration.name === '0001_client_aware_memory') {
        addColumnIfMissing('memories', 'client', "TEXT NOT NULL DEFAULT 'unknown'");
        addColumnIfMissing('memories', 'workspace_root', 'TEXT');
        addColumnIfMissing('memories', 'kind', "TEXT NOT NULL DEFAULT 'note'");
        addColumnIfMissing(
          'memories',
          'superseded_by',
          'TEXT REFERENCES memories(id) ON DELETE SET NULL',
        );
        addColumnIfMissing('memories', 'superseded_at', 'INTEGER');
        addColumnIfMissing('memories', 'superseded_reason', 'TEXT');
        addColumnIfMissing('memories', 'importance', 'REAL NOT NULL DEFAULT 0.5');
        addColumnIfMissing('memories', 'access_count', 'INTEGER NOT NULL DEFAULT 0');
        addColumnIfMissing('memories', 'last_accessed_at', 'INTEGER');
        addColumnIfMissing('memories', 'decay_rate', 'REAL NOT NULL DEFAULT 0.01');
      }

      if (migration.name === '0002_tree_path') {
        addColumnIfMissing('memories', 'tree_path', "TEXT NOT NULL DEFAULT '[]'");
      }

      database.exec(migration.sql);
      database
        .prepare('INSERT INTO __ourbook_memory_migrations(name) VALUES (?)')
        .run(migration.name);
    })();
  }
}

export function closeDatabase() {
  sqlite.close();
}
