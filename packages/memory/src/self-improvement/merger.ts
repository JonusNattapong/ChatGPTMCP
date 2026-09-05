import { sqlite } from '../db/client';
import { supersedeMemory } from '../memory/store';

export type MergeResult = {
  candidates: number;
  merged: number;
};

/**
 * Auto-merge: find memories with identical content + same tree_path,
 * and supersede the older one.
 */
export async function autoMerge(): Promise<MergeResult> {
  const result: MergeResult = { candidates: 0, merged: 0 };

  // Find duplicate content within same tree_path
  const duplicates = sqlite
    .prepare(`
      SELECT m1.id AS newer_id, m2.id AS older_id, m1.content
      FROM memories m1
      JOIN memories m2 ON m1.content = m2.content
        AND m1.tree_path = m2.tree_path
        AND m1.id != m2.id
        AND m1.created_at > m2.created_at
      WHERE m1.superseded_by IS NULL
        AND m2.superseded_by IS NULL
      LIMIT 50
    `)
    .all() as Array<{ newer_id: string; older_id: string; content: string }>;

  result.candidates = duplicates.length;

  // Supersede older duplicates
  for (const dup of duplicates) {
    try {
      await supersedeMemory({
        id: dup.older_id,
        replacementId: dup.newer_id,
        reason: 'auto-merged: duplicate content',
      });
      result.merged++;
    } catch {
      // skip if already superseded by concurrent operation
    }
  }

  return result;
}
