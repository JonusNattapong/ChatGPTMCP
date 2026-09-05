import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { searchTimelineEvents } from '../memory/store';

const inputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(200).default(20).optional(),
});

export function registerTimelineSearchTool(server: McpServer) {
  server.registerTool(
    'ourbook_timeline_search',
    {
      description: 'Search timeline events by title, body, and tags with FTS5.',
      inputSchema,
    },
    async (args) => {
      try {
        const events = await searchTimelineEvents(args.query, args.limit ?? 20);
        return textResult({ events });
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
