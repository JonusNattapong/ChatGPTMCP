import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { workingList } from '../memory/store';

const inputSchema = z.object({
  sessionId: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(100).optional(),
});

export function registerWorkingListTool(server: McpServer) {
  server.registerTool(
    'ourbook_working_list',
    {
      description: 'List all working memory entries for the current session.',
      inputSchema,
    },
    async (args) => {
      try {
        const entries = await workingList(args);
        return textResult({ entries });
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
