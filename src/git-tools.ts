import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ToolError } from './errors.js';
import { resolveMachinePath, type MachineAccess } from './shell-tools.js';

const execFileAsync = promisify(execFile);
const MAX_DIFF_BYTES = 4 * 1024 * 1024;

interface GitOptions extends MachineAccess {
  path?: string;
}

export interface GitDiffOptions extends GitOptions {
  staged?: boolean;
  statOnly?: boolean;
  maxBytes?: number;
  paths?: string[];
  contextLines?: number;
}

async function git(cwd: string, args: string[], maxBuffer = MAX_DIFF_BYTES) {
  try {
    return await execFileAsync('git', ['-C', cwd, ...args], { windowsHide: true, maxBuffer, encoding: 'utf8' });
  } catch (error: unknown) {
    const detail = error as { stderr?: string; message?: string; code?: string };
    const message = detail.stderr?.trim() || detail.message || String(error);
    if (detail.code === 'ENOENT') {
      throw new ToolError('DEPENDENCY_MISSING', 'Git is not installed or not on PATH.', message);
    }
    if (/not a git repository/i.test(message)) {
      throw new ToolError(
        'NOT_FOUND',
        message,
        'Point "path" at a directory inside a Git repository.',
      );
    }
    throw new ToolError('INTERNAL', message);
  }
}

/** Parses "## main...origin/main [ahead 1, behind 2]" into structured fields. */
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
  const cwd = await resolveMachinePath(options, options.path ?? '.', true);
  const result = await git(cwd, ['status', '--porcelain=v1', '-b']);
  const lines = result.stdout.replace(/\r\n/g, '\n').split('\n').filter(Boolean);
  const branchLine = lines.find((line) => line.startsWith('## ')) ?? '## (unknown)';
  const files = lines
    .filter((line) => !line.startsWith('## '))
    .map((line) => ({ index: line[0] ?? ' ', worktree: line[1] ?? ' ', path: line.slice(3) }));
  const summary = {
    staged: files.filter((file) => file.index !== ' ' && file.index !== '?').length,
    unstaged: files.filter((file) => file.worktree !== ' ' && file.worktree !== '?').length,
    untracked: files.filter((file) => file.index === '?').length,
    conflicted: files.filter((file) => file.index === 'U' || file.worktree === 'U').length,
  };
  return { path: cwd, ...parseBranchLine(branchLine), clean: files.length === 0, summary, files };
}

export async function gitDiff(options: GitDiffOptions) {
  const cwd = await resolveMachinePath(options, options.path ?? '.', true);
  const maxBytes = options.maxBytes ?? MAX_DIFF_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > MAX_DIFF_BYTES) {
    throw new ToolError('INVALID_ARGUMENT', `"max_bytes" must be an integer between 1024 and ${MAX_DIFF_BYTES}.`);
  }
  if (options.contextLines !== undefined
    && (!Number.isInteger(options.contextLines) || options.contextLines < 0 || options.contextLines > 20)) {
    throw new ToolError('INVALID_ARGUMENT', '"context_lines" must be an integer between 0 and 20.');
  }
  const args = ['diff'];
  if (options.staged) args.push('--cached');
  if (options.statOnly) args.push('--stat');
  if (options.contextLines !== undefined) args.push(`--unified=${options.contextLines}`);
  args.push('--no-ext-diff', '--no-color');
  // "--" keeps a path that looks like a revision from being interpreted as one.
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
