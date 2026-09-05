import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { addTimelineEvent, remember as storeMemory } from '../memory/store';

const inputSchema = z.object({
  summary: z.string().min(1),
  project: z.string().optional(),
  agent: z.string().optional(),
  client: z.string().optional(),
  workspaceRoot: z.string().optional(),
});

export function registerHandoffTool(server: McpServer) {
  server.registerTool(
    'ourbook_handoff',
    {
      description: 'Store a session handoff summary with high confidence and a handoff tag.',
      inputSchema,
    },
    async (args) => {
      try {
        const memory = await storeMemory({
          content: args.summary,
          tags: ['handoff'],
          agent: args.agent ?? 'unknown',
          provider: 'local',
          model: 'handoff-summary',
          project: args.project,
          client: args.client,
          workspaceRoot: args.workspaceRoot,
          kind: 'handoff',
          confidence: 1,
        });

        await addTimelineEvent({
          eventType: 'handoff_created',
          title: 'Handoff created',
          body: 'Stored a session handoff summary.',
          entityType: 'memory',
          entityId: memory.id,
          tags: ['handoff'],
          project: args.project ?? null,
        });

        return textResult({ id: memory.id, status: 'handoff_stored' });
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
