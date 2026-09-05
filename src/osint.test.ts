import assert from 'node:assert/strict';
import test from 'node:test';
import { osintFetch, osintSearch } from './osint.js';
import { ToolError } from './errors.js';

test('OSINT rejects non-HTTPS and scope mismatches before network access', async () => {
  await assert.rejects(() => osintFetch({ url: 'http://example.com', timeoutMs: 1000 }), (error: unknown) => error instanceof ToolError && error.code === 'INVALID_ARGUMENT');
  await assert.rejects(() => osintFetch({ url: 'https://example.com', scope: 'onion', timeoutMs: 1000 }), (error: unknown) => error instanceof ToolError && error.code === 'INVALID_ARGUMENT');
  await assert.rejects(() => osintFetch({ url: 'https://example.onion', scope: 'web', timeoutMs: 1000 }), (error: unknown) => error instanceof ToolError && error.code === 'INVALID_ARGUMENT');
});

test('OSINT search rejects empty and oversized queries locally', async () => {
  await assert.rejects(() => osintSearch('   ', 'web', 1000), (error: unknown) => error instanceof ToolError && error.code === 'INVALID_ARGUMENT');
  await assert.rejects(() => osintSearch('x'.repeat(501), 'web', 1000), (error: unknown) => error instanceof ToolError && error.code === 'INVALID_ARGUMENT');
});
