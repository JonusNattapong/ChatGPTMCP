import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { listMemories, remember as storeMemory } from '../memory/store';

export function registerExportImportTools(server: McpServer) {
  // ourbook_export
  server.registerTool(
    'ourbook_export',
    {
      description: 'Export all active (non-superseded) memories as JSON.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(10000).default(1000).optional(),
        offset: z.number().int().min(0).default(0).optional(),
      }),
    },
    async (args) => {
      try {
        const mems = await listMemories(args.limit, args.offset);
        return textResult({ count: mems.length, memories: mems });
      } catch (error) {
        return textResult({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  );

  // ourbook_import
  server.registerTool(
    'ourbook_import',
    {
      description: 'Import memories from JSON export format.',
      inputSchema: z.object({
        memories: z
          .array(
            z.object({
              content: z.string().min(1),
              tags: z.array(z.string()).optional(),
              agent: z.string().optional(),
              name: z.string().optional(),
              kind: z.string().optional(),
              project: z.string().optional(),
              client: z.string().optional(),
            }),
          )
          .min(1)
          .max(500),
      }),
    },
    async (args) => {
      try {
        const results: Array<{ id: string; status: string; index: number }> = [];
        const errors: Array<{ index: number; error: string }> = [];

        for (let i = 0; i < args.memories.length; i++) {
          const item = args.memories[i]!;
          try {
            const memory = await storeMemory(item);
            results.push({ index: i, id: memory.id, status: 'stored' });
          } catch (error) {
            errors.push({
              index: i,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        return textResult({ imported: results.length, failed: errors.length, results, errors });
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
