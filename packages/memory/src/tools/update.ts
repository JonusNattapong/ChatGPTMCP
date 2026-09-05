import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { updateMemory } from '../memory/store';

const inputSchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
  agent: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  project: z.string().nullable().optional(),
  client: z.string().optional(),
  workspaceRoot: z.string().optional(),
  kind: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  decayAt: z.number().nullable().optional(),
});

export function registerUpdateTool(server: McpServer) {
  server.registerTool(
    'ourbook_update',
    {
      description:
        'Update an existing memory by id. Recomputes the embedding and summary when content changes.',
      inputSchema,
    },
    async (args) => {
      try {
        const memory = await updateMemory(args);
        return textResult({ id: memory.id, status: 'updated' });
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
