import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { workingSet } from '../memory/store';

const inputSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  sessionId: z.string().optional(),
  expiresInMs: z.number().int().positive().optional(),
});

export function registerWorkingSetTool(server: McpServer) {
  server.registerTool(
    'ourbook_working_set',
    {
      description: 'Store a key-value pair scoped to the current session.',
      inputSchema,
    },
    async (args) => {
      try {
        const entry = await workingSet(args);
        return textResult({ id: entry?.id, status: 'stored' });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function textResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function errorResult(error: unknown) {
  return textResult({ error: error instanceof Error ? error.message : String(error) });
}
