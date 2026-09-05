# ChatGPT Pilot (`chatgpt-pilot`)

All-in-one local MCP workstation & bridge for ChatGPT and Codex, consolidating runtime capabilities into four key pillars:

- 💻 **Coding & System** (`apps/server`) — Filesystem, processes, Git, verification, policy governance, and persistent Python runtime (`toolpy`).
- 🧠 **Think** (`packages/thinkforge`) — Reasoning accelerators, problem-reframing, and divergence tools.
- 📚 **Skills** (`packages/skill-hub` + `skills/`) — Dynamic registry and runner with 110+ curated agent skills.
- 💾 **Memory** (`packages/memory`) — Persistent Second Brain with SQLite/vector cross-session recall and provenance.

---

## Workspace Layout

```text
chatgpt-pilot/
├── apps/
│   ├── server/          # Core runtime (HTTP Streamable/Stdio, Tunnel Supervisor, CLI)
│   └── playground/      # Local integration testbed
├── packages/
│   ├── thinkforge/      # Reasoning & problem reframing MCP
│   ├── skill-hub/       # Reusable skills discovery & execution gateway
│   ├── memory/          # Persistent Second Brain & recall
│   ├── mcp-server/      # Minimal MCP transport entrypoint
│   └── core/            # Shared contracts & descriptors
└── skills/              # 110+ curated agentic workflow procedures
```

---

## Quick Start

### 1. Install & Build
```bash
pnpm install
pnpm build
```

### 2. Verify Capabilities (Zero-Config Auto Discovery)
```bash
# Check all 4 capability groups (Legacy mode)
pnpm check

# Check Hybrid surface (toolpy + capability_registry)
pnpm check:hybrid
```

### 3. Manage Tunnel & Workstation CLI
```bash
# Check status of local tunnel
pnpm pilot status

# Start tunnel
pnpm pilot up

# Stop tunnel
pnpm pilot down

# Check configuration & doctor
pnpm pilot doctor
pnpm pilot check
```

---

## Design Highlights

- **Zero-Config Auto Discovery**: The server automatically discovers and connects internal workspace modules (`thinkforge`, `skill-hub`, `memory`, `skills`) without requiring manual `--*-dir` path flags.
- **Hybrid Execution Model**: Advertises a compact `toolpy` surface to ChatGPT while keeping low-level primitives programmatically composable behind controlled Python execution.
- **Full Safety & Governance**: Safe-mode workspace boundary, NDJSON audit logging, approval state validation, and idempotency receipts.
