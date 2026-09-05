import { and, isNotNull, isNull, lt } from 'drizzle-orm';

import { db } from '../db/client';
import { memories } from '../db/schema';
import { forgetMany } from '../memory/store';

export type PruneResult = {
  decayed_pruned: number;
  old_pruned: number;
  superseded_pruned: number;
};

/**
 * Auto-prune:
 * 1. Forgets memories past their decay_at date.
 * 2. Forgets memories with confidence < 0.1 that are older than 30 days.
 * 3. Forgets memories superseded > 90 days ago.
 */
export async function autoPrune(now = Date.now()): Promise<PruneResult> {
  const result: PruneResult = { decayed_pruned: 0, old_pruned: 0, superseded_pruned: 0 };

  // 1. Decayed memories (decay_at is in the past)
  const decayed = (await db
    .select({ id: memories.id })
    .from(memories)
    .where(and(isNotNull(memories.decay_at), lt(memories.decay_at, now)))
    .all()) as Array<{ id: string }>;

  if (decayed.length > 0) {
    const ids = decayed.map((r) => r.id);
    await forgetMany(ids);
    result.decayed_pruned = ids.length;
  }

  // 2. Low-confidence old memories (confidence < 0.1, older than 30d)
  const thirtyDays = 30 * 86400000;
  const oldLowConf = (await db
    .select({ id: memories.id })
    .from(memories)
    .where(
      and(
        lt(memories.confidence, 0.1),
        isNull(memories.superseded_by),
        lt(memories.created_at, now - thirtyDays),
      ),
    )
    .all()) as Array<{ id: string }>;

  if (oldLowConf.length > 0) {
    const ids = oldLowConf.map((r) => r.id);
    await forgetMany(ids);
    result.old_pruned = ids.length;
  }

  // 3. Superseded memories older than 90 days
  const ninetyDays = 90 * 86400000;
  const oldSuperseded = (await db
    .select({ id: memories.id })
    .from(memories)
    .where(and(isNotNull(memories.superseded_at), lt(memories.superseded_at, now - ninetyDays)))
    .all()) as Array<{ id: string }>;

  if (oldSuperseded.length > 0) {
    const ids = oldSuperseded.map((r) => r.id);
    await forgetMany(ids);
    result.superseded_pruned = ids.length;
  }

  return result;
}
