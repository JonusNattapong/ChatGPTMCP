import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { listMemoryFeedback } from '../memory/store';

const inputSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50).optional(),
  offset: z.number().int().min(0).default(0).optional(),
  signal: z.string().optional(),
});

export function registerFeedbackListTool(server: McpServer) {
  server.registerTool(
    'ourbook_feedback_list',
    {
      description: 'List memory feedback records, optionally filtered by signal.',
      inputSchema,
    },
    async (args) => {
      try {
        const feedback = await listMemoryFeedback(args);
        return textResult({ feedback });
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
