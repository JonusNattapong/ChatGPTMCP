# ChatGPT Machine MCP

Local MCP server for exposing controlled machine access to ChatGPT or any MCP-compatible client.

The server exposes exactly three tools:

- `machine_status` — report platform, workspace root, access mode, and process ID.
- `shell_command` — execute PowerShell, `cmd`, or Bash commands.
- `apply_patch` — add, update, move, or delete files using Codex patch format.

The project supports both stdio MCP and Streamable HTTP. On this machine it is also wired to OpenAI Secure MCP Tunnel through the helper scripts in `scripts/`.

## Current local installation

| Item | Value |
| --- | --- |
| Project | `D:\Projects\Github\ChatGPTMCP` |
| Default workspace | `D:\Projects\Github` |
| Package | `chatgpt-machine-mcp@0.1.0` |
| Node.js | `>=20` |
| Tunnel runtime alias | `chatgpt-machine` |
| Runtime profile | `chatgpt-machine-runtime` |
| ChatGPT connector name | `ChatGPT Machine MCP` |
| Codex MCP name | `chatgpt_machine` |
| Tunnel client | `tools\tunnel-client-v0.0.13\tunnel-client.exe` |

The local tunnel launcher starts the MCP server with unrestricted machine access:

```text
node D:/Projects/Github/ChatGPTMCP/dist/index.js --root D:/Projects/Github --dangerously-open-machine
```

That mode is intentionally powerful. See [Security](#security) before reusing the configuration on another machine.

## Quick start

Install dependencies and verify the project:

```powershell
cd D:\Projects\Github\ChatGPTMCP
npm install
npm test
```

Run a configuration check without starting MCP:

```powershell
node dist\index.js --check --root D:\Projects\Github
```

Run stdio MCP in workspace-only mode:

```powershell
node dist\index.js --root D:\Projects\Github
```

Run stdio MCP with unrestricted machine access:

```powershell
node dist\index.js --root D:\Projects\Github --dangerously-open-machine
```

## Access modes

### Workspace-only

Workspace-only is the default.

```powershell
node dist\index.js --root D:\Projects\Github
```

In this mode:

- working directories must resolve inside the configured root;
- symlink or junction resolution is checked against the real root;
- `apply_patch` is restricted to the configured root;
- `machine_status` reports `WORKSPACE_ONLY`.

### Unrestricted machine

Enable with:

```text
--dangerously-open-machine
```

In this mode absolute paths and arbitrary shell commands can target locations outside `--root`. `machine_status` reports `UNRESTRICTED_MACHINE`.

Use this only when the MCP client and tunnel are trusted to operate with the same authority as the Windows user running the process.

## Tool contract

### `machine_status`

Read-only status endpoint.

Example result:

```json
{
  "ok": true,
  "platform": "win32",
  "defaultWorkspace": "D:\\Projects\\Github",
  "accessMode": "UNRESTRICTED_MACHINE",
  "pid": 12345
}
```

### `shell_command`

Input:

```json
{
  "command": "git status --short",
  "workdir": "D:\\Projects\\Github\\some-repo",
  "shell": "powershell",
  "timeout_ms": 30000
}
```

Supported shells:

- `auto` — PowerShell on Windows, Bash elsewhere;
- `powershell`;
- `cmd` — Windows only;
- `bash`.

Runtime constraints:

- default command timeout: 30 seconds;
- maximum command timeout: 10 minutes by default;
- maximum combined stdout/stderr capture: 4 MiB;
- non-zero exit codes and timeouts are returned to the MCP client as tool errors.

The server does not contain a dedicated Codex delegation tool. If a client wants to run `codex`, it may do so explicitly through `shell_command` when policy allows it.

### `apply_patch`

Accepts Codex patch format:

```text
*** Begin Patch
*** Update File: README.md
@@
-old line
+new line
*** End Patch
```

Supported operations:

- `*** Add File:`
- `*** Update File:`
- `*** Delete File:`
- `*** Move to:` on an update operation

The implementation prevents the same path from being claimed twice in a single patch and refuses moves onto existing destinations.

## Streamable HTTP

Run on loopback:

```powershell
node dist\index.js --http --http-port 8787 --root D:\Projects\Github
```

Endpoints:

```text
GET  /healthz
GET  /readyz
*    /mcp
```

Default bind address is `127.0.0.1:8787`.

Binding outside loopback requires a bearer token:

```powershell
node dist\index.js `
  --http `
  --http-host 0.0.0.0 `
  --http-port 8787 `
  --http-token "<secret>" `
  --root D:\Projects\Github
```

You can also set `MCP_HTTP_TOKEN` instead of passing the token on the command line. Bearer-token comparison uses `timingSafeEqual`.

## Secure MCP Tunnel operations

The checked-in helper scripts manage the local `tunnel-client` runtime.

Start:

```powershell
.\scripts\start-tunnel.ps1
```

Status:

```powershell
.\scripts\status-tunnel.ps1
```

A healthy runtime should report values equivalent to:

```text
process_running : True
healthy         : True
ready           : True
runtime_state   : ready
```

Stop:

```powershell
.\scripts\stop-tunnel.ps1
```

The runtime API key is stored locally in:

```text
.tunnel\control-plane-api-key.dpapi
```

`start-tunnel.ps1` decrypts it only for the process launch, exposes it temporarily as `CONTROL_PLANE_API_KEY`, and removes the environment variable in `finally`.

The `.tunnel/` directory is ignored by Git.

## CLI options

```text
--root <path>                 Default workspace and safe-mode boundary
--dangerously-open-machine    Allow absolute paths and unrestricted shell/file access
--max-timeout <ms>            Maximum tool timeout; default 600000
--http                        Use Streamable HTTP instead of stdio
--http-host <host>            HTTP bind host; default 127.0.0.1
--http-port <port>            HTTP port; default 8787
--http-token <token>          Optional bearer token; required off loopback
--check                       Print configuration and exit
-h, --help                    Show help
```

## Architecture

```text
ChatGPT / MCP Client
        |
        | MCP
        v
chatgpt-machine-mcp
  |-- machine_status
  |-- shell_command
  `-- apply_patch
        |
        v
 Windows host filesystem / processes
```

For the ChatGPT Web deployment on this machine:

```text
ChatGPT Web
    |
OpenAI Secure MCP Tunnel
    |
tunnel-client runtime
    |
stdio MCP
    |
chatgpt-machine-mcp
    |
Windows host
```

The tunnel transport and the MCP server are separate components. The MCP server itself has no dependency on a specific ChatGPT UI.

## Security

This project is an administrative bridge, not a sandbox.

Important boundaries:

- `--dangerously-open-machine` grants the MCP client filesystem and shell reach equivalent to the current Windows account.
- `shell_command` is marked destructive and open-world in MCP annotations.
- `apply_patch` is marked destructive.
- workspace-only mode defends against simple path traversal and real-path escapes, but it should still be treated as a local execution boundary rather than a hostile multi-tenant sandbox.
- HTTP binding outside loopback is rejected unless a bearer token is configured.
- never commit runtime keys, access tokens, passwords, or decrypted DPAPI material.
- keep `.tunnel/` local and ignored.
- rotate/revoke the tunnel runtime key if the machine or account is suspected to be compromised.

For normal development, prefer workspace-only mode. Use unrestricted mode only when remote machine administration is the intended capability.

## Development

Build:

```powershell
npm run build
```

Test:

```powershell
npm test
```

The current tests cover:

- safe-mode path containment;
- unrestricted absolute working directories;
- add/update patch behavior;
- stdio MCP tool discovery;
- execution of `machine_status` and `shell_command` through an MCP client.

Source layout:

```text
src/
  index.ts              MCP server, CLI parsing, stdio/HTTP transports
  shell-tools.ts        path policy, shell execution, patch engine
  mcp-smoke.test.ts     stdio MCP integration test
  shell-tools.test.ts   shell/path/patch unit tests
scripts/
  start-tunnel.ps1
  status-tunnel.ps1
  stop-tunnel.ps1
tools/
  tunnel-client-v0.0.13/
```

## Documentation map

- `README.md` — operator and developer reference.
- `AGENTS.md` — repository rules for coding agents working on this project.

When runtime behavior changes, update the documentation in the same change. In particular, keep tool schemas, access-mode semantics, CLI options, tunnel scripts, and security boundaries synchronized with the implementation.
