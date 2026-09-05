import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import { addTimelineEvent, remember as storeMemory } from '../memory/store';

const itemSchema = z.object({
  content: z.string().min(1),
  tags: z.array(z.string()).optional(),
  agent: z.string().optional(),
  name: z.string().optional(),
  kind: z.string().optional(),
  project: z.string().optional(),
  client: z.string().optional(),
});

const inputSchema = z.object({
  items: z.array(itemSchema).min(1).max(100).describe('Memories to store (1-100)'),
});

export function registerBatchRememberTool(server: McpServer) {
  server.registerTool(
    'ourbook_batch_remember',
    {
      description: 'Store multiple memories in one call (up to 100).',
      inputSchema,
    },
    async (args) => {
      try {
        const results: Array<{ id: string; status: string }> = [];
        const errors: Array<{ index: number; error: string }> = [];

        for (let i = 0; i < args.items.length; i++) {
          const item = args.items[i]!;
          try {
            const memory = await storeMemory(item);
            results.push({ id: memory.id, status: 'stored' });
          } catch (error) {
            errors.push({
              index: i,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        await addTimelineEvent({
          eventType: 'agent_action',
          title: `Batch stored ${results.length} memories`,
          body: errors.length > 0 ? `${errors.length} failed` : undefined,
          tags: ['batch'],
          metadata: { total: args.items.length, stored: results.length, errors: errors.length },
        });

        return textResult({ stored: results.length, failed: errors.length, results, errors });
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
