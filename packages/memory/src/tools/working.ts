import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { workingClear, workingGet, workingList, workingSet } from '../memory/store';

const inputSchema = z.object({
  mode: z.enum(['set', 'get', 'list', 'clear']).describe('Working memory operation'),
  key: z.string().optional().describe('Key for set/get'),
  value: z.string().optional().describe('Value for set'),
  sessionId: z.string().optional().describe('Session ID (defaults to OURBOOK_SESSION_ID)'),
  expiresInMs: z.number().int().min(1).optional().describe('TTL in ms'),
  limit: z.number().int().min(1).max(500).default(100).optional().describe('Max results for list'),
});

export function registerWorkingTool(server: McpServer) {
  server.registerTool(
    'ourbook_working',
    {
      description: 'Session-scoped key-value working memory. Modes: set, get, list, clear.',
      inputSchema,
    },
    async (args) => {
      try {
        switch (args.mode) {
          case 'set': {
            if (!args.key || args.value === undefined) {
              return textResult({ error: 'set requires key and value' });
            }
            const entry = await workingSet({
              key: args.key,
              value: args.value,
              sessionId: args.sessionId,
              expiresInMs: args.expiresInMs,
            });
            return textResult({ id: entry?.id, key: args.key, status: 'set' });
          }

          case 'get': {
            if (!args.key) {
              return textResult({ error: 'get requires key' });
            }
            const entry = await workingGet({ key: args.key, sessionId: args.sessionId });
            if (!entry) {
              return textResult({ key: args.key, value: null, status: 'not_found' });
            }
            return textResult({
              key: entry.key,
              value: entry.value,
              expires_at: entry.expires_at ?? null,
            });
          }

          case 'list': {
            const entries = await workingList({ sessionId: args.sessionId, limit: args.limit });
            return textResult({ count: entries.length, entries });
          }

          case 'clear': {
            const deleted = await workingClear({ sessionId: args.sessionId });
            return textResult({ deleted });
          }

          default:
            return textResult({ error: `Unknown mode: ${args.mode}` });
        }
      } catch (error) {
        return textResult({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  );
}

function textResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}
