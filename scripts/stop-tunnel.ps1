[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$clientPath = Join-Path $projectRoot 'tools\tunnel-client-v0.0.13\tunnel-client.exe'

if (-not (Test-Path -LiteralPath $clientPath)) {
    throw "Tunnel client not found: $clientPath"
}

& $clientPath runtimes stop chatgpt-machine

if ($LASTEXITCODE -ne 0) {
    throw "tunnel-client stop failed with exit code $LASTEXITCODE"
}
