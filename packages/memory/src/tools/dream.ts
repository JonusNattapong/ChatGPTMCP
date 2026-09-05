import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { type DreamInput, generateDream } from '../ourbook/engine';

const inputSchema = z.object({
  limit: z.number().int().min(3).max(100).default(24).optional(),
  seed: z.string().min(1).optional(),
  theme: z.string().min(1).optional(),
  mood: z.string().min(1).optional(),
  persist: z.boolean().default(true).optional(),
});

export function registerDreamTool(server: McpServer) {
  server.registerTool(
    'ourbook_dream',
    {
      description:
        'Recombine durable memories into a clearly labeled speculative story seed while keeping source memory IDs for provenance.',
      inputSchema,
    },
    async (args) => {
      try {
        const input = {
          ...(args.limit !== undefined ? { limit: args.limit } : {}),
          ...(args.seed !== undefined ? { seed: args.seed } : {}),
          ...(args.theme !== undefined ? { theme: args.theme } : {}),
          ...(args.mood !== undefined ? { mood: args.mood } : {}),
          ...(args.persist !== undefined ? { persist: args.persist } : {}),
        } satisfies DreamInput;
        return textResult(await generateDream(input));
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
