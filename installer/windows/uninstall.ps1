[CmdletBinding()]
param([switch]$Elevated)

$ErrorActionPreference = "Stop"
$productName = "After Effects MCP Extended"
$extensionId = "com.nickpittas.aftereffectsmcpextended"
$appData = [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
$appFolder = Join-Path $appData "AfterEffectsMCP"
$statePath = Join-Path $appFolder "install-state.json"

Add-Type -AssemblyName System.Windows.Forms

function Show-UninstallMessage {
    param([string]$Message, [System.Windows.Forms.MessageBoxIcon]$Icon = [System.Windows.Forms.MessageBoxIcon]::Information)
    [System.Windows.Forms.MessageBox]::Show($Message, $productName, [System.Windows.Forms.MessageBoxButtons]::OK, $Icon) | Out-Null
}

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Start-ElevatedUninstaller {
    $escapedScript = $PSCommandPath.Replace("'", "''")
    $command = "& '$escapedScript' -Elevated"
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    try {
        $process = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
            -Verb RunAs -WindowStyle Hidden -Wait -PassThru `
            -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-EncodedCommand", $encoded
        exit $process.ExitCode
    } catch {
        Show-UninstallMessage "Uninstall was cancelled or administrator permission was not granted." ([System.Windows.Forms.MessageBoxIcon]::Warning)
        exit 1
    }
}

function Find-CodexExecutable {
    $candidates = @(
        (Get-Command codex.exe -ErrorAction SilentlyContinue).Source,
        (Join-Path $env:LOCALAPPDATA "Programs\OpenAI\Codex\bin\codex.exe"),
        (Join-Path $env:LOCALAPPDATA "OpenAI\Codex\bin\codex.exe"),
        (Join-Path $env:USERPROFILE ".local\bin\codex.exe")
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique
    return $candidates | Select-Object -First 1
}

if (-not (Test-Administrator)) { Start-ElevatedUninstaller }

try {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath.EndsWith("after-effects-codex-chat.exe", [StringComparison]::OrdinalIgnoreCase)
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

    $state = $null
    if (Test-Path -LiteralPath $statePath) {
        try { $state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json } catch {}
    }
    if ($state -and $state.bridgePaths) {
        foreach ($bridgePath in @($state.bridgePaths)) {
            if ($bridgePath -and [IO.Path]::GetFileName($bridgePath) -eq "mcp-bridge-auto.jsx" -and (Test-Path -LiteralPath $bridgePath)) {
                Remove-Item -LiteralPath $bridgePath -Force
            }
        }
    }

    $cepFolder = if ($state -and $state.cepFolder) { [string]$state.cepFolder } else { Join-Path $appData "Adobe\CEP\extensions\$extensionId" }
    $expectedCepSuffix = "Adobe\CEP\extensions\$extensionId"
    if ($cepFolder.EndsWith($expectedCepSuffix, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $cepFolder)) {
        Remove-Item -LiteralPath $cepFolder -Recurse -Force
    }

    $codex = Find-CodexExecutable
    if ($codex) {
        & $codex mcp get AfterEffectsMCP *> $null
        if ($LASTEXITCODE -eq 0) { & $codex mcp remove AfterEffectsMCP *> $null }
    }

    Remove-Item -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\AfterEffectsMCPExtended" -Recurse -Force -ErrorAction SilentlyContinue

    # Chat transcripts and captured frames live in Documents and are preserved.
    if ($appFolder.EndsWith("AfterEffectsMCP", [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $appFolder)) {
        Remove-Item -LiteralPath $appFolder -Recurse -Force
    }

    Show-UninstallMessage "After Effects MCP Extended was removed.`n`nYour chat history and captured frames in Documents were preserved. Restart After Effects if it is open."
    exit 0
} catch {
    Show-UninstallMessage ("Uninstall failed:`n`n" + $_.Exception.Message) ([System.Windows.Forms.MessageBoxIcon]::Error)
    exit 2
}
