import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { supersedeMemory } from '../memory/store';

const inputSchema = z.object({
  id: z.string().min(1),
  replacementId: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
});

export function registerSupersedeTool(server: McpServer) {
  server.registerTool(
    'ourbook_supersede',
    {
      description:
        'Mark an existing memory as superseded without deleting it. If replacementId is omitted, the memory is marked superseded by itself.',
      inputSchema,
    },
    async (args) => {
      try {
        const memory = await supersedeMemory(args);
        return textResult({
          id: memory.id,
          status: 'superseded',
          superseded_by: memory.superseded_by,
          superseded_at: memory.superseded_at,
          superseded_reason: memory.superseded_reason,
        });
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
