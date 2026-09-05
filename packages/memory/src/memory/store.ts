import { and, count, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { ulid } from 'ulid';

import { detectClient, getWorkspaceRoot, normalizeClient, resolveTreePath } from '../client';
import { db } from '../db/client';
import {
  type Memory,
  memories,
  memoryFeedback,
  memoryTags,
  memoryTimeline,
  memoryTrace,
  workingMemory,
} from '../db/schema';
import { embedText } from '../embeddings/embedder';
import { sanitizeContent } from '../privacy';
import { summarizeContent } from './summarize';

export type RememberInput = {
  content: string;
  tags?: string[] | undefined;
  agent?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  project?: string | undefined;
  client?: string | undefined;
  workspaceRoot?: string | undefined;
  kind?: string | undefined;
  confidence?: number | undefined;
  decayAt?: number | undefined;
  name?: string | undefined;
};

export type RecallInput = {
  query: string;
  limit?: number | undefined;
  agent?: string | undefined;
  project?: string | undefined;
  tags?: string[] | undefined;
  name?: string | undefined;
  treePath?: string[] | undefined;
  cascade?: boolean | undefined;
};

export type UpdateInput = {
  id: string;
  content?: string | undefined;
  tags?: string[] | undefined;
  agent?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  project?: string | null | undefined;
  client?: string | undefined;
  workspaceRoot?: string | undefined;
  kind?: string | undefined;
  confidence?: number | undefined;
  decayAt?: number | null | undefined;
  name?: string | undefined;
};

export type SupersedeInput = {
  id: string;
  replacementId?: string | undefined;
  reason?: string | undefined;
};

export type PublicMemory = {
  id: string;
  content: string;
  summary?: string | null;
  tags: string[];
  agent: string;
  provider: string;
  model: string;
  project?: string | null;
  client: string;
  workspace_root?: string | null;
  kind: string;
  superseded_by?: string | null;
  superseded_at?: number | null;
  superseded_reason?: string | null;
  created_at: number;
  updated_at: number;
  confidence: number;
  decay_at?: number | null;
  importance: number;
  access_count: number;
  last_accessed_at?: number | null;
  decay_rate: number;
  tree_path: string[];
};

export type RecallResult = {
  id: string;
  content: string;
  score: number;
  tags: string[];
  agent: string;
  created_at: number;
};

export type MemoryTraceInput = {
  toolName: string;
  query?: string | undefined;
  client?: string | undefined;
  project?: string | null | undefined;
  resultCount: number;
  selectedIds: string[];
};

export type PublicMemoryTrace = {
  id: string;
  tool_name: string;
  query?: string | null;
  client: string;
  project?: string | null;
  result_count: number;
  selected_ids: string[];
  created_at: number;
};

export type TimelineEventType =
  | 'session_started'
  | 'session_ended'
  | 'memory_added'
  | 'memory_recalled'
  | 'memory_superseded'
  | 'memory_forgotten'
  | 'taste_learned'
  | 'decision_recorded'
  | 'handoff_created'
  | 'agent_action'
  | 'user_correction'
  | 'important_context';

export type AddTimelineEventInput = {
  scope?: string | undefined;
  project?: string | null | undefined;
  sessionId?: string | null | undefined;
  client?: string | undefined;
  actor?: string | undefined;
  eventType: TimelineEventType | string;
  title: string;
  body?: string | null | undefined;
  entityType?: string | null | undefined;
  entityId?: string | null | undefined;
  tags?: string[] | undefined;
  metadata?: Record<string, unknown> | undefined;
};

export type PublicTimelineEvent = {
  id: string;
  scope: string;
  project?: string | null;
  session_id?: string | null;
  client: string;
  actor: string;
  event_type: string;
  title: string;
  body?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: number;
};

export async function remember(input: RememberInput) {
  const now = Date.now();
  const safeContent = sanitizeContent(input.content);
  const embedding = await embedText(safeContent);
  const summary = summarizeContent(safeContent);
  const tags = normalizeTags(input.tags);
  const id = ulid();
  const client = normalizeClient(input.client ?? detectClient());
  const workspaceRoot = input.workspaceRoot ?? getWorkspaceRoot();
  const kind = input.kind ?? 'note';
  const treePath = resolveTreePath({
    name: input.name,
    project: input.project,
    client,
  });

  const [memory] = await db
    .insert(memories)
    .values({
      id,
      content: safeContent,
      summary,
      embedding: Buffer.from(embedding.buffer),
      tags,
      agent: input.agent ?? 'unknown',
      provider: input.provider ?? 'local',
      model: input.model ?? 'unknown',
      project: input.project ?? null,
      client,
      workspace_root: workspaceRoot,
      kind,
      created_at: now,
      updated_at: now,
      confidence: input.confidence ?? 1,
      decay_at: input.decayAt ?? null,
      importance: 0.5,
      access_count: 0,
      decay_rate: 0.01,
      tree_path: treePath,
    })
    .returning();

  if (!memory) {
    throw new Error('Failed to store memory');
  }

  await replaceTags(id, tags);
  await addTimelineEvent({
    eventType: 'memory_added',
    title: 'Memory added',
    body: summary ?? summarizeContent(input.content),
    entityType: 'memory',
    entityId: id,
    tags,
    metadata: {
      client,
      workspace_root: workspaceRoot,
      kind,
    },
  });

  return toPublicMemory(memory);
}

export async function recall(input: RecallInput) {
  const { hybridSearch } = await import('./search');
  return hybridSearch(input);
}

export async function getMemory(id: string) {
  const memory = await db.query.memories.findFirst({
    where: eq(memories.id, id),
  });

  return memory ? toPublicMemory(memory) : undefined;
}

export async function updateMemory(input: UpdateInput) {
  const existing = await getMemory(input.id);

  if (!existing) {
    throw new Error(`Memory not found: ${input.id}`);
  }

  const content = input.content ?? existing.content;
  const tags = input.tags === undefined ? existing.tags : normalizeTags(input.tags);
  const embedding = input.content
    ? Buffer.from((await embedText(input.content)).buffer)
    : undefined;
  const summary = input.content ? summarizeContent(input.content) : existing.summary;
  const now = Date.now();
  const values = {
    content,
    summary,
    agent: input.agent ?? existing.agent,
    provider: input.provider ?? existing.provider,
    model: input.model ?? existing.model,
    project: input.project === undefined ? existing.project : input.project,
    client: input.client ?? existing.client,
    workspace_root: input.workspaceRoot ?? existing.workspace_root,
    kind: input.kind ?? existing.kind,
    updated_at: now,
    confidence: input.confidence ?? existing.confidence,
    decay_at: input.decayAt === undefined ? existing.decay_at : input.decayAt,
  };

  const [memory] = await db
    .update(memories)
    .set({
      ...values,
      embedding,
    })
    .where(eq(memories.id, input.id))
    .returning();

  if (!memory) {
    throw new Error(`Failed to update memory: ${input.id}`);
  }

  await replaceTags(input.id, tags);

  return toPublicMemory(memory);
}

export async function supersedeMemory(input: SupersedeInput) {
  const existing = await getMemory(input.id);

  if (!existing) {
    throw new Error(`Memory not found: ${input.id}`);
  }

  if (input.replacementId && input.replacementId !== existing.id) {
    const replacement = await getMemory(input.replacementId);
    if (!replacement) {
      throw new Error(`Replacement memory not found: ${input.replacementId}`);
    }
  }

  const now = Date.now();
  const replacementId = input.replacementId ?? existing.id;
  const [memory] = await db
    .update(memories)
    .set({
      superseded_by: replacementId,
      superseded_at: now,
      superseded_reason: input.reason ?? 'superseded',
    })
    .where(eq(memories.id, input.id))
    .returning();

  if (!memory) {
    throw new Error(`Failed to supersede memory: ${input.id}`);
  }

  await addTimelineEvent({
    eventType: 'memory_superseded',
    title: 'Memory superseded',
    body: input.reason ?? 'superseded',
    entityType: 'memory',
    entityId: input.id,
    metadata: {
      replacement_id: replacementId,
    },
  });

  return toPublicMemory(memory);
}

export async function listMemories(limit = 50, offset = 0) {
  const rows = await db
    .select()
    .from(memories)
    .orderBy(desc(memories.created_at))
    .limit(Math.min(limit, 200))
    .offset(offset);

  return rows.map(toPublicMemory);
}

export async function forgetById(id: string) {
  const deleted = await db.delete(memories).where(eq(memories.id, id)).run();

  if (deleted.changes > 0) {
    await addTimelineEvent({
      eventType: 'memory_forgotten',
      title: 'Memory permanently deleted',
      body: 'A memory was deleted for privacy or security reasons.',
      entityType: 'memory',
      entityId: id,
    });
  }

  return deleted.changes;
}

export async function forgetMany(ids: string[]) {
  if (ids.length === 0) {
    return 0;
  }

  const result = await db.delete(memories).where(inArray(memories.id, ids)).run();

  if (result.changes > 0) {
    await addTimelineEvent({
      eventType: 'memory_forgotten',
      title: 'Memories permanently deleted',
      body: `${result.changes} memor${result.changes === 1 ? 'y was' : 'ies were'} deleted for privacy or security reasons.`,
      entityType: 'memory',
      metadata: {
        deleted_count: result.changes,
      },
    });
  }

  return result.changes;
}

export async function countMemories() {
  const row = await db.select({ count: count() }).from(memories).get();
  return row?.count ?? 0;
}

export async function stats() {
  const totalRow = await db.select({ count: count() }).from(memories).get();
  const avgRow = await db.select({ avg: sql<number>`AVG(confidence)` }).from(memories).get();
  const agentRows = await db
    .select({ agent: memories.agent, count: count() })
    .from(memories)
    .groupBy(memories.agent);
  const clientRows = await db
    .select({ client: memories.client, count: count() })
    .from(memories)
    .groupBy(memories.client);
  const kindRows = await db
    .select({ kind: memories.kind, count: count() })
    .from(memories)
    .groupBy(memories.kind);
  const projectRows = await db
    .select({ project: memories.project, count: count() })
    .from(memories)
    .groupBy(memories.project);
  const traceRows = await db.select({ count: count() }).from(memoryTrace).get();

  const treeRows = await db
    .select({ path: memories.tree_path, count: count() })
    .from(memories)
    .groupBy(memories.tree_path)
    .orderBy(memories.tree_path)
    .all();

  return {
    total: totalRow?.count ?? 0,
    by_agent: Object.fromEntries(agentRows.map((row) => [row.agent, row.count])),
    by_client: Object.fromEntries(clientRows.map((row) => [row.client, row.count])),
    by_kind: Object.fromEntries(kindRows.map((row) => [row.kind, row.count])),
    by_project: Object.fromEntries(projectRows.map((row) => [row.project ?? '(none)', row.count])),
    avg_confidence: Number(avgRow?.avg ?? 0),
    traces: traceRows?.count ?? 0,
    tree: treeRows as Array<{ path: string[]; count: number }>,
  };
}

export async function recordMemoryTrace(input: MemoryTraceInput) {
  await db.insert(memoryTrace).values({
    id: ulid(),
    toolName: input.toolName,
    query: input.query ?? null,
    client: input.client ?? detectClient(),
    project: input.project ?? null,
    resultCount: input.resultCount,
    selectedIdsJson: JSON.stringify(input.selectedIds),
    created_at: Date.now(),
  });
}

export async function listMemoryTraces(limit = 50, offset = 0) {
  const rows = await db
    .select()
    .from(memoryTrace)
    .orderBy(desc(memoryTrace.created_at))
    .limit(Math.min(limit, 200))
    .offset(offset);

  return rows.map(toPublicMemoryTrace);
}

export type TreeEntry = {
  path: string[];
  count: number;
};

export type TreeNodeType = {
  name: string;
  count: number;
  children: TreeNodeType[];
};

export async function treeList(): Promise<TreeEntry[]> {
  const rows = await db
    .select({ path: memories.tree_path, count: count() })
    .from(memories)
    .groupBy(memories.tree_path)
    .orderBy(memories.tree_path)
    .all();

  return rows as unknown as TreeEntry[];
}

type _TreeNode = { count: number; children: Record<string, _TreeNode> };

export function buildTree(entries: TreeEntry[]): Record<string, unknown>[] {
  const root: Record<string, _TreeNode> = {};

  for (const entry of entries) {
    let current = root;
    for (const segment of entry.path) {
      if (!current[segment]) {
        current[segment] = { count: 0, children: {} };
      }
      current[segment]!.count += entry.count;
      current = current[segment]!.children;
    }
  }

  function toOutput(obj: Record<string, _TreeNode>): Record<string, unknown>[] {
    return Object.entries(obj)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, node]) => {
        const item: Record<string, unknown> = { name, count: node.count };
        const childList = toOutput(node.children);
        if (childList.length > 0) {
          item.children = childList;
        }
        return item;
      });
  }

  return toOutput(root);
}

export async function treePrune(options: {
  prefix: string[];
  olderThanMs: number;
}): Promise<number> {
  const prefixJson = JSON.stringify(options.prefix);
  const cutoff = Date.now() - options.olderThanMs;

  // Match exact path or any child path
  const childPattern = `${prefixJson.slice(0, -1)},"%`;

  const result = await db
    .delete(memories)
    .where(
      and(
        or(eq(memories.tree_path, options.prefix), sql`memories.tree_path LIKE ${childPattern}`),
        sql`${memories.created_at} < ${cutoff}`,
      ),
    )
    .run();

  return result.changes;
}

export async function treeMv(oldSegment: string, newSegment: string): Promise<number> {
  const rows = (await db
    .select({ id: memories.id, tree_path: memories.tree_path })
    .from(memories)
    .where(sql`memories.tree_path LIKE ${`%"${oldSegment}"%`}`)
    .all()) as Array<{ id: string; tree_path: string[] }>;

  let changed = 0;
  for (const row of rows) {
    const newPath = row.tree_path.map((s) => (s === oldSegment ? newSegment : s));
    if (JSON.stringify(newPath) !== JSON.stringify(row.tree_path)) {
      await db.update(memories).set({ tree_path: newPath }).where(eq(memories.id, row.id));
      changed++;
    }
  }

  return changed;
}

export async function addTimelineEvent(input: AddTimelineEventInput) {
  const now = Date.now();
  const [event] = await db
    .insert(memoryTimeline)
    .values({
      id: ulid(),
      scope: input.scope ?? 'project',
      project: input.project ?? getWorkspaceRoot(),
      sessionId: input.sessionId ?? null,
      client: input.client ?? detectClient(),
      actor: input.actor ?? 'agent',
      eventType: input.eventType,
      title: input.title,
      body: input.body ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      tagsJson: JSON.stringify(normalizeTags(input.tags)),
      metadataJson: JSON.stringify(input.metadata ?? {}),
      created_at: now,
    })
    .returning();

  if (!event) {
    throw new Error('Failed to add timeline event');
  }

  return toPublicTimelineEvent(event);
}

export async function recentTimelineEvents(limit = 50, offset = 0) {
  const rows = await db
    .select()
    .from(memoryTimeline)
    .orderBy(desc(memoryTimeline.created_at))
    .limit(Math.min(limit, 200))
    .offset(offset);

  return rows.map(toPublicTimelineEvent);
}

export async function searchTimelineEvents(query: string, limit = 50, offset = 0) {
  const ftsQuery = toFtsQuery(query);
  const timelineFtsScores = db
    .select({
      id: sql<string>`memory_timeline_fts.id`.as('id'),
      score: sql<number>`1.0 / (1.0 + ABS(bm25(memory_timeline_fts, 5.0, 1.0, 2.0)))`.as('score'),
    })
    .from(sql`memory_timeline_fts`)
    .where(ftsQuery ? sql`memory_timeline_fts MATCH ${ftsQuery}` : undefined)
    .as('timeline_fts_scores');
  const rows = await db
    .select({
      id: memoryTimeline.id,
      scope: memoryTimeline.scope,
      project: memoryTimeline.project,
      session_id: memoryTimeline.sessionId,
      client: memoryTimeline.client,
      actor: memoryTimeline.actor,
      event_type: memoryTimeline.eventType,
      title: memoryTimeline.title,
      body: memoryTimeline.body,
      entity_type: memoryTimeline.entityType,
      entity_id: memoryTimeline.entityId,
      tags_json: memoryTimeline.tagsJson,
      metadata_json: memoryTimeline.metadataJson,
      created_at: memoryTimeline.created_at,
      score: timelineFtsScores.score,
    })
    .from(memoryTimeline)
    .innerJoin(timelineFtsScores, sql`timeline_fts_scores.id = ${memoryTimeline.id}`)
    .orderBy(sql`score DESC, ${memoryTimeline.created_at} DESC`)
    .limit(Math.min(limit, 200))
    .offset(offset);

  return rows.map((row) => ({
    id: row.id,
    scope: row.scope,
    project: row.project,
    session_id: row.session_id,
    client: row.client,
    actor: row.actor,
    event_type: row.event_type,
    title: row.title,
    body: row.body,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    tags: parseJsonArray(row.tags_json),
    metadata: parseJsonObject(row.metadata_json),
    created_at: row.created_at,
    score: Number(row.score ?? 0),
  }));
}

export async function summarizeTimeline(limit = 50) {
  const events = await recentTimelineEvents(limit);
  const byType = events.reduce<Record<string, number>>((accumulator, event) => {
    accumulator[event.event_type] = (accumulator[event.event_type] ?? 0) + 1;
    return accumulator;
  }, {});

  return {
    total: events.length,
    by_event_type: byType,
    recent_events: events.slice(0, Math.min(limit, 10)),
  };
}

export async function clearTimeline() {
  const result = await db.delete(memoryTimeline).run();
  return result.changes;
}

export type FeedbackSignal =
  | 'accepted'
  | 'rejected'
  | 'corrected'
  | 'preferred'
  | 'disliked'
  | 'important'
  | 'wrong';

export async function addMemoryFeedback(input: {
  memoryId: string;
  signal: FeedbackSignal;
  note?: string | null | undefined;
  client?: string | undefined;
  timelineId?: string | null | undefined;
}) {
  const now = Date.now();
  await db.insert(memoryFeedback).values({
    id: ulid(),
    memoryId: input.memoryId,
    timelineId: input.timelineId ?? null,
    signal: input.signal,
    note: input.note ?? null,
    client: input.client ?? detectClient(),
    created_at: now,
  });

  if (input.signal === 'important') {
    await db
      .update(memories)
      .set({
        importance: sql<number>`MIN(importance + 0.15, 1.0)`,
        access_count: sql`access_count + 1`,
      })
      .where(eq(memories.id, input.memoryId));
  } else if (input.signal === 'accepted') {
    await db
      .update(memories)
      .set({
        confidence: sql<number>`MIN(confidence + 0.1, 1.0)`,
        importance: sql<number>`MIN(importance + 0.05, 1.0)`,
        access_count: sql`access_count + 1`,
      })
      .where(eq(memories.id, input.memoryId));
  } else if (input.signal === 'preferred') {
    await db
      .update(memories)
      .set({
        importance: sql<number>`MIN(importance + 0.1, 1.0)`,
        access_count: sql`access_count + 1`,
      })
      .where(eq(memories.id, input.memoryId));

    await addTimelineEvent({
      eventType: 'taste_learned',
      title: input.note ?? 'Preference recorded',
      body: `Feedback signal: preferred on memory ${input.memoryId}`,
      tags: ['taste'],
    });
  } else if (input.signal === 'corrected') {
    await db
      .update(memories)
      .set({
        access_count: sql`access_count + 1`,
      })
      .where(eq(memories.id, input.memoryId));

    await addTimelineEvent({
      eventType: 'user_correction',
      title: input.note ?? 'Memory corrected',
      body: `Correction applied to memory ${input.memoryId}`,
      entityType: 'memory',
      entityId: input.memoryId,
    });
  } else if (input.signal === 'rejected') {
    await db
      .update(memories)
      .set({
        confidence: sql<number>`MAX(confidence - 0.15, 0.0)`,
        access_count: sql`access_count + 1`,
      })
      .where(eq(memories.id, input.memoryId));
  } else if (input.signal === 'wrong') {
    await db
      .update(memories)
      .set({
        confidence: sql<number>`MAX(confidence - 0.3, 0.0)`,
        access_count: sql`access_count + 1`,
      })
      .where(eq(memories.id, input.memoryId));
  } else {
    await db
      .update(memories)
      .set({ access_count: sql`access_count + 1` })
      .where(eq(memories.id, input.memoryId));
  }

  // Queue lightweight background improve for positive signals
  if (['accepted', 'important', 'preferred', 'corrected'].includes(input.signal)) {
    // Run a bump-only cycle in background (fire-and-forget)
    autoBumpIfNeeded().catch(() => {});
  }
}

async function autoBumpIfNeeded() {
  try {
    const { autoBump } = await import('../self-improvement/bumper');
    await autoBump();
    await addTimelineEvent({
      eventType: 'agent_action',
      title: 'Feedback-triggered bump',
      body: 'Positive feedback signal triggered auto-bump.',
      tags: ['self-improvement'],
    });
  } catch {
    // self-improvement module not available
  }
}

export async function listMemoryFeedback(input: {
  limit?: number | undefined;
  offset?: number | undefined;
  signal?: string | undefined;
}) {
  const rows = await db
    .select()
    .from(memoryFeedback)
    .orderBy(desc(memoryFeedback.created_at))
    .limit(Math.min(input.limit ?? 50, 200))
    .offset(input.offset ?? 0);

  return rows.map((row) => ({
    id: row.id,
    memory_id: row.memoryId,
    timeline_id: row.timelineId,
    signal: row.signal,
    note: row.note,
    client: row.client,
    created_at: row.created_at,
  }));
}

const defaultSessionId = (process.env.OURBOOK_SESSION_ID as string | undefined) ?? 'default';

export async function workingSet(input: {
  key: string;
  value: string;
  sessionId?: string | undefined;
  expiresInMs?: number | undefined;
}) {
  const now = Date.now();
  const sessionId = input.sessionId ?? defaultSessionId;
  const expiresAt = input.expiresInMs ? now + input.expiresInMs : undefined;

  const existing = await db
    .select()
    .from(workingMemory)
    .where(and(eq(workingMemory.sessionId, sessionId), eq(workingMemory.key, input.key)))
    .get();

  if (existing) {
    const [row] = await db
      .update(workingMemory)
      .set({ value: input.value, expiresAt, updated_at: now })
      .where(eq(workingMemory.id, existing.id))
      .returning();
    return row ? toPublicWorkingMemory(row) : undefined;
  }

  const [row] = await db
    .insert(workingMemory)
    .values({
      id: ulid(),
      sessionId,
      key: input.key,
      value: input.value,
      expiresAt,
      created_at: now,
      updated_at: now,
    })
    .returning();

  return row ? toPublicWorkingMemory(row) : undefined;
}

export async function cleanExpiredWorking(): Promise<number> {
  const result = await db
    .delete(workingMemory)
    .where(and(isNotNull(workingMemory.expiresAt), lt(workingMemory.expiresAt, Date.now())))
    .run();
  return result.changes;
}

export async function workingGet(input: { key: string; sessionId?: string | undefined }) {
  const sessionId = input.sessionId ?? defaultSessionId;

  const row = await db
    .select()
    .from(workingMemory)
    .where(and(eq(workingMemory.sessionId, sessionId), eq(workingMemory.key, input.key)))
    .get();

  if (!row) {
    return null;
  }

  if (row.expiresAt && row.expiresAt < Date.now()) {
    await db.delete(workingMemory).where(eq(workingMemory.id, row.id));
    return null;
  }

  return toPublicWorkingMemory(row);
}

export async function workingList(input: {
  sessionId?: string | undefined;
  limit?: number | undefined;
}) {
  const sessionId = input.sessionId ?? defaultSessionId;
  const limit = Math.min(input.limit ?? 100, 500);

  // Clean expired entries first
  await cleanExpiredWorking();

  const rows = await db
    .select()
    .from(workingMemory)
    .where(eq(workingMemory.sessionId, sessionId))
    .orderBy(desc(workingMemory.updated_at))
    .limit(limit);

  return rows.map(toPublicWorkingMemory);
}

export async function workingClear(input: { sessionId?: string | undefined }) {
  const sessionId = input.sessionId ?? defaultSessionId;
  const result = await db.delete(workingMemory).where(eq(workingMemory.sessionId, sessionId));
  return result.changes;
}

export type SessionReflectionOutput = {
  session_summary: string;
  learned_taste: string[];
  project_decisions: string[];
  next_actions: string[];
  stored_memory_ids: string[];
};

export async function reflectSession(input: {
  sessionId?: string | undefined;
  limit?: number | undefined;
}): Promise<SessionReflectionOutput> {
  const limit = Math.min(input.limit ?? 20, 100);
  const sessionId = input.sessionId ?? defaultSessionId;

  const [timelineEvents, feedbackRows, recentMemories] = await Promise.all([
    (async () => {
      const rows = await db
        .select()
        .from(memoryTimeline)
        .where(sessionId ? eq(memoryTimeline.sessionId, sessionId) : undefined)
        .orderBy(desc(memoryTimeline.created_at))
        .limit(limit);
      return rows.map(toPublicTimelineEvent);
    })(),
    (async () => {
      const rows = await db
        .select()
        .from(memoryFeedback)
        .orderBy(desc(memoryFeedback.created_at))
        .limit(limit * 2);
      return rows;
    })(),
    (async () => {
      const rows = await db
        .select()
        .from(memories)
        .where(isNull(memories.superseded_by))
        .orderBy(desc(memories.updated_at))
        .limit(limit);
      return rows.map(toPublicMemory);
    })(),
  ]);

  const decisions = timelineEvents
    .filter((e) => e.event_type === 'decision_recorded')
    .map((e) => e.title);
  const decisionsFromMemories = recentMemories
    .filter((m) => m.kind === 'decision')
    .map((m) => m.content);
  const projectDecisions = [...decisions, ...decisionsFromMemories].slice(0, 10);

  const tasteEvents = timelineEvents.filter((e) => e.event_type === 'taste_learned');
  const acceptedFeedback = feedbackRows.filter(
    (f) => f.signal === 'accepted' || f.signal === 'corrected' || f.signal === 'preferred',
  );
  const learnedTaste = [
    ...tasteEvents.map((e) => e.title),
    ...acceptedFeedback.map((f) => f.note ?? `Signal: ${f.signal}`),
  ].slice(0, 10);

  const corrections = timelineEvents.filter(
    (e) => e.event_type === 'user_correction' || e.event_type === 'agent_action',
  );
  const nextActions = corrections.map((e) => e.title).slice(0, 5);

  const sessionSummary = [
    `Reviewed ${timelineEvents.length} timeline events`,
    `${feedbackRows.length} feedback records`,
    `${recentMemories.length} recent memories`,
  ].join('. ');

  const storedMemoryIds: string[] = [];

  const handoff = await remember({
    content: sessionSummary,
    tags: ['handoff'],
    agent: 'reflection',
    provider: 'local',
    model: 'ourbook-reflect-session',
    kind: 'handoff',
    confidence: 1,
  });
  storedMemoryIds.push(handoff.id);

  for (const taste of learnedTaste.slice(0, 5)) {
    const memory = await remember({
      content: taste,
      tags: ['taste'],
      agent: 'reflection',
      provider: 'local',
      model: 'ourbook-reflect-session',
      kind: 'taste',
      confidence: 0.8,
    });
    storedMemoryIds.push(memory.id);
  }

  for (const decision of projectDecisions.slice(0, 5)) {
    const memory = await remember({
      content: decision,
      tags: ['decision'],
      agent: 'reflection',
      provider: 'local',
      model: 'ourbook-reflect-session',
      kind: 'decision',
      confidence: 0.8,
    });
    storedMemoryIds.push(memory.id);
  }

  for (const action of nextActions) {
    const memory = await remember({
      content: action,
      tags: ['next-action'],
      agent: 'reflection',
      provider: 'local',
      model: 'ourbook-reflect-session',
      kind: 'note',
      confidence: 0.7,
    });
    storedMemoryIds.push(memory.id);
  }

  return {
    session_summary: sessionSummary,
    learned_taste: learnedTaste,
    project_decisions: projectDecisions,
    next_actions: nextActions,
    stored_memory_ids: storedMemoryIds,
  };
}

type PublicWorkingMemory = {
  id: string;
  session_id: string;
  key: string;
  value: string;
  expires_at?: number | null;
  created_at: number;
  updated_at: number;
};

function toPublicWorkingMemory(row: typeof workingMemory.$inferSelect): PublicWorkingMemory {
  return {
    id: row.id,
    session_id: row.sessionId,
    key: row.key,
    value: row.value,
    expires_at: row.expiresAt,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function replaceTags(memoryId: string, tags: string[]) {
  await db.delete(memoryTags).where(eq(memoryTags.memoryId, memoryId)).run();

  if (tags.length === 0) {
    return;
  }

  await db
    .insert(memoryTags)
    .values(tags.map((tag) => ({ memoryId, tag })))
    .run();
}

export function normalizeTags(tags?: string[]) {
  return Array.from(
    new Set((tags ?? []).map((tag) => tag.trim().toLowerCase()).filter((tag) => tag.length > 0)),
  );
}

export function toPublicTimelineEvent(
  event: typeof memoryTimeline.$inferSelect,
): PublicTimelineEvent {
  let tags: string[] = [];
  let metadata: Record<string, unknown> = {};

  tags = parseJsonArray(event.tagsJson ?? '[]');
  metadata = parseJsonObject(event.metadataJson ?? '{}');

  return {
    id: event.id,
    scope: event.scope,
    project: event.project,
    session_id: event.sessionId,
    client: event.client,
    actor: event.actor,
    event_type: event.eventType,
    title: event.title,
    body: event.body,
    entity_type: event.entityType,
    entity_id: event.entityId,
    tags: Array.isArray(tags) ? tags : [],
    metadata,
    created_at: event.created_at,
  };
}

export function toPublicMemory(memory: Memory): PublicMemory {
  return {
    id: memory.id,
    content: memory.content,
    summary: memory.summary,
    tags: Array.isArray(memory.tags) ? memory.tags : [],
    agent: memory.agent,
    provider: memory.provider,
    model: memory.model,
    project: memory.project,
    client: memory.client,
    workspace_root: memory.workspace_root,
    kind: memory.kind,
    superseded_by: memory.superseded_by,
    superseded_at: memory.superseded_at,
    superseded_reason: memory.superseded_reason,
    created_at: memory.created_at,
    updated_at: memory.updated_at,
    confidence: memory.confidence,
    decay_at: memory.decay_at,
    importance: memory.importance,
    access_count: memory.access_count,
    last_accessed_at: memory.last_accessed_at,
    decay_rate: memory.decay_rate,
    tree_path: Array.isArray(memory.tree_path) ? memory.tree_path : [],
  };
}

function parseJsonArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toFtsQuery(query: string) {
  const terms = query
    .match(/[a-zA-Z0-9_]{2,}/g)
    ?.map((term) => `${term.replace(/[^a-zA-Z0-9_]/g, '')}*`)
    .join(' OR ');

  return terms && terms.length > 0 ? terms : undefined;
}

function toPublicMemoryTrace(trace: typeof memoryTrace.$inferSelect): PublicMemoryTrace {
  let selectedIds: string[] = [];

  try {
    selectedIds = JSON.parse(trace.selectedIdsJson ?? '[]') as string[];
  } catch {
    selectedIds = [];
  }

  return {
    id: trace.id,
    tool_name: trace.toolName,
    query: trace.query,
    client: trace.client,
    project: trace.project,
    result_count: trace.resultCount,
    selected_ids: Array.isArray(selectedIds) ? selectedIds : [],
    created_at: trace.created_at,
  };
}
