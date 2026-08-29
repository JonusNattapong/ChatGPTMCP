import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { listManagedProcesses, processStatus, readProcessOutput, startProcess, stopProcess, writeProcessInput } from './process-tools.js';

async function withRoot(prefix: string, body: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    await body(root);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

// C: process cleanup & lifecycle invariants

test('startProcess returns explicit PID and durable metadata', async () => {
  await withRoot('machine-mcp-proc-pid-', async (root) => {
    const access = { root, unrestricted: false };
    const started = await startProcess({ ...access, command: "node -e \"setTimeout(()=>{}, 8000)\"" });
    try {
      assert.ok(Number.isInteger(started.pid) && started.pid > 0, 'pid must be positive integer');
      assert.equal(started.durable, true);
      assert.equal(typeof started.workdir, 'string');
      assert.ok(started.startedAt);
      assert.equal(started.shell === 'powershell' || started.shell === 'bash' || started.shell === 'cmd', true);
    } finally {
      await stopProcess({ ...access, pid: started.pid }).catch(() => undefined);
    }
  });
});

test('process output is bounded and offsets are monotonic', async () => {
  await withRoot('machine-mcp-proc-bounded-', async (root) => {
    const access = { root, unrestricted: false };
    const started = await startProcess({
      ...access,
      command: "node -e \"console.log('first'); setTimeout(()=>console.log('second'), 250); setTimeout(()=>{}, 6000)\"",
    });
    try {
      const first = await readProcessOutput({ ...access, pid: started.pid, waitMs: 4000 });
      assert.match(first.stdout, /first/);
      assert.ok(first.nextStdoutOffset > 0);
      assert.ok(first.nextStderrOffset >= 0);

      const second = await readProcessOutput({
        ...access,
        pid: started.pid,
        sinceStdout: first.nextStdoutOffset,
        waitMs: 4000,
      });
      assert.doesNotMatch(second.stdout, /first/);
      assert.match(second.stdout, /second/);
      assert.ok(second.nextStdoutOffset >= first.nextStdoutOffset);
    } finally {
      await stopProcess({ ...access, pid: started.pid }).catch(() => undefined);
    }
  });
});

test('stopProcess waits for exit and is idempotent on already-exited', async () => {
  await withRoot('machine-mcp-proc-stop-', async (root) => {
    const access = { root, unrestricted: false };
    const started = await startProcess({
      ...access,
      command: "node -e \"setTimeout(()=>{}, 8000)\"",
    });
    const first = await stopProcess({ ...access, pid: started.pid });
    assert.equal(first.stopped, true);
    assert.equal(first.alreadyExited, false);
    // Windows kernel needs a moment before the pid is reusable; second call must report alreadyExited.
    const second = await stopProcess({ ...access, pid: started.pid });
    assert.equal(second.alreadyExited, true);
    assert.equal(second.stopped, false);

    const status = await processStatus({ ...access, pid: started.pid });
    assert.equal(status.running, false);
    assert.ok(status.finishedAt);
  });
});

test('stopProcess handles short-lived process that already exited', async () => {
  await withRoot('machine-mcp-proc-short-', async (root) => {
    const access = { root, unrestricted: false };
    const started = await startProcess({
      ...access,
      command: "node -e \"process.exit(0)\"",
    });
    // Give it a moment to exit on its own (especially on Windows cold start).
    await new Promise((r) => setTimeout(r, 800));
    const result = await stopProcess({ ...access, pid: started.pid });
    // Either it already exited or we stopped it — both are valid, but it must be not running after.
    assert.equal(typeof result.alreadyExited, 'boolean');
    const status = await processStatus({ ...access, pid: started.pid });
    assert.equal(status.running, false);
  });
});

test('process registry persists offsets after stop (recovered read)', async () => {
  await withRoot('machine-mcp-proc-recovered-', async (root) => {
    const access = { root, unrestricted: false };
    const started = await startProcess({
      ...access,
      command: "node -e \"console.log('recover-me'); setTimeout(()=>{}, 5000)\"",
    });
    const first = await readProcessOutput({ ...access, pid: started.pid, waitMs: 4000 });
    assert.match(first.stdout, /recover-me/);
    await stopProcess({ ...access, pid: started.pid });
    const status = await processStatus({ ...access, pid: started.pid });
    assert.equal(status.running, false);
    assert.ok(status.stdoutOffset >= first.nextStdoutOffset);
    // After stop the log file must still be readable via readProcessOutput.
    const recovered = await readProcessOutput({ ...access, pid: started.pid });
    assert.match(recovered.stdout, /recover-me/);
  });
});

test('writeProcessInput delivers stdin and is unavailable after stop', async () => {
  await withRoot('machine-mcp-proc-stdin-', async (root) => {
    const access = { root, unrestricted: false };
    const started = await startProcess({
      ...access,
      command: "node -e \"process.stdin.once('data', d=>{console.log('echo:'+d.toString().trim()); setTimeout(()=>{}, 5000)})\"",
    });
    try {
      const written = await writeProcessInput({ ...access, pid: started.pid, input: 'hello\n' });
      assert.ok(written.bytes > 0);
      const out = await readProcessOutput({ ...access, pid: started.pid, waitMs: 4000 });
      assert.match(out.stdout, /echo:hello/);
    } finally {
      await stopProcess({ ...access, pid: started.pid }).catch(() => undefined);
    }
    // After stop, stdin must be unavailable.
    await assert.rejects(
      writeProcessInput({ ...access, pid: started.pid, input: 'after\n' }),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        assert.match(msg, /Standard input|not attached|PROCESS_IO_UNAVAILABLE/);
        return true;
      },
    );
  });
});

test('listManagedProcesses reflects running and finished', async () => {
  await withRoot('machine-mcp-proc-list-', async (root) => {
    const access = { root, unrestricted: false };
    const started = await startProcess({
      ...access,
      command: "node -e \"setTimeout(()=>{}, 7000)\"",
    });
    try {
      const before = await listManagedProcesses(access);
      assert.ok(before.some((p) => p.pid === started.pid && p.running === true));

      await stopProcess({ ...access, pid: started.pid });

      const after = await listManagedProcesses(access);
      const entry = after.find((p) => p.pid === started.pid);
      assert.ok(entry);
      assert.equal(entry.running, false);
    } finally {
      await stopProcess({ ...access, pid: started.pid }).catch(() => undefined);
    }
  });
});
