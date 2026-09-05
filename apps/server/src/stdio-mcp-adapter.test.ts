import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { StdioMcpAdapter } from './stdio-mcp-adapter.js';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const fixtureSource = `
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
const serverFactory = () => {
  const server = new McpServer({ name: 'fixture-provider', version: '1.0.0' });
  server.registerTool('echo_json', {
    description: 'Echo JSON.',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: z.object({ value: z.string() }),
  }, async ({ value }) => ({ content: [{ type: 'text', text: JSON.stringify({ value }) }] }));
  server.registerTool('fail', {
    description: 'Fail deliberately.',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: z.object({}),
  }, async () => ({ isError: true, content: [{ type: 'text', text: 'fixture failure' }] }));
  return server;
};
void serveStdio(serverFactory);
`;

test('stdio MCP adapter discovers, invokes, normalizes JSON, and surfaces tool errors', async () => {
  const root = await mkdtemp(path.join(serverDir, '.tmp-stdio-provider-'));
  const fixture = path.join(root, 'fixture.mjs');
  await writeFile(fixture, fixtureSource, 'utf8');
  const adapter = new StdioMcpAdapter({
    command: process.execPath,
    args: [fixture],
    cwd: serverDir,
    env: { ...process.env } as Record<string, string>,
    timeoutMs: 10_000,
  });
  try {
    const tools = await adapter.discoverTools();
    const echo = tools.find((tool) => tool.name === 'echo_json');
    assert.equal(echo?.annotations?.readOnlyHint, true);
    assert.deepEqual(await adapter.callTool('echo_json', { value: 'hello' }), { value: 'hello' });
    await assert.rejects(() => adapter.callTool('fail', {}), /fixture failure/);
  } finally {
    await adapter.close();
    await rm(root, { recursive: true, force: true });
  }
});
