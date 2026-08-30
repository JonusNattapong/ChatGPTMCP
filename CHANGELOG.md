# Changelog

All notable changes to ChatGPT Machine MCP are documented here.

## Unreleased

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
