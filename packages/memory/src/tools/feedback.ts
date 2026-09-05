import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { addMemoryFeedback, listMemoryFeedback } from '../memory/store';

const inputSchema = z.object({
  mode: z.enum(['add', 'list', 'important', 'wrong']).describe('Feedback operation'),
  memoryId: z.string().optional().describe('Memory ID (required for add/important/wrong)'),
  signal: z
    .enum(['accepted', 'rejected', 'corrected', 'preferred', 'disliked', 'important', 'wrong'])
    .optional()
    .describe('Signal type for add'),
  note: z.string().optional().describe('Note for the feedback'),
  signalFilter: z.string().optional().describe('Filter by signal for list'),
  limit: z.number().int().min(1).max(200).default(50).optional(),
});

export function registerFeedbackTool(server: McpServer) {
  server.registerTool(
    'ourbook_feedback',
    {
      description: 'Record or list memory feedback signals. Modes: add, list, important, wrong.',
      inputSchema,
    },
    async (args) => {
      try {
        switch (args.mode) {
          case 'add': {
            if (!args.memoryId || !args.signal) {
              return textResult({ error: 'add requires memoryId and signal' });
            }
            await addMemoryFeedback({
              memoryId: args.memoryId,
              signal: args.signal,
              note: args.note ?? null,
            });
            return textResult({ status: 'recorded', signal: args.signal, memoryId: args.memoryId });
          }

          case 'important':
          case 'wrong': {
            if (!args.memoryId) {
              return textResult({ error: `${args.mode} requires memoryId` });
            }
            await addMemoryFeedback({
              memoryId: args.memoryId,
              signal: args.mode,
              note: args.note ?? null,
            });
            return textResult({ status: 'recorded', signal: args.mode, memoryId: args.memoryId });
          }

          case 'list': {
            const feedback = await listMemoryFeedback({
              limit: args.limit,
              signal: args.signalFilter,
            });
            return textResult({ count: feedback.length, feedback });
          }

          default:
            return textResult({ error: `Unknown mode: ${args.mode}` });
        }
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
