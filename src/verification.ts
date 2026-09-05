import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { redactSecrets } from './audit.js';
import { startProcess, waitProcess, stopProcess, readProcessOutput } from './process-tools.js';
import { ToolError } from './errors.js';
import { gitAdd, gitCommit, gitStatus, gitUnstage } from './git-tools.js';
import { resolveMachinePath, type MachineAccess } from './shell-tools.js';

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_BYTES = 256 * 1024;
const OUTPUT_TAIL_CHARS = 8_000;

export type VerificationProfile = 'fast' | 'normal' | 'strict';

export interface VerificationOptions extends MachineAccess {
  path?: string;
  profile?: VerificationProfile;
  timeoutMs?: number;
  totalTimeoutMs?: number;
}

export interface VerifiedCommitOptions extends VerificationOptions {
  paths: string[];
  message: string;
}

interface VerificationCommand {
  name: string;
  executable: string;
  args: string[];
}

function tail(value: string | undefined): string {
  const text = value ?? '';
  return text.length <= OUTPUT_TAIL_CHARS ? text : text.slice(-OUTPUT_TAIL_CHARS);
}

function npmRun(name: string): VerificationCommand {
  if (process.platform === 'win32') {
    // Node cannot execute .cmd shims directly with execFile on all supported
    // Windows releases. The command and script name are fixed/detected values,
    // so routing the npm shim through cmd.exe does not expose shell input.
    return { name: `npm run ${name}`, executable: 'cmd.exe', args: ['/d', '/s', '/c', `npm run ${name}`] };
  }
  return { name: `npm run ${name}`, executable: 'npm', args: ['run', name] };
}

function referencesScript(script: string | undefined, name: string): boolean {
  if (!script) return false;
  return new RegExp(`(?:npm|pnpm|yarn)\\s+(?:run\\s+)?${name}(?:\\s|$|&&|;)`, 'i').test(script);
}

function uniqueCommands(commands: Array<VerificationCommand | undefined>): VerificationCommand[] {
  const seen = new Set<string>();
  return commands.filter((command): command is VerificationCommand => {
    if (!command || seen.has(command.name)) return false;
    seen.add(command.name);
    return true;
  });
}

function nodeCommands(scripts: Record<string, string>, profile: VerificationProfile): VerificationCommand[] {
  const has = (name: string) => typeof scripts[name] === 'string' ? npmRun(name) : undefined;
  if (profile === 'strict' && scripts.verify) return [npmRun('verify')];

  if (profile === 'fast') {
    return uniqueCommands([
      has('check'),
      has('typecheck'),
      has('build'),
      has('lint'),
      has('test'),
    ]).slice(0, 1);
  }

  const typeGate = has('check') ?? has('typecheck');
  const test = has('test');
  const build = scripts.build && !referencesScript(scripts.test, 'build') ? has('build') : undefined;
  if (profile === 'normal') return uniqueCommands([typeGate, test, build]);

  return uniqueCommands([
    has('lint'),
    has('typecheck'),
    has('check'),
    test,
    build,
  ]);
}

async function pythonCommands(cwd: string, profile: VerificationProfile): Promise<VerificationCommand[]> {
  let pyprojectContent = '';
  const pyprojectPath = path.join(cwd, 'pyproject.toml');
  if (existsSync(pyprojectPath)) {
    try { pyprojectContent = await readFile(pyprojectPath, 'utf8'); } catch { /* ignore */ }
  }
  const hasRuff = pyprojectContent.includes('[tool.ruff]');
  const hasMypy = pyprojectContent.includes('[tool.mypy]');
  const testCmd: VerificationCommand = {
    name: profile === 'fast' ? 'python -m pytest -q' : 'python -m pytest',
    executable: 'python',
    args: profile === 'fast' ? ['-m', 'pytest', '-q'] : ['-m', 'pytest'],
  };
  const ruffCmd: VerificationCommand = { name: 'ruff check', executable: 'ruff', args: ['check'] };
  const mypyCmd: VerificationCommand = { name: 'mypy .', executable: 'mypy', args: ['.'] };

  if (profile === 'fast') {
    return [hasRuff ? ruffCmd : testCmd];
  }
  if (profile === 'normal') {
    return hasRuff ? [ruffCmd, testCmd] : [testCmd];
  }
  const list: VerificationCommand[] = [];
  if (hasRuff) list.push(ruffCmd);
  if (hasMypy) list.push(mypyCmd);
  list.push(testCmd);
  return list;
}

async function detectCommands(cwd: string, profile: VerificationProfile): Promise<{ projectType: string; commands: VerificationCommand[] }> {
  const packageFile = path.join(cwd, 'package.json');
  if (existsSync(packageFile)) {
    const pkg = JSON.parse(await readFile(packageFile, 'utf8')) as { scripts?: Record<string, string> };
    return { projectType: 'node', commands: nodeCommands(pkg.scripts ?? {}, profile) };
  }
  if (existsSync(path.join(cwd, 'pyproject.toml')) || existsSync(path.join(cwd, 'requirements.txt')) || existsSync(path.join(cwd, 'setup.py')) || existsSync(path.join(cwd, 'Pipfile'))) {
    return { projectType: 'python', commands: await pythonCommands(cwd, profile) };
  }
  if (existsSync(path.join(cwd, 'go.mod'))) {
    const test: VerificationCommand = { name: 'go test ./...', executable: 'go', args: ['test', './...'] };
    return {
      projectType: 'go',
      commands: profile === 'strict'
        ? [{ name: 'go vet ./...', executable: 'go', args: ['vet', './...'] }, test]
        : [test],
    };
  }
  if (existsSync(path.join(cwd, 'Cargo.toml'))) {
    const check: VerificationCommand = { name: 'cargo check', executable: 'cargo', args: ['check'] };
    const test: VerificationCommand = { name: 'cargo test', executable: 'cargo', args: ['test'] };
    return { projectType: 'rust', commands: profile === 'fast' ? [check] : profile === 'normal' ? [test] : [check, test] };
  }
  return { projectType: 'unknown', commands: [] };
}

export function parseDiagnostics(text: string) {
  const diagnostics: Array<{ file: string; line: number; column?: number; code?: string; message: string }> = [];
  for (const line of text.split(/\r?\n/)) {
    const ts = /^(.*?)\((\d+),(\d+)\):\s*(?:error|warning)\s+([A-Z]+\d+):\s*(.*)$/.exec(line);
    const generic = /^(.*?):(\d+)(?::(\d+))?:\s*(.+)$/.exec(line);
    const pyTraceback = /^\s*File\s+"([^"]+)",\s+line\s+(\d+)(?:,\s+in\s+(.+))?/.exec(line);
    const pytestFailed = /^FAILED\s+([^:]+)::([^\s]+)\s+-\s+(.+)$/.exec(line);
    if (ts) diagnostics.push({ file: ts[1], line: Number(ts[2]), column: Number(ts[3]), code: ts[4], message: ts[5] });
    else if (pyTraceback) diagnostics.push({ file: pyTraceback[1], line: Number(pyTraceback[2]), message: pyTraceback[3] ? `in ${pyTraceback[3]}` : 'traceback' });
    else if (pytestFailed) diagnostics.push({ file: pytestFailed[1], line: 1, code: pytestFailed[2], message: pytestFailed[3] });
    else if (generic) diagnostics.push({ file: generic[1], line: Number(generic[2]), column: generic[3] ? Number(generic[3]) : undefined, message: generic[4] });
    if (diagnostics.length >= 200) break;
  }
  return diagnostics;
}

export async function verifyChanges(options: VerificationOptions) {
  const cwd = await resolveMachinePath(options, options.path ?? '.', true);
  const profile = options.profile ?? 'normal';
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!['fast', 'normal', 'strict'].includes(profile)) throw new ToolError('INVALID_ARGUMENT', 'Verification profile must be fast, normal, or strict.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 11 * 60_000) {
    throw new ToolError('INVALID_ARGUMENT', 'Verification timeout must be an integer between 1000 and 660000 milliseconds.');
  }

  const totalTimeoutMs = options.totalTimeoutMs ?? timeoutMs;
  if (!Number.isInteger(totalTimeoutMs) || totalTimeoutMs < 1000 || totalTimeoutMs > 660000) throw new ToolError('INVALID_ARGUMENT', 'total_timeout_ms must be between 1000 and 660000.');
  const deadline = Date.now() + totalTimeoutMs;
  const detected = await detectCommands(cwd, profile);
  if (detected.commands.length === 0) {
    return {
      ok: false,
      profile,
      path: cwd,
      projectType: detected.projectType,
      checks: [],
      reason: detected.projectType === 'node' ? 'No verification scripts were found in package.json.' : 'No supported verification strategy was detected.',
    };
  }

  const checks: Array<{ name: string; ok: boolean; exitCode: number | null; durationMs: number; stdout: string; stderr: string; timedOut: boolean; logPath?: string; outputTruncated?: boolean; diagnostics: ReturnType<typeof parseDiagnostics> }> = [];
  const runId = randomUUID();
  for (const command of detected.commands) {
    const startedAt = Date.now();
    if (deadline - startedAt < 100) {
      checks.push({ name: command.name, ok: false, exitCode: null, durationMs: 0, stdout: '', stderr: '', timedOut: true, diagnostics: [] });
      break;
    }
    const started = await startProcess({ ...options, workdir: cwd,
      command: command.name, shell: process.platform === 'win32' ? 'cmd' : 'bash' });
    let timedOut = false;
    try {
      const remaining = Math.min(timeoutMs, deadline - Date.now());
      timedOut = remaining < 100 || (await waitProcess({ ...options, pid: started.pid, processId: started.processId, timeoutMs: Math.max(100, remaining), maxTimeoutMs: 660000 })).timedOut;
      if (timedOut) await stopProcess({ ...options, pid: started.pid, processId: started.processId });
      const result = await readProcessOutput({ ...options, pid: started.pid, processId: started.processId });
      const stdout = redactSecrets(result.stdout) as string;
      const stderr = redactSecrets(result.stderr) as string;
      const logPath = await resolveMachinePath(options, path.join(cwd, '.chatgpt-machine', 'verification', `${runId}-${checks.length}.log`));
      await mkdir(path.dirname(logPath), { recursive: true });
      await writeFile(logPath, `STDOUT\n${stdout}\nSTDERR\n${stderr}`, { flag: 'wx', mode: 0o600 });
      checks.push({ name: command.name, ok: !timedOut && result.exitCode === 0,
        exitCode: result.exitCode, durationMs: Date.now() - startedAt, stdout: tail(stdout), stderr: tail(stderr),
        timedOut, logPath, outputTruncated: result.outputTruncated, diagnostics: parseDiagnostics(`${stdout}\n${stderr}`) });
    } catch (error) {
      await stopProcess({ ...options, pid: started.pid, processId: started.processId });
      throw error;
    }
    if (!checks[checks.length - 1].ok) break;
  }

  return {
    runId,
    totalTimeoutMs,
    verificationScope: 'current_worktree',
    ok: checks.length === detected.commands.length && checks.every((check) => check.ok),
    profile,
    path: cwd,
    projectType: detected.projectType,
    checks,
  };
}

async function gitValue(cwd: string, args: string[]) {
  return (await execFileAsync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 30000, windowsHide: true })).stdout;
}
async function worktreeFingerprint(options: VerificationOptions, cwd: string) {
  const listed = await gitValue(cwd, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  const files = [...new Set(listed.split('\0').filter(Boolean))].filter(file => !file.startsWith('.chatgpt-machine/')).sort();
  if (files.length > 10000) throw new ToolError('TOO_LARGE', 'Verified commit fingerprint is limited to 10000 files.');
  const hash = createHash('sha256');
  let total = 0;
  for (const file of files) {
    hash.update(JSON.stringify(file));
    try {
      const resolved = await resolveMachinePath(options, path.join(cwd, file));
      const meta = await stat(resolved);
      if (!meta.isFile()) throw new ToolError('PRECONDITION_FAILED', 'Verified commit does not support submodules or directory entries.');
      total += meta.size;
      if (total > 64 * 1024 * 1024) throw new ToolError('TOO_LARGE', 'Verified commit fingerprint is limited to 64 MiB.');
      hash.update(String(meta.mode));
      hash.update(createHash('sha256').update(await readFile(resolved)).digest());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      hash.update('deleted');
    }
  }
  return hash.digest('hex');
}

export async function gitCommitVerified(options: VerifiedCommitOptions) {
  if (!options.paths?.length) throw new ToolError('INVALID_ARGUMENT', '"paths" must contain at least one explicit repository path.');
  if (!options.message?.trim()) throw new ToolError('INVALID_ARGUMENT', '"message" must be a non-empty string.');

  const before = await gitStatus(options);
  if (before.summary.conflicted > 0) {
    throw new ToolError('PRECONDITION_FAILED', 'Cannot create a verified commit while merge conflicts exist.');
  }
  if (before.summary.staged > 0) {
    throw new ToolError(
      'PRECONDITION_FAILED',
      'Verified commit requires an empty staging area to avoid committing unrelated changes.',
      'Commit or unstage the existing staged changes first.',
      { staged: before.files.filter((file) => file.index !== ' ' && file.index !== '?').map((file) => file.path) },
    );
  }

  // Freeze the prospective index without touching the caller's real staging area.
  const gitDir = (await gitValue(before.path, ['rev-parse', '--absolute-git-dir'])).trim();
  const indexPath = (await gitValue(before.path, ['rev-parse', '--git-path', 'index'])).trim();
  const resolvedIndex = path.resolve(before.path, indexPath);
  const tempIndex = path.join(gitDir, `machine-verified-${randomUUID()}.index`);
  const originalIndex = await readFile(resolvedIndex).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return Buffer.alloc(0); throw error; });
  const indexHash = createHash('sha256').update(originalIndex).digest('hex');
  const frozenGit = async (args: string[]) => (await execFileAsync('git', ['-C', before.path, ...args], {
    env: { ...process.env, GIT_INDEX_FILE: tempIndex }, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024,
  })).stdout.trim();
  let expectedTree: string;
  try {
    if (originalIndex.length) await writeFile(tempIndex, originalIndex, { flag: 'wx' });
    for (const file of options.paths) {
      if (file.startsWith(':')) throw new ToolError('INVALID_ARGUMENT', 'Verified commit requires literal repository paths.');
      await resolveMachinePath(options, path.resolve(before.path, file));
    }
    await frozenGit(['--literal-pathspecs', 'add', '--', ...options.paths]);
    expectedTree = await frozenGit(['write-tree']);
  } finally { await rm(tempIndex, { force: true }); }
  const fingerprint = await worktreeFingerprint(options, before.path);
  const verification = await verifyChanges({
    root: options.root,
    unrestricted: options.unrestricted,
    path: before.path,
    profile: options.profile,
    timeoutMs: options.timeoutMs,
    totalTimeoutMs: options.totalTimeoutMs,
  });
  if (!verification.ok) {
    throw new ToolError('PRECONDITION_FAILED', 'Verification failed; no files were staged or committed.', 'Fix the failing verification check and retry.', { verification });
  }

  const currentIndex = await readFile(resolvedIndex).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return Buffer.alloc(0); throw error; });
  if (fingerprint !== await worktreeFingerprint(options, before.path) || createHash('sha256').update(currentIndex).digest('hex') !== indexHash) {
    throw new ToolError('PRECONDITION_FAILED', 'Worktree or staging area changed during verification; nothing was staged or committed.');
  }
  await gitAdd({ ...options, path: before.path, paths: options.paths });
  const staged = await gitStatus({ ...options, path: before.path });
  if (staged.summary.staged === 0) {
    throw new ToolError('PRECONDITION_FAILED', 'The requested paths produced no staged changes.');
  }

  try {
    if ((await gitValue(before.path, ['write-tree'])).trim() !== expectedTree || fingerprint !== await worktreeFingerprint(options, before.path)) throw new ToolError('PRECONDITION_FAILED', 'Staged content differs from the verified candidate.');
    const commit = await gitCommit({ ...options, path: before.path, message: options.message, all: false });
    const after = await gitStatus({ ...options, path: before.path });
    return {
      ok: true,
      path: before.path,
      paths: options.paths,
      verification,
      verifiedFingerprint: fingerprint,
      expectedTree,
      verificationScope: 'current_worktree',
      otherWorktreeChanges: before.files.filter(file => !options.paths.includes(file.path)).map(file => file.path),
      commit,
      status: after,
      pushRequired: true,
    };
  } catch (error) {
    await gitUnstage({ ...options, path: before.path, paths: options.paths }).catch(() => undefined);
    throw error;
  }
}
