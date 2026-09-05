# Changelog

All notable changes to `chatgpt-pilot` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-09-06

### Added
- **Pure Markdown Living Memory Book Engine (`packages/memory`)**:
  - Replaced legacy SQLite and native binary dependencies with a zero-native-dependency Markdown memory system.
  - Master Table of Contents (`TOC.md`) with automatic chapter, subtopic, and timestep indexing.
  - Executive Summaries (`SUMMARY.md`) for quick architectural and contextual overviews.
  - Structured chapters (`01-identity.md`, `02-projects.md`, `03-architecture.md`, `04-timeline.md`).
  - Daily and monthly chronological timesteps (`timesteps/YYYY-MM-DD.md`).
  - Bundled seed directory (`packages/memory/seed/`) for offline/zero-config initialization.
  - MCP Tools: `memory_toc`, `memory_summary`, `memory_read_topic`, `memory_recall_time`, `memory_search`, `memory_remember`, `memory_stats`, and `memory_recall`.
- **All-in-One Monorepo Unification**:
  - Consolidated `ChatGPTMCP`, `ThinkForge-MCP`, `chatgpt-skill-hub`, `ourbook`, and `chatgpt-skills` into `chatgpt-pilot`.
  - Added 111+ curated agent skills in `skills/`.
  - Multi-tier provider federation across `machine`, `think`, `skills`, and `memory`.
- **Unified Storage Architecture**:
  - Standardized runtime state under workspace `.pilot/` and user-global `~/.pilot/`.
  - Migrated legacy `.chatgpt-machine` and `.tunnel` state with automatic backward-compatible fallbacks.
- **Documentation Suite**:
  - Comprehensive English and Thai `README.md` and `README.th.md`.
  - Detailed system architecture specification in `docs/architecture.md`.
  - Subsystem documentation in `packages/memory`, `packages/thinkforge`, `packages/skill-hub`, and `apps/server`.
  - `AGENTS.md` guidelines for autonomous AI agents.

### Changed
- Refactored `apps/server` to expose all memory tools under the hybrid capability surface without restriction.
- Updated `worktreeFingerprint` to exclude `.pilot/` to guarantee deterministic verified commits.
- Converted all shell script line-endings to LF to eliminate Windows bash syntax errors.

### Fixed
- Resolved C++ native compilation errors on Windows caused by `better-sqlite3` and `sqlite-vec`.
- Fixed duplicate tool mapping in remote MCP adapter.
- Fixed 100% of monorepo unit and integration tests (138/138 passing).
