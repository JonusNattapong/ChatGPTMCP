[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$clientPath = Join-Path $projectRoot 'tools\tunnel-client-v0.0.13\tunnel-client.exe'
$keyPath = Join-Path $projectRoot '.tunnel\control-plane-api-key.dpapi'
$profileDir = Join-Path $env:APPDATA 'tunnel-client'
$mcpCommand = 'node D:/Projects/Github/ChatGPTMCP/dist/index.js --root D:/Projects/Github --dangerously-open-machine --enable-browser'

if (-not (Test-Path -LiteralPath $clientPath)) {
    throw "Tunnel client not found: $clientPath"
}

if (-not (Test-Path -LiteralPath $keyPath)) {
    throw "DPAPI runtime key not found: $keyPath"
}

$secureKey = $null
$runtimeKey = $null

try {
    $cipherText = Get-Content -LiteralPath $keyPath -Raw
    $secureKey = ConvertTo-SecureString $cipherText
    $runtimeKey = [Net.NetworkCredential]::new('', $secureKey).Password

    if (-not $runtimeKey.StartsWith('sk-')) {
        throw 'The DPAPI file did not decrypt to a valid runtime API key.'
    }

    $env:CONTROL_PLANE_API_KEY = $runtimeKey

    & $clientPath runtimes connect `
        --alias chatgpt-machine `
        --admin-profile default `
        --profile chatgpt-machine-runtime `
        --profile-dir $profileDir `
        --tunnel-id tunnel_6a91bbd0be488191912a5abe9f80a711 `
        --organization-id org-Ku85qrWdADBgvNx2WZyjju4O `
        --runtime-api-key env:CONTROL_PLANE_API_KEY `
        --mcp-command $mcpCommand

    if ($LASTEXITCODE -ne 0) {
        throw "tunnel-client connect failed with exit code $LASTEXITCODE"
    }

    & (Join-Path $PSScriptRoot 'status-tunnel.ps1')
}
finally {
    Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue
    $runtimeKey = $null
    if ($null -ne $secureKey) {
        $secureKey.Dispose()
    }
}
