import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { recentTimelineEvents } from '../memory/store';

const inputSchema = z.object({
  limit: z.number().int().min(1).max(200).default(20).optional(),
});

export function registerTimelineRecentTool(server: McpServer) {
  server.registerTool(
    'ourbook_timeline_recent',
    {
      description: 'Return recent memory timeline events without searching raw prompts.',
      inputSchema,
    },
    async (args) => {
      try {
        const events = await recentTimelineEvents(args.limit ?? 20);
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
