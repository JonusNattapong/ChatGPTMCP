import { afterAll, beforeAll, describe, expect, test } from 'vitest';

let hasNativeBindings = false;

try {
  const bs3 = await import('better-sqlite3');
  new bs3.default(':memory:');
  hasNativeBindings = true;
} catch {
  // native bindings not available
}

describe('migration compatibility', () => {
  if (!hasNativeBindings) {
    test.skip('skipped: native better-sqlite3 bindings unavailable on this platform', () => {});
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Database: any;
  let database: any;
  let closeRuntimeDatabase: (() => void) | undefined;

  beforeAll(async () => {
    const bs3 = await import('better-sqlite3');
    Database = bs3.default;
    database = new Database(':memory:');
    process.env.OURBOOK_MEMORY_DB = ':memory:';

    database.exec(`
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
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        confidence REAL NOT NULL DEFAULT 1.0,
        decay_at INTEGER
      );

      INSERT INTO memories(id, content, summary, embedding, tags, agent, provider, model, created_at, updated_at, confidence)
      VALUES (
        'test-001',
        'Old memory content',
        'Old summary',
        x'0000',
        '["old"]',
        'claude-code',
        'local',
        'test',
        1000,
        1000,
        1.0
      );
    `);

    const client = await import('./client');
    closeRuntimeDatabase = client.closeDatabase;
    client.runMigrations(database);
  });

  afterAll(() => {
    database?.close();
    closeRuntimeDatabase?.();
  });

  test('applies current migrations to a legacy database', () => {
    const applied = database
      .prepare('SELECT name FROM __ourbook_memory_migrations')
      .all() as Array<{
      name: string;
    }>;

    expect(applied.map((row) => row.name).sort()).toEqual([
      '0000_init',
      '0001_client_aware_memory',
      '0002_tree_path',
      '0003_fix_fts_triggers',
    ]);
  });

  test('new columns exist after migration', () => {
    const cols = database.prepare('PRAGMA table_info(memories)').all() as Array<{ name: string }>;

    const names = cols.map((c) => c.name);
    for (const col of [
      'client',
      'kind',
      'importance',
      'access_count',
      'decay_rate',
      'superseded_by',
      'tree_path',
    ]) {
      expect(names).toContain(col);
    }
  });

  test('old memory still exists with defaulted new columns', () => {
    const row = database
      .prepare(
        'SELECT id, content, client, kind, importance, access_count, superseded_by FROM memories WHERE id = ?',
      )
      .get('test-001') as Record<string, unknown>;

    expect(row.id).toBe('test-001');
    expect(row.content).toBe('Old memory content');
    expect(row.client).toBe('unknown');
    expect(row.kind).toBe('note');
    expect(row.importance).toBe(0.5);
    expect(row.access_count).toBe(0);
    expect(row.superseded_by).toBeNull();
  });

  test('new tables exist', () => {
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;

    const names = tables.map((t) => t.name);
    for (const table of ['memory_trace', 'memory_timeline', 'memory_feedback', 'working_memory']) {
      expect(names).toContain(table);
    }
  });
});
