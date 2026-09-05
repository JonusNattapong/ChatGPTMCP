import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { type ConsolidateInput, consolidateSharedMemory } from '../ourbook/engine';

const inputSchema = z.object({
  sinceHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(24)
    .optional(),
  limit: z.number().int().min(2).max(200).default(80).optional(),
  force: z.boolean().default(false).optional(),
});

export function registerConsolidateTool(server: McpServer) {
  server.registerTool(
    'ourbook_consolidate',
    {
      description:
        'Consolidate recent durable memories into one daily continuity memory. Idempotent per local day unless force=true.',
      inputSchema,
    },
    async (args) => {
      try {
        const input = {
          ...(args.sinceHours !== undefined ? { sinceHours: args.sinceHours } : {}),
          ...(args.limit !== undefined ? { limit: args.limit } : {}),
          ...(args.force !== undefined ? { force: args.force } : {}),
        } satisfies ConsolidateInput;
        return textResult(await consolidateSharedMemory(input));
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
