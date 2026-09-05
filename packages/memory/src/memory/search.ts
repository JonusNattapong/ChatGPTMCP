import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';

import { db } from '../db/client';
import { memories, memoryTags } from '../db/schema';
import { embedText } from '../embeddings/embedder';
import type { RecallInput, RecallResult } from './store';

export type DebugRecallResult = RecallResult & {
  score_vector: number;
  score_fts: number;
  score_importance: number;
  score_recency: number;
  score_access: number;
};

export async function hybridSearch(input: RecallInput): Promise<RecallResult[]> {
  const queryEmbedding = await embedText(input.query);
  const ftsQuery = toFtsQuery(input.query);
  const tags = (input.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean);
  const limit = Math.min(input.limit ?? 5, 200);

  const treePathFilter = input.treePath
    ? buildTreePathFilter(input.treePath, input.cascade ?? false)
    : undefined;
  const cascadeBoost =
    input.treePath && input.cascade ? buildCascadeBoost(input.treePath) : sql`1.0`;
  const tagFilter =
    tags.length > 0
      ? sql`EXISTS (
          SELECT 1
          FROM memory_tags mt
          WHERE mt.memory_id = ${memories.id}
            AND ${inArray(memoryTags.tag, tags)}
        )`
      : undefined;
  const ftsScores = db
    .select({
      id: sql<string>`memories_fts.id`.as('id'),
      score_fts: sql<number>`1.0 / (1.0 + ABS(bm25(memories_fts, 5.0, 1.0)))`.as('score_fts'),
    })
    .from(sql`memories_fts`)
    .where(ftsQuery ? sql`memories_fts MATCH ${ftsQuery}` : undefined)
    .as('fts_scores');

  const rows = await db
    .select({
      id: memories.id,
      content: memories.content,
      tags: memories.tags,
      agent: memories.agent,
      created_at: memories.created_at,
      score: sql<number>`
        (0.55 * (1.0 - vec_distance_cosine(${memories.embedding}, ${queryEmbedding}))
        + 0.25 * COALESCE(fts_scores.score_fts, 0)
        + 0.10 * ${memories.importance}
        + 0.05 * (1.0 / (1.0 + (${Date.now()} - ${memories.created_at}) / 86400000.0 * COALESCE(${memories.decay_rate}, 0.01)))
        + 0.05 * (1.0 / (1.0 + (${memories.access_count} / 10.0)))
        ) * COALESCE(${cascadeBoost}, 1.0)
      `.as('score'),
    })
    .from(memories)
    .leftJoin(ftsScores, sql`fts_scores.id = ${memories.id}`)
    .where(
      and(
        input.agent ? eq(memories.agent, input.agent) : undefined,
        input.project ? eq(memories.project, input.project) : undefined,
        tagFilter,
        treePathFilter,
        isNull(memories.superseded_by),
        or(isNull(memories.decay_at), gt(memories.decay_at, Date.now())),
      ),
    )
    .orderBy(sql`score DESC`)
    .limit(limit);

  const results = rows.map((row) => ({
    id: row.id,
    content: row.content,
    score: Number(row.score ?? 0),
    tags: Array.isArray(row.tags) ? row.tags : [],
    agent: row.agent,
    created_at: row.created_at,
  }));

  if (results.length > 0) {
    const resultIds = results.map((r) => r.id);
    await db
      .update(memories)
      .set({
        access_count: sql`access_count + 1`,
        last_accessed_at: Date.now(),
      })
      .where(inArray(memories.id, resultIds));
  }

  return results;
}

export async function hybridSearchDebug(input: RecallInput): Promise<DebugRecallResult[]> {
  const queryEmbedding = await embedText(input.query);
  const ftsQuery = toFtsQuery(input.query);
  const limit = Math.min(input.limit ?? 5, 200);
  const now = Date.now();
  const treePathFilter = input.treePath
    ? buildTreePathFilter(input.treePath, input.cascade ?? false)
    : undefined;
  const cascadeBoost =
    input.treePath && input.cascade ? buildCascadeBoost(input.treePath) : sql`1.0`;

  const ftsScores = db
    .select({
      id: sql<string>`memories_fts.id`.as('id'),
      score_fts: sql<number>`1.0 / (1.0 + ABS(bm25(memories_fts, 5.0, 1.0)))`.as('score_fts'),
    })
    .from(sql`memories_fts`)
    .where(ftsQuery ? sql`memories_fts MATCH ${ftsQuery}` : undefined)
    .as('fts_scores');

  const rows = await db
    .select({
      id: memories.id,
      content: memories.content,
      tags: memories.tags,
      agent: memories.agent,
      created_at: memories.created_at,
      score: sql<number>`
        (0.55 * (1.0 - vec_distance_cosine(${memories.embedding}, ${queryEmbedding}))
        + 0.25 * COALESCE(fts_scores.score_fts, 0)
        + 0.10 * ${memories.importance}
        + 0.05 * (1.0 / (1.0 + (${now} - ${memories.created_at}) / 86400000.0 * COALESCE(${memories.decay_rate}, 0.01)))
        + 0.05 * (1.0 / (1.0 + (${memories.access_count} / 10.0)))
        ) * COALESCE(${cascadeBoost}, 1.0)
      `.as('score'),
      score_vector: sql<number>`1.0 - vec_distance_cosine(${memories.embedding}, ${queryEmbedding})`,
      score_fts: sql<number>`COALESCE(fts_scores.score_fts, 0)`,
      score_importance: sql<number>`${memories.importance}`,
      score_recency: sql<number>`1.0 / (1.0 + (${now} - ${memories.created_at}) / 86400000.0 * COALESCE(${memories.decay_rate}, 0.01))`,
      score_access: sql<number>`1.0 / (1.0 + (${memories.access_count} / 10.0))`,
    })
    .from(memories)
    .leftJoin(ftsScores, sql`fts_scores.id = ${memories.id}`)
    .where(
      and(
        input.agent ? eq(memories.agent, input.agent) : undefined,
        input.project ? eq(memories.project, input.project) : undefined,
        treePathFilter,
        isNull(memories.superseded_by),
        or(isNull(memories.decay_at), gt(memories.decay_at, now)),
      ),
    )
    .orderBy(sql`score DESC`)
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    content: row.content,
    score: Number(row.score ?? 0),
    tags: Array.isArray(row.tags) ? row.tags : [],
    agent: row.agent,
    created_at: row.created_at,
    score_vector: Number((row as Record<string, unknown>).score_vector ?? 0),
    score_fts: Number((row as Record<string, unknown>).score_fts ?? 0),
    score_importance: Number((row as Record<string, unknown>).score_importance ?? 0),
    score_recency: Number((row as Record<string, unknown>).score_recency ?? 0),
    score_access: Number((row as Record<string, unknown>).score_access ?? 0),
  }));
}

export function toFtsQuery(query: string) {
  const terms = query
    .match(/[a-zA-Z0-9_]{2,}/g)
    ?.map((term) => `${term.replace(/[^a-zA-Z0-9_]/g, '')}*`)
    .join(' OR ');

  return terms && terms.length > 0 ? terms : undefined;
}

/** Serialize a tree path array to a JSON string for SQL comparison. */
function toJsonPath(segments: string[]): string {
  return JSON.stringify(segments);
}

/** Generate SQL LIKE pattern to match child paths of the given segments. */
function toChildLikePattern(segments: string[]): string {
  // ["a","b"] → ["a","b",%
  const prefix = JSON.stringify(segments);
  // Insert a comma before the closing bracket
  return `${prefix.slice(0, -1)},"%`;
}

/**
 * Build a WHERE filter for tree_path.
 *
 * - Normal: `tree_path = ?` (exact match only)
 * - Cascade: `tree_path IN (exact, parent1, parent2, ...) OR tree_path LIKE child_pattern`
 */
function buildTreePathFilter(treePath: string[], cascade: boolean): ReturnType<typeof or> {
  if (!cascade) {
    return eq(memories.tree_path, treePath);
  }

  const conditions: ReturnType<typeof eq>[] = [
    eq(memories.tree_path, treePath), // exact
  ];

  // Parent paths: every prefix except the full path
  for (let i = 1; i < treePath.length; i++) {
    conditions.push(eq(memories.tree_path, treePath.slice(0, i)));
  }

  // Child paths: LIKE for JSON array prefix
  const childPattern = toChildLikePattern(treePath);
  conditions.push(sql`memories.tree_path LIKE ${childPattern}`);

  return or(...conditions);
}

/**
 * Build a CASE expression that returns a boost multiplier based on
 * how the matched memory's tree_path relates to the query tree_path.
 *
 * - Exact match: 1.0
 * - Child match: 0.85
 * - Parent match: 0.70
 * - Sibling/other: 0.50
 */
function buildCascadeBoost(queryPath: string[]): ReturnType<typeof sql> {
  const exactJson = toJsonPath(queryPath);
  const childPattern = toChildLikePattern(queryPath);

  const parentConditions: string[] = [];
  for (let i = 1; i < queryPath.length; i++) {
    parentConditions.push(`memories.tree_path = '${toJsonPath(queryPath.slice(0, i))}'`);
  }

  const whenClauses = [`WHEN memories.tree_path = '${exactJson}' THEN 1.0`];

  for (const cond of parentConditions) {
    whenClauses.push(`WHEN ${cond} THEN 0.70`);
  }

  whenClauses.push(`WHEN memories.tree_path LIKE '${childPattern}' THEN 0.85`);

  return sql`CASE ${sql.raw(whenClauses.join(' '))} ELSE 1.0 END`;
}
