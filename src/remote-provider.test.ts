import assert from 'node:assert/strict';
import test from 'node:test';
import { ToolGateway } from './gateway.js';
import { createRemoteMcpProvider, type RemoteMcpAdapter } from './remote-provider.js';

function adapter(overrides: Partial<RemoteMcpAdapter> = {}): RemoteMcpAdapter {
  return {
    discoverTools: async () => [{
      name: 'challenge_idea',
      description: 'Challenge one candidate.',
      inputSchema: { type: 'object', properties: { idea: { type: 'string' } }, required: ['idea'] },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    }],
    callTool: async (name, args) => ({ name, args }),
    ...overrides,
  };
}

test('remote provider namespaces tools and preserves declared schemas and annotations', async () => {
  const provider = await createRemoteMcpProvider({ id: 'thinkforge', adapter: adapter() });
  const gateway = new ToolGateway([provider]);
  const resolved = gateway.resolve('thinkforge_challenge_idea');

  assert.equal(resolved?.providerId, 'thinkforge');
  assert.equal(resolved?.spec.description, 'Challenge one candidate.');
  assert.deepEqual(resolved?.spec.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  });
  assert.deepEqual(resolved?.spec.inputSchema, {
    type: 'object',
    properties: { idea: { type: 'string' } },
    required: ['idea'],
  });
});

test('remote provider invokes the original remote tool name', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const provider = await createRemoteMcpProvider({
    id: 'thinkforge',
    adapter: adapter({ callTool: async (name, args) => { calls.push({ name, args }); return { ok: true }; } }),
  });
  const spec = provider.tools()[0];

  assert.deepEqual(await spec.handler({ idea: 'gateway' }), { ok: true });
  assert.deepEqual(calls, [{ name: 'challenge_idea', args: { idea: 'gateway' } }]);
});

test('remote provider treats missing authority annotations conservatively', async () => {
  const provider = await createRemoteMcpProvider({
    id: 'skills',
    adapter: adapter({ discoverTools: async () => [{ name: 'search', inputSchema: { type: 'object', properties: {} } }] }),
  });

  assert.deepEqual(provider.tools()[0].annotations, {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  });
});

test('remote provider allow-list exposes only selected tools and fails on contract drift', async () => {
  const source = adapter({
    discoverTools: async () => [
      { name: 'recall', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
      { name: 'remember', inputSchema: { type: 'object', properties: {} }, annotations: { destructiveHint: true } },
    ],
  });
  const provider = await createRemoteMcpProvider({ id: 'memory', adapter: source, includeTools: ['recall'] });
  assert.deepEqual(provider.tools().map((tool) => tool.name), ['memory_recall']);

  await assert.rejects(
    createRemoteMcpProvider({ id: 'memory', adapter: source, includeTools: ['missing'] }),
    /missing required tool "missing"/,
  );
});

test('remote provider rejects invalid provider ids before discovery', async () => {
  let discovered = false;
  await assert.rejects(
    createRemoteMcpProvider({
      id: 'bad.provider',
      adapter: adapter({ discoverTools: async () => { discovered = true; return []; } }),
    }),
    /Invalid remote provider id/,
  );
  assert.equal(discovered, false);
});
