[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$clientPath = Join-Path $projectRoot 'tools\tunnel-client-v0.0.13\tunnel-client.exe'
$keyPath = Join-Path $projectRoot '.tunnel\control-plane-api-key.dpapi'
$profileDir = Join-Path $env:APPDATA 'tunnel-client'
$workspaceRoot = if ([string]::IsNullOrWhiteSpace($env:MCP_WORKSPACE_ROOT)) { Split-Path -Parent $projectRoot } else { $env:MCP_WORKSPACE_ROOT }
$accessMode = if ([string]::IsNullOrWhiteSpace($env:MCP_ACCESS_MODE)) { 'unrestricted' } else { $env:MCP_ACCESS_MODE }
$policy = if ([string]::IsNullOrWhiteSpace($env:MCP_POLICY)) { 'admin' } else { $env:MCP_POLICY }
$approvalMode = if ([string]::IsNullOrWhiteSpace($env:MCP_APPROVAL_MODE)) { 'mrtr' } else { $env:MCP_APPROVAL_MODE }
$supervisorTimeout = if ([string]::IsNullOrWhiteSpace($env:MCP_SUPERVISOR_TIMEOUT_MS)) { '120000' } else { $env:MCP_SUPERVISOR_TIMEOUT_MS }
$supervisorPath = (Join-Path $projectRoot 'dist\supervisor.js').Replace('\', '/')
$workspaceArg = $workspaceRoot.Replace('\', '/')
$openArg = if ($accessMode -eq 'workspace') { '' } else { ' --dangerously-open-machine' }
$mcpCommand = "node $supervisorPath --supervisor-timeout $supervisorTimeout --root `"$workspaceArg`" --policy $policy --approval-mode $approvalMode$openArg"

if (-not (Test-Path -LiteralPath $clientPath)) {
    throw "Tunnel client not found: $clientPath"
}

if (-not (Test-Path -LiteralPath $keyPath)) {
    throw "DPAPI runtime key not found: $keyPath"
}

$secureKey = $null
$runtimeKey = $env:CONTROL_PLANE_API_KEY

try {
    if ([string]::IsNullOrWhiteSpace($runtimeKey)) {
        $cipherText = Get-Content -LiteralPath $keyPath -Raw
        $secureKey = ConvertTo-SecureString $cipherText
        $runtimeKey = [Net.NetworkCredential]::new('', $secureKey).Password
    }

    if ([string]::IsNullOrWhiteSpace($runtimeKey) -or -not $runtimeKey.StartsWith('sk-')) {
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


