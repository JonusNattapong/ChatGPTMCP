import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ToolError } from './errors.js';
import { gitAdd, gitLog, gitStatus } from './git-tools.js';
import { runShellCommand } from './shell-tools.js';
import { gitCommitVerified, verifyChanges } from './verification.js';

async function withRoot(prefix: string, body: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    await body(root);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function packageJson(scripts: Record<string, string>): string {
  return JSON.stringify({ name: 'fixture', private: true, scripts }, null, 2);
}

test('verification profiles select bounded Node project gates', async () => {
  await withRoot('machine-verify-profiles-', async (root) => {
    await writeFile(path.join(root, 'package.json'), packageJson({
      build: 'node -e "process.stdout.write(\'build-ok\')"',
      test: 'node -e "process.stdout.write(\'test-ok\')"',
      verify: 'node -e "process.stdout.write(\'strict-ok\')"',
    }));
    const access = { root, unrestricted: false };

    const fast = await verifyChanges({ ...access, profile: 'fast', timeoutMs: 10_000 });
    assert.equal(fast.ok, true);
    assert.deepEqual(fast.checks.map((check) => check.name), ['npm run build']);

    const normal = await verifyChanges({ ...access, profile: 'normal', timeoutMs: 10_000 });
    assert.equal(normal.ok, true);
    assert.deepEqual(normal.checks.map((check) => check.name), ['npm run test', 'npm run build']);

    const strict = await verifyChanges({ ...access, profile: 'strict', timeoutMs: 10_000 });
    assert.equal(strict.ok, true);
    assert.deepEqual(strict.checks.map((check) => check.name), ['npm run verify']);
  });
});

test('verification fails closed when a project gate fails or no strategy exists', async () => {
  await withRoot('machine-verify-fail-', async (root) => {
    await writeFile(path.join(root, 'package.json'), packageJson({ test: 'node -e "process.exit(2)"' }));
    const failed = await verifyChanges({ root, unrestricted: false, profile: 'normal', timeoutMs: 10_000 });
    assert.equal(failed.ok, false);
    assert.equal(failed.checks[0]?.ok, false);

    const empty = path.join(root, 'empty');
    await runShellCommand({ root, unrestricted: false, command: 'node -e "require(\'fs\').mkdirSync(\'empty\')"' });
    const unknown = await verifyChanges({ root, unrestricted: false, path: empty, profile: 'normal', timeoutMs: 10_000 });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.projectType, 'unknown');
  });
});

test('verified commit stages only explicit paths after verification', async () => {
  await withRoot('machine-verified-commit-', async (root) => {
    const machine = { root, unrestricted: false };
    await runShellCommand({ ...machine, command: 'git init -q; git config user.email test@example.com; git config user.name test' });
    await writeFile(path.join(root, 'package.json'), packageJson({ build: 'node -e "process.exit(0)"' }));
    await writeFile(path.join(root, 'tracked.txt'), 'one\n');
    await writeFile(path.join(root, 'unrelated.txt'), 'alpha\n');
    await runShellCommand({ ...machine, command: 'git add package.json tracked.txt unrelated.txt; git commit -qm initial' });
    await writeFile(path.join(root, 'tracked.txt'), 'one\ntwo\n');
    await writeFile(path.join(root, 'unrelated.txt'), 'alpha\nbeta\n');

    const result = await gitCommitVerified({
      ...machine,
      paths: ['tracked.txt'],
      message: 'verified change',
      profile: 'fast',
      timeoutMs: 10_000,
    });
    assert.equal(result.ok, true);
    assert.equal(result.verification.ok, true);
    assert.deepEqual(result.status.files.map((file) => file.path), ['unrelated.txt']);
    assert.equal((await gitLog({ ...machine, maxCount: 1 })).commits[0]?.subject, 'verified change');
    assert.equal(await readFile(path.join(root, 'tracked.txt'), 'utf8'), 'one\ntwo\n');
  });
});

test('verified commit refuses a non-empty staging area without changing it', async () => {
  await withRoot('machine-verified-staged-', async (root) => {
    const machine = { root, unrestricted: false };
    await runShellCommand({ ...machine, command: 'git init -q; git config user.email test@example.com; git config user.name test' });
    await writeFile(path.join(root, 'package.json'), packageJson({ build: 'node -e "process.exit(0)"' }));
    await writeFile(path.join(root, 'a.txt'), 'a\n');
    await writeFile(path.join(root, 'b.txt'), 'b\n');
    await runShellCommand({ ...machine, command: 'git add package.json a.txt b.txt; git commit -qm initial' });
    await writeFile(path.join(root, 'a.txt'), 'aa\n');
    await writeFile(path.join(root, 'b.txt'), 'bb\n');
    await gitAdd({ ...machine, paths: ['b.txt'] });

    await assert.rejects(
      gitCommitVerified({ ...machine, paths: ['a.txt'], message: 'must not happen', profile: 'fast', timeoutMs: 10_000 }),
      (error: unknown) => error instanceof ToolError && error.code === 'PRECONDITION_FAILED' && /staging area/.test(error.message),
    );
    const status = await gitStatus(machine);
    assert.equal(status.summary.staged, 1);
    assert.equal(status.files.find((file) => file.path === 'b.txt')?.index, 'M');
  });
});

test('verified commit rolls staging back if commit itself is rejected', async (t) => {
  await withRoot('machine-verified-rollback-', async (root) => {
    const machine = { root, unrestricted: false };
    await runShellCommand({ ...machine, command: 'git init -q; git config user.email test@example.com; git config user.name test' });
    await writeFile(path.join(root, 'package.json'), packageJson({ build: 'node -e "process.exit(0)"' }));
    await writeFile(path.join(root, 'a.txt'), 'a\n');
    await runShellCommand({ ...machine, command: 'git add package.json a.txt; git commit -qm initial' });
    await writeFile(path.join(root, 'a.txt'), 'aa\n');

    const hook = path.join(root, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, '#!/bin/sh\nexit 1\n');
    try { await chmod(hook, 0o755); } catch { return t.skip('cannot make Git hook executable on this platform'); }

    await assert.rejects(gitCommitVerified({ ...machine, paths: ['a.txt'], message: 'blocked', profile: 'fast', timeoutMs: 10_000 }));
    const status = await gitStatus(machine);
    assert.equal(status.summary.staged, 0);
    assert.equal(status.summary.unstaged, 1);
  });
});

test('verification detects Python projects and parses diagnostics', async () => {
  await withRoot('machine-verify-python-', async (root) => {
    await writeFile(path.join(root, 'pyproject.toml'), '[tool.ruff]\nline-length = 88\n');
    const access = { root, unrestricted: false };
    const fast = await verifyChanges({ ...access, profile: 'fast', timeoutMs: 10_000 });
    assert.equal(fast.projectType, 'python');
    assert.deepEqual(fast.checks.map((c) => c.name), ['ruff check']);

    const normal = await verifyChanges({ ...access, profile: 'normal', timeoutMs: 10_000 });
    assert.equal(normal.projectType, 'python');
    assert.deepEqual(normal.checks.map((c) => c.name), ['ruff check', 'python -m pytest']);
  });

  const { parseDiagnostics } = await import('./verification.js');
  const parsed = parseDiagnostics([
    'src/app.py(10,5): error TS2322: Type error',
    '  File "test_example.py", line 42, in test_fn',
    'FAILED test_mod.py::test_case - AssertionError: failed',
    'module/sub.py:15:20: E501 line too long',
  ].join('\n'));
  assert.equal(parsed.length, 4);
  assert.equal(parsed[0].code, 'TS2322');
  assert.equal(parsed[1].file, 'test_example.py');
  assert.equal(parsed[1].line, 42);
  assert.equal(parsed[2].code, 'test_case');
  assert.equal(parsed[3].file, 'module/sub.py');
  assert.equal(parsed[3].line, 15);
  assert.equal(parsed[3].column, 20);
});
