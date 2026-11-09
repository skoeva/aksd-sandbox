# Copyright (c) Microsoft Corporation.
# Licensed under the Apache 2.0.

[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$SourceRoot,
  [Parameter(Mandatory)][string]$ResultsDir
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-Condition([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Get-PeMachine([string]$File) {
  $stream = [System.IO.File]::OpenRead($File)
  $reader = [System.IO.BinaryReader]::new($stream)
  try {
    Assert-Condition ($reader.ReadUInt16() -eq 0x5A4D) "Missing DOS header: $File"
    $stream.Position = 0x3C
    $peOffset = $reader.ReadUInt32()
    $stream.Position = $peOffset
    Assert-Condition ($reader.ReadUInt32() -eq 0x4550) "Missing PE header: $File"
    return $reader.ReadUInt16()
  } finally {
    $reader.Dispose()
    $stream.Dispose()
  }
}

function Invoke-Installer([string]$File, [string[]]$Arguments) {
  Write-Host "Running installer operation: $File"
  $process = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru
  try {
    if (-not $process.WaitForExit(300000)) {
      $process.Kill()
      $process.WaitForExit()
      throw "Installer operation timed out: $File"
    }
    $process.Refresh()
    Assert-Condition ($process.ExitCode -eq 0) "Installer exited with $($process.ExitCode): $File"
    return $process.ExitCode
  } finally {
    $process.Dispose()
  }
}

function Get-ProductRegistrations([string]$ProductName) {
  $roots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKCU:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
  )
  foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    foreach ($key in (Get-ChildItem -LiteralPath $root)) {
      $entry = Get-ItemProperty -LiteralPath $key.PSPath
      $displayName = $entry.PSObject.Properties['DisplayName']
      if ($displayName -and $displayName.Value -match ('^' + [regex]::Escape($ProductName) + '( |$)')) {
        [pscustomobject]@{
          Key = $key.Name
          DisplayName = $displayName.Value
        }
      }
    }
  }
}

Assert-Condition ($env:OS -eq 'Windows_NT') 'Installer validation requires Windows'
$nodeArch = (& node -p process.arch).Trim()
Assert-Condition ($LASTEXITCODE -eq 0 -and $nodeArch -eq 'arm64') 'A native ARM64 Node runner is required'
Set-Location -LiteralPath $SourceRoot
$ResultsDir = [System.IO.Path]::GetFullPath($ResultsDir)
$sourceSha = (& git rev-parse HEAD).Trim()
Assert-Condition ($LASTEXITCODE -eq 0 -and $sourceSha -eq $env:EXPECTED_SOURCE_SHA) 'Unexpected application source revision'
$project = Get-Content -LiteralPath (Join-Path $SourceRoot 'package.json') -Raw | ConvertFrom-Json
$productName = $project.headlamp.product.productName
$installDir = Join-Path $env:RUNNER_TEMP 'aks-pr1114-installed'
Assert-Condition (-not (Test-Path -LiteralPath $installDir)) "Test install directory already exists: $installDir"
Assert-Condition (@(Get-ProductRegistrations $productName).Count -eq 0) 'An existing AKS desktop installation must not be modified'
New-Item -ItemType Directory -Force -Path $ResultsDir | Out-Null
$dist = Join-Path $SourceRoot 'node_modules/@headlamp-k8s/headlamp-source/source/app/dist'
$installers = @(Get-ChildItem -LiteralPath $dist -Filter 'aks-desktop-*-win-arm64.exe' -File)
Assert-Condition ($installers.Count -eq 1) "Expected exactly one ARM64 installer, found $($installers.Count)"
$installer = $installers[0].FullName
$appExe = Join-Path $installDir ($project.headlamp.platforms.win.executableName + '.exe')
$backendExe = Join-Path $installDir 'resources/headlamp-server.exe'
$azCmd = Join-Path $installDir 'resources/external-tools/az-cli/win32/bin/az.cmd'
$report = [ordered]@{
  source_sha = $sourceSha
  runner_arch = $nodeArch
  installer = $installer
  installer_sha256 = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash
  installer_signature_status = (Get-AuthenticodeSignature -LiteralPath $installer).Status.ToString()
  install_directory = $installDir
  install_exit_code = $null
  app_machine = $null
  backend_machine = $null
  registered = $false
  azure_cli_exit_code = $null
  installed_gui_tests_exit_code = $null
  uninstall_exit_code = $null
  uninstalled = $false
  failure = $null
  cleanup_failure = $null
}
$failure = $null
$cleanupFailure = $null
$installAttempted = $false

try {
  $installAttempted = $true
  $report.install_exit_code = Invoke-Installer $installer @('/S', "/D=$installDir")
  Assert-Condition (Test-Path -LiteralPath $appExe) "Installed application is missing: $appExe"
  Assert-Condition (Test-Path -LiteralPath $backendExe) "Installed backend is missing: $backendExe"
  $report.app_machine = ('0x{0:X4}' -f (Get-PeMachine $appExe))
  $report.backend_machine = ('0x{0:X4}' -f (Get-PeMachine $backendExe))
  Assert-Condition ($report.app_machine -eq '0xAA64') 'Installed Electron executable is not ARM64'
  Assert-Condition ($report.backend_machine -eq '0xAA64') 'Installed backend executable is not ARM64'
  $registrations = @(Get-ProductRegistrations $productName)
  Assert-Condition ($registrations.Count -gt 0) 'Installed application is absent from Windows uninstall registration'
  $report.registered = $true
  $registrations | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $ResultsDir 'installed-registration.json')

  Assert-Condition (Test-Path -LiteralPath $azCmd) "Installed Azure CLI is missing: $azCmd"
  $env:AZURE_CONFIG_DIR = Join-Path $ResultsDir 'azure-config'
  $env:AZURE_CORE_COLLECT_TELEMETRY = '0'
  & $azCmd --version 2>&1 | Tee-Object -FilePath (Join-Path $ResultsDir 'azure-cli-version.txt')
  $report.azure_cli_exit_code = $LASTEXITCODE
  Assert-Condition ($LASTEXITCODE -eq 0) 'Installed Azure CLI failed under ARM64 emulation'

  $env:AKS_DESKTOP_EXECUTABLE = $appExe
  & npm run test:packaged-theme 2>&1 | Tee-Object -FilePath (Join-Path $ResultsDir 'installed-gui-tests.txt')
  $report.installed_gui_tests_exit_code = $LASTEXITCODE
  Assert-Condition ($LASTEXITCODE -eq 0) 'Installed application GUI tests failed'
} catch {
  $failure = $_
  $report.failure = $_.Exception.Message
  Write-Error -ErrorRecord $_ -ErrorAction Continue
} finally {
  if ($installAttempted -and (Test-Path -LiteralPath $installDir)) {
    try {
      $uninstallers = @(Get-ChildItem -LiteralPath $installDir -Filter 'Uninstall*.exe' -File)
      Assert-Condition ($uninstallers.Count -eq 1) 'Expected exactly one installed uninstaller'
      $report.uninstall_exit_code = Invoke-Installer $uninstallers[0].FullName @('/S')
      $deadline = [DateTime]::UtcNow.AddSeconds(60)
      while (
        ((Test-Path -LiteralPath $installDir) -or @(Get-ProductRegistrations $productName).Count -gt 0) -and
        [DateTime]::UtcNow -lt $deadline
      ) {
        Start-Sleep -Seconds 1
      }
      Assert-Condition (-not (Test-Path -LiteralPath $installDir)) 'Uninstall left the installation directory behind'
      Assert-Condition (@(Get-ProductRegistrations $productName).Count -eq 0) 'Uninstall registration was not removed'
      $report.uninstalled = $true
    } catch {
      $cleanupFailure = $_
      $report.cleanup_failure = $_.Exception.Message
      Write-Error -ErrorRecord $_ -ErrorAction Continue
    }
  }
  $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $ResultsDir 'installer-validation.json')
}

if ($failure) { throw $failure }
if ($cleanupFailure) { throw $cleanupFailure }
Assert-Condition $report.uninstalled 'Installer lifecycle validation did not complete'
Write-Host 'PASS: exact PR installer, native installed binaries, Azure CLI emulation, installed GUI tests, and uninstall cleanup'
