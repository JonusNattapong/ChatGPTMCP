# @chatgpt-pilot/memory — Living Memory Book Engine

A pure Markdown, zero-native-dependency Living Memory Book engine designed for LLM agents, ChatGPT, and Codex.

Instead of storing memories inside opaque SQLite databases or binary vectors, `@chatgpt-pilot/memory` organizes memory as a **Living Book**: human-readable, structured, Git-friendly, and chronologically indexed.

---

## Architecture & Layout

Memories are stored in `.pilot/memory/` (or `~/.pilot/memory/`) organized as follows:

```text
.pilot/memory/
├── TOC.md                   # Master Table of Contents (Chapters, Subtopics, Timesteps)
├── SUMMARY.md               # Executive Summary across all topics
├── chapters/
│   ├── 01-identity.md       # Developer profile, work style, preferences
│   ├── 02-projects.md       # Project architectures, commits, version milestones
│   ├── 03-architecture.md   # Architectural DNA, technical patterns, conventions
│   └── 04-timeline.md       # High-level chronological milestones
└── timesteps/
    ├── 2026-09-05.md        # Daily timeline logs
    ├── 2026-09-04.md
    └── September-2026.md    # Monthly summaries
```

---

## MCP Tools

| Tool Name | Description | Arguments |
|---|---|---|
| `memory_toc` | Retrieve the Master Table of Contents (TOC) | `filter?: string` |
| `memory_summary` | Read executive summary of whole memory or a topic | `topic?: string` |
| `memory_read_topic` | Read full chapter or extract a specific subtopic | `topic: string, subtopic?: string` |
| `memory_recall_time` | Temporal recall of memories by date or "latest" | `timestep: string` |
| `memory_search` | Full-text search across chapters and timesteps | `query: string, limit?: number` |
| `memory_remember` | Append a new memory note to timeline and TOC | `title: string, content: string, chapter?: string, tags?: string[]` |
| `memory_stats` | Inspect memory size, words, chapters, and storage path | `{}` |
| `memory_recall` | Unified recall helper dispatching query/topic/timestep | `query: string, topic?: string, timestep?: string` |

---

## Command Line Interface (CLI)

You can inspect the memory book directly from terminal:

```bash
# View Table of Contents
node dist/index.js toc

# View Summary
node dist/index.js summary

# Read specific subtopic
node dist/index.js read 02-projects "Loom Agent"

# Recall date
node dist/index.js time 2026-09-05

# Search
node dist/index.js search "persistent loop"

# Statistics
node dist/index.js stats
```

---

## Automatic Seeding

If running in a fresh workspace or environment without existing memories, the engine automatically initializes itself from:
1. `D:\Projects\Github\chatgpt-memory-backup` (if present)
2. `packages/memory/seed/` (bundled default snapshot)
