import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ToolError } from './errors.js';
import { resolveMachinePath, type MachineAccess } from './shell-tools.js';

const execFileAsync = promisify(execFile);
const MAX_DIFF_BYTES = 4 * 1024 * 1024;

export interface GitOptions extends MachineAccess {
  path?: string;
}

export interface GitDiffOptions extends GitOptions {
  staged?: boolean;
  statOnly?: boolean;
  maxBytes?: number;
  paths?: string[];
  contextLines?: number;
}

export interface GitLogOptions extends GitOptions {
  maxCount?: number;
  ref?: string;
}

export interface GitShowOptions extends GitOptions {
  ref?: string;
  statOnly?: boolean;
  maxBytes?: number;
}

async function git(cwd: string, args: string[], maxBuffer = MAX_DIFF_BYTES) {
  try {
    return await execFileAsync('git', ['-C', cwd, ...args], { windowsHide: true, maxBuffer, encoding: 'utf8' });
  } catch (error: unknown) {
    const detail = error as { stderr?: string; stdout?: string; message?: string; code?: string; exitCode?: number };
    const message = detail.stderr?.trim() || detail.stdout?.trim() || detail.message || String(error);
    if (detail.code === 'ENOENT') throw new ToolError('DEPENDENCY_MISSING', 'Git is not installed or not on PATH.', message);
    if (/not a git repository/i.test(message)) {
      throw new ToolError('NOT_FOUND', message, 'Point "path" at a directory inside a Git repository.');
    }
    if (/nothing to commit/i.test(message)) throw new ToolError('PRECONDITION_FAILED', message, 'Stage or modify files before committing.');
    if (/pathspec .* did not match/i.test(message) || /invalid reference|unknown revision|bad revision/i.test(message)) {
      throw new ToolError('NOT_FOUND', message);
    }
    throw new ToolError('INTERNAL', message);
  }
}

async function resolveRepo(options: GitOptions): Promise<string> {
  return resolveMachinePath(options, options.path ?? '.', true);
}

function parseBranchLine(line: string): { branch: string; upstream?: string; ahead: number; behind: number } {
  const value = line.slice(3);
  const tracking = /^(?<branch>[^ ]+?)(?:\.\.\.(?<upstream>[^ ]+))?(?: \[(?<state>[^\]]+)\])?$/.exec(value);
  const branch = tracking?.groups?.branch ?? value;
  const state = tracking?.groups?.state ?? '';
  return {
    branch,
    upstream: tracking?.groups?.upstream,
    ahead: Number(/ahead (\d+)/.exec(state)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(state)?.[1] ?? 0),
  };
}

export async function gitStatus(options: GitOptions) {
  const cwd = await resolveRepo(options);
  const result = await git(cwd, ['status', '--porcelain=v1', '-b']);
  const lines = result.stdout.replace(/\r\n/g, '\n').split('\n').filter(Boolean);
  const branchLine = lines.find((line) => line.startsWith('## ')) ?? '## (unknown)';
  const files = lines
    .filter((line) => !line.startsWith('## '))
    .map((line) => ({ index: line[0] ?? ' ', worktree: line[1] ?? ' ', path: line.slice(3) }))
    .filter((file) => !file.path.startsWith('.chatgpt-machine/') && file.path !== '.chatgpt-machine' && !file.path.startsWith('.pilot/') && file.path !== '.pilot');
  const summary = {
    staged: files.filter((file) => file.index !== ' ' && file.index !== '?').length,
    unstaged: files.filter((file) => file.worktree !== ' ' && file.worktree !== '?').length,
    untracked: files.filter((file) => file.index === '?').length,
    conflicted: files.filter((file) => file.index === 'U' || file.worktree === 'U').length,
  };
  return { path: cwd, ...parseBranchLine(branchLine), clean: files.length === 0, summary, files };
}

export async function gitDiff(options: GitDiffOptions) {
  const cwd = await resolveRepo(options);
  const maxBytes = options.maxBytes ?? MAX_DIFF_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > MAX_DIFF_BYTES) {
    throw new ToolError('INVALID_ARGUMENT', `"max_bytes" must be an integer between 1024 and ${MAX_DIFF_BYTES}.`);
  }
  if (options.contextLines !== undefined && (!Number.isInteger(options.contextLines) || options.contextLines < 0 || options.contextLines > 20)) {
    throw new ToolError('INVALID_ARGUMENT', '"context_lines" must be an integer between 0 and 20.');
  }
  const args = ['diff'];
  if (options.staged) args.push('--cached');
  if (options.statOnly) args.push('--stat');
  if (options.contextLines !== undefined) args.push(`--unified=${options.contextLines}`);
  args.push('--no-ext-diff', '--no-color');
  if (options.paths?.length) args.push('--', ...options.paths);
  const result = await git(cwd, args, MAX_DIFF_BYTES * 2);
  const bytes = Buffer.byteLength(result.stdout);
  return {
    path: cwd,
    staged: options.staged === true,
    statOnly: options.statOnly === true,
    paths: options.paths ?? [],
    diff: result.stdout.slice(0, maxBytes),
    bytes: Math.min(bytes, maxBytes),
    truncated: bytes > maxBytes,
  };
}

export async function gitLog(options: GitLogOptions) {
  const cwd = await resolveRepo(options);
  const maxCount = options.maxCount ?? 20;
  if (!Number.isInteger(maxCount) || maxCount < 1 || maxCount > 200) throw new ToolError('INVALID_ARGUMENT', '"max_count" must be between 1 and 200.');
  const format = '%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e';
  const args = ['log', `--max-count=${maxCount}`, `--format=${format}`];
  if (options.ref) args.push(options.ref);
  const result = await git(cwd, args);
  const commits = result.stdout.split('\x1e').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const [hash, shortHash, authorName, authorEmail, authoredAt, subject] = entry.split('\x1f');
    return { hash, shortHash, authorName, authorEmail, authoredAt, subject };
  });
  return { path: cwd, ref: options.ref ?? 'HEAD', commits };
}

export async function gitShow(options: GitShowOptions) {
  const cwd = await resolveRepo(options);
  const maxBytes = options.maxBytes ?? MAX_DIFF_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > MAX_DIFF_BYTES) throw new ToolError('INVALID_ARGUMENT', `"max_bytes" must be between 1024 and ${MAX_DIFF_BYTES}.`);
  const ref = options.ref ?? 'HEAD';
  const args = ['show', '--no-color', '--no-ext-diff', '--format=fuller'];
  if (options.statOnly) args.push('--stat', '--no-patch');
  args.push(ref);
  const result = await git(cwd, args, MAX_DIFF_BYTES * 2);
  const bytes = Buffer.byteLength(result.stdout);
  return { path: cwd, ref, output: result.stdout.slice(0, maxBytes), bytes: Math.min(bytes, maxBytes), truncated: bytes > maxBytes };
}

export async function gitBranch(options: GitOptions & { all?: boolean }) {
  const cwd = await resolveRepo(options);
  const refs = options.all ? ['refs/heads', 'refs/remotes'] : ['refs/heads'];
  const result = await git(cwd, ['for-each-ref', '--format=%(refname:short)%09%(objectname:short)%09%(upstream:short)%09%(HEAD)', ...refs]);
  const branches = result.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [name, hash, upstream, head] = line.split('\t');
    return { name, hash, upstream: upstream || undefined, current: head === '*' };
  });
  return { path: cwd, branches };
}

export async function gitAdd(options: GitOptions & { paths: string[] }) {
  const cwd = await resolveRepo(options);
  if (!options.paths?.length) throw new ToolError('INVALID_ARGUMENT', '"paths" must contain at least one repository path.');
  await git(cwd, ['add', '--', ...options.paths]);
  return { path: cwd, staged: options.paths, status: await gitStatus({ ...options, path: cwd }) };
}

export async function gitUnstage(options: GitOptions & { paths: string[] }) {
  const cwd = await resolveRepo(options);
  if (!options.paths?.length) throw new ToolError('INVALID_ARGUMENT', '"paths" must contain at least one repository path.');
  try {
    await git(cwd, ['restore', '--staged', '--', ...options.paths]);
  } catch {
    // Repositories without an initial commit have no HEAD for `restore --staged`.
    // Removing the entries from the index is the safe equivalent in that state.
    await git(cwd, ['rm', '--cached', '--quiet', '--', ...options.paths]);
  }
  return { path: cwd, unstaged: options.paths, status: await gitStatus({ ...options, path: cwd }) };
}
export async function gitCommit(options: GitOptions & { message: string; all?: boolean }) {
  const cwd = await resolveRepo(options);
  if (!options.message.trim()) throw new ToolError('INVALID_ARGUMENT', '"message" must be a non-empty string.');
  const args = ['commit'];
  if (options.all) args.push('--all');
  args.push('-m', options.message);
  const result = await git(cwd, args);
  const rev = await git(cwd, ['rev-parse', 'HEAD']);
  return { path: cwd, commit: rev.stdout.trim(), output: result.stdout.trim() || result.stderr.trim() };
}

export async function gitCheckout(options: GitOptions & { branch: string; create?: boolean }) {
  const cwd = await resolveRepo(options);
  if (!options.branch.trim()) throw new ToolError('INVALID_ARGUMENT', '"branch" must be a non-empty string.');
  const args = ['switch'];
  if (options.create) args.push('-c');
  args.push(options.branch);
  const result = await git(cwd, args);
  const branch = (await git(cwd, ['branch', '--show-current'])).stdout.trim();
  return { path: cwd, branch, created: options.create === true, output: result.stderr.trim() || result.stdout.trim() };
}

export async function gitPush(options: GitOptions & { remote?: string; branch?: string; setUpstream?: boolean }) {
  const cwd = await resolveRepo(options);
  const remote = options.remote ?? 'origin';
  const branch = options.branch ?? (await git(cwd, ['branch', '--show-current'])).stdout.trim();
  if (!branch) throw new ToolError('PRECONDITION_FAILED', 'Cannot push from a detached HEAD without an explicit "branch".');
  const args = ['push'];
  if (options.setUpstream) args.push('--set-upstream');
  args.push(remote, branch);
  const result = await git(cwd, args, 8 * 1024 * 1024);
  return { path: cwd, remote, branch, setUpstream: options.setUpstream === true, output: result.stderr.trim() || result.stdout.trim() };
}
