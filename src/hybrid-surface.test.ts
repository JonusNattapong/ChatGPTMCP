import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOptions } from './index.js';

test('hybrid surface is explicit and requires unrestricted runtime authority', () => {
  assert.equal(parseOptions([]).toolSurface, 'legacy');
  assert.throws(
    () => parseOptions(['--tool-surface', 'hybrid']),
    /requires --dangerously-open-machine/,
  );
  const options = parseOptions(['--dangerously-open-machine', '--tool-surface', 'hybrid']);
  assert.equal(options.toolSurface, 'hybrid');
});

test('hybrid surface can be selected by environment without accepting invalid CLI modes', () => {
  const previous = process.env.MCP_TOOL_SURFACE;
  try {
    process.env.MCP_TOOL_SURFACE = 'hybrid';
    assert.equal(parseOptions(['--dangerously-open-machine']).toolSurface, 'hybrid');
    assert.throws(
      () => parseOptions(['--dangerously-open-machine', '--tool-surface', 'other']),
      /must be one of: legacy, hybrid/,
    );
  } finally {
    if (previous === undefined) delete process.env.MCP_TOOL_SURFACE;
    else process.env.MCP_TOOL_SURFACE = previous;
  }
});

test('hybrid provider directories are explicit runtime configuration', () => {
  const options = parseOptions([
    '--dangerously-open-machine',
    '--tool-surface', 'hybrid',
    '--skill-hub-dir', './skill-hub',
    '--thinkforge-dir', './thinkforge',
    '--memory-dir', './memory',
  ]);
  assert.equal(options.skillHubDir?.endsWith('skill-hub'), true);
  assert.equal(options.thinkForgeDir?.endsWith('thinkforge'), true);
  assert.equal(options.memoryDir?.endsWith('memory'), true);
});
