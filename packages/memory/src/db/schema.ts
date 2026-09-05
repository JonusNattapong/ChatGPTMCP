import { blob, index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const memories = sqliteTable('memories', {
  id: text('id').primaryKey(),
  content: text('content').notNull(),
  summary: text('summary'),
  embedding: blob('embedding', { mode: 'buffer' }).notNull(),
  tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default([]),
  agent: text('agent').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  project: text('project'),
  client: text('client').notNull().default('unknown'),
  workspace_root: text('workspace_root'),
  kind: text('kind').notNull().default('note'),
  superseded_by: text('superseded_by'),
  superseded_at: integer('superseded_at', { mode: 'number' }),
  superseded_reason: text('superseded_reason'),
  created_at: integer('created_at', { mode: 'number' }).notNull(),
  updated_at: integer('updated_at', { mode: 'number' }).notNull(),
  confidence: real('confidence').notNull().default(1.0),
  decay_at: integer('decay_at', { mode: 'number' }),
  importance: real('importance').notNull().default(0.5),
  access_count: integer('access_count').notNull().default(0),
  last_accessed_at: integer('last_accessed_at', { mode: 'number' }),
  decay_rate: real('decay_rate').notNull().default(0.01),
  tree_path: text('tree_path', { mode: 'json' }).$type<string[]>().notNull().default([]),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  summary: text('summary').notNull(),
  agent: text('agent').notNull(),
  project: text('project'),
  created_at: integer('created_at', { mode: 'number' }).notNull(),
});

export const memoryTags = sqliteTable(
  'memory_tags',
  {
    memoryId: text('memory_id')
      .notNull()
      .references(() => memories.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.memoryId, table.tag], name: 'memory_tags_pk' }),
    memoryIdIdx: index('memory_tags_memory_id_idx').on(table.memoryId),
    tagIdx: index('memory_tags_tag_idx').on(table.tag),
  }),
);

export const memoryTrace = sqliteTable(
  'memory_trace',
  {
    id: text('id').primaryKey(),
    toolName: text('tool_name').notNull(),
    query: text('query'),
    client: text('client').notNull().default('unknown'),
    project: text('project'),
    resultCount: integer('result_count').notNull().default(0),
    selectedIdsJson: text('selected_ids_json').notNull().default('[]'),
    created_at: integer('created_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    createdAtIdx: index('memory_trace_created_at_idx').on(table.created_at),
  }),
);

export const memoryTimeline = sqliteTable('memory_timeline', {
  id: text('id').primaryKey(),
  scope: text('scope').notNull().default('project'),
  project: text('project'),
  sessionId: text('session_id'),
  client: text('client').notNull().default('unknown'),
  actor: text('actor').notNull().default('agent'),
  eventType: text('event_type').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  tagsJson: text('tags_json').notNull().default('[]'),
  metadataJson: text('metadata_json').notNull().default('{}'),
  created_at: integer('created_at', { mode: 'number' }).notNull(),
});

export const memoryFeedback = sqliteTable(
  'memory_feedback',
  {
    id: text('id').primaryKey(),
    memoryId: text('memory_id')
      .notNull()
      .references(() => memories.id, { onDelete: 'cascade' }),
    timelineId: text('timeline_id'),
    signal: text('signal').notNull(),
    note: text('note'),
    client: text('client').notNull().default('unknown'),
    created_at: integer('created_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    memoryIdIdx: index('memory_feedback_memory_id_idx').on(table.memoryId),
    signalIdx: index('memory_feedback_signal_idx').on(table.signal),
  }),
);

export const workingMemory = sqliteTable(
  'working_memory',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'number' }),
    created_at: integer('created_at', { mode: 'number' }).notNull(),
    updated_at: integer('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    sessionKeyIdx: index('working_memory_session_key_idx').on(table.sessionId, table.key),
    expiresAtIdx: index('working_memory_expires_at_idx').on(table.expiresAt),
  }),
);

export type Memory = typeof memories.$inferSelect;
export type NewMemory = typeof memories.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type MemoryTag = typeof memoryTags.$inferSelect;
export type NewMemoryTag = typeof memoryTags.$inferInsert;
export type MemoryTrace = typeof memoryTrace.$inferSelect;
export type NewMemoryTrace = typeof memoryTrace.$inferInsert;
export type MemoryTimeline = typeof memoryTimeline.$inferSelect;
export type NewMemoryTimeline = typeof memoryTimeline.$inferInsert;
export type MemoryFeedback = typeof memoryFeedback.$inferSelect;
export type NewMemoryFeedback = typeof memoryFeedback.$inferInsert;
export type WorkingMemory = typeof workingMemory.$inferSelect;
export type NewWorkingMemory = typeof workingMemory.$inferInsert;
