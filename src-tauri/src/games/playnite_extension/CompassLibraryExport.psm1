# Installed by Compass. Writes a read-only copy of this library for Compass; Playnite data is never changed.
$script:CompassFolder = "CompassLibraryExport"

function Get-CompassUnixMs($value) {
    if ($null -eq $value) { return 0 }
    try { return [DateTimeOffset]::new(([DateTime]$value).ToUniversalTime()).ToUnixTimeMilliseconds() } catch { return 0 }
}

function Get-CompassImage($path) {
    if ([string]::IsNullOrWhiteSpace($path)) { return $null }
    if ($path -match '^https?://') { return $path }
    try { return $PlayniteApi.Database.GetFullFilePath($path) } catch { return $null }
}

function ExportCompassLibrary() {
    param($scriptMainMenuItemActionArgs)
    try {
        $games = New-Object System.Collections.Generic.List[object]
        foreach ($game in $PlayniteApi.Database.Games) {
            $platforms = @()
            if ($game.Platforms) { $platforms = @($game.Platforms | ForEach-Object { $_.Name }) }
            $source = $null
            if ($game.Source) { $source = $game.Source.Name }
            $games.Add([ordered]@{
                id = $game.Id.ToString()
                name = $game.Name
                source = $source
                pluginId = $game.PluginId.ToString()
                gameId = $game.GameId
                installed = [bool]$game.IsInstalled
                installDirectory = $game.InstallDirectory
                platforms = $platforms
                playtime = [uint64]$game.Playtime
                lastActivity = Get-CompassUnixMs $game.LastActivity
                added = Get-CompassUnixMs $game.Added
                hidden = [bool]$game.Hidden
                favorite = [bool]$game.Favorite
                cover = Get-CompassImage $game.CoverImage
                background = Get-CompassImage $game.BackgroundImage
                icon = Get-CompassImage $game.Icon
            })
        }
        $export = [ordered]@{ version = 1; exportedAt = Get-CompassUnixMs ([DateTime]::UtcNow); games = $games.ToArray() }
        $folder = Join-Path $PlayniteApi.Paths.ExtensionsDataPath $script:CompassFolder
        [System.IO.Directory]::CreateDirectory($folder) | Out-Null
        $target = Join-Path $folder "library.json"
        $temporary = "$target.tmp"
        $json = ConvertTo-Json -InputObject $export -Depth 5 -Compress
        [System.IO.File]::WriteAllText($temporary, $json, (New-Object System.Text.UTF8Encoding $false))
        Move-Item -LiteralPath $temporary -Destination $target -Force
    } catch {
        $__logger.Error("Compass library export failed: $($_.Exception.Message)")
    }
}

function OnApplicationStarted() { ExportCompassLibrary }
function OnLibraryUpdated() { ExportCompassLibrary }
function OnGameInstalled() { param($evnArgs) ExportCompassLibrary }
function OnGameUninstalled() { param($evnArgs) ExportCompassLibrary }
function OnGameStopped() { param($evnArgs) ExportCompassLibrary }

function GetMainMenuItems() {
    param($getMainMenuItemsArgs)
    $item = New-Object Playnite.SDK.Plugins.ScriptMainMenuItem
    $item.Description = "Send library to Compass"
    $item.FunctionName = "ExportCompassLibrary"
    $item.MenuSection = "@Compass"
    return $item
}
