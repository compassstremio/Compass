#Requires -Version 5.1
<#
  Compass beta release, end to end.

    pwsh -File scripts/release-beta.ps1                  # build + verify + sign + stage
    pwsh -File scripts/release-beta.ps1 -Publish         # ... and publish to the beta channel
    pwsh -File scripts/release-beta.ps1 -SkipApp         # reuse the existing compass.exe

  Mac artifacts are optional. Drop Compass_<version>_aarch64.app.tar.gz(.sig) and
  Compass_<version>_aarch64.dmg into the staging folder before -Publish to include them.
#>
param(
  [switch]$Publish,
  [switch]$SkipApp,
  [string]$Channel = 'beta',
  [string]$StageRoot = 'D:\compass-release',
  [string]$NotesFile
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

function Step($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }
function Fail($text) { throw $text }
function Run($file, $arguments) {
  & $file @arguments
  if ($LASTEXITCODE -ne 0) { Fail "$file $($arguments -join ' ') failed with exit $LASTEXITCODE" }
}

$version = (Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { Fail "Bad version in tauri.conf.json: $version" }
Step "Compass $version -> $Channel"

Step 'Version consistency'
$checks = @(
  @{ File = 'package.json';                          Pattern = '"version":\s*"([^"]+)"' }
  @{ File = 'src-tauri/tauri.conf.json';             Pattern = '"version":\s*"([^"]+)"' }
  @{ File = 'src-tauri/Cargo.toml';                  Pattern = '(?m)^version\s*=\s*"([^"]+)"' }
  @{ File = 'installer/package.json';                Pattern = '"version":\s*"([^"]+)"' }
  @{ File = 'installer/src-tauri/tauri.conf.json';   Pattern = '"version":\s*"([^"]+)"' }
  @{ File = 'installer/src-tauri/Cargo.toml';        Pattern = '(?m)^version\s*=\s*"([^"]+)"' }
)
foreach ($check in $checks) {
  $raw = Get-Content $check.File -Raw
  $found = [regex]::Match($raw, $check.Pattern)
  if (-not $found.Success) { Fail "No version found in $($check.File)" }
  if ($found.Groups[1].Value -ne $version) { Fail "$($check.File) is $($found.Groups[1].Value), expected $version" }
  Write-Host "  ok  $($check.File)"
}
foreach ($lock in @(@{ File = 'src-tauri/Cargo.lock'; Name = 'compass' }, @{ File = 'installer/src-tauri/Cargo.lock'; Name = 'compass-setup' })) {
  $raw = Get-Content $lock.File -Raw
  $found = [regex]::Match($raw, "(?ms)name\s*=\s*""$($lock.Name)""\s*\r?\nversion\s*=\s*""([^""]+)""")
  if (-not $found.Success) { Fail "No $($lock.Name) entry in $($lock.File)" }
  if ($found.Groups[1].Value -ne $version) { Fail "$($lock.File) has $($lock.Name) $($found.Groups[1].Value), expected $version" }
  Write-Host "  ok  $($lock.File) ($($lock.Name))"
}

Step 'Updater signing key'
$keyPath = if ($env:COMPASS_UPDATER_KEY) { $env:COMPASS_UPDATER_KEY } else { Join-Path $env:USERPROFILE '.compass\updater.key' }
if (-not (Test-Path -LiteralPath $keyPath)) { Fail "No updater signing key at $keyPath" }
# tauri build signs the updater artifacts itself, so the key must be set before it runs.
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content -LiteralPath $keyPath -Raw).Trim()
if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) { $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = '' }
Write-Host "  ok  key loaded from $keyPath"

if (-not $SkipApp) {
  Step 'App build'
  Run 'pnpm' @('tauri', 'build')
} else {
  Step 'App build skipped'
}

Step 'Uninstaller'
Run 'cargo' @('build', '--manifest-path', 'installer/src-tauri/Cargo.toml', '--release',
  '--no-default-features', '--features', 'tauri/custom-protocol', '--bin', 'compass-uninstall', '--locked')

Step 'Payload'
Run 'node' @('installer/scripts/make-payload.mjs')
Run 'node' @('scripts/verify-managed-payload.mjs')

Step 'Managed installer'
Run 'cargo' @('build', '--manifest-path', 'installer/src-tauri/Cargo.toml', '--release',
  '--features', 'tauri/custom-protocol', '--bin', 'compass-setup', '--locked')
Run 'node' @('scripts/verify-managed-payload.mjs', '--embedded')

# Cargo writes to CARGO_TARGET_DIR when set, else to each crate's own target/.
$appRelease = if ($env:CARGO_TARGET_DIR) { Join-Path $env:CARGO_TARGET_DIR 'release' } else { 'src-tauri/target/release' }
$setupRelease = if ($env:CARGO_TARGET_DIR) { Join-Path $env:CARGO_TARGET_DIR 'release' } else { 'installer/src-tauri/target/release' }

Step 'Executable versions'
$exes = @(
  (Join-Path $appRelease 'compass.exe'),
  (Join-Path $setupRelease 'compass-uninstall.exe'),
  (Join-Path $setupRelease 'compass-setup.exe')
)
foreach ($exe in $exes) {
  if (-not (Test-Path -LiteralPath $exe)) { Fail "Missing $exe" }
  $fileVersion = (Get-Item -LiteralPath $exe).VersionInfo.FileVersion
  if ($fileVersion -ne $version) { Fail "$exe reports $fileVersion, expected $version" }
  Write-Host "  ok  $exe"
}

Step 'Stage artifacts'
$stage = Join-Path $StageRoot $version
New-Item -ItemType Directory -Force -Path $stage | Out-Null
$setup = Join-Path $appRelease "bundle/nsis/Compass_${version}_x64-setup.exe"
if (-not (Test-Path -LiteralPath $setup)) { Fail "Missing NSIS bundle $setup" }
$staged = @{
  "Compass_${version}_x64-setup.exe"     = $setup
  "Compass_${version}_x64-installer.exe" = (Join-Path $setupRelease 'compass-setup.exe')
}
foreach ($name in $staged.Keys) {
  Copy-Item -LiteralPath $staged[$name] -Destination (Join-Path $stage $name) -Force
  Write-Host "  staged $name"
}

Step 'Authenticode (optional)'
# Must run before the minisign step below: minisign signs the final bytes of each staged file.
# Uses a certificate already in the Windows store (hardware tokens work too), so no secret is passed on a command line.
if ($env:COMPASS_SIGN_THUMBPRINT) {
  $signtool = if ($env:COMPASS_SIGNTOOL) { $env:COMPASS_SIGNTOOL } else { 'signtool' }
  $timestamp = if ($env:COMPASS_SIGN_TIMESTAMP) { $env:COMPASS_SIGN_TIMESTAMP } else { 'http://timestamp.digicert.com' }
  foreach ($name in $staged.Keys) {
    $target = Join-Path $stage $name
    Run $signtool @('sign', '/fd', 'SHA256', '/sha1', $env:COMPASS_SIGN_THUMBPRINT, '/tr', $timestamp, '/td', 'SHA256', $target)
    Run $signtool @('verify', '/pa', $target)
    Write-Host "  authenticode signed $name"
  }
} else {
  Write-Host '  skipped: COMPASS_SIGN_THUMBPRINT is not set, so Windows SmartScreen will warn on these installers (see installer/SIGNING.md)' -ForegroundColor Yellow
}

Step 'Sign (each exe gets its own signature)'
foreach ($name in $staged.Keys) {
  $target = Join-Path $stage $name
  Remove-Item -LiteralPath "$target.sig" -Force -ErrorAction SilentlyContinue
  Run 'pnpm' @('tauri', 'signer', 'sign', $target)
  if (-not (Test-Path -LiteralPath "$target.sig")) { Fail "Signing produced no $name.sig" }
  Write-Host "  signed $name"
}

Step 'Staging folder'
Get-ChildItem -LiteralPath $stage | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize

if (-not $Publish) {
  Write-Host "`nBuilt and signed. Nothing was published." -ForegroundColor Yellow
  Write-Host "To publish:  pwsh -File scripts/release-beta.ps1 -SkipApp -Publish" -ForegroundColor Yellow
  exit 0
}

Step "Publish to $Channel"
$envFile = Join-Path $env:USERPROFILE '.compass\compass-themes.env'
if (-not $env:COMPASS_THEMES_ADMIN_TOKEN) {
  if (-not (Test-Path -LiteralPath $envFile)) { Fail "No admin token: set COMPASS_THEMES_ADMIN_TOKEN or create $envFile" }
  foreach ($line in Get-Content -LiteralPath $envFile) {
    if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)$') {
      Set-Item -Path "env:$($Matches[1])" -Value $Matches[2].Trim().Trim('"', "'")
    }
  }
}
if (-not $env:COMPASS_THEMES_ADMIN_TOKEN) { Fail 'COMPASS_THEMES_ADMIN_TOKEN is empty' }

$publishArgs = @('scripts/publish-release.mjs', '--dir', $stage, '--version', $version, '--channel', $Channel)
if (-not $NotesFile) {
  $candidate = Join-Path $stage 'notes.txt'
  if (Test-Path -LiteralPath $candidate) { $NotesFile = $candidate }
}
if ($NotesFile) { $publishArgs += @('--notes-file', $NotesFile) }
Run 'node' $publishArgs

Step 'Done'
Write-Host "Compass $version is live on $Channel." -ForegroundColor Green
