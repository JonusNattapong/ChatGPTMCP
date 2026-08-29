import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('stdio MCP exposes and executes the machine tools', async () => {
  const distDirectory = path.dirname(fileURLToPath(import.meta.url));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      path.join(distDirectory, 'index.js'),
      '--root',
      process.cwd(),
      '--dangerously-open-machine',
    ],
    env: Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'chatgpt-machine-mcp-smoke', version: '0.1.0' });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [
      'apply_patch',
      'machine_status',
      'shell_command',
    ]);

    const status = await client.callTool({ name: 'machine_status', arguments: {} });
    assert.equal(status.isError, undefined);
    assert.match(JSON.stringify(status.content), /UNRESTRICTED_MACHINE/);

    const shell = await client.callTool({
      name: 'shell_command',
      arguments: {
        command: 'node -e "process.stdout.write(\'mcp-ok\')"',
        workdir: process.cwd(),
        timeout_ms: 10_000,
      },
    });
    assert.equal(shell.isError, undefined, JSON.stringify(shell.content));
    assert.match(JSON.stringify(shell.content), /mcp-ok/);
  } finally {
    await client.close();
  }
});
