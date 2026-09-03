import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMachineRoutingSpecs, normalizeMachineEndpoint, resolveMachine, writeMachineRegistry } from './machine-router.js';

async function fakeNode() {
  let toolsListCalls = 0;
  let capabilityVersion = 1;
  const tools = () => [
    { name: 'machine_status', description: 'status', annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
    { name: 'write_file', description: 'write', annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false } },
    ...(capabilityVersion >= 2 ? [{ name: 'system_info', description: 'system', annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }] : []),
  ];

  const server = createServer(async (req, res) => {
    if (req.url === '/healthz' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, status: 'alive' }));
      return;
    }
    if (req.url !== '/mcp' || req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const message = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { id: unknown; method: string; params?: { name?: string } };
    if (message.method === 'tools/list') {
      toolsListCalls++;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools: tools() } }));
      return;
    }
    if (message.method === 'tools/call' && message.params?.name === 'machine_status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: JSON.stringify({ ok: true, hostname: 'NODE-A' }) }] } }));
      return;
    }
    if (message.method === 'tools/call' && message.params?.name === 'system_info') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: JSON.stringify({ ok: true, platform: 'test' }) }] } }));
      return;
    }
    if (message.method === 'tools/call' && message.params?.name === 'write_file') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: JSON.stringify({ ok: true, written: true }) }] } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'not found' } }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing server address');
  return {
    port: address.port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    toolsListCalls: () => toolsListCalls,
    setCapabilityVersion: (version: number) => { capabilityVersion = version; },
  };
}

test('machine endpoints allow private HTTP but require HTTPS for public hosts', () => {
  assert.equal(normalizeMachineEndpoint('192.168.1.20:8787'), 'http://192.168.1.20:8787/mcp');
  assert.equal(normalizeMachineEndpoint('https://example.com/mcp'), 'https://example.com/mcp');
  assert.throws(() => normalizeMachineEndpoint('http://8.8.8.8:8787'), /plaintext HTTP/);
});

test('machine registry resolves a node by id, alias, hostname, IP, and host:port', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'machine-router-registry-'));
  const file = path.join(root, 'machines.json');
  try {
    writeMachineRegistry(file, { version: 1, machines: [{ id: 'server', name: 'Home Server', hostname: 'HOME-SERVER', endpoint: 'http://192.168.1.20:8787/mcp', aliases: ['buildbox'] }] });
    const { readMachineRegistry } = await import('./machine-router.js');
    const registry = readMachineRegistry(file);
    for (const selector of ['server', 'Home Server', 'HOME-SERVER', 'buildbox', '192.168.1.20', '192.168.1.20:8787']) {
      assert.equal(resolveMachine(registry, selector).id, 'server');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('remote routing caches capabilities, proves read-only calls, and refreshes changed fingerprints', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'machine-router-call-'));
  const file = path.join(root, 'machines.json');
  const node = await fakeNode();
  try {
    writeMachineRegistry(file, { version: 1, machines: [{ id: 'node-a', endpoint: `http://127.0.0.1:${node.port}/mcp` }] });
    const specs = createMachineRoutingSpecs({ machinesFile: file, timeoutMs: 5_000 });
    const byName = new Map(specs.map((spec) => [spec.name, spec]));

    const listed = await byName.get('machines_list')!.handler({}) as { machines: Array<{ id: string }> };
    assert.deepEqual(listed.machines.map((machine) => machine.id), ['node-a']);

    const probed = await byName.get('machine_probe')!.handler({ machine: '127.0.0.1' }) as { online: boolean };
    assert.equal(probed.online, true);

    const firstTools = await byName.get('machine_tools')!.handler({ machine: '127.0.0.1' }) as { tools: Array<{ name: string }>; cache: { hit: boolean; fingerprint: string; changed: boolean } };
    assert.deepEqual(firstTools.tools.map((tool) => tool.name), ['machine_status', 'write_file']);
    assert.equal(firstTools.cache.hit, false);
    assert.equal(node.toolsListCalls(), 1);

    const secondTools = await byName.get('machine_tools')!.handler({ machine: 'node-a' }) as { cache: { hit: boolean } };
    assert.equal(secondTools.cache.hit, true);
    assert.equal(node.toolsListCalls(), 1);

    const read = await byName.get('machine_read')!.handler({ machine: '127.0.0.1', tool: 'machine_status', arguments: {} }) as { result: { hostname: string } };
    assert.equal(read.result.hostname, 'NODE-A');
    assert.equal(node.toolsListCalls(), 1, 'machine_read should reuse the cached capability proof');

    await assert.rejects(
      () => byName.get('machine_read')!.handler({ machine: 'node-a', tool: 'write_file', arguments: { path: 'x' } }),
      (error: unknown) => (error as { code?: string }).code === 'POLICY_DENIED',
    );

    const called = await byName.get('machine_call')!.handler({ machine: '127.0.0.1', tool: 'write_file', arguments: { path: 'x' } }) as { result: { written: boolean } };
    assert.equal(called.result.written, true);

    node.setCapabilityVersion(2);
    const refreshed = await byName.get('machine_tools')!.handler({ machine: 'node-a', refresh: true }) as { tools: Array<{ name: string }>; cache: { changed: boolean; fingerprint: string } };
    assert.equal(node.toolsListCalls(), 2);
    assert.equal(refreshed.cache.changed, true);
    assert.notEqual(refreshed.cache.fingerprint, firstTools.cache.fingerprint);
    assert.deepEqual(refreshed.tools.map((tool) => tool.name), ['machine_status', 'write_file', 'system_info']);

    const system = await byName.get('machine_read')!.handler({ machine: 'node-a', tool: 'system_info' }) as { result: { platform: string } };
    assert.equal(system.result.platform, 'test');

    await assert.rejects(() => byName.get('machine_call')!.handler({ machine: 'node-a', tool: 'machine_call' }), /cannot be called through another routing tool/);
  } finally {
    await node.close();
    await rm(root, { recursive: true, force: true });
  }
});
