import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { runImproveCycle } from '../self-improvement';

export function registerSelfImproveTool(server: McpServer) {
  server.registerTool(
    'ourbook_self_improve',
    {
      description:
        'Run one full self-improvement cycle: bump, merge, prune, mine, and record to timeline.',
    },
    async () => {
      try {
        const result = await runImproveCycle();
        return textResult(result);
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
