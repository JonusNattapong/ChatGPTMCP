# 🚀 ChatGPT Pilot (`chatgpt-pilot`)

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Monorepo](https://img.shields.io/badge/monorepo-pnpm-orange.svg)](pnpm-workspace.yaml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/protocol-Model_Context_Protocol-purple.svg)](https://modelcontextprotocol.io/)

**ChatGPT Pilot** is an all-in-one local MCP workstation, runtime gateway, and capability bridge for ChatGPT and Codex. It consolidates developer infrastructure into four integrated pillars behind a single unified MCP surface:

```
                  ┌─────────────────────────────────────────────────────────┐
                  │                 ChatGPT / Codex Client                  │
                  └────────────────────────────┬────────────────────────────┘
                                               │
                                      Stdio / HTTP Stream
                                               │
                                               ▼
                  ┌─────────────────────────────────────────────────────────┐
                  │        ChatGPT Pilot Gateway (`apps/server`)            │
                  │   - Process Isolation & Supervisor Circuit Breaker      │
                  │   - Dynamic Policy Governance & NDJSON Audit Trail      │
                  │   - Hybrid Surface (toolpy + capability_registry)       │
                  └───────┬──────────────┬──────────────┬─────────────┬─────┘
                          │              │              │             │
              ┌───────────┴───┐   ┌──────┴──────┐ ┌─────┴─────┐ ┌─────┴──────────┐
              │ 💻 Coding/Sys │   │  🧠 Think   │ │ 📚 Skills │ │   💾 Memory    │
              │  apps/server  │   │  ThinkForge │ │ Skill Hub │ │ Living Book    │
              └───────────────┘   └─────────────┘ └───────────┘ └────────────────┘
```

---

## 🌟 The Four Pillars

1. 💻 **Coding & System Execution** (`apps/server`)
   - **Filesystem & Codebase**: High-performance reads, structured diff editing, atomic line replacement, and code search (`search_code`, `edit_file`, `find_files`).
   - **Process & Shell Management**: Supervised background processes, monotonic offset stream reading, and safe command execution (`shell`, `start_process`, `read_process_output`, `process_write`).
   - **Verified Git Tools**: Transactional Git staging and commit gates (`git_status`, `git_diff`, `git_commit_verified`) preventing dirty worktrees or broken tests from being committed.
   - **Persistent Python Runtime (`toolpy`)**: IPython-backed stateful execution environment for programmatic tool composition with low latency and tight token budgets.

2. 🧠 **Cognitive Accelerators** (`packages/thinkforge`)
   - **ThinkForge MCP**: Structured thinking tools enabling agents to diverge on ideas, challenge assumptions, reframe problems, analyze trade-offs, and stress-test architectures (`diverge`, `converge`, `challenge`, `frame`, `reframe`, `perspective_swap`, `stress_test`).

3. 📚 **Dynamic Skills Engine** (`packages/skill-hub` + `skills/`)
   - **Skill Hub Gateway**: Automated discovery and runtime runner for **111+ curated agentic skills** (engineering, design, product management, DevOps, and debugging).
   - Dynamically loads procedures from `skills/` without polluting initial prompt token limits.

4. 💾 **Living Memory Book** (`packages/memory`)
   - **Pure Markdown Second Brain**: Zero-native-dependency, 100% human-readable, and Git-friendly memory engine. Replaces legacy binary SQLite databases with structured Markdown books.
   - **Master Table of Contents (`TOC.md`)**: Automatically indexes chapters, subtopics, and chronological events.
   - **Executive Summaries (`SUMMARY.md`)**: High-level overviews across developer identity, projects, and architecture.
   - **Temporal Timesteps (`timesteps/`)**: Chronological recall by date or month (`latest`, `2026-09-05`, `2026-08`).
   - **Self-Seeding**: Automatically seeds and syncs from backups or bundled snapshots.

---

## 📁 Repository Structure

```text
chatgpt-pilot/
├── .pilot/                      # Unified workspace storage (audit, runtime config, memory)
├── apps/
│   ├── server/                  # Core MCP Server, Tunnel Supervisor & Gateway
│   └── playground/              # Interactive developer testing suite
├── packages/
│   ├── memory/                  # Pure Markdown Living Memory Book Engine
│   │   ├── seed/                # Bundled recovery snapshots (identity, projects, architecture)
│   │   └── src/
│   │       ├── book.ts          # BrainBook manager (TOC, chapters, timesteps, search)
│   │       └── index.ts         # MCP Server entrypoint & standalone CLI
│   ├── thinkforge/              # Cognitive accelerators & problem reframing tools
│   ├── skill-hub/               # Skills catalog discovery and execution gateway
│   ├── mcp-server/              # Minimal standalone MCP server adapter
│   └── core/                    # Shared contracts, types, and schemas
├── skills/                      # 111+ curated agentic workflow procedures
├── scripts/                     # Platform automation & tunnel scripts
└── docs/                        # Architecture and integration guides
```

---

## 🚀 Quick Start

### Requirements
- **Node.js**: `v20+` or `v22+`
- **Package Manager**: `pnpm` (v9 or v10)
- **OS**: Windows, macOS, or Linux

### 1. Installation & Build

```bash
# Clone the repository
git clone https://github.com/JonusNattapong/chatgpt-pilot.git
cd chatgpt-pilot

# Install dependencies and build all packages
pnpm install
pnpm build
```

### 2. Zero-Config Verification

ChatGPT Pilot features **Zero-Config Auto Discovery** — it automatically locates internal packages (`packages/memory`, `packages/thinkforge`, `packages/skill-hub`, `skills/`) without requiring manual path flags:

```bash
# Check raw capabilities across all 4 providers (Legacy Surface)
pnpm check

# Check Hybrid Surface (toolpy + capability_registry)
pnpm check:hybrid
```

### 3. Run the Test Suite

```bash
# Execute full monorepo test suite (138 tests)
pnpm test
```

---

## 🛠️ CLI & Management Tools

ChatGPT Pilot provides unified CLI commands for controlling tunnels, inspecting capabilities, and querying memory:

### Workstation & Tunnel Management (`pnpm pilot`)

```bash
# Start background supervised tunnel to ChatGPT
pnpm pilot up

# Check tunnel and gateway status
pnpm pilot status

# Stop background tunnel
pnpm pilot down

# Run system diagnostic and health checks
pnpm pilot doctor
```

### Living Memory CLI (`pilot-memory`)

The memory engine can be queried directly from the terminal or scripts:

```bash
# View Master Table of Contents (สารบัญ)
node packages/memory/dist/index.js toc

# View executive summaries
node packages/memory/dist/index.js summary

# Read a specific chapter or subtopic
node packages/memory/dist/index.js read 02-projects "Loom Agent"

# Recall events from a specific date or period
node packages/memory/dist/index.js time 2026-09-05
node packages/memory/dist/index.js time latest

# Search across all memory files
node packages/memory/dist/index.js search "Jupyter runtime"

# Display memory store metrics
node packages/memory/dist/index.js stats
```

---

## 🔌 Complete MCP Tools Reference

### 💻 System & Coding Tools (`machine_*`)
| Tool | Description |
|---|---|
| `read_file` | Read complete or sliced file contents with line numbering and SHA-256 preconditions. |
| `write_file` | Write or overwrite file contents with directory auto-creation and collision safeguards. |
| `edit_file` | Perform precise string/block replacements with near-miss diagnostics. |
| `find_files` | Search files by pattern or extension with automated dependency directory exclusion. |
| `search_code` | Ripgrep-powered fast text and regex search with fallback scanning. |
| `shell` | Execute shell commands in workspace or unrestricted mode with bounded UTF-8 output. |
| `start_process` | Spawn background processes with dedicated PID and monotonic offset tracking. |
| `read_process_output` | Stream incremental stdout/stderr output from managed processes. |
| `process_write` | Send input to stdin of a live background process. |
| `process_wait` | Wait for process exit with timeout and exit code capture. |
| `git_status` | Retrieve structured Git working tree status. |
| `git_diff` | Generate unified diffs without shell interpolation. |
| `git_commit_verified` | Run verification gates (build/test) and commit only upon successful check. |
| `toolpy` | Stateful Python execution sandbox with access to internal capability functions. |

### 💾 Living Memory Tools (`memory_*`)
| Tool | Description |
|---|---|
| `memory_toc` | Retrieve the Master Table of Contents listing all chapters, subtopics, and timesteps. |
| `memory_summary` | Read executive summaries of the whole system or a specific chapter. |
| `memory_read_topic` | Read a full chapter or extract a specific heading/subtopic. |
| `memory_recall_time` | Temporal recall of memories indexed by date (`2026-09-05`), month, or `latest`. |
| `memory_search` | Full-text keyword and concept search across all memory files. |
| `memory_remember` | Append a new memory note, milestone, or decision to the timeline and rebuild index. |
| `memory_stats` | Inspect memory metrics (chapters count, timesteps count, words, bytes, storage path). |
| `memory_recall` | Unified recall helper dispatching query, topic, or timestep queries. |

### 🧠 Cognitive & Reasoning Tools (`think_*`)
| Tool | Description |
|---|---|
| `think_diverge` | Generate multiple distinct angles, options, and divergent possibilities. |
| `think_converge` | Synthesize disparate concepts, prioritize options, and extract actionable conclusions. |
| `think_challenge` | Critically question assumptions, identify flaws, and simulate edge cases. |
| `think_reframe` | Reframe a problem statement across different perspectives and constraints. |
| `think_perspective_swap` | Analyze a scenario through different personas or stakeholder views. |
| `think_stress_test` | Subject an architecture or plan to extreme scale, failure modes, and stress. |

### 📚 Skills Engine Tools (`skills_*`)
| Tool | Description |
|---|---|
| `skills_list` | List all available procedures from the 111+ curated agent skills catalog. |
| `skills_get_spec` | Retrieve the detailed workflow specification and instructions for a skill. |
| `skills_run` | Execute a curated skill procedure against the current context. |

---

## 🛡️ Security & Governance

- **Workspace Boundary Enforcement**: Safe mode restricts shell commands and file mutations strictly within the workspace root.
- **Supervisor Circuit Breaker**: Background MCP workers are health-probed and automatically restarted upon crash or hang.
- **Audit Logging**: Every tool invocation and file mutation is immutably recorded in `.pilot/audit.ndjson`.
- **Precondition Verification**: File edits require read hash validation to avoid clobbering concurrent modifications.

---

## 📄 License

MIT © [JonusNattapong](https://github.com/JonusNattapong)
