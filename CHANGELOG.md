# Changelog

- Added opt-in bounded public OSINT tools: `osint_search` and `osint_fetch`. Clearnet requests reject private destinations; explicit `.onion` fetches require a local Tor `socks5h` proxy and are text-only, non-authenticated, non-crawling reads.

All notable changes to ChatGPT Machine MCP are documented here.

## Unreleased

- Bumped the public MCP contract to v6 with 46 tools, adding persistent Python execution via `runtime_exec` (requiring `--dangerously-open-machine`).
- Extended `verify_changes` with Python project detection (`pyproject.toml`, `requirements.txt`, `setup.py`) and diagnostics parsing for Pytest, Flake8, Ruff, and Mypy.
- Added catastrophic destructive command guardrails in `shell_command` (blocking `rm -rf /`, `rmdir /s /q` drive root, disk format, and raw disk writes in workspace-only mode).
- Enhanced secret redaction in audit and output streams with OpenAI project keys, Anthropic keys, GitHub fine-grained PATs, and private key headers.
- Filtered internal `.chatgpt-machine/` audit and log artifacts from `git_status` to prevent worktree status contamination.
- Added the read-only `process_wait` tool, which waits for a managed process to exit up to a bounded timeout and returns its exit code plus stdout/stderr offsets without stopping it on timeout.
- Added coding-DX read tools: `read_files` batches bounded text reads under one combined byte budget, and `project_snapshot` returns a bounded repository Git/tree/package/scripts/instructions snapshot.
- Hardened `machine_status` workspace semantics with explicit live `runtimeRoot`, persisted `configuredRoot`, `configApplied`, and a `restartRequired` value derived from supervisor worker state rather than ambiguous path labels.
- Hardened synchronous PowerShell execution so PowerShell errors fail the shell result instead of returning false success; results now expose `success`, `hadPowerShellError`, and output byte counts. Fixed the Windows tunnel access-mode check so only `unrestricted` adds `--dangerously-open-machine`.
- Extended the allowlisted multi-machine gateway with `machine_read`, which proves `readOnlyHint=true` from the remote tool surface before execution. Remote capabilities are cached for 60 seconds with a fingerprint and explicit refresh; routed audit records promote `targetMachine` and `remoteTool` to top-level fields.
- Added `chatgpt-local machine list|add|remove`, a Git-ignored `.chatgpt-machine/machines.json` registry, per-node HTTP health checks, and remote MCP tool discovery/calls. The `developer` policy approval-gates high-authority `machine_call`, while `machine_read` stays read-only and remote nodes still enforce their own policy and audit boundaries.
- Bumped the public MCP contract to v5 with 45 tools.
- Simplified `chatgpt-local restart` to an explicit stop/start sequence and removed the detached `refresh-tunnel.*` helper, avoiding a PowerShell self-spawn pattern that endpoint security could quarantine.
- Added a bounded tunnel watchdog for Windows and Bash. While a tunnel is intentionally active, two consecutive unhealthy runtime checks reconnect it; `chatgpt-local down` stops the watchdog first. The real-supervisor smoke test now keeps its state in its own temporary directory.
- Hardened the supervised stdio runtime with real `closed`/`open`/`half_open` circuit-breaker states, generation-safe recovery timers, and process-tree termination on Windows and POSIX.
- Persisted the live worker root and circuit diagnostics so `chatgpt-local status` can detect when a changed active workspace requires a runtime restart.
- Made `machine_status` compact by default; process history, tool surface, dependency versions, and full runtime metadata are opt-in through `include` or `detailed`.
- Added `verify_changes` with detected `fast`, `normal`, and `strict` project verification profiles for Node.js, Go, and Rust projects.
- Added `git_commit_verified`, which verifies before staging, refuses a non-empty staging area, stages only explicit paths, rolls staging back on commit failure, and leaves `git_push` as a separate approval/network boundary.
- Bumped the public MCP contract to v2 with 37 tools.
## 1.0.0 — 2026-08-29

- Added a supervised stdio runtime. `dist/supervisor.js` isolates the MCP worker, applies hard request deadlines, restarts a crashed or hung worker, and replays MCP initialization before accepting new work.
- Added persisted supervisor diagnostics in `.chatgpt-machine/supervisor.json`, including worker generation, restart count, worker PID, readiness, and last restart reason.
- Added local operator configuration in `.chatgpt-machine/config.json` for workspace root, access mode, policy, approval mode, and supervisor timeout.
- Expanded `chatgpt-local` with `check`, `config`, and `version`; `doctor` now checks platform dependencies and workspace permissions.
- Hardened custom policy loading: unknown tool names and invalid shell regular expressions fail at startup. Policy fingerprints are exposed for diagnostics.
- Added a versioned 35-tool contract manifest and deterministic contract fingerprint. Tool names, schemas, and annotations form the v1 public contract.
- Split HTTP liveness and readiness semantics and exposed service/contract version metadata.
- Added Windows PowerShell and Bash tunnel-script parser checks plus supervised-runtime smoke and hang-recovery tests.
- Added Thai installation and technical documentation.

## 0.4.0 — 2026-08-29

- Added HTTP bearer protection, path-policy coverage, operator CLI hardening, audit diagnostics, and the 35-tool machine bridge baseline used for the 1.0 stabilization cycle.
