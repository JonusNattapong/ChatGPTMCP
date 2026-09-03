<p align="center">
  <img src="docs/assets/machine-mcp-logo.svg" alt="ChatGPT Machine MCP" width="760" />
</p>

# ChatGPT Machine MCP

**English** | [ไทย](README.th.md)

Use ChatGPT Web with a trusted local Windows machine through OpenAI Secure MCP Tunnel.

This README is the installation guide. For tools, architecture, transport, security, and contributor details, see the **[technical guide](https://jonusnattapong.github.io/ChatGPTMCP/)**.

## What you need

- Windows 10/11 or macOS (Apple Silicon / Intel)
- Node.js 20 or newer
- Git
- GitHub CLI (`gh`)
- A ChatGPT account that can use custom MCP apps/connectors
- An OpenAI Platform organization that can create Secure MCP Tunnels

## Setup

### 1. Clone and verify

```powershell
Set-Location D:\Projects\Github
gh repo clone JonusNattapong/ChatGPTMCP
Set-Location D:\Projects\Github\ChatGPTMCP
npm install
npm test
```

### 2. Download `tunnel-client`

The binary is deliberately not stored in Git.

```powershell
New-Item -ItemType Directory -Force tools\tunnel-client-v0.0.13 | Out-Null
gh release download v0.0.13 --repo openai/tunnel-client --pattern tunnel-client-v0.0.13-windows-amd64.zip --dir tools
Expand-Archive -LiteralPath tools\tunnel-client-v0.0.13-windows-amd64.zip -DestinationPath tools\tunnel-client-v0.0.13 -Force
Test-Path tools\tunnel-client-v0.0.13\tunnel-client.exe
```

![Download tunnel-client](docs/tunnel-client-release-annotated.png)

### 3. Create a tunnel

Open OpenAI Platform → Organization settings → **Tunnels** → **Create tunnel**. Give it a name such as `ChatGPT Machine MCP`.

![OpenAI Tunnels page](docs/tunnel-page-annotated.png)

For a new tunnel, update `--tunnel-id` and `--organization-id` in [scripts/start-tunnel.ps1](scripts/start-tunnel.ps1). Do not put a runtime API key in source control.

### 4. Store the runtime key locally

```powershell
New-Item -ItemType Directory -Force .tunnel | Out-Null
$secureKey = Read-Host 'OpenAI tunnel runtime API key' -AsSecureString
ConvertFrom-SecureString $secureKey | Set-Content .tunnel\control-plane-api-key.dpapi
```

This encrypts the key with Windows DPAPI for the current Windows user. The `.tunnel` directory is ignored by Git.

### 5. Start the connection

Install/link the CLI once from the repository:

```powershell
npm install
npm link
```

Then use the operator CLI:

```powershell
chatgpt-local setup
chatgpt-local up
chatgpt-local status
```

Lifecycle and diagnostics commands:

```text
chatgpt-local up
chatgpt-local down
chatgpt-local restart
chatgpt-local status
chatgpt-local machine list
chatgpt-local doctor
chatgpt-local check
chatgpt-local config show
chatgpt-local version
```

The underlying `scripts/` commands remain available for debugging, but normal operation should use `chatgpt-local`.

`chatgpt-local setup` creates a local, Git-ignored `.chatgpt-machine/config.json`. It controls the workspace root, `workspace` vs `unrestricted` access mode, policy, approval mode, and the supervisor hard deadline. Use `chatgpt-local config show` to inspect the effective local settings; `config reset` restores the defaults.

The tunnel-facing stdio entry point is `dist/supervisor.js`. It runs `dist/index.js` as an isolated MCP worker. If that worker crashes or stops answering past the hard deadline, the supervisor returns a recoverable error, restarts the worker, replays MCP initialization, and keeps the tunnel process alive. `chatgpt-local status` also reports the persisted worker generation and restart count from `.chatgpt-machine/supervisor.json`.

While the tunnel is intentionally active, a small local watchdog also checks the managed runtime every 15 seconds. After two failed status checks it reconnects the tunnel and writes bounded diagnostics to `.tunnel/watch-tunnel.log`. `chatgpt-local down` stops the watchdog first, so an explicit shutdown is never undone by automatic recovery.

Continue only when the tunnel status reports:

```text
process_running : True
healthy         : True
ready           : True
```

For a supervised runtime, `chatgpt-local status` should additionally report `supervisor: ready`.

Stop or restart the connection when it is not needed:

```powershell
chatgpt-local down      # or .\scripts\stop-tunnel.ps1
chatgpt-local restart   # rebuild, stop, then start the tunnel
```

### 6. Add it in ChatGPT Web

Enable Developer mode in ChatGPT if required. Add the MCP app/connector for the tunnel, select `ChatGPT Machine MCP`, then refresh or reconnect its tools.

Test with:

```text
ใช้ machine_status ตรวจว่าเชื่อมต่อเครื่อง local สำเร็จ และอย่าแก้ไขไฟล์
```

After changing MCP code: run `npm run build`, stop/start the tunnel, and refresh the connector so ChatGPT receives the latest tool schema.


Useful local checks:

```powershell
chatgpt-local doctor          # dependencies + workspace permissions
chatgpt-local check           # effective config + v3 / 41-tool contract fingerprint
npm run smoke                 # real MCP + supervisor recovery smoke tests
npm run verify                # full tests + server contract check
# Preview all mutations without executing them:
node dist/index.js --root D:\Projects\Github --dry-run
```

The current MCP contract is v3: 41 public tools with a SHA-256 fingerprint derived from tool names, schemas, and annotations. It adds the multi-machine routing surface (`machines_list`, `machine_probe`, `machine_tools`, and `machine_call`) while preserving all existing local tools.

## Multi-machine routing

One tunnel can act as a gateway to multiple registered MCP nodes. Remote nodes are selected explicitly by machine id, name, hostname, alias, IP address, or `host:port`; arbitrary unregistered URLs are never accepted from a tool call.

Register nodes on the gateway:

```powershell
chatgpt-local machine add server 192.168.1.20:8787 --hostname HOME-SERVER --alias buildbox --token-env MCP_NODE_SERVER_TOKEN
chatgpt-local machine list
```

`machines.json` lives under the Git-ignored `.chatgpt-machine/` directory. `tokenEnv` stores only the environment-variable name, never the bearer token itself. Set that environment variable on the gateway before starting the tunnel.

Run each remote node with Streamable HTTP and a bearer token when binding outside loopback:

```powershell
$env:MCP_HTTP_TOKEN = '<node-secret>'
node dist/index.js --http --http-host 0.0.0.0 --http-port 8787 --http-token $env:MCP_HTTP_TOKEN --root D:\Projects --dangerously-open-machine
```

Keep the node port restricted to the trusted LAN, VPN, or Tailscale network. Plain HTTP is accepted by the gateway only for local/private addresses; public endpoints must use HTTPS. The `developer` gateway policy approval-gates `machine_call`, and the selected remote node independently enforces its own workspace, policy, approval, and audit rules.

From ChatGPT, use `machines_list`, then `machine_probe`, `machine_tools`, or `machine_call`. For example, `machine_call(machine="192.168.1.20", tool="git_status", arguments={...})` routes only to the matching registered node. Existing tools such as `read_file` continue to operate on the gateway machine itself.

When using local HTTP transport, the redacted recent-call viewer is available at `http://127.0.0.1:8787/ui`. If `MCP_HTTP_TOKEN` is enabled, the UI endpoints require the same Bearer authorization header.

## macOS / Ubuntu / WSL setup

The MCP server, file/process/Git tools, and tunnel lifecycle are supported on macOS, Ubuntu, and Ubuntu WSL. The Bash scripts use Keychain on macOS; Ubuntu/WSL use either `CONTROL_PLANE_API_KEY` for one launch or a local key file with mode `600`.

```bash
brew install node git gh
git clone https://github.com/JonusNattapong/ChatGPTMCP.git
cd ChatGPTMCP
npm install && npm test

# macOS: download darwin-arm64 on Apple Silicon, or darwin-amd64 on Intel.
mkdir -p tools/tunnel-client-v0.0.13
gh release download v0.0.13 --repo openai/tunnel-client --pattern "tunnel-client-v0.0.13-darwin-*.zip" --dir tools
unzip tools/tunnel-client-v0.0.13-darwin-*.zip -d tools/tunnel-client-v0.0.13
chmod +x tools/tunnel-client-v0.0.13/tunnel-client

# Enter the OpenAI runtime key at the prompt; it is stored in your Keychain.
security add-generic-password -U -a "$USER" -s chatgpt-machine-mcp-tunnel -w
export OPENAI_TUNNEL_ID="tunnel_..."
export OPENAI_ORGANIZATION_ID="org_..."
./scripts/start-tunnel.sh
./scripts/status-tunnel.sh
```

Use `./scripts/stop-tunnel.sh` to stop it. Download only the matching release archive for your architecture; do not extract both archives into the same directory.

On Ubuntu or WSL, use the matching `linux-amd64` or `linux-arm64` archive instead. Store the key without committing it:

```bash
mkdir -p .tunnel
umask 077
printf '%s' "$CONTROL_PLANE_API_KEY" > .tunnel/control-plane-api-key
chmod 600 .tunnel/control-plane-api-key
export OPENAI_TUNNEL_ID="tunnel_..."
export OPENAI_ORGANIZATION_ID="org_..."
./scripts/start-tunnel.sh
```

WSL runs in a Linux boundary: its MCP can operate WSL files and Linux processes. Run the Windows setup above if ChatGPT must operate native Windows applications, Windows services, or the Windows filesystem outside mounted drive paths.

## Automatic startup

The project does **not** start the tunnel automatically after Windows restarts. This is intentional because an active tunnel grants remote access with your Windows account's authority.

If you decide to enable auto-start, create a Windows Task Scheduler task that runs after you sign in and executes:

```powershell
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File D:\Projects\Github\ChatGPTMCP\scripts\start-tunnel.ps1
```

Use **Run only when user is logged on** and **do not store a password**. Disable or delete that task when the machine should no longer be remotely reachable.

On macOS, use a per-user LaunchAgent only if you explicitly want the same persistent remote access after login. It should execute `scripts/start-tunnel.sh` with `OPENAI_TUNNEL_ID` and `OPENAI_ORGANIZATION_ID` set in its environment; the runtime key remains in Keychain. Do not use a system-wide daemon for this user-scoped setup.

## Help

- Check status: `./scripts/status-tunnel.ps1`
- Rebuild after source changes: `npm run build`
- Full architecture, safety model, tools, HTTP, and development: [technical guide](https://jonusnattapong.github.io/ChatGPTMCP/)
