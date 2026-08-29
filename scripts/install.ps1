[CmdletBinding()]
param(
  [string]$Root = "D:/Projects/Github/ChatGPTMCP",
  [switch]$NoLink
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js 20+ is required. Install from https://nodejs.org" }
$nodeVersion = (node --version).TrimStart('v')
if ([version]$nodeVersion -lt [version]"20.0.0") { throw "Node.js 20+ required, found v$nodeVersion" }
if (-not (Test-Path $Root)) { throw "Root not found: $Root" }
Set-Location $Root
Write-Host "Installing chatgpt-machine-mcp v1.0.0..."
npm install
npm run build
npm test
if (-not $NoLink) {
  npm link
  Write-Host "Linked: chatgpt-local (try: chatgpt-local --help)"
}
Write-Host "Done. Next: chatgpt-local setup && chatgpt-local up"
