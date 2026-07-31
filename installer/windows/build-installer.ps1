[CmdletBinding()]
param(
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$installerRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $installerRoot)
$package = Get-Content -Raw -LiteralPath (Join-Path $repoRoot "package.json") | ConvertFrom-Json
$version = [string]$package.version
$iexpress = Join-Path $env:SystemRoot "System32\iexpress.exe"
$stageRoot = Join-Path $installerRoot ".stage"
$payloadRoot = Join-Path $stageRoot "payload"
$releaseRoot = Join-Path $repoRoot "release"
$outputPath = Join-Path $releaseRoot "AfterEffectsMCP-Extended-Setup-$version.exe"

if (-not (Test-Path -LiteralPath $iexpress)) {
    throw "Windows IExpress was not found at $iexpress"
}

if (-not $SkipBuild) {
    Push-Location $repoRoot
    try {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build failed." }
        & npm.cmd run build:standalone
        if ($LASTEXITCODE -ne 0) { throw "npm run build:standalone failed." }
    } finally {
        Pop-Location
    }
}

$requiredFiles = @(
    (Join-Path $repoRoot "dist\after-effects-mcp-extended.exe"),
    (Join-Path $repoRoot "dist\after-effects-codex-chat.exe"),
    (Join-Path $repoRoot "assets\pi-after-effects-extension.ts"),
    (Join-Path $repoRoot "build\scripts\mcp-bridge-auto.jsx"),
    (Join-Path $repoRoot "cep\CSXS\manifest.xml"),
    (Join-Path $repoRoot "cep\bin\launch-chat.vbs")
)
foreach ($required in $requiredFiles) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Missing installer input: $required" }
}

if (Test-Path -LiteralPath $stageRoot) {
    $resolvedStage = [IO.Path]::GetFullPath($stageRoot)
    $resolvedInstaller = [IO.Path]::GetFullPath($installerRoot).TrimEnd('\') + '\'
    if (-not $resolvedStage.StartsWith($resolvedInstaller, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clear an unexpected staging directory: $resolvedStage"
    }
    Remove-Item -LiteralPath $resolvedStage -Recurse -Force
}

New-Item -ItemType Directory -Path (Join-Path $payloadRoot "app") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $payloadRoot "bridge") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $payloadRoot "support") -Force | Out-Null
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null

Copy-Item -LiteralPath (Join-Path $repoRoot "dist\after-effects-mcp-extended.exe") -Destination (Join-Path $payloadRoot "app\after-effects-mcp-extended.exe") -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "dist\after-effects-codex-chat.exe") -Destination (Join-Path $payloadRoot "app\after-effects-codex-chat.exe") -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "assets\pi-after-effects-extension.ts") -Destination (Join-Path $payloadRoot "app\pi-after-effects-extension.ts") -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "cep\bin\launch-chat.vbs") -Destination (Join-Path $payloadRoot "app\launch-chat.vbs") -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "build\scripts\mcp-bridge-auto.jsx") -Destination (Join-Path $payloadRoot "bridge\mcp-bridge-auto.jsx") -Force
Copy-Item -Path (Join-Path $repoRoot "cep") -Destination $payloadRoot -Recurse -Force
Copy-Item -LiteralPath (Join-Path $installerRoot "uninstall.ps1") -Destination (Join-Path $payloadRoot "support\uninstall.ps1") -Force
Copy-Item -LiteralPath (Join-Path $installerRoot "uninstall.vbs") -Destination (Join-Path $payloadRoot "support\uninstall.vbs") -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "LICENSE") -Destination (Join-Path $payloadRoot "LICENSE") -Force
[ordered]@{ product = "After Effects MCP Extended"; version = $version } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $payloadRoot "manifest.json") -Encoding UTF8

Copy-Item -LiteralPath (Join-Path $installerRoot "setup.vbs") -Destination (Join-Path $stageRoot "setup.vbs") -Force
Copy-Item -LiteralPath (Join-Path $installerRoot "install.ps1") -Destination (Join-Path $stageRoot "install.ps1") -Force
Compress-Archive -Path (Join-Path $payloadRoot "*") -DestinationPath (Join-Path $stageRoot "payload.zip") -CompressionLevel Optimal -Force

$stageForSed = $stageRoot.TrimEnd('\') + '\'
$sedPath = Join-Path $stageRoot "package.sed"
$sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3

[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=%InstallPrompt%
DisplayLicense=
FinishMessage=%FinishMessage%
TargetName=%TargetName%
FriendlyName=%FriendlyName%
AppLaunched=%AppLaunched%
PostInstallCmd=<None>
AdminQuietInstCmd=%AppLaunched%
UserQuietInstCmd=%AppLaunched%
SourceFiles=SourceFiles

[Strings]
InstallPrompt=
FinishMessage=
TargetName=$outputPath
FriendlyName=After Effects MCP Extended $version Setup
AppLaunched=wscript.exe setup.vbs
FILE0=setup.vbs
FILE1=install.ps1
FILE2=payload.zip

[SourceFiles]
SourceFiles0=$stageForSed

[SourceFiles0]
%FILE0%=
%FILE1%=
%FILE2%=
"@
$sed | Set-Content -LiteralPath $sedPath -Encoding ASCII

if (Test-Path -LiteralPath $outputPath) { Remove-Item -LiteralPath $outputPath -Force }
& $iexpress /N /Q $sedPath
$iexpressExitCode = $LASTEXITCODE
$deadline = (Get-Date).AddMinutes(3)
$lastOutputSize = -1L
$stableOutputChecks = 0
do {
    if (Test-Path -LiteralPath $outputPath) {
        $currentOutputSize = (Get-Item -LiteralPath $outputPath).Length
        if ($currentOutputSize -gt 1024 -and $currentOutputSize -eq $lastOutputSize) { $stableOutputChecks++ }
        else { $stableOutputChecks = 0; $lastOutputSize = $currentOutputSize }
        if ($stableOutputChecks -ge 2) { break }
    }
    Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $deadline)

if (-not (Test-Path -LiteralPath $outputPath) -or (Get-Item -LiteralPath $outputPath).Length -lt 1024 -or $stableOutputChecks -lt 2) {
    throw "IExpress failed to create the Windows installer (exit code $iexpressExitCode)."
}

$hash = Get-FileHash -LiteralPath $outputPath -Algorithm SHA256
"$($hash.Hash.ToLowerInvariant())  $([IO.Path]::GetFileName($outputPath))" | Set-Content -LiteralPath "$outputPath.sha256" -Encoding ASCII

$result = [ordered]@{
    version = $version
    installer = $outputPath
    bytes = (Get-Item -LiteralPath $outputPath).Length
    sha256 = $hash.Hash.ToLowerInvariant()
}
$result | ConvertTo-Json
