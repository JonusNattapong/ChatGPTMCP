import { count, sql } from 'drizzle-orm';

import { db, sqlite } from '../db/client';
import { memories, memoryFeedback } from '../db/schema';
import { addTimelineEvent, remember } from '../memory/store';

export type MineResult = {
  patterns_found: number;
  memories_stored: number;
  top_tags: string[];
  top_agents: string[];
};

/**
 * Auto-mining:
 * 1. Extract top tags and agents from recent memories.
 * 2. Count correction patterns from feedback.
 * 3. Store a pattern-summary memory.
 */
export async function autoMine(now = Date.now()): Promise<MineResult> {
  const result: MineResult = {
    patterns_found: 0,
    memories_stored: 0,
    top_tags: [],
    top_agents: [],
  };

  // 1. Most common tags in last 100 non-superseded memories
  const tagRows = sqlite
    .prepare(`SELECT value AS tag, COUNT(*) AS tag_count
      FROM memories, json_each(memories.tags)
      WHERE superseded_by IS NULL
      GROUP BY value
      ORDER BY tag_count DESC
      LIMIT 10`)
    .all() as Array<{ tag: string; tag_count: number }>;

  result.top_tags = tagRows.map((r) => r.tag);

  // 2. Most common agents
  const agentRows = (await db
    .select({ agent: memories.agent, agentCount: count() })
    .from(memories)
    .groupBy(memories.agent)
    .orderBy(sql`agentCount DESC`)
    .limit(5)
    .all()) as Array<{ agent: string; agentCount: number }>;

  result.top_agents = agentRows.map((r) => r.agent);

  // 3. Recent correction/signal counts from feedback
  const recentFeedback = (await db
    .select({ signal: memoryFeedback.signal, signalCount: count() })
    .from(memoryFeedback)
    .groupBy(memoryFeedback.signal)
    .orderBy(sql`signalCount DESC`)
    .all()) as Array<{ signal: string; signalCount: number }>;

  const signalSummary = recentFeedback.map((r) => `${r.signal}: ${r.signalCount}`).join(', ');

  // 4. Only store if we have patterns
  if (result.top_tags.length >= 3 || signalSummary.length > 0) {
    const content = [
      '## Auto-mined patterns',
      '',
      `Top tags: ${result.top_tags.join(', ') || '(none)'}`,
      `Top agents: ${result.top_agents.join(', ') || '(none)'}`,
      `Recent feedback: ${signalSummary || '(none)'}`,
      '',
      `Mined at: ${new Date(now).toISOString()}`,
    ].join('\n');

    await remember({
      content,
      tags: ['self-improvement', 'patterns', ...result.top_tags.slice(0, 3)],
      agent: 'system',
      provider: 'local',
      model: 'ourbook-self-improve',
      kind: 'pattern',
      confidence: 0.7,
    });
    result.memories_stored = 1;
    result.patterns_found = result.top_tags.length + result.top_agents.length;

    await addTimelineEvent({
      eventType: 'taste_learned',
      title: `Auto-mined ${result.patterns_found} patterns`,
      body: `Tags: ${result.top_tags.join(', ')}. Agents: ${result.top_agents.join(', ')}. ${signalSummary}`,
      tags: ['self-improvement', 'patterns'],
    });
  }

  return result;
}
