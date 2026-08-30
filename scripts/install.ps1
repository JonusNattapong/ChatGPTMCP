[CmdletBinding()]
param(
  [string]$Root,
  [switch]$NoLink
)
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = Split-Path -Parent $PSScriptRoot }
$Root = [IO.Path]::GetFullPath($Root)
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 20+ is required.' }
$nodeVersion = (node --version).TrimStart('v')
if ([version]$nodeVersion -lt [version]'20.0.0') { throw "Node.js 20+ required, found v$nodeVersion" }
if (-not (Test-Path -LiteralPath $Root -PathType Container)) { throw "Root not found: $Root" }
Set-Location -LiteralPath $Root
Write-Host 'Installing chatgpt-machine-mcp v1.0.0...'
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
npm test
if ($LASTEXITCODE -ne 0) { throw "npm test failed with exit code $LASTEXITCODE" }
if (-not $NoLink) {
  npm link
  if ($LASTEXITCODE -ne 0) { throw "npm link failed with exit code $LASTEXITCODE" }
  Write-Host 'Linked: chatgpt-local (try: chatgpt-local --help)'
}
Write-Host 'Done. Next: chatgpt-local setup && chatgpt-local up'
