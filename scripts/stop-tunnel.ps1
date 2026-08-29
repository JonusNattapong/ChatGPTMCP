[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$clientPath = Join-Path $projectRoot 'tools\tunnel-client-v0.0.13\tunnel-client.exe'

if (-not (Test-Path -LiteralPath $clientPath)) {
    throw "Tunnel client not found: $clientPath"
}

# Record the MCP child (node dist/index.js) this daemon is currently running
# before asking the daemon to stop. "tunnel-client runtimes stop" reliably
# stops the tunnel-client.exe daemon itself, but does not reliably terminate
# the node child it spawned -- left running, that orphan keeps serving stale
# code on the next start-tunnel and silently causes every tool call to 502
# until someone notices and kills it by hand.
$statusJson = & $clientPath runtimes status chatgpt-machine --json 2>$null
$daemonPid = $null
if ($LASTEXITCODE -eq 0 -and $statusJson) {
    try { $daemonPid = ($statusJson | ConvertFrom-Json).process.pid } catch { $daemonPid = $null }
}
$children = @()
if ($daemonPid) {
    $children = @(Get-CimInstance Win32_Process -Filter "Name='node.exe' AND ParentProcessId=$daemonPid" -ErrorAction SilentlyContinue)
}

& $clientPath runtimes stop chatgpt-machine

if ($LASTEXITCODE -ne 0) {
    throw "tunnel-client stop failed with exit code $LASTEXITCODE"
}

# Kill only the exact child PIDs recorded above, and only if still alive.
# This never touches processes by image name (e.g. "taskkill /im node.exe"),
# which would affect every unrelated Node process on the machine -- only the
# specific PID this script itself observed as this daemon's child moments ago.
Start-Sleep -Milliseconds 500
foreach ($child in $children) {
    if (Get-Process -Id $child.ProcessId -ErrorAction SilentlyContinue) {
        Write-Host "Killing orphaned MCP child process (PID $($child.ProcessId))"
        Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue
    }
}
