param()

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$cepSource = Join-Path $repoRoot "cep"
$chatBinary = Join-Path $repoRoot "dist\after-effects-codex-chat.exe"
$mcpBinary = Join-Path $repoRoot "dist\after-effects-mcp-extended.exe"
$piExtensionSource = Join-Path $repoRoot "assets\pi-after-effects-extension.ts"
$chatLauncher = Join-Path $cepSource "bin\launch-chat.vbs"
$extensionId = "com.nickpittas.aftereffectsmcpextended"
$extensionRoot = Join-Path $env:APPDATA "Adobe\CEP\extensions\$extensionId"
$sharedCompanionRoot = Join-Path $env:APPDATA "AfterEffectsMCP"

if (-not (Test-Path -LiteralPath (Join-Path $cepSource "CSXS\manifest.xml"))) {
    throw "CEP manifest is missing."
}
if (-not (Test-Path -LiteralPath $chatBinary)) {
    throw "Standalone CLI chat companion is missing. Run npm run build:standalone first."
}
if (-not (Test-Path -LiteralPath $chatLauncher)) {
    throw "Hidden CLI chat launcher is missing."
}
if (-not (Test-Path -LiteralPath $mcpBinary)) {
    throw "Standalone MCP server is missing. Run npm run build:standalone first."
}
if (-not (Test-Path -LiteralPath $piExtensionSource)) {
    throw "Pi After Effects adapter is missing."
}

# Stop only the companion being replaced. Its single-instance lock is shared
# by the ScriptUI and CEP launchers, so the updated binary will take over.
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

if (Test-Path -LiteralPath $extensionRoot) {
    $expectedCepParent = [IO.Path]::GetFullPath((Join-Path $env:APPDATA "Adobe\CEP\extensions")).TrimEnd('\') + '\'
    $resolvedExtension = [IO.Path]::GetFullPath($extensionRoot)
    if (-not $resolvedExtension.StartsWith($expectedCepParent, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to replace an unexpected CEP directory: $resolvedExtension"
    }
    Remove-Item -LiteralPath $resolvedExtension -Recurse -Force
}
New-Item -ItemType Directory -Path $extensionRoot -Force | Out-Null
Copy-Item -Path (Join-Path $cepSource "*") -Destination $extensionRoot -Recurse -Force

$binFolder = Join-Path $extensionRoot "bin"
New-Item -ItemType Directory -Path $binFolder -Force | Out-Null
Copy-Item -LiteralPath $chatBinary -Destination (Join-Path $binFolder "after-effects-codex-chat.exe") -Force
Copy-Item -LiteralPath $mcpBinary -Destination (Join-Path $binFolder "after-effects-mcp-extended.exe") -Force
New-Item -ItemType Directory -Path $sharedCompanionRoot -Force | Out-Null
Copy-Item -LiteralPath $chatBinary -Destination (Join-Path $sharedCompanionRoot "after-effects-codex-chat.exe") -Force
Copy-Item -LiteralPath $mcpBinary -Destination (Join-Path $sharedCompanionRoot "after-effects-mcp-extended.exe") -Force
Copy-Item -LiteralPath $piExtensionSource -Destination (Join-Path $sharedCompanionRoot "pi-after-effects-extension.ts") -Force
Copy-Item -LiteralPath $chatLauncher -Destination (Join-Path $sharedCompanionRoot "launch-chat.vbs") -Force

# AE 2026 uses CEP/CSXS 12. Setting debug mode permits this local unsigned
# development extension. Older keys are included for adjacent AE versions.
foreach ($version in 9..12) {
    $key = "HKCU:\Software\Adobe\CSXS.$version"
    New-Item -Path $key -Force | Out-Null
    New-ItemProperty -Path $key -Name "PlayerDebugMode" -Value "1" -PropertyType String -Force | Out-Null
}

$manifestTarget = Join-Path $extensionRoot "CSXS\manifest.xml"
$binaryTarget = Join-Path $binFolder "after-effects-codex-chat.exe"
$mcpTarget = Join-Path $binFolder "after-effects-mcp-extended.exe"
$sharedBinaryTarget = Join-Path $sharedCompanionRoot "after-effects-codex-chat.exe"
$sharedMcpTarget = Join-Path $sharedCompanionRoot "after-effects-mcp-extended.exe"
$sharedLauncherTarget = Join-Path $sharedCompanionRoot "launch-chat.vbs"
if (-not (Test-Path -LiteralPath $manifestTarget) -or -not (Test-Path -LiteralPath $binaryTarget) -or -not (Test-Path -LiteralPath $mcpTarget) -or -not (Test-Path -LiteralPath $sharedBinaryTarget) -or -not (Test-Path -LiteralPath $sharedMcpTarget) -or -not (Test-Path -LiteralPath $sharedLauncherTarget)) {
    throw "CEP extension verification failed."
}

Write-Host "After Effects MCP Chat CEP extension installed successfully."
Write-Host "Open or reload Window > Extensions > After Effects MCP Chat."
Write-Host "The CEP panel will start its companion in the correct After Effects desktop context."
