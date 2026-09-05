# Technical Notes, Preferences & Operating Patterns

## Working style

- Thai-first technical communication.
- Concise, direct, action-first answers; senior-engineer-to-senior-engineer tone.
- Prefer system/architecture before implementation.
- Search/read real code before claiming facts.
- Prefer small diffs and isolated changes.
- Parallelize independent work when useful.
- Delete fake/unready scaffolding rather than presenting it as complete.
- Explicitly distinguish verified facts from inference/uncertainty.
- Reliability, security, DX, scale, observability, recoverability, and verification are recurring priorities.
- Prefer user-visible behavior/registry/provider consistency before deep tech-debt refactors when prioritizing Clew-like products.

## Architecture DNA

- Local-first, inspectable, controllable systems.
- Durable agents with SQLite/event logs/checkpoints/resume.
- Multi-agent orchestration, A2A, message buses, handoff/delegation.
- Layered/persistent memory and context continuity.
- Leases, heartbeats, stale-worker recovery, idempotency.
- Explicit permission/policy/approval boundaries.
- Remote workers only when bounded and useful; avoid overbuilding distributed infrastructure prematurely.
- Provider abstraction/routing with usage/cost visibility.
- CLI + IDE/control-plane surfaces; browser agents; bot integrations.
- Evidence-backed verification and artifact/audit trails.

## Persistent loop safeguards

- Durable supervisor owns scheduler/control state.
- SQLite WAL/control state.
- Isolated agent context per iteration.
- Optional worktrees; one writer per checkout.
- HEAD preconditions before write.
- Backoff/jitter, budgets, no-progress breaker, overlap coalescing.
- Semantic finding fingerprints/dedupe.
- Idempotency keys.
- Independent deterministic verification.
- Explicit goal termination.
- Audit bundle should include commands, exit codes, diff/patch hash, tests/lints/typechecks, verification, resulting commit.

## Memory systems

### MemoryAdapter ordering caveat
`recall()` orders by `ts` only. `MemoryAdapter` uses `monotonicTimestamp()` for every write so writes created in the same millisecond still have deterministic ordering. Removing this guard can reintroduce intermittent CI ordering failures.

### Preferred memory-quality direction
- provenance: stated / observed / inferred
- source ownership: user / assistant / tool / web / connector / system
- no-save by default for easily re-queryable external/tool data
- read-before-ask
- supersedes/supersededBy links
- consolidation gate
- confidence/importance/recency/access-aware ranking

## ChatGPTMCP runtime practice

- Stable persistent `session_id` per task/project.
- Keep ephemeral compute state in kernel; persist durable state to file/DB/Git.
- Reset kernel on completion/corruption/dependency change/clean-room verification.
- Persistent IPython is privileged runtime, not a security sandbox.
- Capability allowlists, workspace restrictions, limits/timeouts, and explicit mutating-tool declarations are required safety boundaries.

## Clew tooling conventions

- Bun runtime/package workflow.
- Vitest tests.
- strict TypeScript / `bun x tsc --noEmit`.
- Biome lint/format.
- generated docs, codegraph, relay.
- command registration under command modules; provider registration under AI services.
- MCP supports stdio/SSE/in-process patterns; LAN/process mesh explored separately.

## CI/CD / infrastructure context

- Jenkins UAT frontend/backend jobs can build concurrently; backend-first deploy is safer when frontend consumes new backend APIs.
- Docker/Jenkins/Kubernetes/Terraform/observability are recurring infrastructure topics.
- One remembered Energy Ministry deployment guide used Ubuntu 22.04 app servers, Docker Compose, UAT/production image-tag conventions; source secrets are intentionally excluded.
- Tunnel management uses `chatgpt-tunnel-manager`/`tunnelctl`; broad restarts can affect multiple services, so scoped restart is preferred when appropriate.

## Local model / provider experimentation

- Recurring interest in Ollama/local models, model routers, OpenRouter/direct providers, and big-model fallback.
- Clew scope decision: small local 1.5B/3B model for simple tasks + Codex/Claude/GPT fallback + verifier + success/failure recording; no auto-training initially.
- Older local-node stack exploration: Ollama + Open WebUI, later AnythingLLM/LiteLLM; Hermes as server-side personal-agent runtime.

## Trading context

Historical XAUUSD strategy snapshot only:
- Momentum Burst Scalper + Recovery Layer + Equity Compounding.
- M5 EMA20/EMA50 trend filter.
- M1 pullback + breakout.
- burst same-direction entries.
- equity-based compounding.
- basket TP.
- no fixed SL; not grid.
- explicitly high-risk experimentation.

## Visual/product preferences

- High-contrast monochrome, heavy dithering/halftone/photocopy aesthetic explored.
- AI video generation/editing and YouTube automation ideas.
- Stickman Explainer and Time-Lapse Plant Growth short-form styles.

## Backup exclusions

This backup intentionally does not contain:
- passwords, API keys, tokens, session secrets, account IDs
- authentication/recovery state
- sensitive connected-account data
- hidden chain-of-thought/model reasoning
- raw OpenAI internal databases/inaccessible model state
- unrelated sensitive personal information

## Interaction policy — recovered detail

- Act as engineering collaborator/operator, not tutorial/brainstormer by default.
- Inspect/search before claims.
- Current code/docs/repo state overrides remembered context.
- Prefer simplest correct solution and minimal diff.
- Avoid scope expansion and hypothetical scaling unless needed.
- Infer low-risk reversible ambiguity; ask only for material/high-impact choices.
- Preferred code workflow: inspect -> root cause -> minimal fix -> verify.
- Never claim complete/working without evidence.
- Produce requested artifacts directly.
- Prefer researched concrete answers and official sources when current external facts matter.
- Lead with action; avoid filler, beginner tutorials, and excessive option lists.

## Technical stack details

- Center of gravity: TypeScript/Node.js with Bun, ESM/NodeNext, Zod, Vitest.
- Also recurring: Rust, Lua/Roblox, MQL5.
- Clew baseline remembered: Bun 1.3+, Node.js 18+.
- Extension conventions:
  - providers under `src/services/ai/`
  - commands under `src/commands/<name>/`
  - tools under `src/tools/<ToolName>/`
  - new extensions should include registration, schema/metadata, tests, and docs updates.
- Persistent-loop rollout preference: first production slice should be read-only discovery before unattended write capability.
