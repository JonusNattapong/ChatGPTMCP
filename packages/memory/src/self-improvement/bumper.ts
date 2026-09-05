import { and, gte, isNotNull, lt, sql } from 'drizzle-orm';

import { db } from '../db/client';
import { memories } from '../db/schema';

export type BumpResult = {
  accessed_bumped: number;
  important_bumped: number;
};

/**
 * Auto-bump:
 * 1. Recently accessed memories (last_accessed_at within 7d) get importance +0.05
 * 2. Frequently accessed memories (access_count > 20) get importance +0.02
 * Caps importance at 1.0.
 */
export async function autoBump(now = Date.now()): Promise<BumpResult> {
  const sevenDays = 7 * 86400000;
  const result: BumpResult = { accessed_bumped: 0, important_bumped: 0 };

  // 1. Recently accessed → bump importance
  const accessed = await db
    .update(memories)
    .set({
      importance: sql<number>`MIN(${memories.importance} + 0.05, 1.0)`,
    })
    .where(
      and(
        isNotNull(memories.last_accessed_at),
        gte(memories.last_accessed_at, now - sevenDays),
        lt(memories.importance, 1.0),
      ),
    )
    .run();

  result.accessed_bumped = accessed.changes;

  // 2. Frequently accessed (access_count > 20) → extra bump
  const frequent = await db
    .update(memories)
    .set({
      importance: sql<number>`MIN(${memories.importance} + 0.02, 1.0)`,
    })
    .where(and(gte(memories.access_count, 20), lt(memories.importance, 1.0)))
    .run();

  result.important_bumped = frequent.changes;

  return result;
}
