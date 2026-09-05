import { addTimelineEvent } from '../memory/store';
import { autoBump } from './bumper';
import { autoMerge } from './merger';
import { autoMine } from './miner';
import { autoPrune } from './pruner';

export type ImproveResult = {
  pruned: { decayed_pruned: number; old_pruned: number; superseded_pruned: number };
  bumped: { accessed_bumped: number; important_bumped: number };
  mined: {
    patterns_found: number;
    memories_stored: number;
    top_tags: string[];
    top_agents: string[];
  };
  merged: { candidates: number; merged: number };
  duration_ms: number;
  timeline_id?: string;
};

/**
 * Run one full self-improvement cycle:
 * 1. Auto-bump importance of active memories
 * 2. Auto-merge duplicate content
 * 3. Auto-prune decayed/old/superseded memories
 * 4. Auto-mine patterns from tags/agents/feedback
 * 5. Record a timeline event
 */
export async function runImproveCycle(): Promise<ImproveResult> {
  const start = Date.now();

  const [bumped, merged, pruned, mined] = await Promise.all([
    autoBump(start),
    autoMerge(),
    autoPrune(start),
    autoMine(start),
  ]);

  const duration_ms = Date.now() - start;

  const event = await addTimelineEvent({
    eventType: 'agent_action',
    title: 'Self-improvement cycle',
    body: [
      `Bumped: ${bumped.accessed_bumped + bumped.important_bumped} memories`,
      `Merged: ${merged.merged}/${merged.candidates} duplicates`,
      `Pruned: ${pruned.decayed_pruned} decayed, ${pruned.old_pruned} low-confidence, ${pruned.superseded_pruned} superseded`,
      `Mined: ${mined.patterns_found} patterns, ${mined.memories_stored} stored`,
      `Duration: ${duration_ms}ms`,
    ].join('. '),
    tags: ['self-improvement'],
    metadata: {
      bumped,
      merged,
      pruned,
      mined,
      duration_ms,
    },
  });

  return {
    pruned,
    bumped,
    mined,
    merged,
    duration_ms,
    timeline_id: event.id,
  };
}
