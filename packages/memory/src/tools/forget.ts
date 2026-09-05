import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import { forgetById, forgetMany, recall as searchMemories } from '../memory/store';

const inputSchema = z.union([
  z.object({ id: z.string().min(1) }),
  z.object({ query: z.string().min(1), confirm: z.literal(true) }),
]);

export function registerForgetTool(server: McpServer) {
  server.registerTool(
    'ourbook_forget',
    {
      description:
        'Permanently delete memory for privacy/security reasons by id, or by query with confirm true.',
      inputSchema,
    },
    async (args) => {
      try {
        if ('id' in args) {
          return textResult({ deleted: await forgetById(args.id) });
        }

        const matches = await searchMemories({
          query: args.query,
          limit: 200,
        });
        const deleted = await forgetMany(matches.map((memory) => memory.id));
        return textResult({ deleted });
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
