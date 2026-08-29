# AGENTS.md

Repository instructions for coding agents working in `ChatGPTMCP`.

## Project intent

`chatgpt-machine-mcp` is a small local MCP server that intentionally exposes high-authority machine operations.

Keep the implementation narrow. The core contract is three tools:

1. `machine_status`
2. `shell_command`
3. `apply_patch`

Do not introduce orchestration, planning, memory, agent delegation, or a generic task framework into this repository unless a concrete requirement demands it. This project is infrastructure plumbing, not an agent harness.

## Source of truth

Treat these files as authoritative, in this order:

1. `src/index.ts` — MCP schema, CLI, transports, HTTP authentication.
2. `src/shell-tools.ts` — path policy, shell execution, patch semantics.
3. `scripts/*.ps1` — local Secure MCP Tunnel lifecycle.
4. tests — executable contract.
5. `README.md` — human-facing description of the above.

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

Do not restart the tunnel merely for documentation-only changes.

## Invariants

### Tool surface

The public MCP surface is deliberately small.

- `machine_status` must remain read-only.
- `shell_command` is destructive/open-world.
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

Helper scripts:

```powershell
.\scripts\start-tunnel.ps1
.\scripts\status-tunnel.ps1
.\scripts\stop-tunnel.ps1
```

Do not commit decrypted runtime keys.

The runtime key file under `.tunnel/` is machine-local and Git-ignored. `start-tunnel.ps1` should continue to remove `CONTROL_PLANE_API_KEY` from the process environment in `finally`.

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
- UI/dashboard code.

If those capabilities are needed, integrate this MCP server as a machine-access adapter from a higher-level system instead of turning this repository into that system.
