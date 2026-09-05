import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import { buildTree, treeList, treeMv, treePrune } from '../memory/store';

export function registerTreeTool(server: McpServer) {
  server.registerTool(
    'ourbook_tree',
    {
      description: 'Browse, stats, prune, or rename memory tree paths.',
      inputSchema: z.object({
        mode: z
          .enum(['browse', 'stats', 'prune', 'mv'])
          .default('browse')
          .describe('Tree operation'),
        prefix: z
          .array(z.string())
          .optional()
          .describe('Tree path prefix for prune (e.g. ["claudecode","my-app"])'),
        older: z.string().optional().describe('Prune cutoff like "30d", "12h" (requires prefix)'),
        oldSegment: z.string().optional().describe('Segment to rename (for mv)'),
        newSegment: z.string().optional().describe('New segment name (for mv)'),
      }),
    },
    async (args) => {
      try {
        switch (args.mode) {
          case 'browse':
          case 'stats': {
            const entries = await treeList();
            const tree = buildTree(entries);
            if (args.mode === 'stats') {
              const totalMemories = entries.reduce((sum, e) => sum + e.count, 0);
              return textResult({
                branches: entries.length,
                total_memories: totalMemories,
                tree,
              });
            }
            return textResult({ tree });
          }

          case 'prune': {
            if (!args.prefix || !args.older) {
              return textResult({
                error: 'prune requires prefix (string[]) and older (e.g. "30d")',
              });
            }
            const match = args.older.match(/^(\d+)([dhms])$/);
            if (!match) {
              return textResult({ error: '--older must be like 30d, 12h, 60m, 30s' });
            }
            const multipliers: Record<string, number> = {
              d: 86400000,
              h: 3600000,
              m: 60000,
              s: 1000,
            };
            const olderThanMs = Number(match[1]) * (multipliers[match[2]!] ?? 86400000);
            const deleted = await treePrune({ prefix: args.prefix, olderThanMs });
            return textResult({ deleted, prefix: args.prefix, older_cutoff_ms: olderThanMs });
          }

          case 'mv': {
            if (!args.oldSegment || !args.newSegment) {
              return textResult({ error: 'mv requires oldSegment and newSegment' });
            }
            const changed = await treeMv(args.oldSegment, args.newSegment);
            return textResult({ changed, from: args.oldSegment, to: args.newSegment });
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
