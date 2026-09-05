import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { addMemoryFeedback } from '../memory/store';

const inputSchema = z.object({
  memoryId: z.string().min(1),
  signal: z.enum([
    'accepted',
    'rejected',
    'corrected',
    'preferred',
    'disliked',
    'important',
    'wrong',
  ]),
  note: z.string().min(1).optional(),
  client: z.string().optional(),
  timelineId: z.string().nullable().optional(),
});

export function registerFeedbackAddTool(server: McpServer) {
  server.registerTool(
    'ourbook_feedback_add',
    {
      description:
        'Record a feedback signal for a memory. Accepted/important/preferred increase importance, wrong/rejected reduce confidence, corrected creates a correction timeline event.',
      inputSchema,
    },
    async (args) => {
      try {
        await addMemoryFeedback(args);
        return textResult({ status: 'recorded' });
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
