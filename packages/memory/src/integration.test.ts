import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

vi.mock('./embeddings/embedder', () => ({
  embedText: async () => new Float32Array(384).fill(0.1),
}));

let hasNativeBindings = false;

try {
  const bs3 = await import('better-sqlite3');
  new bs3.default(':memory:');
  hasNativeBindings = true;
} catch {
  // native bindings not available (e.g. Windows without build tools)
}

describe('integration tests', () => {
  if (!hasNativeBindings) {
    test.skip('skipped: native better-sqlite3 bindings unavailable on this platform', () => {});
    return;
  }

  let remember: typeof import('./memory/store').remember;
  let recall: typeof import('./memory/store').recall;
  let addMemoryFeedback: typeof import('./memory/store').addMemoryFeedback;
  let recentTimelineEvents: typeof import('./memory/store').recentTimelineEvents;
  let workingSet: typeof import('./memory/store').workingSet;
  let workingGet: typeof import('./memory/store').workingGet;
  let workingClear: typeof import('./memory/store').workingClear;
  let reflectSession: typeof import('./memory/store').reflectSession;
  let getMemory: typeof import('./memory/store').getMemory;
  let consolidateSharedMemory: typeof import('./ourbook/engine').consolidateSharedMemory;
  let generateDream: typeof import('./ourbook/engine').generateDream;

  beforeAll(async () => {
    process.env.OURBOOK_MEMORY_DB = ':memory:';
    process.env.OURBOOK_SESSION_ID = 'test-session';

    const client = await import('./db/client');
    client.runMigrations();

    const store = await import('./memory/store');
    const ourbook = await import('./ourbook/engine');

    remember = store.remember;
    recall = store.recall;
    addMemoryFeedback = store.addMemoryFeedback;
    recentTimelineEvents = store.recentTimelineEvents;
    workingSet = store.workingSet;
    workingGet = store.workingGet;
    workingClear = store.workingClear;
    reflectSession = store.reflectSession;
    getMemory = store.getMemory;
    consolidateSharedMemory = ourbook.consolidateSharedMemory;
    generateDream = ourbook.generateDream;
  });

  afterAll(async () => {
    try {
      const client = await import('./db/client');
      client.closeDatabase();
    } catch {
      // database was already closed
    }
  });

  test('stores a memory with ourbook_remember', async () => {
    const memory = await remember({
      content: 'The auth middleware validates JWT tokens in the request pipeline.',
      tags: ['auth', 'middleware'],
      agent: 'claude-code',
    });

    expect(memory.id).toBeDefined();
    expect(memory.content).toContain('auth middleware');
    expect(memory.tags).toContain('auth');
    expect(memory.importance).toBe(0.5);
    expect(Array.isArray(memory.tree_path)).toBe(true);
  });

  test('stores memory with tree path from name', async () => {
    const memory = await remember({
      content: 'Project config values',
      tags: ['config'],
      name: 'my-app',
    });

    expect(memory.tree_path).toBeDefined();
    expect(memory.tree_path.length).toBeGreaterThan(0);
  });

  test('recalls memory filtered by treePath', async () => {
    const mem1 = await remember({
      content: 'Claude Code specific knowledge',
      tags: ['claude'],
      name: 'claude-test',
    });

    // recall with treePath matching the stored path
    const results = await recall({
      query: 'knowledge',
      treePath: mem1.tree_path,
    });

    expect(results.length).toBeGreaterThan(0);
    const match = results.find((r) => r.id === mem1.id);
    expect(match).toBeDefined();
  });

  test('cascade recall returns memories from parent tree', async () => {
    // Store under ["unknown", "sub-a"]
    await remember({
      content: 'Sub project A settings',
      tags: ['sub'],
      name: 'sub-a',
    });
    // Mem at parent level (no name, unknown client only)
    await remember({
      content: 'Root project settings',
      tags: ['root'],
    });

    // recall with cascade=true at parent path
    const results = await recall({
      query: 'settings',
      treePath: ['unknown'],
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test('OURBOOK_MEMORY_BRANCH is appended to tree_path', async () => {
    process.env.OURBOOK_MEMORY_BRANCH = 'nightly';
    try {
      const memory = await remember({
        content: 'Nightly build config',
        tags: ['build'],
        name: 'ci',
      });
      expect(memory.tree_path).toContain('nightly');
    } finally {
      delete process.env.OURBOOK_MEMORY_BRANCH;
    }
  });

  test('redacts API keys from stored content', async () => {
    const memory = await remember({
      content: 'Set API_KEY=sk-secret-token-12345 in .env',
      tags: ['env'],
    });

    expect(memory.content).not.toContain('sk-secret-token-12345');
    expect(memory.content).toContain('[REDACTED]');
  });

  test('recalls stored memory by query', async () => {
    const results = await recall({
      query: 'authentication middleware',
      limit: 5,
    });
    expect(results.length).toBeGreaterThan(0);
    const match = results.find((r) => r.content.includes('auth middleware'));
    expect(match).toBeDefined();
    expect(match!.score).toBeGreaterThan(0);
  });

  test('recall excludes expired memories and keeps future decay dates', async () => {
    const expired = await remember({
      content: 'Expiry sentinel expired memory',
      tags: ['expiry-sentinel'],
      decayAt: Date.now() - 1_000,
    });
    const active = await remember({
      content: 'Expiry sentinel active memory',
      tags: ['expiry-sentinel'],
      decayAt: Date.now() + 60_000,
    });

    const results = await recall({ query: 'expiry sentinel', limit: 50 });

    expect(results.some((result) => result.id === expired.id)).toBe(false);
    expect(results.some((result) => result.id === active.id)).toBe(true);
  });

  test('records feedback and adjusts importance', async () => {
    const results = await recall({ query: 'auth middleware', limit: 1 });
    expect(results.length).toBeGreaterThan(0);
    const memoryId = results[0]!.id;

    await addMemoryFeedback({ memoryId, signal: 'important' });
    const updated = await getMemory(memoryId);
    expect(updated?.importance).toBeGreaterThan(0.5);
  });

  test('wrong signal reduces confidence', async () => {
    const results = await recall({ query: 'auth middleware', limit: 1 });
    expect(results.length).toBeGreaterThan(0);
    const memoryId = results[0]!.id;

    await addMemoryFeedback({ memoryId, signal: 'wrong' });
    const updated = await getMemory(memoryId);
    expect(updated?.confidence).toBeLessThan(1.0);
  });

  test('has timeline events from remember and feedback', async () => {
    const events = await recentTimelineEvents(20);
    const eventTypes = events.map((e) => e.event_type);
    expect(eventTypes).toContain('memory_added');
  });

  test('working memory set and get', async () => {
    const entry = await workingSet({
      key: 'current_task',
      value: 'review auth middleware',
      sessionId: 'test-session',
    });

    expect(entry?.id).toBeDefined();

    const found = await workingGet({
      key: 'current_task',
      sessionId: 'test-session',
    });

    expect(found).toBeDefined();
    expect(found!.value).toBe('review auth middleware');
  });

  test('working memory clear', async () => {
    await workingSet({
      key: 'temp_key',
      value: 'temp value',
      sessionId: 'test-session-clear',
    });

    const deleted = await workingClear({ sessionId: 'test-session-clear' });
    expect(deleted).toBeGreaterThan(0);
  });

  test('produces session reflection output', async () => {
    const result = await reflectSession({
      sessionId: 'test-session',
      limit: 10,
    });

    expect(result.session_summary).toBeDefined();
    expect(result.learned_taste).toBeInstanceOf(Array);
    expect(result.stored_memory_ids.length).toBeGreaterThan(0);
  });

  test('consolidates durable memories into a daily continuity memory', async () => {
    await remember({
      content: 'User prefers Python for data tooling.',
      tags: ['preference', 'python'],
      kind: 'taste',
    });
    await remember({
      content: 'The current project uses SQLite for durable local state.',
      tags: ['project', 'sqlite'],
      kind: 'decision',
    });

    const result = await consolidateSharedMemory({ sinceHours: 24, force: true });

    expect(result.status).toBe('consolidated');
    if (result.status === 'consolidated') {
      expect(result.source_count).toBeGreaterThan(0);
      expect(result.content).toContain('OurBook Daily Consolidation');
      expect(result.consolidation_id).toBeDefined();
    }
  });

  test('dream engine keeps provenance and labels output as speculative', async () => {
    const result = await generateDream({ seed: 'integration-seed', persist: true });

    expect(result.status).toBe('generated');
    if (result.status === 'generated') {
      expect(result.source_ids.length).toBeGreaterThanOrEqual(2);
      expect(result.content).toContain('speculative recombination');
      expect(result.persisted).toBe(true);
    }
  });
});
