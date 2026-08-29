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
| Package | `chatgpt-machine-mcp@0.2.0` |
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

## Setup from a new Windows machine

The complete connection path is:

```text
ChatGPT Web -> OpenAI Secure MCP Tunnel -> tunnel-client -> local MCP -> Windows
```

### Step 1: install prerequisites

Install Node.js 20+, Git, and GitHub CLI (`gh`). Verify them:

```powershell
node --version
git --version
gh --version
gh auth login
```

### Step 2: clone and build

```powershell
Set-Location D:\Projects\Github
gh repo clone JonusNattapong/ChatGPTMCP
Set-Location D:\Projects\Github\ChatGPTMCP
npm install
npm test
```

The repository intentionally does not include the tunnel executable or runtime key.

### Step 3: download tunnel-client

For 64-bit Windows:

```powershell
Set-Location D:\Projects\Github\ChatGPTMCP
New-Item -ItemType Directory -Force tools\tunnel-client-v0.0.13 | Out-Null
gh release download v0.0.13 --repo openai/tunnel-client --pattern tunnel-client-v0.0.13-windows-amd64.zip --dir tools
Expand-Archive -LiteralPath tools\tunnel-client-v0.0.13-windows-amd64.zip -DestinationPath tools\tunnel-client-v0.0.13 -Force
Test-Path tools\tunnel-client-v0.0.13\tunnel-client.exe
```

![Download tunnel-client](docs/tunnel-client-release-annotated.png)

เลื่อนลงในหัวข้อ **Assets** แล้วเลือกไฟล์ Windows ที่ตรงกับสถาปัตยกรรมเครื่อง

### Step 4: create the OpenAI tunnel

เปิด OpenAI Platform -> Organization settings -> **Tunnels** -> **Create tunnel** แล้วตั้งชื่อ เช่น `ChatGPT Machine MCP` เก็บ tunnel ID และ organization ID ไว้เป็นค่ากำหนดของเครื่อง ห้ามเผยแพร่ runtime API key

![OpenAI Tunnels page](docs/tunnel-page-annotated.png)

ข้อมูล ID ในภาพถูก redact ก่อนใส่ repository

ถ้าเป็น tunnel ใหม่ ให้แก้ค่า `--tunnel-id` และ `--organization-id` ใน `scripts\start-tunnel.ps1` ให้ตรงกับ tunnel ของคุณ โดยไม่ใส่ key ลงใน source

### Step 5: store the runtime key with Windows DPAPI

```powershell
New-Item -ItemType Directory -Force .tunnel | Out-Null
$secureKey = Read-Host 'OpenAI tunnel runtime API key' -AsSecureString
ConvertFrom-SecureString $secureKey | Set-Content .tunnel\control-plane-api-key.dpapi
```

ไฟล์นี้ถูกเข้ารหัสด้วย Windows DPAPI และถูก ignore โดย Git ใช้ได้กับ Windows user profile เดิมเท่านั้น

### Step 6: start and verify

```powershell
npm run build
.\scripts\start-tunnel.ps1
.\scripts\status-tunnel.ps1
```

ต้องเห็น `process_running: True`, `healthy: True`, และ `ready: True` จึงถือว่าใช้งานได้ หยุด tunnel ด้วย:

```powershell
.\scripts\stop-tunnel.ps1
```

### Step 7: connect ChatGPT Web

ใน ChatGPT Web ให้เปิด Developer mode ถ้าจำเป็น จากนั้นเพิ่ม MCP app/connector โดยเลือก tunnel ที่สร้างไว้ เลือก `ChatGPT Machine MCP` แล้วกด refresh/reconnect tools จนเห็น `machine_status`, `read_file`, `apply_patch`, `git_status`, และ `start_process`

ทดสอบแบบอ่านอย่างเดียวก่อน:

```text
ใช้ machine_status ตรวจว่าเชื่อมต่อเครื่อง local สำเร็จ และอย่าแก้ไขไฟล์
```

หลังแก้โค้ด MCP ให้รัน `npm run build` -> `stop-tunnel.ps1` -> `start-tunnel.ps1` -> refresh connector ใน ChatGPT Web เพื่อโหลด schema ล่าสุด

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

## Result envelope

Every tool answers with the same JSON envelope, so a client can branch on one field instead of parsing prose.

Success:

```json
{ "ok": true, "path": "D:\\Projects\\Github\\app\\src\\index.ts", "totalLines": 42 }
```

Failure (the MCP result also carries `isError: true`):

```json
{
  "ok": false,
  "tool": "edit_file",
  "error": {
    "code": "NO_MATCH",
    "message": "\"old_text\" was not found in: src/index.ts",
    "hint": "Copy the text verbatim from read_file output, including indentation and line endings.",
    "details": { "nearMisses": [{ "line": 17, "text": "  const   value = 1;" }] }
  }
}
```

`error.code` is stable and machine-readable:

| Code | Meaning |
| --- | --- |
| `INVALID_ARGUMENT` | An argument is missing, mistyped, or out of range. |
| `NOT_FOUND` | The path or repository does not exist. |
| `ALREADY_EXISTS` | The destination exists and no overwrite was requested. |
| `NOT_A_FILE` / `NOT_A_DIRECTORY` | The path exists but is the wrong kind. |
| `PATH_DENIED` | Workspace-only mode, a symlink escape, or an OS permission denial. |
| `PRECONDITION_FAILED` | `expected_sha256` or `expected_replacements` did not hold. |
| `AMBIGUOUS_MATCH` | `old_text` matched more than once. |
| `NO_MATCH` | `old_text` or patch context was not found. |
| `TOO_LARGE` / `BINARY_FILE` | The file is not a readable UTF-8 text file within limits. |
| `TIMEOUT` | The operation exceeded its timeout. |
| `DEPENDENCY_MISSING` | An external program (git, a shell) is not on `PATH`. |
| `NETWORK` | An outbound download failed. |
| `PROCESS_NOT_MANAGED` | The PID was not started by `start_process` in this session. |
| `PATCH_INVALID` | The patch text is malformed. |
| `UNKNOWN_TOOL` / `INTERNAL` | Unrecognized tool name, or an unclassified failure. |

Failures carry an optional `hint` describing the next useful action, and `details` with the data needed to retry — the current digest, the occurrence count, or the candidate lines of a near miss.

## Concurrency and preconditions

`read_file`, `write_file`, `edit_file`, and `update_file` return the file's `sha256`. Passing that digest back as `expected_sha256` on the next write turns a lost update into an explicit `PRECONDITION_FAILED` error instead of silently discarding someone else's change. The rejection reports the actual digest, so the caller can re-read and rebuild the edit.

## Tool contract

### `machine_status`

Read-only status endpoint. The tool list is derived from the live registry, and the environment probe reports which external programs are actually usable.

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
  "available": {
    "git": "git version 2.51.0.windows.1",
    "ripgrep": "ripgrep 14.1.1",
    "bash": "GNU bash, version 5.2.37(1)-release",
    "powershell": "5.1.26200.7015",
    "searchEngine": "ripgrep"
  },
  "managedProcesses": [{ "pid": 4321, "running": true, "command": "npm run dev" }],
  "tools": ["machine_status", "read_file", "shell_command", "apply_patch"]
}
```

### `read_file`

Reads a UTF-8 text file without returning unbounded content. Use `start_line`, `max_lines`, and `max_bytes` to paginate. Files larger than 8 MiB and files containing NUL bytes are rejected as non-text inputs.

Set `line_numbers` to prefix each returned line with its 1-based number, which makes a follow-up `update_file` range easy to state. The result includes the whole file's `sha256` for use as `expected_sha256`.

```json
{
  "path": "src/index.ts",
  "start_line": 1,
  "max_lines": 200,
  "max_bytes": 262144,
  "line_numbers": true
}
```

### `list_directory`

Lists direct child entries of a directory, including their type (`file`, `directory`, `symlink`, or `other`), byte size for regular files, and modification time. Hidden names are excluded by default and results are bounded by `max_entries`.

### `find_files`

Finds regular files recursively by `glob`, for example `**/*.ts`. It does not read content or follow symlinks. Hidden names are excluded by default; use `max_depth` and `max_results` to keep a large tree bounded.

Dependency and build directories are skipped by default (`.git`, `node_modules`, `dist`, `build`, `out`, `target`, `coverage`, `.venv`, `__pycache__`, `.next`, `.nuxt`, `.turbo`, `.gradle`, `.idea`, `.cache`, and the other VCS metadata directories). The names that were actually skipped are reported in `excludedDirectories`. Add more with `exclude`, or traverse everything with `include_ignored: true`. Results are returned in a deterministic order, and an unreadable directory is skipped rather than failing the walk.

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

Runs `rg` directly without passing the pattern through a shell. Results contain `path`, `line`, `column`, and matching line text, plus the `engine` that produced them.

```json
{
  "pattern": "registerTool",
  "path": "src",
  "globs": ["*.ts", "!**/*.test.ts"],
  "case_sensitive": true,
  "literal": false,
  "max_results": 200,
  "max_matches_per_file": 5,
  "context_lines": 2,
  "files_only": false,
  "timeout_ms": 30000
}
```

- `context_lines` (0-10) attaches `before` and `after` lines to each match.
- `max_matches_per_file` stops a single noisy file from consuming the whole result budget.
- `files_only` returns just the matching paths, which is the cheapest way to scope a follow-up read.
- An invalid regular expression is rejected before any process is spawned; set `literal` to search for the text exactly as written.

`rg` is used when it is on `PATH`. When it is not, the search falls back to a built-in scanner that reports `"engine": "builtin"`; the fallback skips binary files and files larger than 2 MiB, so it is slower and less complete than ripgrep but keeps search working. `machine_status` reports which engine is active.

### `write_file`

Creates a complete UTF-8 file and missing parent directories. Existing files are rejected unless `overwrite` is explicitly `true`. Supply `expected_sha256` to fail instead of overwriting a file that changed since it was read.

### `edit_file`

Replaces exact `old_text` with `new_text`. By default the old text must occur exactly once; set `replace_all` to replace repeated matches intentionally, or `expected_replacements` to assert the exact count.

- `dry_run: true` reports the replacement count, the first affected line, and the resulting digest without writing.
- `expected_sha256` rejects the edit if the file changed since it was read.
- An ambiguous match reports the line number of every occurrence.
- A failed match reports whitespace-insensitive `nearMisses`, so an indentation mistake can be corrected in one step instead of by guessing.

### `update_file`

Replaces the inclusive 1-based line range from `start_line` through `end_line`. An empty `content` value deletes that range. Existing line-ending style and final newline behavior are preserved. Line numbers shift after every edit, so re-read the file between updates, or pass `expected_sha256` to make a stale range fail loudly.

### `shell_command`

Input:

```json
{
  "command": "git status --short",
  "workdir": "D:\\Projects\\Github\\some-repo",
  "shell": "powershell",
  "timeout_ms": 30000,
  "max_output_bytes": 1048576,
  "env": { "CI": "1" },
  "stdin": "input text"
}
```

`env` is merged over the server environment for that call only. `stdin` is written to the command and the pipe is then closed, which avoids quoting a large payload into the command line.

### Background process tools

Use `start_process` for servers, watchers, and other commands that should continue after the MCP call returns. It returns a PID. Pass that PID to `process_status`, `read_process_output`, or `stop_process`.

The MCP process keeps captured stdout and stderr in memory, up to 4 MiB combined per managed process. Process tracking is session-local: only a process started by `start_process` in the current session can be inspected, and `machine_status` lists those PIDs so a caller that lost track of one can recover it.

`read_process_output` supports incremental reads. It returns `next_stdout_offset` and `next_stderr_offset`; pass them back as `since_stdout` and `since_stderr` to receive only what is new, instead of the whole buffer on every poll. `wait_ms` (up to 60 s) blocks until new output arrives or the process exits, which replaces a polling loop.

`stop_process` waits for the process to actually exit before returning (escalating to `SIGKILL` after a grace period on POSIX) and reports `exited`, so a caller can safely delete the working directory next.

Example flow:

```text
start_process(command="npm run dev", workdir="D:\\Projects\\App") -> pid
process_status(pid) -> running / exitCode / stdoutOffset
read_process_output(pid, wait_ms=5000) -> stdout + next_stdout_offset
read_process_output(pid, since_stdout=next_stdout_offset) -> only new output
stop_process(pid) -> stops the process tree and waits for exit
```

### `git_status` and `git_diff`

These are read-only Git operations that call Git directly instead of passing a command through the shell. Both accept an optional repository `path`.

`git_status` returns the branch, its `upstream`, `ahead`/`behind` counts, a `summary` of staged, unstaged, untracked, and conflicted file counts, and the per-file status entries.

`git_diff` supports `staged`, `stat_only`, `context_lines` (0-20), a `paths` filter for scoping the diff to specific files, and bounded `max_bytes` output.

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
--check                       Print configuration and the tool list, then exit
-h, --help                    Show help
```

## Architecture

![Architecture: MCP clients reach the server over stdio or Streamable HTTP; src/index.ts wraps every result in a shared envelope; src/tools.ts holds the tool registry; four tool modules run behind a single path policy before touching the host; src/errors.ts supplies the shared error codes.](docs/architecture.svg)

The tunnel transport and the MCP server are separate components. The MCP server itself has no dependency on a specific ChatGPT UI: the same binary serves Codex CLI or any other MCP client, over either transport.

### Request lifecycle

Every tool call passes the same gates in the same order, and each gate fails closed with a code the caller can act on.

![Request lifecycle: a tool call passes registry lookup, argument validation, path policy, and preconditions before executing, then returns either a success envelope carrying the new digest or a failure envelope whose code, hint, and details let the caller correct the call and retry.](docs/request-flow.svg)

The last stage is what makes the failure path useful rather than merely safe: `PRECONDITION_FAILED` hands back the current digest, and `NO_MATCH` hands back the near-miss lines, so a caller can rebuild the call instead of retrying blindly.

Tool definitions and their handlers live together in one registry (`src/tools.ts`), so `machine_status` and `--check` report the real surface and cannot drift from what `tools/list` returns. See [Development](#development) for the full source layout.

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
- the built-in `search_code` fallback resolves its target through the same path policy as ripgrep, so it grants no reach that `rg` would not have.
- `expected_sha256` is a concurrency guard, not an authorization control; it prevents accidental lost updates and nothing more.
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
- default exclusion of dependency and build directories, and opting back in;
- HTTPS image download validation and overwrite protection;
- exact-text edits and line-range updates;
- `expected_sha256` preconditions, including a rejected stale write;
- `edit_file` near-miss diagnostics, `dry_run`, and `expected_replacements`;
- `read_file` line numbering;
- structured ripgrep code search, context lines, files-only mode, and invalid-pattern rejection;
- the built-in search fallback when `rg` is not on `PATH`;
- background process start/status/output/stop lifecycle;
- incremental process output reads with offsets and `wait_ms`;
- direct structured Git status and diff;
- unrestricted absolute working directories;
- add/update patch behavior;
- tool-registry argument validation and the derived tool surface;
- stdio MCP tool discovery;
- execution of `machine_status` and `shell_command` through an MCP client;
- the success and failure result envelopes, including `NOT_FOUND` and `UNKNOWN_TOOL`.

Source layout:

```text
src/
  index.ts              CLI parsing, stdio/HTTP transports, shared result envelope
  tools.ts              tool registry: schema, description, argument validation, handler
  errors.ts             ToolError and the stable error-code vocabulary
  file-tools.ts         bounded file, directory, image, and code-search operations
  process-tools.ts      background process lifecycle and captured output
  git-tools.ts          direct read-only Git status and diff operations
  shell-tools.ts        path policy, shell execution, patch engine
  file-tools.test.ts    file and code-search unit tests
  smart-tools.test.ts   preconditions, diagnostics, search fallback, registry tests
  mcp-smoke.test.ts     stdio MCP integration test
  shell-tools.test.ts   shell/path/patch unit tests
docs/
  architecture.svg      module and transport map rendered in this README
  request-flow.svg      per-call gate sequence and failure codes
scripts/
  start-tunnel.ps1
  status-tunnel.ps1
  stop-tunnel.ps1
tools/
  tunnel-client-v0.0.13/
```

## Documentation map

- `README.md` — operator and developer reference.
- `docs/architecture.svg` — how a request reaches the host: clients, transports, registry, tool modules, path policy.
- `docs/request-flow.svg` — the gates a single tool call passes, and the error code each one raises.
- `AGENTS.md` — repository rules for coding agents working on this project.

When runtime behavior changes, update the documentation in the same change. In particular, keep tool schemas, access-mode semantics, CLI options, tunnel scripts, security boundaries, and the two diagrams in `docs/` synchronized with the implementation. The diagrams are hand-authored SVG with no external assets, so they can be edited directly.
