import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import {
  addTimelineEvent,
  clearTimeline,
  recentTimelineEvents,
  searchTimelineEvents,
  summarizeTimeline,
} from '../memory/store';

const inputSchema = z.object({
  mode: z.enum(['add', 'recent', 'search', 'summary', 'clear']).describe('Timeline operation'),
  title: z.string().optional().describe('Title for add mode'),
  eventType: z.string().optional().describe('Event type for add (default: agent_action)'),
  body: z.string().optional().describe('Body text for add'),
  tags: z.array(z.string()).optional().describe('Tags for add'),
  query: z.string().optional().describe('Search query for search mode'),
  limit: z.number().int().min(1).max(200).default(20).optional(),
  confirm: z.boolean().optional().describe('Must be true for clear mode'),
});

export function registerTimelineTool(server: McpServer) {
  server.registerTool(
    'ourbook_timeline',
    {
      description: 'Timeline event log. Modes: add, recent, search, summary, clear.',
      inputSchema,
    },
    async (args) => {
      try {
        switch (args.mode) {
          case 'add': {
            if (!args.title) {
              return textResult({ error: 'add requires title' });
            }
            const event = await addTimelineEvent({
              eventType: args.eventType ?? 'agent_action',
              title: args.title,
              body: args.body ?? null,
              tags: args.tags,
            });
            return textResult({ id: event.id, status: 'added' });
          }

          case 'recent': {
            const events = await recentTimelineEvents(args.limit);
            return textResult({ count: events.length, events });
          }

          case 'search': {
            if (!args.query) {
              return textResult({ error: 'search requires query' });
            }
            const events = await searchTimelineEvents(args.query, args.limit);
            return textResult({ count: events.length, events });
          }

          case 'summary': {
            const summary = await summarizeTimeline(args.limit);
            return textResult(summary);
          }

          case 'clear': {
            if (!args.confirm) {
              return textResult({ error: 'clear requires confirm: true' });
            }
            const deleted = await clearTimeline();
            return textResult({ deleted });
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
