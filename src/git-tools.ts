import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
}

async function git(cwd: string, args: string[], maxBuffer = MAX_DIFF_BYTES) {
  try {
    return await execFileAsync('git', ['-C', cwd, ...args], { windowsHide: true, maxBuffer, encoding: 'utf8' });
  } catch (error: unknown) {
    const detail = error as { stderr?: string; message?: string };
    throw new Error(detail.stderr?.trim() || detail.message || String(error));
  }
}

export async function gitStatus(options: GitOptions) {
  const cwd = await resolveMachinePath(options, options.path ?? '.', true);
  const result = await git(cwd, ['status', '--porcelain=v1', '-b']);
  const lines = result.stdout.replace(/\r\n/g, '\n').split('\n').filter(Boolean);
  const branchLine = lines.find((line) => line.startsWith('## ')) ?? '## (unknown)';
  const files = lines
    .filter((line) => !line.startsWith('## '))
    .map((line) => ({ index: line[0] ?? ' ', worktree: line[1] ?? ' ', path: line.slice(3) }));
  return { path: cwd, branch: branchLine.slice(3), clean: files.length === 0, files };
}

export async function gitDiff(options: GitDiffOptions) {
  const cwd = await resolveMachinePath(options, options.path ?? '.', true);
  const maxBytes = options.maxBytes ?? MAX_DIFF_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > MAX_DIFF_BYTES) {
    throw new Error(`"max_bytes" must be an integer between 1024 and ${MAX_DIFF_BYTES}.`);
  }
  const args = ['diff'];
  if (options.staged) args.push('--cached');
  if (options.statOnly) args.push('--stat');
  args.push('--no-ext-diff', '--no-color');
  const result = await git(cwd, args, MAX_DIFF_BYTES * 2);
  const bytes = Buffer.byteLength(result.stdout);
  return { path: cwd, staged: options.staged === true, statOnly: options.statOnly === true, diff: result.stdout.slice(0, maxBytes), bytes: Math.min(bytes, maxBytes), truncated: bytes > maxBytes };
}
