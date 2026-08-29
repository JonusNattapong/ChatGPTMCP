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
      'edit_file',
      'file_info',
      'find_files',
      'git_diff',
      'git_status',
      'image_info',
      'list_directory',
      'machine_status',
      'process_status',
      'read_file',
      'read_process_output',
      'save_image_from_url',
      'search_code',
      'shell_command',
      'start_process',
      'stop_process',
      'update_file',
      'write_file',
    ]);

    const status = await client.callTool({ name: 'machine_status', arguments: {} });
    assert.equal(status.isError, undefined);
    const statusPayload = JSON.parse((status.content as Array<{ text: string }>)[0].text);
    assert.equal(statusPayload.ok, true);
    assert.equal(statusPayload.accessMode, 'UNRESTRICTED_MACHINE');
    assert.deepEqual(statusPayload.tools, listed.tools.map((tool) => tool.name));

    // Failures answer with the same envelope and a stable machine-readable code.
    const missing = await client.callTool({ name: 'read_file', arguments: { path: 'no-such-file-here.txt' } });
    assert.equal(missing.isError, true);
    const missingPayload = JSON.parse((missing.content as Array<{ text: string }>)[0].text);
    assert.equal(missingPayload.ok, false);
    assert.equal(missingPayload.error.code, 'NOT_FOUND');

    const unknown = await client.callTool({ name: 'not_a_tool', arguments: {} });
    assert.equal(unknown.isError, true);
    assert.equal(JSON.parse((unknown.content as Array<{ text: string }>)[0].text).error.code, 'UNKNOWN_TOOL');

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
