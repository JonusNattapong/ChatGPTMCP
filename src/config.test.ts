import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { configEnvironment, defaultLocalConfig, initLocalConfig, loadLocalConfig, localConfigPath } from './config.js';

test('local config defaults preserve current operator behavior', () => {
  const root = path.join(tmpdir(), 'project', 'ChatGPTMCP');
  const config = defaultLocalConfig(root);
  assert.equal(config.workspaceRoot, path.dirname(root));
  assert.equal(config.accessMode, 'unrestricted');
  assert.equal(config.policy, 'admin');
  assert.equal(config.supervisorTimeoutMs, 120000);
});

test('local config initializes, loads and maps to tunnel environment', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'machine-config-'));
  try {
    const file = initLocalConfig(root);
    assert.equal(file, localConfigPath(root));
    const config = loadLocalConfig(root);
    assert.equal(config.accessMode, 'unrestricted');
    assert.equal(configEnvironment(config).MCP_WORKSPACE_ROOT, path.dirname(root));
    assert.match(readFileSync(file, 'utf8'), /supervisorTimeoutMs/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('local config validates unsafe or malformed values', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'machine-config-invalid-'));
  try {
    mkdirSync(path.dirname(localConfigPath(root)), { recursive: true });
    writeFileSync(localConfigPath(root), JSON.stringify({ accessMode: 'root', supervisorTimeoutMs: 1 }));
    assert.throws(() => loadLocalConfig(root), /accessMode|supervisorTimeoutMs/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
