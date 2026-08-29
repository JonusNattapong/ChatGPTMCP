# ChatGPT Machine MCP

Local MCP server for exposing controlled machine access to ChatGPT or any MCP-compatible client.

The server exposes nineteen tools:

- `machine_status` — report platform, workspace root, access mode, and process ID.
- `read_file` — read bounded pages from UTF-8 text files.
- `list_directory` — list files and directories without a shell.
- `find_files` — find file paths recursively by glob.
- `file_info` — inspect metadata and SHA-256 hashes.
- `image_info` — inspect supported local images and return dimensions, size, and SHA-256.
- `save_image_from_url` — download a PNG, JPEG, or WebP image from HTTPS to the machine.
- `search_code` — search code with ripgrep and structured match results.
- `write_file` — create files or explicitly overwrite complete files.
- `edit_file` — replace exact text with ambiguity protection.
- `update_file` — replace an inclusive range of lines.
- `shell_command` — execute PowerShell, `cmd`, or Bash commands.
- `start_process` — start a background process and return its PID.
- `process_status` — inspect a managed background process.
- `read_process_output` — read captured stdout/stderr from a background process.
- `stop_process` — stop a background process and its child tree.
- `git_status` — read Git branch and working-tree status.
- `git_diff` — read working-tree or staged Git diff.
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
- all file, search, shell, and patch tools are restricted to the configured root;
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
  "pid": 12345,
  "node": "v24.x.x",
  "maxTimeoutMs": 600000,
  "tools": ["machine_status", "shell_command", "apply_patch"]
}
```

### `read_file`

Reads a UTF-8 text file without returning unbounded content. Use `start_line`, `max_lines`, and `max_bytes` to paginate. Files larger than 8 MiB and files containing NUL bytes are rejected as non-text inputs.

```json
{
  "path": "src/index.ts",
  "start_line": 1,
  "max_lines": 200,
  "max_bytes": 262144
}
```

### `list_directory`

Lists direct child entries of a directory, including their type (`file`, `directory`, `symlink`, or `other`). Hidden names are excluded by default and results are bounded by `max_entries`.

### `find_files`

Finds regular files recursively by `glob`, for example `**/*.ts`. It does not read content or follow symlinks. Hidden names are excluded by default; use `max_depth` and `max_results` to keep a large tree bounded.

### `file_info`

Returns type, size, creation/modification timestamps, and a SHA-256 hash for regular files. Set `include_hash` to `false` when metadata is enough.

### `image_info`

Inspects a local PNG, JPEG, or WebP file and returns its MIME type, dimensions when available, size, modification time, and SHA-256.

### `save_image_from_url`

Downloads an image using an HTTPS URL and an explicit destination `path`. The request sends no cookies, authorization headers, or user-supplied headers. Redirects are limited to three hops, local/private network addresses are rejected, and supported formats are PNG/JPEG/WebP. Existing files require `overwrite: true`.

Example:

```json
{
  "url": "https://example.com/generated.png",
  "path": "D:\\Projects\\Generated\\image.png"
}
```

The tool needs a directly downloadable URL. A ChatGPT Web image attachment may use a temporary or authenticated browser URL; if that URL cannot be fetched by the local process, download the image in the browser first and pass the local path through the existing file tools.

### `search_code`

Runs `rg` directly without passing the pattern through a shell. Results contain `path`, `line`, `column`, and matching line text.

```json
{
  "pattern": "registerTool",
  "path": "src",
  "globs": ["*.ts"],
  "case_sensitive": true,
  "literal": false,
  "max_results": 200,
  "timeout_ms": 30000
}
```

The host must have `rg` available on `PATH`.

### `write_file`

Creates a complete UTF-8 file and missing parent directories. Existing files are rejected unless `overwrite` is explicitly `true`.

### `edit_file`

Replaces exact `old_text` with `new_text`. By default the old text must occur exactly once; set `replace_all` to replace repeated matches intentionally.

### `update_file`

Replaces the inclusive 1-based line range from `start_line` through `end_line`. An empty `content` value deletes that range. Existing line-ending style and final newline behavior are preserved.

### `shell_command`

Input:

```json
{
  "command": "git status --short",
  "workdir": "D:\\Projects\\Github\\some-repo",
  "shell": "powershell",
  "timeout_ms": 30000,
  "max_output_bytes": 1048576
}
```

### Background process tools

Use `start_process` for servers, watchers, and other commands that should continue after the MCP call returns. It returns a PID. Pass that PID to `process_status`, `read_process_output`, or `stop_process`.

The MCP process keeps captured stdout and stderr in memory, up to 4 MiB combined per managed process. Process tracking is session-local; a process started before MCP or after MCP restarts cannot be managed in workspace-only mode.

Example flow:

```text
start_process(command="npm run dev", workdir="D:\\Projects\\App") -> pid
process_status(pid) -> running / exitCode
read_process_output(pid) -> stdout / stderr
stop_process(pid) -> stops the process tree
```

### `git_status` and `git_diff`

These are read-only Git operations that call Git directly instead of passing a command through the shell. Both accept an optional repository `path`; `git_diff` also supports `staged`, `stat_only`, and bounded `max_bytes` output.

Supported shells:

- `auto` — PowerShell on Windows, Bash elsewhere;
- `powershell`;
- `cmd` — Windows only;
- `bash`.

Runtime constraints:

- default command timeout: 30 seconds;
- maximum command timeout: 10 minutes by default;
- maximum combined stdout/stderr capture: 4 MiB, configurable downward per call with `max_output_bytes`;
- UTF-8 output is decoded safely across chunk boundaries;
- timeout and output-limit termination stop the spawned process tree;
- results include `durationMs` and `outputTruncated`;
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

Set `dry_run: true` to validate a patch and preview its change list without writing files.

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
  |-- read_file
  |-- list_directory
  |-- find_files
  |-- file_info
  |-- search_code
  |-- write_file
  |-- edit_file
  |-- update_file
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
- `read_file` and `search_code` are marked read-only.
- `list_directory`, `find_files`, and `file_info` are marked read-only.
- `image_info` is marked read-only.
- `save_image_from_url` is marked destructive and open-world because it performs an external network request and writes a file.
- `start_process` and `stop_process` are marked destructive; `process_status` and `read_process_output` are read-only.
- `git_status` and `git_diff` are read-only.
- `write_file`, `edit_file`, and `update_file` are marked destructive.
- `shell_command` is marked destructive and open-world in MCP annotations.
- `apply_patch` is marked destructive.
- workspace-only mode defends against simple path traversal and real-path escapes, but it should still be treated as a local execution boundary rather than a hostile multi-tenant sandbox.
- HTTP binding outside loopback is rejected unless a bearer token is configured.
- `save_image_from_url` only accepts HTTPS, blocks DNS results in local/private ranges, limits redirects, and validates image signatures before writing.
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
- bounded file reads and workspace-safe file writes;
- directory listing, glob file discovery, file metadata/hashing, and image validation;
- HTTPS image download validation and overwrite protection;
- exact-text edits and line-range updates;
- structured ripgrep code search;
- background process start/status/output/stop lifecycle;
- direct structured Git status and diff;
- unrestricted absolute working directories;
- add/update patch behavior;
- stdio MCP tool discovery;
- execution of `machine_status` and `shell_command` through an MCP client.

Source layout:

```text
src/
  index.ts              MCP server, CLI parsing, stdio/HTTP transports
  file-tools.ts         bounded file, directory, image, and code-search operations
  process-tools.ts      background process lifecycle and captured output
  git-tools.ts          direct read-only Git status and diff operations
  shell-tools.ts        path policy, shell execution, patch engine
  file-tools.test.ts    file and code-search unit tests
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
