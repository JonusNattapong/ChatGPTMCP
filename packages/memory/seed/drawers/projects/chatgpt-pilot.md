# Project Context: ChatGPT Pilot

*Tags: chatgpt-pilot, monorepo, architecture*

## Core Invariants
- **Four Pillars**: System & Machine (apps/server), ThinkForge (packages/thinkforge), Skill Hub (packages/skill-hub), Memory Book (packages/memory).
- **Memory Invariant**: Pure Markdown, zero native C++ / SQLite dependencies.
- **Verification Gate**: 100% passing tests before commit.
- **Zero-Config Discovery**: Internal workspace packages auto-detected relative to repo root.
