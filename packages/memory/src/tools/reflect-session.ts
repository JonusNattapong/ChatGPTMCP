import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { reflectSession } from '../memory/store';

const inputSchema = z.object({
  sessionId: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20).optional(),
});

export function registerReflectSessionTool(server: McpServer) {
  server.registerTool(
    'ourbook_reflect_session',
    {
      description:
        'Read recent timeline events, traces, feedback, and memories; produce session summary, learned taste, project decisions, next actions; store useful outputs as memories.',
      inputSchema,
    },
    async (args) => {
      try {
        const result = await reflectSession(args);
        return textResult(result);
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
