import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { remember as storeMemory } from '../memory/store';

const inputSchema = z.object({
  content: z.string().min(1),
  tags: z.array(z.string()).optional(),
  agent: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  project: z.string().optional(),
  client: z.string().optional(),
  workspaceRoot: z.string().optional(),
  kind: z.string().optional(),
  name: z.string().optional(),
});

export function registerRememberTool(server: McpServer) {
  server.registerTool(
    'ourbook_remember',
    {
      description: 'Embed and store a durable memory for future AI coding agent recall.',
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        const memory = await storeMemory(args);
        return textResult({ id: memory.id, status: 'stored' });
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
