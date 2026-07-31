[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PayloadPath,
    [switch]$Elevated,
    [switch]$DryRun,
    [string]$TargetUserProfile,
    [string]$TargetAppData,
    [string]$TargetLocalAppData,
    [string]$TargetUserSid
)

$ErrorActionPreference = "Stop"
$productName = "After Effects MCP Extended"
$productVersion = "unknown"
$publisher = "NickPittas"
$extensionId = "com.nickpittas.aftereffectsmcpextended"
$logPath = Join-Path $env:TEMP "AfterEffectsMCP-Setup.log"

Add-Type -AssemblyName System.Windows.Forms

function Show-SetupMessage {
    param([string]$Message, [string]$Title = $productName, [System.Windows.Forms.MessageBoxIcon]$Icon = [System.Windows.Forms.MessageBoxIcon]::Information)
    [System.Windows.Forms.MessageBox]::Show($Message, $Title, [System.Windows.Forms.MessageBoxButtons]::OK, $Icon) | Out-Null
}

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Start-ElevatedInstaller {
    $escapedScript = $PSCommandPath.Replace("'", "''")
    $escapedPayload = (Resolve-Path -LiteralPath $PayloadPath).Path.Replace("'", "''")
    $escapedUserProfile = $env:USERPROFILE.Replace("'", "''")
    $escapedAppData = $env:APPDATA.Replace("'", "''")
    $escapedLocalAppData = $env:LOCALAPPDATA.Replace("'", "''")
    $escapedUserSid = ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value).Replace("'", "''")
    $command = "& '$escapedScript' -PayloadPath '$escapedPayload' -Elevated -TargetUserProfile '$escapedUserProfile' -TargetAppData '$escapedAppData' -TargetLocalAppData '$escapedLocalAppData' -TargetUserSid '$escapedUserSid'"
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    try {
        $process = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
            -Verb RunAs -WindowStyle Hidden -Wait -PassThru `
            -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-EncodedCommand", $encoded
        exit $process.ExitCode
    } catch {
        Show-SetupMessage "Installation was cancelled or administrator permission was not granted." $productName ([System.Windows.Forms.MessageBoxIcon]::Warning)
        exit 1
    }
}

function Resolve-AeSupportFolder {
    param([string]$Candidate)
    if (-not $Candidate) { return $null }
    $expanded = [Environment]::ExpandEnvironmentVariables($Candidate.Trim('"'))
    $directScripts = Join-Path $expanded "Scripts"
    if (Test-Path -LiteralPath $directScripts) { return [IO.Path]::GetFullPath($expanded).TrimEnd('\') }
    $support = Join-Path $expanded "Support Files"
    if (Test-Path -LiteralPath (Join-Path $support "Scripts")) { return [IO.Path]::GetFullPath($support).TrimEnd('\') }
    return $null
}

function Find-AfterEffectsSupportFolders {
    $found = New-Object System.Collections.Generic.List[string]
    $programFiles = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
    $adobeRoot = Join-Path $programFiles "Adobe"
    if (Test-Path -LiteralPath $adobeRoot) {
        Get-ChildItem -LiteralPath $adobeRoot -Directory -Filter "Adobe After Effects *" -ErrorAction SilentlyContinue | ForEach-Object {
            $resolved = Resolve-AeSupportFolder $_.FullName
            if ($resolved -and -not $found.Contains($resolved)) { $found.Add($resolved) }
        }
    }

    $registryRoots = @(
        "HKLM:\SOFTWARE\Adobe\After Effects",
        "HKLM:\SOFTWARE\WOW6432Node\Adobe\After Effects"
    )
    foreach ($registryRoot in $registryRoots) {
        if (-not (Test-Path $registryRoot)) { continue }
        Get-ChildItem $registryRoot -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
            $values = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
            foreach ($propertyName in @("InstallPath", "ApplicationPath")) {
                $resolved = Resolve-AeSupportFolder $values.$propertyName
                if ($resolved -and -not $found.Contains($resolved)) { $found.Add($resolved) }
            }
        }
    }
    return @($found)
}

function Find-CodexExecutable {
    $candidates = New-Object System.Collections.Generic.List[string]
    foreach ($candidate in @(
        (Join-Path $env:LOCALAPPDATA "Programs\OpenAI\Codex\bin\codex.exe"),
        (Join-Path $env:LOCALAPPDATA "OpenAI\Codex\bin\codex.exe"),
        (Join-Path $env:USERPROFILE ".local\bin\codex.exe"),
        (Join-Path $env:APPDATA "npm\codex.cmd")
    )) {
        if ($candidate -and -not $candidates.Contains($candidate)) { $candidates.Add($candidate) }
    }
    Get-Command codex -All -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.Source -and -not $candidates.Contains($_.Source)) { $candidates.Add($_.Source) }
    }
    foreach ($candidate in $candidates) {
        if (-not (Test-Path -LiteralPath $candidate)) { continue }
        try {
            & $candidate --version *> $null
            if ($LASTEXITCODE -eq 0) { return $candidate }
        } catch {}
    }
    return $null
}

function Stop-ChatCompanion {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath.EndsWith("after-effects-codex-chat.exe", [StringComparison]::OrdinalIgnoreCase)
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

if (-not (Test-Path -LiteralPath $PayloadPath)) {
    Show-SetupMessage "The installer payload is missing. Download the setup file again." $productName ([System.Windows.Forms.MessageBoxIcon]::Error)
    exit 2
}
if (-not $DryRun -and -not (Test-Administrator)) { Start-ElevatedInstaller }

# Over-the-shoulder UAC can run the elevated half under a different admin
# account. Keep every per-user file and registry write bound to the user who
# launched setup, while using elevation only for AE's Program Files folders.
if ($Elevated -and $TargetUserProfile -and $TargetAppData -and $TargetLocalAppData) {
    $env:USERPROFILE = $TargetUserProfile
    $env:HOME = $TargetUserProfile
    $env:APPDATA = $TargetAppData
    $env:LOCALAPPDATA = $TargetLocalAppData
}
$userRegistryRoot = if ($Elevated -and $TargetUserSid) { "Registry::HKEY_USERS\$TargetUserSid" } else { "HKCU:" }

$workRoot = Join-Path $env:TEMP ("AfterEffectsMCP-Install-" + [Guid]::NewGuid().ToString("N"))
try {
    "[$(Get-Date -Format o)] Starting $productName setup" | Set-Content -LiteralPath $logPath -Encoding UTF8
    New-Item -ItemType Directory -Path $workRoot -Force | Out-Null
    Expand-Archive -LiteralPath $PayloadPath -DestinationPath $workRoot -Force

    $manifestPath = Join-Path $workRoot "manifest.json"
    if (-not (Test-Path -LiteralPath $manifestPath)) { throw "Installer version manifest is missing." }
    $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
    $productVersion = [string]$manifest.version
    if (-not $productVersion) { throw "Installer version manifest is invalid." }
    "[$(Get-Date -Format o)] Payload version $productVersion" | Add-Content -LiteralPath $logPath -Encoding UTF8

    $payloadApp = Join-Path $workRoot "app"
    $payloadCep = Join-Path $workRoot "cep"
    $payloadBridge = Join-Path $workRoot "bridge\mcp-bridge-auto.jsx"
    $payloadSupport = Join-Path $workRoot "support"
    foreach ($required in @(
        (Join-Path $payloadApp "after-effects-mcp-extended.exe"),
        (Join-Path $payloadApp "after-effects-codex-chat.exe"),
        (Join-Path $payloadApp "pi-after-effects-extension.ts"),
        (Join-Path $payloadApp "launch-chat.vbs"),
        (Join-Path $payloadCep "CSXS\manifest.xml"),
        $payloadBridge,
        (Join-Path $payloadSupport "uninstall.ps1"),
        (Join-Path $payloadSupport "uninstall.vbs"),
        $manifestPath
    )) {
        if (-not (Test-Path -LiteralPath $required)) { throw "Installer payload is incomplete: $required" }
    }

    $aeFolders = Find-AfterEffectsSupportFolders
    if (-not $aeFolders -or $aeFolders.Count -eq 0) {
        throw "Adobe After Effects was not found. Install After Effects and run this setup again."
    }

    if ($DryRun) {
        $dryRunCodex = Find-CodexExecutable
        [ordered]@{
            valid = $true
            product = $productName
            version = $productVersion
            afterEffectsFolders = @($aeFolders)
            codexExecutable = $dryRunCodex
            appTarget = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)) "AfterEffectsMCP"
            cepTarget = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)) "Adobe\CEP\extensions\$extensionId"
        } | ConvertTo-Json -Depth 4
        exit 0
    }

    Stop-ChatCompanion
    Start-Sleep -Milliseconds 300

    $appData = [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
    $appFolder = Join-Path $appData "AfterEffectsMCP"
    $cepFolder = Join-Path $appData "Adobe\CEP\extensions\$extensionId"
    foreach ($target in @($appFolder, $cepFolder)) {
        if (-not (Test-Path -LiteralPath $target)) { continue }
        $resolvedTarget = [IO.Path]::GetFullPath($target)
        $resolvedAppData = [IO.Path]::GetFullPath($appData).TrimEnd('\') + '\'
        if (-not $resolvedTarget.StartsWith($resolvedAppData, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to replace an unexpected installation directory: $resolvedTarget"
        }
        Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
    }
    New-Item -ItemType Directory -Path $appFolder -Force | Out-Null
    New-Item -ItemType Directory -Path $cepFolder -Force | Out-Null

    Copy-Item -Path (Join-Path $payloadApp "*") -Destination $appFolder -Recurse -Force
    Copy-Item -Path (Join-Path $payloadCep "*") -Destination $cepFolder -Recurse -Force
    $cepBin = Join-Path $cepFolder "bin"
    New-Item -ItemType Directory -Path $cepBin -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $payloadApp "after-effects-codex-chat.exe") -Destination (Join-Path $cepBin "after-effects-codex-chat.exe") -Force
    Copy-Item -LiteralPath (Join-Path $payloadSupport "uninstall.ps1") -Destination (Join-Path $appFolder "uninstall.ps1") -Force
    Copy-Item -LiteralPath (Join-Path $payloadSupport "uninstall.vbs") -Destination (Join-Path $appFolder "uninstall.vbs") -Force

    $bridgePaths = New-Object System.Collections.Generic.List[string]
    foreach ($aeFolder in $aeFolders) {
        $panelFolder = Join-Path $aeFolder "Scripts\ScriptUI Panels"
        New-Item -ItemType Directory -Path $panelFolder -Force | Out-Null
        $panelTarget = Join-Path $panelFolder "mcp-bridge-auto.jsx"
        Copy-Item -LiteralPath $payloadBridge -Destination $panelTarget -Force
        $bridgePaths.Add($panelTarget)
    }

    foreach ($csxsVersion in 9..12) {
        $key = "$userRegistryRoot\Software\Adobe\CSXS.$csxsVersion"
        New-Item -Path $key -Force | Out-Null
        New-ItemProperty -Path $key -Name "PlayerDebugMode" -Value "1" -PropertyType String -Force | Out-Null
    }

    $mcpTarget = Join-Path $appFolder "after-effects-mcp-extended.exe"
    $codex = Find-CodexExecutable
    $codexRegistered = $false
    if ($codex) {
        & $codex mcp get AfterEffectsMCP *> $null
        if ($LASTEXITCODE -eq 0) { & $codex mcp remove AfterEffectsMCP *> $null }
        & $codex mcp add AfterEffectsMCP -- $mcpTarget *> $null
        $codexRegistered = $LASTEXITCODE -eq 0
    }

    $state = [ordered]@{
        product = $productName
        version = $productVersion
        installedAt = (Get-Date).ToString("o")
        appFolder = $appFolder
        cepFolder = $cepFolder
        bridgePaths = @($bridgePaths)
        codexRegistered = $codexRegistered
    }
    $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $appFolder "install-state.json") -Encoding UTF8

    $uninstallKey = "$userRegistryRoot\Software\Microsoft\Windows\CurrentVersion\Uninstall\AfterEffectsMCPExtended"
    New-Item -Path $uninstallKey -Force | Out-Null
    New-ItemProperty -Path $uninstallKey -Name "DisplayName" -Value $productName -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $uninstallKey -Name "DisplayVersion" -Value $productVersion -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $uninstallKey -Name "Publisher" -Value $publisher -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $uninstallKey -Name "InstallLocation" -Value $appFolder -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $uninstallKey -Name "UninstallString" -Value ("wscript.exe `"" + (Join-Path $appFolder "uninstall.vbs") + "`"") -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $uninstallKey -Name "NoModify" -Value 1 -PropertyType DWord -Force | Out-Null
    New-ItemProperty -Path $uninstallKey -Name "NoRepair" -Value 1 -PropertyType DWord -Force | Out-Null

    $installedVersions = $aeFolders | ForEach-Object {
        if ($_ -match "Adobe After Effects ([^\\]+)") { $Matches[1] } else { $_ }
    }
    $codexLine = if ($codexRegistered) { "Codex MCP registration: complete." } elseif ($codex) { "Codex was found, but MCP registration needs to be retried from the chat panel." } else { "Codex CLI is not installed yet; the AE chat panel can install it for you." }
    $runningLine = if (Get-Process AfterFX -ErrorAction SilentlyContinue) { "`nAfter Effects is open and must be restarted." } else { "" }
    Show-SetupMessage ("Installation complete.`n`nAfter Effects: " + ($installedVersions -join ", ") + "`n" + $codexLine + $runningLine + "`n`nIn After Effects open:`n1. Window > mcp-bridge-auto.jsx`n2. Window > Extensions > After Effects MCP Chat`n`nAlso enable Preferences > Scripting & Expressions > Allow Scripts to Write Files and Access Network.")
    "[$(Get-Date -Format o)] Installation completed" | Add-Content -LiteralPath $logPath -Encoding UTF8
    exit 0
} catch {
    $message = $_.Exception.Message
    "[$(Get-Date -Format o)] ERROR: $message`n$($_ | Out-String)" | Add-Content -LiteralPath $logPath -Encoding UTF8
    Show-SetupMessage ("Installation failed:`n`n$message`n`nDetails were saved to:`n$logPath") $productName ([System.Windows.Forms.MessageBoxIcon]::Error)
    exit 3
} finally {
    if ($workRoot -and (Test-Path -LiteralPath $workRoot)) {
        $resolvedTemp = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
        $resolvedWork = [IO.Path]::GetFullPath($workRoot)
        if ($resolvedWork.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $resolvedWork -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
