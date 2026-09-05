import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { detectClient } from '../client';
import { addTimelineEvent, recordMemoryTrace, recall as searchMemories } from '../memory/store';

const inputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(200).default(5).optional(),
  agent: z.string().optional(),
  project: z.string().optional(),
  tags: z.array(z.string()).optional(),
  treePath: z.array(z.string()).optional(),
  cascade: z.boolean().optional(),
});

export function registerRecallTool(server: McpServer) {
  server.registerTool(
    'ourbook_recall',
    {
      description: 'Run hybrid vector cosine + FTS5 search over stored memories.',
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        const memories = await searchMemories(args);
        await recordMemoryTrace({
          toolName: 'ourbook_recall',
          query: args.query,
          client: detectClient(),
          project: args.project ?? null,
          resultCount: memories.length,
          selectedIds: memories.map((memory) => memory.id),
        });

        if (memories.length > 0) {
          await addTimelineEvent({
            eventType: 'memory_recalled',
            title: 'Memories recalled',
            body: `Recalled ${memories.length} memories.`,
            entityType: 'memory',
            entityId: memories[0]?.id ?? null,
            tags: args.tags,
            metadata: {
              result_count: memories.length,
            },
          });
        }

        return textResult({
          memories: memories.map((memory) => ({
            id: memory.id,
            content: memory.content,
            score: memory.score,
            tags: memory.tags,
            agent: memory.agent,
            created_at: memory.created_at,
          })),
        });
      } catch (error) {
        await recordMemoryTrace({
          toolName: 'ourbook_recall',
          query: args.query,
          client: detectClient(),
          project: args.project ?? null,
          resultCount: 0,
          selectedIds: [],
        });
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
