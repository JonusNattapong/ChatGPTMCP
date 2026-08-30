import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
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

async function detectCommands(cwd: string, profile: VerificationProfile): Promise<{ projectType: string; commands: VerificationCommand[] }> {
  const packageFile = path.join(cwd, 'package.json');
  if (existsSync(packageFile)) {
    const pkg = JSON.parse(await readFile(packageFile, 'utf8')) as { scripts?: Record<string, string> };
    return { projectType: 'node', commands: nodeCommands(pkg.scripts ?? {}, profile) };
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

export async function verifyChanges(options: VerificationOptions) {
  const cwd = await resolveMachinePath(options, options.path ?? '.', true);
  const profile = options.profile ?? 'normal';
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!['fast', 'normal', 'strict'].includes(profile)) throw new ToolError('INVALID_ARGUMENT', 'Verification profile must be fast, normal, or strict.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 11 * 60_000) {
    throw new ToolError('INVALID_ARGUMENT', 'Verification timeout must be an integer between 1000 and 660000 milliseconds.');
  }

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

  const checks: Array<{ name: string; ok: boolean; exitCode: number | null; durationMs: number; stdout: string; stderr: string; timedOut: boolean }> = [];
  for (const command of detected.commands) {
    const startedAt = Date.now();
    try {
      const result = await execFileAsync(command.executable, command.args, {
        cwd,
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT_BYTES,
        encoding: 'utf8',
      });
      checks.push({
        name: command.name,
        ok: true,
        exitCode: 0,
        durationMs: Date.now() - startedAt,
        stdout: tail(result.stdout),
        stderr: tail(result.stderr),
        timedOut: false,
      });
    } catch (error: unknown) {
      const failure = error as { code?: string | number; killed?: boolean; signal?: string; stdout?: string; stderr?: string };
      const timedOut = failure.killed === true || failure.signal === 'SIGTERM';
      checks.push({
        name: command.name,
        ok: false,
        exitCode: typeof failure.code === 'number' ? failure.code : null,
        durationMs: Date.now() - startedAt,
        stdout: tail(failure.stdout),
        stderr: tail(failure.stderr),
        timedOut,
      });
      break;
    }
  }

  return {
    ok: checks.length === detected.commands.length && checks.every((check) => check.ok),
    profile,
    path: cwd,
    projectType: detected.projectType,
    checks,
  };
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

  const verification = await verifyChanges({
    root: options.root,
    unrestricted: options.unrestricted,
    path: before.path,
    profile: options.profile,
    timeoutMs: options.timeoutMs,
  });
  if (!verification.ok) {
    throw new ToolError('PRECONDITION_FAILED', 'Verification failed; no files were staged or committed.', 'Fix the failing verification check and retry.', { verification });
  }

  await gitAdd({ ...options, path: before.path, paths: options.paths });
  const staged = await gitStatus({ ...options, path: before.path });
  if (staged.summary.staged === 0) {
    throw new ToolError('PRECONDITION_FAILED', 'The requested paths produced no staged changes.');
  }

  try {
    const commit = await gitCommit({ ...options, path: before.path, message: options.message, all: false });
    const after = await gitStatus({ ...options, path: before.path });
    return {
      ok: true,
      path: before.path,
      paths: options.paths,
      verification,
      commit,
      status: after,
      pushRequired: true,
    };
  } catch (error) {
    await gitUnstage({ ...options, path: before.path, paths: options.paths }).catch(() => undefined);
    throw error;
  }
}
