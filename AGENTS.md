# AGENTS.md

Repository instructions for coding agents working in `ChatGPTMCP`.

## Project intent

`chatgpt-machine-mcp` is a small local MCP server that intentionally exposes high-authority machine operations.

Keep the implementation narrow. The public contract is thirty-five tools:

1. `machine_status`
2. `read_file`
3. `list_directory`
4. `find_files`
5. `file_info`
6. `image_info`
7. `save_image_from_url`
8. `search_code`
9. `write_file`
10. `edit_file`
11. `update_file`
12. `shell_command`
13. `start_process`
14. `process_status`
15. `read_process_output`
16. `stop_process`
17. `process_write`
18. `git_status`
19. `git_diff`
20. `git_log`
21. `git_show`
22. `git_branch`
23. `git_add`
24. `git_commit`
25. `git_checkout`
26. `git_push`
27. `system_info`
28. `list_processes`
29. `list_ports`
30. `environment_info`
31. `disk_info`
32. `network_info`
33. `audit_recent`
34. `audit_search`
35. `apply_patch`

Do not introduce orchestration, planning, memory, agent delegation, or a generic task framework into this repository unless a concrete requirement demands it. This project is infrastructure plumbing, not an agent harness.

## Source of truth

Treat these files as authoritative, in this order:

1. `src/tools.ts` — the tool registry: schema, description, argument validation, and handler for every tool.
2. `src/index.ts` — CLI, transports, HTTP authentication, and the shared result envelope.
3. `src/errors.ts` — `ToolError` and the stable `error.code` vocabulary.
4. `src/file-tools.ts` — bounded file operations, directory walk, and structured code search.
5. `src/shell-tools.ts` — path policy, shell execution, patch semantics.
6. `scripts/*.ps1` and `scripts/*.sh` — local Secure MCP Tunnel lifecycle on Windows, macOS, Ubuntu, and WSL.
7. tests — executable contract.
8. `README.md` and `docs/*.svg` — human-facing description of the above.

Tool definitions and handlers must stay together in `src/tools.ts`. `machine_status` derives its tool list from that registry; do not reintroduce a hand-maintained copy.

If documentation and code disagree, fix the documentation or implementation deliberately; do not preserve stale claims.

## Required workflow

Before editing:

```powershell
git status --short --branch
npm test
```

After editing source:

```powershell
npm test
```

If MCP schemas, tool names, annotations, CLI options, HTTP behavior, or tunnel startup behavior changed, update `README.md` in the same change.

If the module layout, the transports, the gate order of a tool call, or the error-code set changed, update `docs/architecture.svg` and `docs/request-flow.svg` too. They are hand-authored SVG with no build step and no external assets; edit the markup directly and keep them self-contained.

Do not restart the tunnel merely for documentation-only changes.

## Invariants

### Tool surface

The public MCP surface is deliberately small.

- `machine_status` must remain read-only.
- `read_file`, `list_directory`, `find_files`, `file_info`, `image_info`, and `search_code` are read-only.
- `save_image_from_url` is destructive/open-world because it performs network I/O and writes a file.
- `start_process`, `process_write`, and `stop_process` are destructive; `process_status` and `read_process_output` are read-only.
- `git_status`, `git_diff`, `git_log`, `git_show`, and `git_branch` are read-only; Git mutations must remain policy-aware and approval-gated where configured.
- `system_info`, `list_processes`, `list_ports`, `environment_info`, `disk_info`, `network_info`, `audit_recent`, and `audit_search` are read-only.
- `write_file`, `edit_file`, and `update_file` are destructive but not open-world by annotation.
- `shell_command` is destructive/open-world.
- `shell_command.on_timeout="background"` must preserve the process in the managed registry and return offsets usable by `read_process_output`.
- `idempotency_key` is transport metadata accepted by every tool; identical retries return the cached response and conflicting reuse fails closed.
- `apply_patch` is destructive but not open-world by annotation.
- changing tool names or argument schemas is a breaking integration change.

Do not add a tool that simply wraps a shell command unless it creates a meaningful security, reliability, or schema boundary.

### Workspace-only mode

Without `--dangerously-open-machine`:

- all requested paths must remain within `--root`;
- real-path resolution must not permit symlink/junction escapes;
- relative paths resolve from the configured root;
- path-policy changes require tests.

Do not weaken this mode for convenience.

### File operations and code search

- text file operations must reuse `resolveMachinePath` and enforce the workspace boundary;
- `read_file` output must remain bounded and reject binary inputs;
- `list_directory` and `find_files` must keep entry, depth, and recursion limits, and must not follow symlinks;
- `file_info` must report hashes only for regular files;
- `image_info` and `save_image_from_url` must validate PNG/JPEG/WebP signatures;
- image downloads must require HTTPS, reject local/private DNS results, limit redirects, and never accept caller-provided cookies or authorization headers;
- image downloads must not overwrite an existing file unless explicitly requested;
- background processes must return an explicit PID;
- process output must be bounded in memory and process tracking is session-local;
- workspace-only mode may inspect or stop only processes created by `start_process` in the current MCP session;
- `git_status` and `git_diff` are read-only and must invoke Git directly, without shell interpolation;
- `write_file` must not overwrite an existing file without explicit `overwrite=true`;
- `edit_file` must reject ambiguous exact matches unless `replace_all` or `expected_replacements` is given;
- `update_file` uses inclusive 1-based line ranges;
- `search_code` invokes `rg` directly without shell interpolation and must keep result and timeout limits;
- the built-in search fallback exists only for hosts without `rg`; it must stay bounded (binary and large files skipped) and must report `engine: "builtin"`;
- `read_file`, `write_file`, `edit_file`, and `update_file` return the file `sha256`, and `expected_sha256` must fail closed with `PRECONDITION_FAILED`;
- `stop_process` must wait for the process to exit before returning;
- path-policy and mutation semantics require focused tests.

### Result envelope and errors

- every tool result is `{ "ok": true, ... }` or `{ "ok": false, "tool", "error": { code, message, hint?, details? } }`, and a failure also sets MCP `isError`;
- redact common credential formats before any result crosses the MCP transport, and always deny `.env`, `.ssh`, and private-key paths;
- `error.code` values in `src/errors.ts` are a public contract; add codes rather than repurposing existing ones;
- failures that a caller can act on should carry `hint` and the `details` needed to retry;
- argument validation belongs in `src/tools.ts` and must reject a missing or mistyped argument instead of coercing it.

### Unrestricted mode

`--dangerously-open-machine` is intentionally an administrative mode. Do not disguise or rename away the danger semantics.

Any new operation available in this mode should be assumed capable of modifying the host machine.

### Shell execution

Preserve these guards unless there is a measured reason to change them:

- default timeout: 30 seconds;
- configurable maximum timeout: 10 minutes by default;
- combined output cap: 4 MiB;
- explicit shell allow-list: `auto`, `powershell`, `cmd`, `bash`;
- `cmd` only on Windows.

Changes to process termination, timeout handling, encoding, or output limits should include focused tests.

### Patch engine

`apply_patch` uses Codex patch syntax, not unified diff syntax.

Maintain these properties:

- patch begins with `*** Begin Patch` and ends with `*** End Patch`;
- add/update/delete operations are explicit;
- moves cannot overwrite an existing destination;
- one patch cannot claim the same path twice;
- workspace policy applies to source and destination paths;
- writes are UTF-8.

If patch semantics become materially more complex, prefer extracting a dedicated module over growing `shell-tools.ts` indefinitely.

## HTTP transport

Streamable HTTP is optional. Stdio remains the simplest/default transport.

Current endpoints:

- `/mcp`
- `/healthz`
- `/readyz`

Binding outside `127.0.0.1`, `localhost`, or `::1` requires a bearer token. Do not remove that startup check.

Token comparison should remain constant-time for equal-length values.

Do not log bearer tokens.

## Tunnel integration

Current local integration:

```text
runtime alias:   chatgpt-machine
runtime profile: chatgpt-machine-runtime
MCP command:     node D:/Projects/Github/ChatGPTMCP/dist/index.js --root D:/Projects/Github --dangerously-open-machine
```

Helper scripts (`.ps1` on Windows, `.sh` on macOS/Ubuntu/WSL):

```powershell
.\scripts\start-tunnel.ps1
.\scripts\status-tunnel.ps1
.\scripts\stop-tunnel.ps1
.\scripts\refresh-tunnel.ps1
```

Operator CLI — normal entry point that wraps the scripts above (after `npm link`):

```powershell
chatgpt-local setup
chatgpt-local up
chatgpt-local down
chatgpt-local restart
chatgpt-local status
chatgpt-local doctor
```

The operator CLI bin is `chatgpt-local` (`src/cli.ts` → `dist/cli.js`); the tunnel runtime alias remains `chatgpt-machine` — they are distinct. `refresh-tunnel.*` restarts the tunnel in a detached worker and logs to `.tunnel/refresh-tunnel.log`. Tests for the operator CLI live in `src/cli.test.ts`.

Do not commit decrypted runtime keys.

The runtime key file under `.tunnel/` is machine-local and Git-ignored. `start-tunnel.ps1` (and `refresh-tunnel.ps1`) must continue to remove `CONTROL_PLANE_API_KEY` from the process environment in `finally`.

Avoid changing tunnel IDs, organization IDs, aliases, or profiles unless the task explicitly concerns tunnel provisioning.


## Security review checklist

For any change touching execution or file access, verify:

1. Can workspace-only mode escape `--root`?
2. Can a symlink/junction redirect access outside the root?
3. Does user input reach a shell in a new way?
4. Can output grow without a bound?
5. Can a process outlive its timeout unexpectedly?
6. Does HTTP become reachable off-loopback without authentication?
7. Are secrets exposed in args, logs, error messages, tests, or docs?
8. Did the MCP annotations still describe the authority of the tool accurately?

Security regressions outweigh convenience in this repository.

## Documentation rules

Keep documentation operational and falsifiable.

Prefer statements that can be verified from code or scripts. Avoid claims such as "ChatGPT delegates to Codex automatically" unless the implementation actually does so.

Document exact commands for Windows where the local integration depends on Windows, but keep core MCP behavior platform-neutral where possible.

Do not include:

- API keys;
- bearer tokens;
- passwords;
- decrypted DPAPI values;
- private credentials copied from local configuration.

## Scope control

Prefer small changes that preserve the bridge's inspectability.

Good additions:

- stronger path-policy tests;
- HTTP integration tests;
- better process cleanup;
- structured diagnostics;
- clearer security boundaries;
- portability fixes with tests.

Usually out of scope:

- autonomous planning;
- persistent memory;
- multi-agent coordination;
- job queues;
- workflow engines;
- model-provider abstractions;
- product-scale UI/dashboard code. The bounded localhost-only `/ui` audit viewer is part of the HTTP transport diagnostics and must stay dependency-free.

If those capabilities are needed, integrate this MCP server as a machine-access adapter from a higher-level system instead of turning this repository into that system.
