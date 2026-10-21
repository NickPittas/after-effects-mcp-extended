[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$PanelPath,
    [string]$SigningToolPath,
    [string]$CertificatePath,
    [string]$PasswordFile
)
$ErrorActionPreference = 'Stop'
$signingRoot = Join-Path $env:LOCALAPPDATA 'AfterEffectsMCP\signing'
New-Item -ItemType Directory -Path $signingRoot -Force | Out-Null
if (-not $SigningToolPath) { $SigningToolPath = Join-Path $signingRoot 'ZXPSignCmd.exe' }
if (-not (Test-Path -LiteralPath $SigningToolPath)) {
    Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/ZXPSignCMD/4.1.3/x64/ZXPSignCmd.exe' -OutFile $SigningToolPath
}
if (-not $CertificatePath) { $CertificatePath = Join-Path $signingRoot 'panel-signing.p12' }
if (-not $PasswordFile) { $PasswordFile = Join-Path $signingRoot 'panel-signing.password' }
if (-not (Test-Path -LiteralPath $CertificatePath)) {
    $signingPassword = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
    & $SigningToolPath -selfSignedCert GR Attica 'NickPittas' 'After Effects MCP Extended' $signingPassword $CertificatePath -validityDays 3650
    if ($LASTEXITCODE -ne 0) { throw 'Could not create a local CEP signing certificate.' }
    Set-Content -LiteralPath $PasswordFile -Value $signingPassword -NoNewline
} else { $signingPassword = Get-Content -LiteralPath $PasswordFile -Raw }
if (Test-Path -LiteralPath (Join-Path $PanelPath 'META-INF')) { throw 'Sign a clean staged panel after assembling all files, not an existing signed installation.' }
$work = Join-Path $env:TEMP ('AfterEffectsMCP-Sign-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
$zxp = Join-Path $work 'panel.zxp'
& $SigningToolPath -sign $PanelPath $zxp $CertificatePath $signingPassword
if ($LASTEXITCODE -ne 0) { throw 'CEP panel signing failed.' }
& $SigningToolPath -verify $zxp
if ($LASTEXITCODE -ne 0) { throw 'Signed CEP archive verification failed.' }
Copy-Item -LiteralPath $zxp -Destination (Join-Path $work 'panel.zip')
Expand-Archive -LiteralPath (Join-Path $work 'panel.zip') -DestinationPath (Join-Path $work 'signed')
Copy-Item -LiteralPath (Join-Path $work 'signed\META-INF') -Destination $PanelPath -Recurse
Copy-Item -LiteralPath (Join-Path $work 'signed\mimetype') -Destination $PanelPath
& $SigningToolPath -verify $PanelPath
if ($LASTEXITCODE -ne 0) { throw 'Staged CEP panel verification failed.' }
Write-Output "Verified signed CEP panel: $PanelPath"
