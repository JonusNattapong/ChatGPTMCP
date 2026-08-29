import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, type WriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { redactCommandForStorage } from './audit.js';
import { ToolError } from './errors.js';
import { resolveMachinePath, type MachineAccess, type ShellKind } from './shell-tools.js';

const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;
const OUTPUT_POLL_INTERVAL_MS = 50;
const MAX_WAIT_MS = 60_000;
const STOP_GRACE_MS = 3_000;
const STOP_TIMEOUT_MS = 8_000;

export interface StartProcessOptions extends MachineAccess {
  command: string;
  workdir?: string;
  shell?: ShellKind;
  env?: Record<string, string>;
}

export interface ProcessPidOptions extends MachineAccess {
  pid: number;
}

export interface ReadProcessOutputOptions extends ProcessPidOptions {
  sinceStdout?: number;
  sinceStderr?: number;
  waitMs?: number;
}

export interface WriteProcessInputOptions extends ProcessPidOptions {
  input: string;
  end?: boolean;
}

interface PersistedProcess {
  pid: number;
  root: string;
  command: string;
  workdir: string;
  shell: Exclude<ShellKind, 'auto'>;
  stdoutLogPath: string;
  stderrLogPath: string;
  outputTruncated: boolean;
  capturedBytes: number;
  startedAt: number;
  finishedAt?: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

interface ManagedProcess extends Omit<PersistedProcess, 'pid'> {
  child?: ChildProcess;
  stdout: string;
  stderr: string;
  stdoutDecoder: StringDecoder;
  stderrDecoder: StringDecoder;
  stdoutLog?: WriteStream;
  stderrLog?: WriteStream;
  settled?: Promise<void>;
}

const managed = new Map<number, ManagedProcess>();
const loadedRoots = new Set<string>();
let persistQueue: Promise<void> = Promise.resolve();

function selectShell(shell: ShellKind): { kind: Exclude<ShellKind, 'auto'>; executable: string; args: string[] } {
  const selected = shell === 'auto' ? (process.platform === 'win32' ? 'powershell' : 'bash') : shell;
  if (selected === 'powershell') return { kind: selected, executable: process.platform === 'win32' ? 'powershell.exe' : 'pwsh', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'] };
  if (selected === 'cmd') {
    if (process.platform !== 'win32') throw new ToolError('INVALID_ARGUMENT', 'The cmd shell is only available on Windows.');
    return { kind: selected, executable: 'cmd.exe', args: ['/d', '/s', '/c'] };
  }
  return { kind: selected, executable: 'bash', args: ['-lc'] };
}

function runtimeDirectory(root: string): string {
  return path.join(root, '.chatgpt-machine', 'processes');
}

function registryPath(root: string): string {
  return path.join(root, '.chatgpt-machine', 'processes.json');
}

async function persistRoot(root: string): Promise<void> {
  const entries: PersistedProcess[] = [...managed.entries()]
    .filter(([, info]) => info.root === root)
    .map(([pid, info]) => ({
      pid,
      root: info.root,
      command: redactCommandForStorage(info.command),
      workdir: info.workdir,
      shell: info.shell,
      stdoutLogPath: info.stdoutLogPath,
      stderrLogPath: info.stderrLogPath,
      outputTruncated: info.outputTruncated,
      capturedBytes: info.capturedBytes,
      startedAt: info.startedAt,
      finishedAt: info.finishedAt,
      exitCode: info.exitCode,
      signal: info.signal,
    }));
  const destination = registryPath(root);
  const temporary = `${destination}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  persistQueue = persistQueue.then(async () => {
    try {
      // A temporary workspace may legitimately be removed immediately after a
      // process is stopped. Never recreate a deleted root just to persist stale
      // bookkeeping from an already-finished child.
      await fs.access(root);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(temporary, JSON.stringify({ version: 1, processes: entries }, null, 2), 'utf8');
      await fs.rename(temporary, destination);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }).catch((error) => {
    console.error('[chatgpt-machine-mcp] process registry write failed:', error instanceof Error ? error.message : String(error));
  });
  return persistQueue;
}

function closeWriteStream(stream: WriteStream | undefined): Promise<void> {
  if (!stream || stream.closed) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    stream.once('close', done);
    stream.once('error', done);
    if (!stream.writableEnded) stream.end();
  });
}

async function ensureLoaded(access: MachineAccess): Promise<void> {
  const root = path.resolve(access.root);
  if (loadedRoots.has(root)) return;
  loadedRoots.add(root);
  try {
    const parsed = JSON.parse(await fs.readFile(registryPath(root), 'utf8')) as { processes?: PersistedProcess[] };
    for (const entry of parsed.processes ?? []) {
      if (!Number.isInteger(entry.pid) || entry.pid < 1 || managed.has(entry.pid)) continue;
      managed.set(entry.pid, {
        root,
        command: entry.command,
        workdir: entry.workdir,
        shell: entry.shell,
        stdoutLogPath: entry.stdoutLogPath,
        stderrLogPath: entry.stderrLogPath,
        outputTruncated: entry.outputTruncated,
        capturedBytes: entry.capturedBytes ?? 0,
        startedAt: entry.startedAt,
        finishedAt: entry.finishedAt,
        exitCode: entry.exitCode,
        signal: entry.signal,
        stdout: '',
        stderr: '',
        stdoutDecoder: new StringDecoder('utf8'),
        stderrDecoder: new StringDecoder('utf8'),
      });
    }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.error('[chatgpt-machine-mcp] process registry read failed:', error instanceof Error ? error.message : String(error));
    }
  }
}

function appendOutput(info: ManagedProcess, stream: 'stdout' | 'stderr', chunk: Buffer): void {
  const remaining = Math.max(0, MAX_CAPTURE_BYTES - info.capturedBytes);
  const accepted = chunk.subarray(0, remaining);
  info.capturedBytes += accepted.length;
  if (accepted.length < chunk.length) info.outputTruncated = true;
  if (!accepted.length) return;

  const decoder = stream === 'stdout' ? info.stdoutDecoder : info.stderrDecoder;
  const value = decoder.write(accepted);
  if (stream === 'stdout') {
    info.stdout += value;
    info.stdoutLog?.write(accepted);
  } else {
    info.stderr += value;
    info.stderrLog?.write(accepted);
  }
}

async function pidAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException)?.code;
    return code === 'EPERM';
  }
}

async function refreshRecovered(pid: number, info: ManagedProcess): Promise<boolean> {
  if (info.child) return info.exitCode === null && info.finishedAt === undefined;
  if (info.finishedAt !== undefined || info.exitCode !== null) return false;
  const alive = await pidAlive(pid);
  if (!alive) {
    info.finishedAt = Date.now();
    await persistRoot(info.root);
  }
  return alive;
}

async function getManaged(pid: number, access: ProcessPidOptions): Promise<ManagedProcess> {
  if (!Number.isInteger(pid) || pid < 1) throw new ToolError('INVALID_ARGUMENT', '"pid" must be a positive integer.');
  await ensureLoaded(access);
  const info = managed.get(pid);
  if (!info) {
    throw new ToolError(
      'PROCESS_NOT_MANAGED',
      `Process ${pid} is not managed by this MCP runtime.`,
      'Only processes started by start_process and recorded by this runtime can be inspected.',
      { managedPids: [...managed.keys()] },
    );
  }
  return info;
}

async function readLog(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return '';
    throw error;
  }
}

export async function startProcess(options: StartProcessOptions) {
  if (!options.command.trim()) throw new ToolError('INVALID_ARGUMENT', '"command" parameter is required.');
  await ensureLoaded(options);
  const workdir = await resolveMachinePath(options, options.workdir || '.', true);
  const shell = selectShell(options.shell ?? 'auto');
  const child = spawn(shell.executable, [...shell.args, options.command], {
    cwd: workdir,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (!child.pid) throw new ToolError('INTERNAL', 'The process started without a PID.');

  const directory = runtimeDirectory(path.resolve(options.root));
  await fs.mkdir(directory, { recursive: true });
  const stdoutLogPath = path.join(directory, `${child.pid}.stdout.log`);
  const stderrLogPath = path.join(directory, `${child.pid}.stderr.log`);
  await Promise.all([fs.writeFile(stdoutLogPath, ''), fs.writeFile(stderrLogPath, '')]);

  let settleProcess!: () => void;
  const settled = new Promise<void>((resolve) => { settleProcess = resolve; });

  const info: ManagedProcess = {
    child,
    root: path.resolve(options.root),
    command: options.command,
    workdir,
    shell: shell.kind,
    stdout: '',
    stderr: '',
    stdoutDecoder: new StringDecoder('utf8'),
    stderrDecoder: new StringDecoder('utf8'),
    stdoutLogPath,
    stderrLogPath,
    stdoutLog: createWriteStream(stdoutLogPath, { flags: 'a' }),
    stderrLog: createWriteStream(stderrLogPath, { flags: 'a' }),
    outputTruncated: false,
    capturedBytes: 0,
    startedAt: Date.now(),
    exitCode: null,
    signal: null,
    settled,
  };
  managed.set(child.pid, info);
  await persistRoot(info.root);

  child.stdout?.on('data', (chunk: Buffer) => appendOutput(info, 'stdout', chunk));
  child.stderr?.on('data', (chunk: Buffer) => appendOutput(info, 'stderr', chunk));
  child.on('error', (error) => {
    appendOutput(info, 'stderr', Buffer.from(`${info.stderr ? '\n' : ''}${error.message}`, 'utf8'));
  });
  child.on('close', (exitCode, signal) => {
    void (async () => {
      try {
        info.stdout += info.stdoutDecoder.end();
        info.stderr += info.stderrDecoder.end();
        info.exitCode = exitCode;
        info.signal = signal;
        info.finishedAt = Date.now();
        await Promise.all([closeWriteStream(info.stdoutLog), closeWriteStream(info.stderrLog)]);
        await persistRoot(info.root);
      } finally {
        settleProcess();
      }
    })();
  });
  child.unref();
  return {
    pid: child.pid,
    command: info.command,
    workdir,
    shell: info.shell,
    startedAt: new Date(info.startedAt).toISOString(),
    durable: true,
    stdinAvailable: child.stdin?.writable === true,
  };
}

export async function listManagedProcesses(access?: MachineAccess) {
  if (access) await ensureLoaded(access);
  return Promise.all([...managed.entries()].map(async ([pid, info]) => ({
    pid,
    running: await refreshRecovered(pid, info),
    recovered: !info.child,
    command: info.command,
    workdir: info.workdir,
    exitCode: info.exitCode,
    startedAt: new Date(info.startedAt).toISOString(),
  })));
}

export async function processStatus(options: ProcessPidOptions) {
  const info = await getManaged(options.pid, options);
  const running = await refreshRecovered(options.pid, info);
  const stdout = info.child ? info.stdout : await readLog(info.stdoutLogPath);
  const stderr = info.child ? info.stderr : await readLog(info.stderrLogPath);
  return {
    pid: options.pid,
    running,
    recovered: !info.child,
    exitCode: info.exitCode,
    signal: info.signal,
    command: info.command,
    workdir: info.workdir,
    shell: info.shell,
    startedAt: new Date(info.startedAt).toISOString(),
    finishedAt: info.finishedAt === undefined ? undefined : new Date(info.finishedAt).toISOString(),
    runtimeMs: (info.finishedAt ?? Date.now()) - info.startedAt,
    stdoutOffset: stdout.length,
    stderrOffset: stderr.length,
    outputTruncated: info.outputTruncated,
    stdinAvailable: info.child?.stdin?.writable === true,
  };
}

export async function readProcessOutput(options: ReadProcessOutputOptions) {
  const info = await getManaged(options.pid, options);
  const sinceStdout = options.sinceStdout ?? 0;
  const sinceStderr = options.sinceStderr ?? 0;
  const waitMs = options.waitMs ?? 0;
  for (const [name, value] of [['since_stdout', sinceStdout], ['since_stderr', sinceStderr]] as const) {
    if (!Number.isInteger(value) || value < 0) throw new ToolError('INVALID_ARGUMENT', `"${name}" must be a non-negative integer offset.`);
  }
  if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > MAX_WAIT_MS) {
    throw new ToolError('INVALID_ARGUMENT', `"wait_ms" must be an integer between 0 and ${MAX_WAIT_MS}.`);
  }

  const readCurrent = async () => ({
    stdout: info.child ? info.stdout : await readLog(info.stdoutLogPath),
    stderr: info.child ? info.stderr : await readLog(info.stderrLogPath),
  });
  let current = await readCurrent();
  const hasNewOutput = () => current.stdout.length > sinceStdout || current.stderr.length > sinceStderr;
  const deadline = Date.now() + waitMs;
  let running = await refreshRecovered(options.pid, info);
  while (waitMs > 0 && !hasNewOutput() && running && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, OUTPUT_POLL_INTERVAL_MS));
    current = await readCurrent();
    running = await refreshRecovered(options.pid, info);
  }

  return {
    pid: options.pid,
    running,
    recovered: !info.child,
    exitCode: info.exitCode,
    stdout: current.stdout.slice(Math.min(sinceStdout, current.stdout.length)),
    stderr: current.stderr.slice(Math.min(sinceStderr, current.stderr.length)),
    nextStdoutOffset: current.stdout.length,
    nextStderrOffset: current.stderr.length,
    outputTruncated: info.outputTruncated,
  };
}

export async function writeProcessInput(options: WriteProcessInputOptions) {
  const info = await getManaged(options.pid, options);
  if (!info.child?.stdin?.writable) {
    throw new ToolError(
      'PROCESS_IO_UNAVAILABLE',
      `Standard input for process ${options.pid} is not attached to this MCP process.`,
      'Recovered processes can be inspected and stopped after an MCP restart, but their stdin pipe cannot be reattached.',
    );
  }
  await new Promise<void>((resolve, reject) => {
    const writable = info.child!.stdin!;
    const done = (error?: Error | null) => error ? reject(error) : resolve();
    if (writable.write(options.input, 'utf8')) resolve();
    else writable.once('drain', resolve).once('error', done);
  });
  if (options.end) info.child.stdin.end();
  return { pid: options.pid, bytes: Buffer.byteLength(options.input), ended: options.end === true };
}

export async function stopProcess(options: ProcessPidOptions) {
  const info = await getManaged(options.pid, options);
  const wasRunning = await refreshRecovered(options.pid, info);
  if (!wasRunning) {
    return { pid: options.pid, stopped: false, alreadyExited: true, exited: true, exitCode: info.exitCode, recovered: !info.child };
  }

  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/pid', String(options.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    await new Promise<void>((resolve) => { killer.once('close', () => resolve()); killer.once('error', () => resolve()); });
  } else if (info.child) {
    try { process.kill(-options.pid, 'SIGTERM'); } catch { info.child.kill('SIGTERM'); }
  } else {
    try { process.kill(options.pid, 'SIGTERM'); } catch { /* already gone */ }
  }

  const startedWaitingAt = Date.now();
  let escalated = false;
  while (await pidAlive(options.pid) && Date.now() - startedWaitingAt < STOP_TIMEOUT_MS) {
    if (!escalated && process.platform !== 'win32' && Date.now() - startedWaitingAt > STOP_GRACE_MS) {
      escalated = true;
      try { process.kill(info.child ? -options.pid : options.pid, 'SIGKILL'); } catch { /* already gone */ }
    }
    await new Promise((resolve) => setTimeout(resolve, OUTPUT_POLL_INTERVAL_MS));
  }

  if (info.settled) {
    await Promise.race([
      info.settled,
      new Promise<void>((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS)),
    ]);
  }
  if (process.platform === 'win32') {
    // taskkill can report completion a few milliseconds before Windows releases
    // the last descendant CWD/file handle. Give the kernel a bounded grace
    // period so the documented "stop, then delete workdir" sequence is reliable.
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (!info.child && info.finishedAt === undefined) info.finishedAt = Date.now();
  await persistRoot(info.root);
  return {
    pid: options.pid,
    stopped: true,
    alreadyExited: false,
    exited: !(await pidAlive(options.pid)),
    exitCode: info.exitCode,
    signal: info.signal,
    recovered: !info.child,
    waitedMs: Date.now() - startedWaitingAt,
  };
}
