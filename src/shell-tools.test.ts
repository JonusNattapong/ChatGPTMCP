import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyFilePatch, runShellCommand } from './shell-tools.js';

test('safe mode keeps shell commands inside the configured root', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'machine-mcp-'));
  try {
    await assert.rejects(
      runShellCommand({ command: 'node --version', root, unrestricted: false, workdir: '..' }),
      /outside the configured root/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('unrestricted mode accepts an absolute working directory outside root', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'machine-mcp-root-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'machine-mcp-outside-'));
  try {
    const result = await runShellCommand({
      command: 'node -e "process.stdout.write(process.cwd())"',
      root,
      unrestricted: true,
      workdir: outside,
      timeoutMs: 10_000,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(path.resolve(result.stdout), path.resolve(outside));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('apply_patch adds and updates a file', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'machine-mcp-patch-'));
  try {
    await applyFilePatch({ root, unrestricted: false }, [
      '*** Begin Patch',
      '*** Add File: example.txt',
      '+hello',
      '*** End Patch',
    ].join('\n'));
    await applyFilePatch({ root, unrestricted: false }, [
      '*** Begin Patch',
      '*** Update File: example.txt',
      '@@',
      '-hello',
      '+hello world',
      '*** End Patch',
    ].join('\n'));
    assert.equal(await readFile(path.join(root, 'example.txt'), 'utf8'), 'hello world\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
