import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { IdempotencyStore } from './idempotency.js';
import { ToolError } from './errors.js';
import { applyFilePatch } from './shell-tools.js';
import { createToolSpecs } from './tools.js';
import { processStatus, startProcess, stopProcess, waitProcess } from './process-tools.js';
import { gitCommitVerified, verifyChanges } from './verification.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
async function fixture(body: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'machine-reliability-'));
  try { await body(root); } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
}
const code = (expected: string) => (error: unknown) => error instanceof ToolError && error.code === expected;

test('durable retries coalesce concurrent execution, reject conflicts, and replay after reload', async () => fixture(async root => {
  const store = new IdempotencyStore(root);
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const execute = async () => { calls++; await gate; return { ok: true, value: 42 }; };
  const first = store.run('test-key', 'write', { a: 1 }, execute);
  const second = store.run('test-key', 'write', { a: 1 }, execute);
  await assert.rejects(store.run('test-key', 'write', { a: 2 }, execute), code('IDEMPOTENCY_CONFLICT'));
  await assert.rejects(new IdempotencyStore(root).run('test-key', 'write', { a: 1 }, execute), code('IDEMPOTENCY_UNKNOWN'));
  release();
  assert.deepEqual(await first, await second);
  assert.equal(calls, 1);
  assert.deepEqual(await new IdempotencyStore(root).run('test-key', 'write', { a: 1 }, execute), { ok: true, value: 42 });
  assert.equal(calls, 1);
}));

test('interrupted or corrupt receipts fail closed without re-executing', async () => fixture(async root => {
  const store = new IdempotencyStore(root);
  await assert.rejects(store.run('interrupted', 'write', {}, async () => { throw new Error('lost result'); }));
  let ran = false;
  await assert.rejects(new IdempotencyStore(root).run('interrupted', 'write', {}, async () => { ran = true; }), code('IDEMPOTENCY_UNKNOWN'));
  await writeFile(path.join(root, `${sha('corrupt')}.json`), '{broken');
  await assert.rejects(store.run('corrupt', 'write', {}, async () => { ran = true; }), code('IDEMPOTENCY_UNKNOWN'));
  assert.equal(ran, false);
}));

test('process recovery treats a reused PID as finished without signalling the foreign process', async () => fixture(async root => {
  const dir = path.join(root, '.chatgpt-machine');
  await mkdir(dir);
  await writeFile(path.join(dir, 'processes.json'), JSON.stringify({ version: 1, processes: [{
    pid: process.pid, processId: 'old-process', osStartTime: 'wrong-start-time', root,
    command: 'fixture', workdir: root, shell: 'bash', startedAt: Date.now(), exitCode: null, signal: null,
    stdoutLogPath: path.join(dir, 'stdout'), stderrLogPath: path.join(dir, 'stderr'), capturedBytes: 0, outputTruncated: false,
  }] }));
  // A reused PID with mismatched identity is now treated as finished rather than throwing,
  // so machine_status (which calls listManagedProcesses) remains resilient across sessions.
  const status = await processStatus({ root, unrestricted: false, pid: process.pid });
  assert.strictEqual(status.running, false, 'reused PID must be reported as not running');
  // stopProcess should also be a no-op (already exited) rather than signalling the foreign process
  const stopped = await stopProcess({ root, unrestricted: false, pid: process.pid });
  assert.strictEqual((stopped as { alreadyExited?: boolean }).alreadyExited, true, 'stopProcess must return alreadyExited=true for reused PID');
  // The foreign process (current jest/test runner process) must not have been killed
  assert.doesNotThrow(() => process.kill(process.pid, 0));
}));

test('process_wait returns bounded UTF-8 pages without skipping output', async () => fixture(async root => {
  const access = { root, unrestricted: false };
  const started = await startProcess({ ...access, command: `node -e "process.stdout.write('abc'.repeat(200)); process.stderr.write('done')"` });
  try {
    let stdout = '', stderr = '', out = 0, err = 0;
    for (let i = 0; i < 20; i++) {
      const result = await waitProcess({ ...access, pid: started.pid, processId: started.processId, timeoutMs: 10000, includeOutput: true, maxOutputBytes: 64, sinceStdout: out, sinceStderr: err });
      assert.ok(Buffer.byteLength(result.stdout ?? '') + Buffer.byteLength(result.stderr ?? '') <= 64);
      stdout += result.stdout; stderr += result.stderr;
      out = result.nextStdoutOffset; err = result.nextStderrOffset;
      if (!result.outputHasMore && result.completed) break;
    }
    assert.equal(stdout, 'abc'.repeat(200)); assert.equal(stderr, 'done');
  } finally { await stopProcess({ ...access, pid: started.pid }); }
}));

test('patch validates every expected hash before writing and reports partial filesystem failure', async () => fixture(async root => {
  const access = { root, unrestricted: false };
  await writeFile(path.join(root, 'one'), 'old\n'); await writeFile(path.join(root, 'two'), 'changed\n');
  const patch = '*** Begin Patch\n*** Update File: one\n@@\n-old\n+new\n*** Update File: two\n@@\n-changed\n+new\n*** End Patch';
  await assert.rejects(applyFilePatch(access, patch, false, { one: sha('old\n'), two: sha('stale\n') }), code('PRECONDITION_FAILED'));
  assert.equal(await readFile(path.join(root, 'one'), 'utf8'), 'old\n');
  await assert.rejects(applyFilePatch(access, '*** Begin Patch\n*** Add File: parent\n+file\n*** Add File: parent/child\n+child\n*** End Patch'), error => {
    assert.ok(error instanceof ToolError); assert.equal(error.code, 'PATCH_PARTIAL_FAILURE');
    assert.deepEqual(error.details?.completed, ['added parent']); return true;
  });
}));

test('verification retains early diagnostics in readable logs and avoids a duplicate nested build', async () => fixture(async root => {
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: {
    build: 'node build.cjs', test: 'npm run build',
  } }));
  await writeFile(path.join(root, 'build.cjs'), `const fs = require('fs'); fs.appendFileSync('count.txt','1'); console.log('src/a.ts(2,3): error TS2322: bad type'); console.log('x'.repeat(10000));`);
  const result = await verifyChanges({ root, unrestricted: false, timeoutMs: 15000 });
  assert.equal(result.ok, true); assert.equal(result.checks.length, 1);
  assert.equal(await readFile(path.join(root, 'count.txt'), 'utf8'), '1');
  assert.equal(result.checks[0].diagnostics[0].code, 'TS2322');
  assert.match(await readFile(result.checks[0].logPath!, 'utf8'), /TS2322/);
}));

test('verified commit refuses a file changed by verification and leaves staging untouched', async () => fixture(async root => {
  const git = (args: string[]) => exec('git', ['-C', root, ...args], { windowsHide: true });
  await git(['init', '-q']); await git(['config', 'user.email', 'test@example.com']); await git(['config', 'user.name', 'test']);
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node check.cjs' } }));
  await writeFile(path.join(root, 'check.cjs'), "require('fs').writeFileSync('a.txt','changed-by-test')");
  await writeFile(path.join(root, 'a.txt'), 'original');
  await git(['add', '.']); await git(['commit', '-qm', 'initial']);
  await writeFile(path.join(root, 'a.txt'), 'candidate');
  await assert.rejects(gitCommitVerified({ root, unrestricted: false, paths: ['a.txt'], message: 'must not commit', timeoutMs: 15000 }), code('PRECONDITION_FAILED'));
  assert.equal((await git(['diff', '--cached', '--name-only'])).stdout.trim(), '');
  assert.equal((await git(['log', '-1', '--format=%s'])).stdout.trim(), 'initial');
}));

test('registry rejects malformed new options before mutation', async () => fixture(async root => {
  const specs = createToolSpecs({ root, unrestricted: false, maxTimeoutMs: 60000 });
  const wait = specs.find(s => s.name === 'process_wait')!;
  await assert.rejects(wait.handler({ pid: 1, include_output: 'yes' }), code('INVALID_ARGUMENT'));
  const patch = specs.find(s => s.name === 'apply_patch')!;
  await assert.rejects(patch.handler({ patch: '*** Begin Patch\n*** Add File: x\n+x\n*** End Patch', expected_sha256: { x: 12 } }), code('INVALID_ARGUMENT'));
}));
