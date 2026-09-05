import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { workingGet } from '../memory/store';

const inputSchema = z.object({
  key: z.string().min(1),
  sessionId: z.string().optional(),
});

export function registerWorkingGetTool(server: McpServer) {
  server.registerTool(
    'ourbook_working_get',
    {
      description: 'Get a working memory value by key for the current session.',
      inputSchema,
    },
    async (args) => {
      try {
        const entry = await workingGet(args);
        return textResult(entry ? { found: true, value: entry.value } : { found: false });
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
