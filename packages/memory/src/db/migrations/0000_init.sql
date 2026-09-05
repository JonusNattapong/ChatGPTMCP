CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  summary TEXT,
  embedding BLOB NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  agent TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  project TEXT,
  client TEXT NOT NULL DEFAULT 'unknown',
  workspace_root TEXT,
  kind TEXT NOT NULL DEFAULT 'note',
  superseded_by TEXT REFERENCES memories(id) ON DELETE SET NULL,
  superseded_at INTEGER,
  superseded_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  decay_at INTEGER,
  importance REAL NOT NULL DEFAULT 0.5,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at INTEGER,
  decay_rate REAL NOT NULL DEFAULT 0.01,
  tree_path TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  summary TEXT NOT NULL,
  agent TEXT NOT NULL,
  project TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_tags (
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (memory_id, tag)
);

CREATE TABLE IF NOT EXISTS memory_trace (
  id TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL,
  query TEXT,
  client TEXT NOT NULL DEFAULT 'unknown',
  project TEXT,
  result_count INTEGER NOT NULL DEFAULT 0,
  selected_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_timeline (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'project',
  project TEXT,
  session_id TEXT,
  client TEXT NOT NULL DEFAULT 'unknown',
  actor TEXT NOT NULL DEFAULT 'agent',
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  entity_type TEXT,
  entity_id TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_feedback (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  timeline_id TEXT,
  signal TEXT NOT NULL,
  note TEXT,
  client TEXT NOT NULL DEFAULT 'unknown',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS working_memory (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS memories_agent_project_created_at_idx
  ON memories (client, agent, project, created_at DESC);

CREATE INDEX IF NOT EXISTS memories_client_idx
  ON memories (client);

CREATE INDEX IF NOT EXISTS memories_kind_idx
  ON memories (kind);

CREATE INDEX IF NOT EXISTS memories_superseded_by_idx
  ON memories (superseded_by);

CREATE INDEX IF NOT EXISTS memories_decay_at_idx
  ON memories (decay_at);

CREATE INDEX IF NOT EXISTS memory_tags_memory_id_idx
  ON memory_tags (memory_id);

CREATE INDEX IF NOT EXISTS memory_tags_tag_idx
  ON memory_tags (tag);

CREATE INDEX IF NOT EXISTS memory_trace_created_at_idx
  ON memory_trace (created_at DESC);

CREATE INDEX IF NOT EXISTS memory_timeline_created_at_idx
  ON memory_timeline (created_at DESC);

CREATE INDEX IF NOT EXISTS memory_timeline_event_type_idx
  ON memory_timeline (event_type);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_timeline_fts USING fts5(
  id UNINDEXED,
  title,
  body,
  tags,
  tokenize = 'porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS memory_timeline_fts_ai AFTER INSERT ON memory_timeline BEGIN
  INSERT INTO memory_timeline_fts(rowid, id, title, body, tags)
  VALUES (new.rowid, new.id, new.title, COALESCE(new.body, ''), COALESCE(new.tags_json, '[]'));
END;

CREATE TRIGGER IF NOT EXISTS memory_timeline_fts_ad AFTER DELETE ON memory_timeline BEGIN
  INSERT INTO memory_timeline_fts(memory_timeline_fts, rowid, id, title, body, tags)
  VALUES ('delete', old.rowid, old.id, old.title, COALESCE(old.body, ''), COALESCE(old.tags_json, '[]'));
END;

CREATE TRIGGER IF NOT EXISTS memory_timeline_fts_au AFTER UPDATE ON memory_timeline BEGIN
  INSERT INTO memory_timeline_fts(memory_timeline_fts, rowid, id, title, body, tags)
  VALUES ('delete', old.rowid, old.id, old.title, COALESCE(old.body, ''), COALESCE(old.tags_json, '[]'));
  INSERT INTO memory_timeline_fts(rowid, id, title, body, tags)
  VALUES (new.rowid, new.id, new.title, COALESCE(new.body, ''), COALESCE(new.tags_json, '[]'));
END;

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  id UNINDEXED,
  content,
  summary,
  tokenize = 'porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS memories_fts_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, id, content, summary)
  VALUES (new.rowid, new.id, new.content, COALESCE(new.summary, ''));
END;

CREATE TRIGGER IF NOT EXISTS memories_fts_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, id, content, summary)
  VALUES ('delete', old.rowid, old.id, old.content, COALESCE(old.summary, ''));
END;

CREATE TRIGGER IF NOT EXISTS memories_fts_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, id, content, summary)
  VALUES ('delete', old.rowid, old.id, old.content, COALESCE(old.summary, ''));
  INSERT INTO memories_fts(rowid, id, content, summary)
  VALUES (new.rowid, new.id, new.content, COALESCE(new.summary, ''));
END;
