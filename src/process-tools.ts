import { spawn, type ChildProcess } from 'node:child_process';
import { ToolError } from './errors.js';
import { resolveMachinePath, type MachineAccess, type ShellKind } from './shell-tools.js';
import { StringDecoder } from 'node:string_decoder';

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
  /** Character offsets returned by a previous call; only newer output is returned. */
  sinceStdout?: number;
  sinceStderr?: number;
  /** Block up to this long for new output or for the process to exit. */
  waitMs?: number;
}

interface ManagedProcess {
  child: ChildProcess;
  command: string;
  workdir: string;
  shell: Exclude<ShellKind, 'auto'>;
  stdout: string;
  stderr: string;
  stdoutDecoder: StringDecoder;
  stderrDecoder: StringDecoder;
  outputTruncated: boolean;
  startedAt: number;
  finishedAt?: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

const managed = new Map<number, ManagedProcess>();

function selectShell(shell: ShellKind): { kind: Exclude<ShellKind, 'auto'>; executable: string; args: string[] } {
  const selected = shell === 'auto' ? (process.platform === 'win32' ? 'powershell' : 'bash') : shell;
  if (selected === 'powershell') return { kind: selected, executable: process.platform === 'win32' ? 'powershell.exe' : 'pwsh', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'] };
  if (selected === 'cmd') {
    if (process.platform !== 'win32') {
      throw new ToolError('INVALID_ARGUMENT', 'The cmd shell is only available on Windows.');
    }
    return { kind: selected, executable: 'cmd.exe', args: ['/d', '/s', '/c'] };
  }
  return { kind: selected, executable: 'bash', args: ['-lc'] };
}

function appendOutput(processInfo: ManagedProcess, stream: 'stdout' | 'stderr', chunk: Buffer): void {
  const current = stream === 'stdout' ? processInfo.stdout : processInfo.stderr;
  const used = Buffer.byteLength(processInfo.stdout) + Buffer.byteLength(processInfo.stderr);
  const accepted = chunk.subarray(0, Math.max(0, MAX_CAPTURE_BYTES - used));
  const decoder = stream === 'stdout' ? processInfo.stdoutDecoder : processInfo.stderrDecoder;
  const value = decoder.write(accepted);
  if (stream === 'stdout') processInfo.stdout = current + value;
  else processInfo.stderr = current + value;
  if (accepted.length < chunk.length) processInfo.outputTruncated = true;
}

export async function startProcess(options: StartProcessOptions) {
  if (!options.command.trim()) throw new ToolError('INVALID_ARGUMENT', '"command" parameter is required.');
  const workdir = await resolveMachinePath(options, options.workdir || '.', true);
  const shell = selectShell(options.shell ?? 'auto');
  const child = spawn(shell.executable, [...shell.args, options.command], {
    cwd: workdir,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!child.pid) throw new ToolError('INTERNAL', 'The process started without a PID.');
  const processInfo: ManagedProcess = {
    child, command: options.command, workdir, shell: shell.kind, stdout: '', stderr: '',
    stdoutDecoder: new StringDecoder('utf8'), stderrDecoder: new StringDecoder('utf8'),
    outputTruncated: false, startedAt: Date.now(), exitCode: null, signal: null,
  };
  managed.set(child.pid, processInfo);
  child.stdout?.on('data', (chunk: Buffer) => appendOutput(processInfo, 'stdout', chunk));
  child.stderr?.on('data', (chunk: Buffer) => appendOutput(processInfo, 'stderr', chunk));
  child.on('error', (error) => { processInfo.stderr += `${processInfo.stderr ? '\n' : ''}${error.message}`; });
  child.on('close', (exitCode, signal) => {
    processInfo.stdout += processInfo.stdoutDecoder.end();
    processInfo.stderr += processInfo.stderrDecoder.end();
    processInfo.exitCode = exitCode;
    processInfo.signal = signal;
    processInfo.finishedAt = Date.now();
  });
  child.unref();
  return { pid: child.pid, command: processInfo.command, workdir, shell: processInfo.shell, startedAt: new Date(processInfo.startedAt).toISOString() };
}

function getManaged(pid: number, options: ProcessPidOptions): ManagedProcess {
  if (!Number.isInteger(pid) || pid < 1) {
    throw new ToolError('INVALID_ARGUMENT', '"pid" must be a positive integer.');
  }
  const processInfo = managed.get(pid);
  if (!processInfo) {
    throw new ToolError(
      'PROCESS_NOT_MANAGED',
      `Process ${pid} is not managed by this MCP session.`,
      'Only processes started by start_process in this session can be inspected. Check machine_status for the managed PIDs.',
      { managedPids: [...managed.keys()] },
    );
  }
  return processInfo;
}

function isRunning(info: ManagedProcess): boolean {
  return info.exitCode === null && !info.child.killed;
}

/** Summary used by machine_status so callers can recover PIDs they lost track of. */
export function listManagedProcesses() {
  return [...managed.entries()].map(([pid, info]) => ({
    pid,
    running: isRunning(info),
    command: info.command,
    workdir: info.workdir,
    exitCode: info.exitCode,
    startedAt: new Date(info.startedAt).toISOString(),
  }));
}

export async function processStatus(options: ProcessPidOptions) {
  const info = getManaged(options.pid, options);
  const running = isRunning(info);
  return {
    pid: options.pid,
    running,
    exitCode: info.exitCode,
    signal: info.signal,
    command: info.command,
    workdir: info.workdir,
    shell: info.shell,
    startedAt: new Date(info.startedAt).toISOString(),
    finishedAt: info.finishedAt === undefined ? undefined : new Date(info.finishedAt).toISOString(),
    runtimeMs: (info.finishedAt ?? Date.now()) - info.startedAt,
    stdoutOffset: info.stdout.length,
    stderrOffset: info.stderr.length,
    outputTruncated: info.outputTruncated,
  };
}

/**
 * Incremental reads: a long-running process is polled repeatedly, and resending
 * the whole capture buffer every time wastes the caller's context window. The
 * returned offsets are passed back as "since_stdout"/"since_stderr".
 */
export async function readProcessOutput(options: ReadProcessOutputOptions) {
  const info = getManaged(options.pid, options);
  const sinceStdout = options.sinceStdout ?? 0;
  const sinceStderr = options.sinceStderr ?? 0;
  const waitMs = options.waitMs ?? 0;
  for (const [name, value] of [['since_stdout', sinceStdout], ['since_stderr', sinceStderr]] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new ToolError('INVALID_ARGUMENT', `"${name}" must be a non-negative integer offset.`);
    }
  }
  if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > MAX_WAIT_MS) {
    throw new ToolError('INVALID_ARGUMENT', `"wait_ms" must be an integer between 0 and ${MAX_WAIT_MS}.`);
  }

  const hasNewOutput = () => info.stdout.length > sinceStdout || info.stderr.length > sinceStderr;
  const deadline = Date.now() + waitMs;
  while (waitMs > 0 && !hasNewOutput() && isRunning(info) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, OUTPUT_POLL_INTERVAL_MS));
  }

  return {
    pid: options.pid,
    running: isRunning(info),
    exitCode: info.exitCode,
    stdout: info.stdout.slice(Math.min(sinceStdout, info.stdout.length)),
    stderr: info.stderr.slice(Math.min(sinceStderr, info.stderr.length)),
    nextStdoutOffset: info.stdout.length,
    nextStderrOffset: info.stderr.length,
    outputTruncated: info.outputTruncated,
  };
}

/**
 * Waits for the child to actually exit rather than returning as soon as the kill
 * is issued: callers routinely delete the working directory next, which fails on
 * Windows while the process still holds it.
 */
export async function stopProcess(options: ProcessPidOptions) {
  const info = getManaged(options.pid, options);
  if (info.exitCode !== null) {
    return { pid: options.pid, stopped: false, alreadyExited: true, exited: true, exitCode: info.exitCode };
  }

  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/pid', String(options.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    await new Promise<void>((resolve) => { killer.once('close', () => resolve()); killer.once('error', () => resolve()); });
  } else {
    try { process.kill(-options.pid, 'SIGTERM'); } catch { info.child.kill('SIGTERM'); }
  }

  const startedWaitingAt = Date.now();
  let escalated = false;
  while (info.exitCode === null && Date.now() - startedWaitingAt < STOP_TIMEOUT_MS) {
    if (!escalated && process.platform !== 'win32' && Date.now() - startedWaitingAt > STOP_GRACE_MS) {
      escalated = true;
      try { process.kill(-options.pid, 'SIGKILL'); } catch { info.child.kill('SIGKILL'); }
    }
    await new Promise((resolve) => setTimeout(resolve, OUTPUT_POLL_INTERVAL_MS));
  }

  return {
    pid: options.pid,
    stopped: true,
    alreadyExited: false,
    exited: info.exitCode !== null,
    exitCode: info.exitCode,
    signal: info.signal,
    waitedMs: Date.now() - startedWaitingAt,
  };
}
