import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { detectClient } from '../client';
import { addTimelineEvent, recordMemoryTrace, recall as searchMemories } from '../memory/store';

const inputSchema = z.object({
  context: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(3).optional(),
});

export function registerReflectTool(server: McpServer) {
  server.registerTool(
    'ourbook_reflect',
    {
      description:
        'Recall relevant memories for the current context and return an XML injection block.',
      inputSchema,
    },
    async (args) => {
      try {
        const memories = await searchMemories({
          query: args.context,
          limit: args.limit ?? 3,
        });
        await recordMemoryTrace({
          toolName: 'ourbook_reflect',
          query: args.context,
          client: detectClient(),
          project: null,
          resultCount: memories.length,
          selectedIds: memories.map((memory) => memory.id),
        });

        if (memories.length > 0) {
          await addTimelineEvent({
            eventType: 'memory_recalled',
            title: 'Reflection context generated',
            body: `Generated reflection context from ${memories.length} memories.`,
            entityType: 'memory',
            entityId: memories[0]?.id ?? null,
            metadata: {
              result_count: memories.length,
            },
          });
        }

        return textResult({
          injection: formatInjection(memories),
        });
      } catch (error) {
        await recordMemoryTrace({
          toolName: 'ourbook_reflect',
          query: args.context,
          client: detectClient(),
          project: null,
          resultCount: 0,
          selectedIds: [],
        });
        return errorResult(error);
      }
    },
  );
}

function formatInjection(
  memories: Array<{
    id: string;
    content: string;
    score: number;
    tags: string[];
    agent: string;
    created_at: number;
  }>,
) {
  const items = memories
    .map(
      (memory) =>
        `  <memory id="${escapeXml(memory.id)}" score="${memory.score.toFixed(4)}" agent="${escapeXml(memory.agent)}" created_at="${memory.created_at}" tags="${escapeXml(memory.tags.join(','))}">${escapeXml(memory.content)}</memory>`,
    )
    .join('\n');

  return `<ourbook_memory>\n${items}\n</ourbook_memory>`;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function textResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function errorResult(error: unknown) {
  return textResult({ error: error instanceof Error ? error.message : String(error) });
}
