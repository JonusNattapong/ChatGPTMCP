import { spawn, type ChildProcess } from 'node:child_process';
import { resolveMachinePath, type MachineAccess, type ShellKind } from './shell-tools.js';
import { StringDecoder } from 'node:string_decoder';

const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;

export interface StartProcessOptions extends MachineAccess {
  command: string;
  workdir?: string;
  shell?: ShellKind;
}

export interface ProcessPidOptions extends MachineAccess {
  pid: number;
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
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

const managed = new Map<number, ManagedProcess>();

function selectShell(shell: ShellKind): { kind: Exclude<ShellKind, 'auto'>; executable: string; args: string[] } {
  const selected = shell === 'auto' ? (process.platform === 'win32' ? 'powershell' : 'bash') : shell;
  if (selected === 'powershell') return { kind: selected, executable: process.platform === 'win32' ? 'powershell.exe' : 'pwsh', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'] };
  if (selected === 'cmd') {
    if (process.platform !== 'win32') throw new Error('The cmd shell is only available on Windows.');
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
  if (!options.command.trim()) throw new Error('"command" parameter is required.');
  const workdir = await resolveMachinePath(options, options.workdir || '.', true);
  const shell = selectShell(options.shell ?? 'auto');
  const child = spawn(shell.executable, [...shell.args, options.command], {
    cwd: workdir,
    env: process.env,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!child.pid) throw new Error('The process started without a PID.');
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
  });
  child.unref();
  return { pid: child.pid, command: processInfo.command, workdir, shell: processInfo.shell, startedAt: new Date(processInfo.startedAt).toISOString() };
}

function getManaged(pid: number, options: ProcessPidOptions): ManagedProcess {
  if (!Number.isInteger(pid) || pid < 1) throw new Error('"pid" must be a positive integer.');
  const processInfo = managed.get(pid);
  if (!processInfo && !options.unrestricted) throw new Error('In workspace-only mode, pid must belong to a process started by start_process in this session.');
  if (!processInfo) throw new Error(`Process ${pid} is not managed by this MCP session.`);
  return processInfo;
}

export async function processStatus(options: ProcessPidOptions) {
  const info = getManaged(options.pid, options);
  return { pid: options.pid, running: info.exitCode === null && !info.child.killed, exitCode: info.exitCode, signal: info.signal, command: info.command, workdir: info.workdir, shell: info.shell, startedAt: new Date(info.startedAt).toISOString(), outputTruncated: info.outputTruncated };
}

export async function readProcessOutput(options: ProcessPidOptions) {
  const info = getManaged(options.pid, options);
  return { pid: options.pid, running: info.exitCode === null && !info.child.killed, stdout: info.stdout, stderr: info.stderr, outputTruncated: info.outputTruncated };
}

export async function stopProcess(options: ProcessPidOptions) {
  const info = getManaged(options.pid, options);
  if (info.exitCode !== null) return { pid: options.pid, stopped: false, alreadyExited: true, exitCode: info.exitCode };
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/pid', String(options.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    await new Promise<void>((resolve) => { killer.once('close', () => resolve()); killer.once('error', () => resolve()); });
  } else {
    try { process.kill(-options.pid, 'SIGTERM'); } catch { info.child.kill('SIGTERM'); }
  }
  return { pid: options.pid, stopped: true };
}
