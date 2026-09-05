# AGENTS.md — Agent Operating Guidelines for `chatgpt-pilot`

This document provides instructions and architectural principles for AI agents (Antigravity, Codex, Loom, ChatGPT) working within the `chatgpt-pilot` monorepo.

---

## 1. System Topology & Monorepo Map

```text
chatgpt-pilot/
├── apps/
│   ├── server/           # MCP Gateway runtime, Process Manager, Git, IPython (toolpy)
│   └── playground/       # Testbed
├── packages/
│   ├── memory/           # Pure Markdown Living Memory Book (@chatgpt-pilot/memory)
│   ├── thinkforge/       # Cognitive scaffolds (@chatgpt-pilot/thinkforge)
│   ├── skill-hub/        # Curated skills registry (@chatgpt-pilot/skill-hub)
│   ├── mcp-server/       # Minimal MCP adapter (@chatgpt-pilot/mcp-server)
│   └── core/             # Shared contracts & types (@chatgpt-pilot/core)
├── skills/               # 111+ curated agent skills in markdown format
├── scripts/              # Platform tunnel and management scripts
└── .pilot/               # Runtime local directory (audit.ndjson, config.json, memory/)
```

---

## 2. Capability Architecture & The Four Pillars

When interacting with this codebase, remember the 4 capability providers federated by `apps/server`:

1. **System & Machine**: Low-level filesystem, process orchestration, and git operations.
2. **ThinkForge**: Structured cognitive accelerators (`think_diverge`, `think_challenge`, `think_reframe`, etc.).
3. **Skill Hub**: Dynamic execution of 111+ procedures in `skills/`.
4. **Living Memory Book**: Pure Markdown second brain.

---

## 3. How to Query and Update Memory

The memory system is file-based Markdown under `.pilot/memory/` (with fallback seed under `packages/memory/seed/`).

- **To discover topics**: Query `memory_toc` or read `TOC.md`.
- **To view high-level summaries**: Query `memory_summary` or read `SUMMARY.md`.
- **To read a specific chapter or section**: Query `memory_read_topic` with `{ topic: "02-projects", subtopic: "..." }`.
- **To recall historical context**: Query `memory_recall_time` with `{ timestep: "YYYY-MM-DD" }` or `{ timestep: "latest" }`.
- **To persist new milestones/learnings**: Call `memory_remember` with `{ title: "...", content: "...", tags: [...] }`.

---

## 4. Engineering Invariants & Coding Standards

1. **Pure TypeScript / No Native C++ Dependencies in Memory**:
   - `packages/memory` must never use SQLite (`better-sqlite3`), `sqlite-vec`, or native addons.
   - Memory must remain pure Markdown files manipulated through Node.js standard modules (`fs`, `path`).

2. **Zero-Config Discovery**:
   - Internal workspace packages must be auto-detected relative to the workspace root. Never introduce mandatory path CLI flags for built-in packages.

3. **Pre-commit Verification Gate**:
   - All commits should pass through `git_commit_verified` or `pnpm test`.
   - Ensure the monorepo test suite (138 tests) passes with 100% success before pushing changes.

4. **Line Endings**:
   - Shell scripts (`.sh`) must use LF line endings (`\n`) to prevent syntax failures on bash environments.

5. **Storage Isolation**:
   - Local runtime artifacts belong in `.pilot/` (workspace) or `~/.pilot/` (global user).
   - `.pilot/` is excluded from git tracking, while `packages/memory/seed/` holds repository-level backup templates.
