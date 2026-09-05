import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { summarizeTimeline } from '../memory/store';

const inputSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50).optional(),
});

export function registerTimelineSummaryTool(server: McpServer) {
  server.registerTool(
    'ourbook_timeline_summary',
    {
      description: 'Summarize recent timeline events by event type and include recent examples.',
      inputSchema,
    },
    async (args) => {
      try {
        return textResult(await summarizeTimeline(args.limit ?? 50));
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
