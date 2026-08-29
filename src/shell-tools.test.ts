import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyFilePatch, runShellCommand } from './shell-tools.js';
import { processStatus, readProcessOutput, startProcess, stopProcess } from './process-tools.js';
import { gitDiff, gitStatus } from './git-tools.js';

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

test('shell preserves UTF-8 output and returns execution metadata', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'machine-mcp-utf8-'));
  try {
    const result = await runShellCommand({
      command: 'node -e "process.stdout.write(\'สวัสดีครับ\')"',
      root,
      unrestricted: false,
      timeoutMs: 10_000,
    });
    assert.equal(result.stdout, 'สวัสดีครับ');
    assert.equal(result.outputTruncated, false);
    assert.ok(result.durationMs >= 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('shell stops when the configured output limit is reached', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'machine-mcp-output-'));
  try {
    const result = await runShellCommand({
      command: 'node -e "process.stdout.write(\'x\'.repeat(4096))"',
      root,
      unrestricted: false,
      timeoutMs: 10_000,
      maxOutputBytes: 1024,
    });
    assert.equal(result.outputTruncated, true);
    assert.ok(Buffer.byteLength(result.stdout) <= 1024);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('apply_patch dry_run validates without writing files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'machine-mcp-dry-run-'));
  try {
    const changed = await applyFilePatch({ root, unrestricted: false }, [
      '*** Begin Patch',
      '*** Add File: preview.txt',
      '+preview',
      '*** End Patch',
    ].join('\n'), true);
    assert.deepEqual(changed, ['added preview.txt']);
    await assert.rejects(access(path.join(root, 'preview.txt')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('process tools start, inspect output, and stop a background process', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'machine-mcp-process-'));
  try {
    const started = await startProcess({
      root,
      unrestricted: false,
      command: "node -e \"console.log('process-ok'); setTimeout(() => {}, 10000)\"",
    });
    assert.ok(started.pid > 0);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const output = await readProcessOutput({ root, unrestricted: false, pid: started.pid });
    assert.match(output.stdout, /process-ok/);
    assert.equal((await processStatus({ root, unrestricted: false, pid: started.pid })).running, true);
    assert.equal((await stopProcess({ root, unrestricted: false, pid: started.pid })).stopped, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('git tools return structured status and diff without shell interpolation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'machine-mcp-git-'));
  try {
    await runShellCommand({ root, unrestricted: false, workdir: root, command: 'git init -q; git config user.email test@example.com; git config user.name test; node -e "require(\'fs\').writeFileSync(\'tracked.txt\', \'one\\n\')"; git add tracked.txt; git commit -qm initial; node -e "require(\'fs\').appendFileSync(\'tracked.txt\', \'two\\n\')"' });
    const status = await gitStatus({ root, unrestricted: false, path: root });
    assert.equal(status.clean, false);
    assert.equal(status.files[0].path, 'tracked.txt');
    const diff = await gitDiff({ root, unrestricted: false, path: root });
    assert.match(diff.diff, /two/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
