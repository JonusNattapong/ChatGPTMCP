import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SkillRegistry } from '../src/registry.js';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-hub-'));
  await fs.mkdir(path.join(root, 'a11y-debugging'));
  await fs.writeFile(path.join(root, 'a11y-debugging', 'SKILL.md'), '---\nname: a11y-debugging\ndescription: Accessibility audit with browser tooling\n---\n# A11y');
  await fs.writeFile(path.join(root, 'a11y-debugging', 'notes.md'), '# Notes');
  await fs.mkdir(path.join(root, 'research'));
  await fs.writeFile(path.join(root, 'research', 'SKILL.md'), '---\nname: research\ndescription: Research topics with source verification\n---\n# Research');
  return root;
}

test('syncs, lists, searches, resolves and reads skills', async () => {
  const root = await fixture();
  const registry = new SkillRegistry(root);
  const state = await registry.sync();
  assert.equal(state.count, 2);
  assert.equal(registry.list().length, 2);
  assert.equal(registry.search('accessibility')[0]?.name, 'a11y-debugging');
  assert.equal(registry.resolve('browser accessibility audit')[0]?.name, 'a11y-debugging');
  assert.equal((await registry.read('a11y-debugging')).skill.name, 'a11y-debugging');
  assert.equal((await registry.read('a11y-debugging', 'notes.md')).content, '# Notes');
});

test('blocks traversal outside a skill directory', async () => {
  const root = await fixture();
  await fs.writeFile(path.join(root, 'secret.md'), 'secret');
  const registry = new SkillRegistry(root);
  await registry.sync();
  await assert.rejects(() => registry.read('a11y-debugging', '../secret.md'), /outside the selected skill directory/);
});
