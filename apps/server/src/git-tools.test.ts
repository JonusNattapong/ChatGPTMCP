import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { gitPublishPaths, gitRemoteStatus } from './git-tools.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  return result.stdout.trim();
}

async function setupRemote(prefix: string): Promise<{ root: string; remote: string; repo: string; peer: string }> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  const remote = path.join(root, 'remote.git');
  const repo = path.join(root, 'repo');
  const peer = path.join(root, 'peer');
  await execFileAsync('git', ['init', '--bare', '--initial-branch=main', remote], { windowsHide: true });
  await execFileAsync('git', ['clone', remote, repo], { windowsHide: true });
  await git(repo, 'config', 'user.name', 'ChatGPT Pilot Test');
  await git(repo, 'config', 'user.email', 'pilot@example.invalid');
  await writeFile(path.join(repo, 'a.txt'), 'base-a\n', 'utf8');
  await writeFile(path.join(repo, 'b.txt'), 'base-b\n', 'utf8');
  await git(repo, 'add', 'a.txt', 'b.txt');
  await git(repo, 'commit', '-m', 'initial');
  await git(repo, 'push', '--set-upstream', 'origin', 'main');
  await execFileAsync('git', ['clone', remote, peer], { windowsHide: true });
  await git(peer, 'config', 'user.name', 'ChatGPT Pilot Peer');
  await git(peer, 'config', 'user.email', 'peer@example.invalid');
  return { root, remote, repo, peer };
}

test('gitPublishPaths publishes selected files from an isolated remote-based worktree', async () => {
  const fixture = await setupRemote('machine-mcp-git-publish-');
  try {
    await writeFile(path.join(fixture.repo, 'a.txt'), 'selected-local\n', 'utf8');
    await writeFile(path.join(fixture.repo, 'b.txt'), 'unrelated-staged\n', 'utf8');
    await git(fixture.repo, 'add', 'b.txt');
    const headBefore = await git(fixture.repo, 'rev-parse', 'HEAD');
    const branchBefore = await git(fixture.repo, 'branch', '--show-current');
    const stagedBefore = await git(fixture.repo, 'diff', '--cached', '--', 'b.txt');

    let verifyCalled = false;
    const published = await gitPublishPaths({
      root: fixture.repo,
      unrestricted: false,
      path: fixture.repo,
      paths: ['a.txt'],
      message: 'publish selected path',
      verify: async (isolatedWorktree) => {
        verifyCalled = true;
        assert.equal((await readFile(path.join(isolatedWorktree, 'a.txt'), 'utf8')).replace(/\r\n/g, '\n'), 'selected-local\n');
        assert.equal((await readFile(path.join(isolatedWorktree, 'b.txt'), 'utf8')).replace(/\r\n/g, '\n'), 'base-b\n');
        return { ok: true };
      },
    });

    assert.equal(verifyCalled, true);
    assert.equal(published.isolated, true);
    assert.deepEqual(published.paths, ['a.txt']);
    assert.equal(await git(fixture.repo, 'rev-parse', 'HEAD'), headBefore);
    assert.equal(await git(fixture.repo, 'branch', '--show-current'), branchBefore);
    assert.equal(await git(fixture.repo, 'diff', '--cached', '--', 'b.txt'), stagedBefore);
    assert.equal((await readFile(path.join(fixture.repo, 'a.txt'), 'utf8')).replace(/\r\n/g, '\n'), 'selected-local\n');
    assert.equal((await readFile(path.join(fixture.repo, 'b.txt'), 'utf8')).replace(/\r\n/g, '\n'), 'unrelated-staged\n');
    assert.equal(await git(fixture.repo, 'show', 'origin/main:a.txt'), 'selected-local');
    assert.equal(await git(fixture.repo, 'show', 'origin/main:b.txt'), 'base-b');

    const status = await gitRemoteStatus({ root: fixture.repo, unrestricted: false, path: fixture.repo, refresh: true });
    assert.equal(status.branch, 'main');
    assert.equal(status.behind, 1);
    assert.equal(status.ahead, 0);
    assert.equal(status.source, 'remote_fetch');
  } finally {
    await rm(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('gitPublishPaths fails closed when a selected path changed remotely', async () => {
  const fixture = await setupRemote('machine-mcp-git-drift-');
  try {
    await writeFile(path.join(fixture.repo, 'a.txt'), 'local-change\n', 'utf8');
    await writeFile(path.join(fixture.peer, 'a.txt'), 'remote-change\n', 'utf8');
    await git(fixture.peer, 'add', 'a.txt');
    await git(fixture.peer, 'commit', '-m', 'remote change');
    await git(fixture.peer, 'push', 'origin', 'main');

    await assert.rejects(
      () => gitPublishPaths({
        root: fixture.repo,
        unrestricted: false,
        path: fixture.repo,
        paths: ['a.txt'],
        message: 'must not overwrite remote',
      }),
      /Remote drift detected for selected path: a\.txt/,
    );
    assert.equal((await readFile(path.join(fixture.repo, 'a.txt'), 'utf8')).replace(/\r\n/g, '\n'), 'local-change\n');
    assert.equal(await git(fixture.repo, 'rev-parse', 'HEAD'), await git(fixture.repo, 'rev-parse', 'main'));
    assert.equal(await git(fixture.repo, 'show', 'origin/main:a.txt'), 'remote-change');
  } finally {
    await rm(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
