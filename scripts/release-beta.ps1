#Requires -Version 5.1
<#
  Compass beta release, end to end.

    pwsh -File scripts/release-beta.ps1                  # build + verify + sign + stage
    pwsh -File scripts/release-beta.ps1 -Publish         # ... and publish to the beta channel
    pwsh -File scripts/release-beta.ps1 -SkipApp         # reuse the existing compass.exe
    pwsh -File scripts/release-beta.ps1 -Channel stable -Publish   # publish to the stable channel

  Or through pnpm for a plain run:  pnpm release:beta  /  pnpm release:stable.
  For -Publish or other switches call the script directly, so no literal "--" can reach
  PowerShell:  pwsh -File scripts/release-beta.ps1 -Publish

  If the updater key is protected by a password, set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
  first; without it the signer stops and prompts interactively, which hangs a script.

  The Compass Setup installer is staged twice: as Compass_<version>_x64-installer.exe, the name the
  release API parses, and as compass-setup-v<version>-<channel>.exe for identification.
  installer/changelog/<version>-changelog.json must exist with this channel's notes, or the
  script refuses to build the release.

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

# No staged extension runtime means this release ships without extension support. The layer's
# sources are tracked while its jars are gitignored, so a jarless checkout looks "present but
# broken" to capstan-stage and it stops when sh cannot fetch the jars. Point it at a path that
# does not exist so the build takes the documented no-layer path instead.
if (-not (Test-Path -LiteralPath 'src-tauri/resources/capstan/capstan.jar')) {
  if (-not $env:COMPASS_CAPSTAN_OPTIONAL) {
    Write-Host 'No extension runtime staged; building without extension support (COMPASS_CAPSTAN_OPTIONAL=1).' -ForegroundColor Yellow
    $env:COMPASS_CAPSTAN_OPTIONAL = '1'
  }
  $noLayer = Join-Path $env:TEMP 'compass-no-capstan-layer'
  Remove-Item -LiteralPath $noLayer -Recurse -Force -ErrorAction SilentlyContinue
  $env:COMPASS_CAPSTAN_SRC = $noLayer
}

# No staged game engine means this build ships tab-only games, which the payload script would
# otherwise refuse. Mirror the capstan fallback.
if (-not (Test-Path -LiteralPath 'src-tauri/resources/pokemon-engine/Compass.PokemonEngine.exe') -and -not $env:COMPASS_POKEMON_OPTIONAL) {
  Write-Host 'No game engine staged; shipping tab-only games (COMPASS_POKEMON_OPTIONAL=1).' -ForegroundColor Yellow
  $env:COMPASS_POKEMON_OPTIONAL = '1'
}

function Step($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }
function Fail($text) { throw $text }
function Run($file, $arguments) {
  & $file @arguments
  if ($LASTEXITCODE -ne 0) { Fail "$file $($arguments -join ' ') failed with exit $LASTEXITCODE" }
}

# Cargo writes to CARGO_TARGET_DIR when set, else to each crate's own target/.
$appRelease = if ($env:CARGO_TARGET_DIR) { Join-Path $env:CARGO_TARGET_DIR 'release' } else { 'src-tauri/target/release' }
$setupRelease = if ($env:CARGO_TARGET_DIR) { Join-Path $env:CARGO_TARGET_DIR 'release' } else { 'installer/src-tauri/target/release' }

$version = (Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { Fail "Bad version in tauri.conf.json: $version" }
$nameChannel = if ($Channel -eq 'stable') { 'stable' } else { 'beta' }
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

Step 'Installer changelog'
$changelogFile = "installer/changelog/$version-changelog.json"
if (-not (Test-Path -LiteralPath $changelogFile)) {
  Fail "No $changelogFile. Add the patch notes for $version before releasing."
}
$changelog = Get-Content -LiteralPath $changelogFile -Raw | ConvertFrom-Json
$note = $changelog.notes.PSObject.Properties[$version]
$changelogChannel = if ($changelog.channel) { $changelog.channel } else { 'stable' }
if (-not $note -or $changelogChannel -ne $nameChannel -or -not $note.Value.title -or -not $note.Value.sections) {
  Fail "$changelogFile must hold notes for $version, channel $nameChannel, with a title and sections."
}
Write-Host "  ok  $changelogFile"

if (-not $SkipApp) {
  Step 'App build'
  # The frontend reads COMPASS_CHANNEL at build time; only "stable" clears the Beta label the
  # app shows in About. Tie the stamp to the channel this release is cut for.
  $env:COMPASS_CHANNEL = $Channel
  Write-Host "  channel stamp: $Channel"
  Run 'pnpm' @('tauri', 'build', '--no-bundle')
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

Step 'Name the build'
$setupExe = Join-Path $setupRelease 'compass-setup.exe'
$namedSetup = Join-Path $setupRelease "compass-setup-v${version}-${nameChannel}.exe"
Copy-Item -LiteralPath $setupExe -Destination $namedSetup -Force
Write-Host "  $namedSetup"

Step 'Executable versions'
$exes = @(
  (Join-Path $appRelease 'compass.exe'),
  (Join-Path $setupRelease 'compass-uninstall.exe'),
  $setupExe
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
if (-not (Test-Path -LiteralPath $setupExe)) { Fail "Missing $setupExe" }
$staged = @{
  # The release API reads version and platform from this name, so the upload keeps it.
  "Compass_${version}_x64-installer.exe"            = $setupExe
  # The channel-named copy marks the channel the folder was cut for and names the GitHub
  # asset. publish-release.mjs only uploads the Compass_<version>_* name.
  "compass-setup-v${version}-${nameChannel}.exe" = $namedSetup
}
foreach ($name in $staged.Keys) {
  Copy-Item -LiteralPath $staged[$name] -Destination (Join-Path $stage $name) -Force
  Write-Host "  staged $name"
}

Step 'Sign (each exe gets its own signature)'
$keyPath = @(
  (Join-Path $env:USERPROFILE '.tauri\compass-updater.key'),
  (Join-Path $env:USERPROFILE '.compass\updater.key')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $keyPath) { Fail "No updater signing key at ~\.tauri\compass-updater.key or ~\.compass\updater.key" }
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content -LiteralPath $keyPath -Raw).Trim()
# PowerShell 5.1 drops empty arguments and removes empty environment variables, so a
# passwordless key can never reach the signer as "no password given": it prompts
# interactively and a script hangs. "--password=" carries an explicit empty password.
# A key protected by a real password must have TAURI_SIGNING_PRIVATE_KEY_PASSWORD set;
# without it the signer hangs at the same prompt.
$signArgs = if ($env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
  @('tauri', 'signer', 'sign')
} else {
  @('tauri', 'signer', 'sign', '--password=')
}
foreach ($name in $staged.Keys) {
  $target = Join-Path $stage $name
  Remove-Item -LiteralPath "$target.sig" -Force -ErrorAction SilentlyContinue
  Run 'pnpm' @($signArgs + $target)
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
      # Strip the quotes a dotenv value may carry, or they are sent as part of the token.
      # Name is read first: the quote match below overwrites $Matches.
      $name = $Matches[1]
      $value = $Matches[2].Trim()
      if ($value -match '^"(.*)"$' -or $value -match "^'(.*)'$") { $value = $Matches[1] }
      Set-Item -Path "env:$name" -Value $value
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
