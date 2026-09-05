[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$clientPath = Join-Path $projectRoot 'tools\tunnel-client-v0.0.13\tunnel-client.exe'

if (-not (Test-Path -LiteralPath $clientPath)) {
    throw "Tunnel client not found: $clientPath"
}

$statusJson = & $clientPath runtimes status chatgpt-machine --json

if ($LASTEXITCODE -ne 0) {
    throw "tunnel-client status failed with exit code $LASTEXITCODE"
}

$status = $statusJson | ConvertFrom-Json

[pscustomobject]@{
    alias           = $status.alias
    process_running = $status.process_running
    healthy         = $status.healthy
    ready           = $status.ready
    runtime_state   = $status.runtime_state
    pid             = $status.process.pid
    ui_url          = $status.ui_url
}
