import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { stats } from '../memory/store';

export function registerStatsTool(server: McpServer) {
  server.registerTool(
    'ourbook_stats',
    {
      description: 'Show memory statistics: totals by agent, client, kind, project, and tree.',
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      try {
        const result = await stats();
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
