import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { ThoughtStore } from '../dist/store.js';

function tempDb() {
  return join(tmpdir(), `thinkforge-${randomUUID()}.sqlite`);
}

test('store recognizes persisted sessions', () => {
  const path = tempDb();
  const store = new ThoughtStore(path);
  try {
    const sessionId = store.createSession('test problem');
    assert.equal(store.hasSession(sessionId), true);
    assert.equal(store.hasSession(randomUUID()), false);
  } finally {
    store.db.close();
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  }
});

test('foreign key protection rejects orphan thoughts', () => {
  const path = tempDb();
  const store = new ThoughtStore(path);
  try {
    assert.throws(() => store.addThought(randomUUID(), 'test', null, { ok: true }));
  } finally {
    store.db.close();
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  }
});
