# ChatGPT Machine MCP

Use ChatGPT Web with a trusted local Windows machine through OpenAI Secure MCP Tunnel.

This README is the installation guide. For tools, architecture, transport, security, and contributor details, see the **[technical guide](https://jonusnattapong.github.io/ChatGPTMCP/)**.

## What you need

- Windows 10/11
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

```powershell
npm run build
.\scripts\start-tunnel.ps1
.\scripts\status-tunnel.ps1
```

Continue only when the status reports:

```text
process_running : True
healthy         : True
ready           : True
```

Stop the connection when it is not needed:

```powershell
.\scripts\stop-tunnel.ps1
```

### 6. Add it in ChatGPT Web

Enable Developer mode in ChatGPT if required. Add the MCP app/connector for the tunnel, select `ChatGPT Machine MCP`, then refresh or reconnect its tools.

Test with:

```text
ใช้ machine_status ตรวจว่าเชื่อมต่อเครื่อง local สำเร็จ และอย่าแก้ไขไฟล์
```

After changing MCP code: run `npm run build`, stop/start the tunnel, and refresh the connector so ChatGPT receives the latest tool schema.

## Automatic startup

The project does **not** start the tunnel automatically after Windows restarts. This is intentional because an active tunnel grants remote access with your Windows account's authority.

If you decide to enable auto-start, create a Windows Task Scheduler task that runs after you sign in and executes:

```powershell
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File D:\Projects\Github\ChatGPTMCP\scripts\start-tunnel.ps1
```

Use **Run only when user is logged on** and **do not store a password**. Disable or delete that task when the machine should no longer be remotely reachable.

## Help

- Check status: `./scripts/status-tunnel.ps1`
- Rebuild after source changes: `npm run build`
- Full architecture, safety model, tools, HTTP, and development: [technical guide](https://jonusnattapong.github.io/ChatGPTMCP/)
