param(
    [string]$AfterEffectsVersion = "2026"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$panelSource = Join-Path $repoRoot "build\scripts\mcp-bridge-auto.jsx"
$mcpSource = Join-Path $repoRoot "dist\after-effects-mcp-extended.exe"
$chatSource = Join-Path $repoRoot "dist\after-effects-codex-chat.exe"
$cepSource = Join-Path $repoRoot "cep"
$cepManifest = Join-Path $cepSource "CSXS\manifest.xml"
$chatLauncher = Join-Path $cepSource "bin\launch-chat.vbs"

foreach ($requiredFile in @($panelSource, $mcpSource, $chatSource, $cepManifest, $chatLauncher)) {
    if (-not (Test-Path -LiteralPath $requiredFile)) {
        throw "Missing release file: $requiredFile"
    }
}

# Stop only the chat companion being replaced. Both the ScriptUI bridge and
# the CEP panel use this same background process and single-instance lock.
$companions = Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.EndsWith("after-effects-codex-chat.exe", [System.StringComparison]::OrdinalIgnoreCase)
}
$companions | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $remaining = Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath.EndsWith("after-effects-codex-chat.exe", [System.StringComparison]::OrdinalIgnoreCase)
    }
    if (-not $remaining) { break }
    Start-Sleep -Milliseconds 150
}
$hostLock = Join-Path $env:USERPROFILE "Documents\ae-mcp-bridge\codex-chat\host.lock"
$remainingCompanion = Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.EndsWith("after-effects-codex-chat.exe", [System.StringComparison]::OrdinalIgnoreCase)
}
if (-not $remainingCompanion -and (Test-Path -LiteralPath $hostLock)) {
    Remove-Item -LiteralPath $hostLock -Force
}

$appFolder = Join-Path $env:APPDATA "AfterEffectsMCP"
New-Item -ItemType Directory -Path $appFolder -Force | Out-Null
Copy-Item -LiteralPath $mcpSource -Destination (Join-Path $appFolder "after-effects-mcp-extended.exe") -Force
Copy-Item -LiteralPath $chatSource -Destination (Join-Path $appFolder "after-effects-codex-chat.exe") -Force
Copy-Item -LiteralPath $chatLauncher -Destination (Join-Path $appFolder "launch-chat.vbs") -Force

$extensionId = "com.nickpittas.aftereffectsmcpextended"
$extensionRoot = Join-Path $env:APPDATA "Adobe\CEP\extensions\$extensionId"
New-Item -ItemType Directory -Path $extensionRoot -Force | Out-Null
Copy-Item -Path (Join-Path $cepSource "*") -Destination $extensionRoot -Recurse -Force

$extensionBin = Join-Path $extensionRoot "bin"
New-Item -ItemType Directory -Path $extensionBin -Force | Out-Null
$extensionChat = Join-Path $extensionBin "after-effects-codex-chat.exe"
Copy-Item -LiteralPath $chatSource -Destination $extensionChat -Force

# AE 2026 uses CEP/CSXS 12. These adjacent versions make the local unsigned
# panel available to nearby supported After Effects releases as well.
foreach ($version in 9..12) {
    $key = "HKCU:\Software\Adobe\CSXS.$version"
    New-Item -Path $key -Force | Out-Null
    New-ItemProperty -Path $key -Name "PlayerDebugMode" -Value "1" -PropertyType String -Force | Out-Null
}

$aeFolder = "C:\Program Files\Adobe\Adobe After Effects $AfterEffectsVersion\Support Files\Scripts\ScriptUI Panels"
if (-not (Test-Path -LiteralPath $aeFolder)) {
    throw "After Effects $AfterEffectsVersion was not found at: $aeFolder"
}

$panelTarget = Join-Path $aeFolder "mcp-bridge-auto.jsx"
$copyScript = "Copy-Item -LiteralPath '$($panelSource.Replace("'", "''"))' -Destination '$($panelTarget.Replace("'", "''"))' -Force"
$encodedCopy = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($copyScript))
$elevated = Start-Process -FilePath "powershell.exe" -Verb RunAs -Wait -PassThru -ArgumentList "-NoProfile", "-EncodedCommand", $encodedCopy
if ($elevated.ExitCode -ne 0) {
    throw "After Effects panel installation failed with exit code $($elevated.ExitCode)."
}

$installedManifest = Join-Path $extensionRoot "CSXS\manifest.xml"
if (-not (Test-Path -LiteralPath $installedManifest) -or -not (Test-Path -LiteralPath $extensionChat)) {
    throw "CEP extension verification failed."
}

Write-Host "After Effects MCP Extended installed successfully."
Write-Host "Restart After Effects."
Write-Host "Open Window > mcp-bridge-auto.jsx for the bridge."
Write-Host "Open Window > Extensions > After Effects MCP Chat for the dockable chat."
Write-Host "The CEP panel starts its companion in the correct After Effects desktop context."
Write-Host "The chat panel can install Codex CLI without Node.js or npm."
