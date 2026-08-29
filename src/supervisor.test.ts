import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { parseSupervisorArgs } from './supervisor.js';

test('supervisor options validate the hard request deadline', () => {
  assert.equal(parseSupervisorArgs(['--supervisor-timeout', '5000', '--root', 'x']).requestTimeoutMs, 5000);
  assert.throws(() => parseSupervisorArgs(['--supervisor-timeout', '4999']), /between 5000 and 660000/);
});

test('supervisor restarts a hung MCP worker and the next request succeeds', async () => {
  const distDirectory = path.dirname(fileURLToPath(import.meta.url));
  const fixtureDir = await mkdtemp(path.join(tmpdir(), 'machine-supervisor-'));
  const fixture = path.join(fixtureDir, 'worker.mjs');
  const stateFile = path.join(fixtureDir, 'supervisor.json');
  await writeFile(fixture, `
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', line => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') return process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}})+'\\n');
  if (m.method === 'notifications/initialized') return;
  if (m.method === 'tools/list') return process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'ping',description:'ping',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}},{name:'hang',description:'hang',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}}]}})+'\\n');
  if (m.method === 'tools/call' && m.params.name === 'hang') return;
  if (m.method === 'tools/call') return process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'pong'}]}})+'\\n');
});
`, 'utf8');

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(distDirectory, 'supervisor.js'), '--supervisor-timeout', '5000'],
    env: { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), MCP_SUPERVISOR_CHILD_ENTRY: fixture, MCP_SUPERVISOR_STATE_FILE: stateFile },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'supervisor-test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
  try {
    await client.connect(transport);
    const hung = await client.callTool({ name: 'hang', arguments: {} }).catch((error) => error as Error);
    assert.match(String(hung), /did not answer|worker/i);
    await new Promise((resolve) => setTimeout(resolve, 700));
    const result = await client.callTool({ name: 'ping', arguments: {} });
    assert.match(JSON.stringify(result), /pong/);
    const state = JSON.parse(await readFile(stateFile, 'utf8')) as { ready: boolean; restarts: number; workerGeneration: number; lastRestartReason: string };
    assert.equal(state.ready, true);
    assert.ok(state.restarts >= 1);
    assert.ok(state.workerGeneration >= 2);
    assert.match(state.lastRestartReason, /request timeout/);
  } finally {
    await client.close();
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test('supervisor proxies the real MCP server during normal use', async () => {
  const distDirectory = path.dirname(fileURLToPath(import.meta.url));
  const root = await mkdtemp(path.join(tmpdir(), 'machine-supervisor-real-'));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(distDirectory, 'supervisor.js'), '--root', root, '--dangerously-open-machine'],
    env: Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'supervisor-real-smoke', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 35);
    const result = await client.callTool({ name: 'machine_status', arguments: {} });
    assert.match(JSON.stringify(result), /UNRESTRICTED_MACHINE/);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
