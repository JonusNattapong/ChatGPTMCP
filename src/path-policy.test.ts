import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ToolError } from './errors.js';
import { readMachineFile, writeMachineFile } from './file-tools.js';
import { resolveMachinePath } from './shell-tools.js';

function isPathDenied(err: unknown): boolean {
  return err instanceof ToolError && (err.code === 'PATH_DENIED' || err.code === 'POLICY_DENIED');
}

test('workspace-only rejects traversal outside root via ..', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'machine-mcp-path-'));
  try {
    await assert.rejects(
      resolveMachinePath({ root, unrestricted: false }, '../outside.txt'),
      (err: unknown) => {
        assert.ok(isPathDenied(err));
        return true;
      },
    );
    await assert.rejects(
      readMachineFile({ root, unrestricted: false, filePath: '../outside.txt' }),
      (err: unknown) => {
        assert.ok(isPathDenied(err));
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('workspace-only rejects absolute path outside root, unrestricted allows it', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'machine-mcp-path-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'machine-mcp-outside-'));
  try {
    const target = path.join(outside, 'file.txt');
    await writeFile(target, 'outside', 'utf8');

    await assert.rejects(
      resolveMachinePath({ root, unrestricted: false }, target),
      (err: unknown) => {
        assert.ok(isPathDenied(err));
        return true;
      },
    );

    // Unrestricted: absolute outside path must resolve (file may not exist yet, but directory check passes via nearestExistingPath).
    const resolved = await resolveMachinePath({ root, unrestricted: true }, target);
    assert.equal(path.resolve(resolved), path.resolve(target));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('workspace-only blocks symlink that escapes root', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'machine-mcp-path-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'machine-mcp-outside-'));
  try {
    const outsideFile = path.join(outside, 'secret.txt');
    await writeFile(outsideFile, 'secret', 'utf8');
    const linkPath = path.join(root, 'link-escape');
    try {
      await symlink(outside, linkPath, 'dir');
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      // Windows without developer mode / admin cannot create symlink; skip gracefully.
      if (code === 'EPERM' || code === 'EACCES') {
        assert.ok(true, 'symlink not permitted on this host, skipping');
        return;
      }
      throw err;
    }

    await assert.rejects(
      resolveMachinePath({ root, unrestricted: false }, 'link-escape/secret.txt'),
      (err: unknown) => {
        assert.ok(isPathDenied(err), `expected PATH_DENIED, got ${err instanceof ToolError ? err.code : String(err)}`);
        assert.match((err as ToolError).message, /outside.*root/i);
        return true;
      },
    );

    await assert.rejects(
      readMachineFile({ root, unrestricted: false, filePath: 'link-escape/secret.txt' }),
      (err: unknown) => {
        assert.ok(isPathDenied(err));
        return true;
      },
    );

    // Unrestricted must allow following the same symlink.
    const ok = await resolveMachinePath({ root, unrestricted: true }, 'link-escape/secret.txt');
    assert.ok(ok.endsWith('secret.txt'));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('workspace-only blocks file symlink that escapes root', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'machine-mcp-path-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'machine-mcp-outside-'));
  try {
    const outsideFile = path.join(outside, 'secret2.txt');
    await writeFile(outsideFile, 'secret2', 'utf8');
    const linkFile = path.join(root, 'file-link.txt');
    try {
      await symlink(outsideFile, linkFile, 'file');
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES') return;
      throw err;
    }
    await assert.rejects(
      readMachineFile({ root, unrestricted: false, filePath: 'file-link.txt' }),
      (err: unknown) => {
        assert.ok(isPathDenied(err));
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('write outside root is denied in workspace-only', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'machine-mcp-path-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'machine-mcp-outside-'));
  try {
    const target = path.join(outside, 'evil.txt');
    await assert.rejects(
      writeMachineFile({ root, unrestricted: false, filePath: target, content: 'evil' }),
      (err: unknown) => {
        assert.ok(isPathDenied(err));
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
