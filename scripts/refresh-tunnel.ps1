[CmdletBinding()]
param(
    [switch]$Worker
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$keyPath = Join-Path $projectRoot '.tunnel\control-plane-api-key.dpapi'
$logPath = Join-Path $projectRoot '.tunnel\refresh-tunnel.log'
$startScript = Join-Path $PSScriptRoot 'start-tunnel.ps1'
$stopScript = Join-Path $PSScriptRoot 'stop-tunnel.ps1'
$statusScript = Join-Path $PSScriptRoot 'status-tunnel.ps1'

function Write-RefreshLog {
    param([string]$Message)
    $timestamp = (Get-Date).ToString('o')
    Add-Content -LiteralPath $logPath -Value "$timestamp $Message" -Encoding UTF8
}

if ($Worker) {
    try {
        Write-RefreshLog 'worker started'
        Start-Sleep -Seconds 2

        try {
            $stopOutput = (& $stopScript 2>&1 | Out-String).Trim()
            if ($stopOutput) { Write-RefreshLog "stop: $stopOutput" }
        }
        catch {
            Write-RefreshLog "stop warning: $($_.Exception.Message)"
        }

        Start-Sleep -Seconds 1
        $startOutput = (& $startScript 2>&1 | Out-String).Trim()
        if ($startOutput) { Write-RefreshLog "start: $startOutput" }

        Start-Sleep -Seconds 1
        $statusOutput = (& $statusScript 2>&1 | Out-String).Trim()
        if ($statusOutput) { Write-RefreshLog "status: $statusOutput" }
        Write-RefreshLog 'worker completed'
        exit 0
    }
    catch {
        Write-RefreshLog "worker failed: $($_.Exception.Message)"
        exit 1
    }
    finally {
        Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue
    }
}

if (-not (Test-Path -LiteralPath $keyPath)) {
    throw "DPAPI runtime key not found: $keyPath"
}

$secureKey = $null
$runtimeKey = $env:CONTROL_PLANE_API_KEY

try {
    if ([string]::IsNullOrWhiteSpace($runtimeKey)) {
        $env:MCP_RUNTIME_KEY_PATH = $keyPath
        $decoder = (Get-Command pwsh.exe -ErrorAction SilentlyContinue).Source
        if ([string]::IsNullOrWhiteSpace($decoder)) { $decoder = 'powershell.exe' }
        $runtimeKey = (& $decoder -NoLogo -NoProfile -NonInteractive -Command '$cipherText = Get-Content -LiteralPath $env:MCP_RUNTIME_KEY_PATH -Raw; $secureKey = ConvertTo-SecureString $cipherText; [Net.NetworkCredential]::new('''' , $secureKey).Password').Trim()
    }

    if ([string]::IsNullOrWhiteSpace($runtimeKey) -or -not $runtimeKey.StartsWith('sk-')) {
        throw 'The DPAPI file did not decrypt to a valid runtime API key.'
    }

    $env:CONTROL_PLANE_API_KEY = $runtimeKey
    Set-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) refresh scheduled" -Encoding UTF8

    $workerArgs = @(
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        $PSCommandPath,
        '-Worker'
    )
    $process = Start-Process powershell.exe -ArgumentList $workerArgs -WindowStyle Hidden -PassThru

    [pscustomobject]@{
        scheduled = $true
        worker_pid = $process.Id
        log = $logPath
        note = 'The current tunnel will restart after this command returns.'
    }
}
finally {
    Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:MCP_RUNTIME_KEY_PATH -ErrorAction SilentlyContinue
    $decoder = $null
    $runtimeKey = $null
    if ($null -ne $secureKey) {
        $secureKey.Dispose()
    }
}
