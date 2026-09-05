import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { BrainBook } from '../dist/brain.js';

test('BrainBook Drawers operations', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pilot-memory-test-'));
  try {
    const book = new BrainBook(tmpDir);
    await book.ensureLayout();

    // 1. List seeded drawers
    const drawers = await book.listDrawers();
    assert.ok(drawers.length >= 1, 'Should list seeded drawers');
    assert.ok(drawers.some((d) => d.name === 'cheatsheets' || d.name === 'lessons'));

    // 2. Put drawer item
    const putRes = await book.putDrawerItem('cheatsheets', 'powershell', '# PowerShell Cheatsheet\n\nCommands here.', {
      tags: ['terminal', 'windows']
    });
    assert.equal(putRes.ok, true);
    assert.match(putRes.filePath, /powershell\.md$/);

    // 3. Read drawer item (returns raw markdown content)
    const content = await book.readDrawerItem('cheatsheets', 'powershell');
    assert.match(content, /PowerShell Cheatsheet/);
    assert.match(content, /terminal, windows/);
    assert.match(content, /Commands here/);

    // 4. Search includes drawer items
    const searchRes = await book.search('PowerShell');
    assert.ok(searchRes.length >= 1);
    assert.ok(searchRes.some((r) => r.file && r.file.includes('drawers')));

    // 5. Delete drawer item
    const deleted = await book.deleteDrawerItem('cheatsheets', 'powershell');
    assert.equal(deleted.ok, true);
    const contentAfter = await book.readDrawerItem('cheatsheets', 'powershell');
    assert.match(contentAfter, /not found in drawer/i);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
});
