import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { detectClient } from '../client';
import { addTimelineEvent } from '../memory/store';

const inputSchema = z.object({
  scope: z.string().optional(),
  project: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
  client: z.string().optional(),
  actor: z.string().optional(),
  eventType: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1).optional(),
  entityType: z.string().nullable().optional(),
  entityId: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export function registerTimelineAddTool(server: McpServer) {
  server.registerTool(
    'ourbook_timeline_add',
    {
      description:
        'Append one timeline event. Prefer concise summaries; do not include secrets or full file contents.',
      inputSchema,
    },
    async (args) => {
      try {
        const event = await addTimelineEvent({
          ...args,
          client: args.client ?? detectClient(),
        });
        return textResult({ id: event.id, status: 'added' });
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
