import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { workingClear } from '../memory/store';

const inputSchema = z.object({
  sessionId: z.string().optional(),
});

export function registerWorkingClearTool(server: McpServer) {
  server.registerTool(
    'ourbook_working_clear',
    {
      description: 'Clear all working memory entries for the current session.',
      inputSchema,
    },
    async (args) => {
      try {
        const deleted = await workingClear(args);
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
