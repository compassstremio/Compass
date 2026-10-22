//! Playnite library through Compass's own script extension. Playnite keeps `games.db` locked while
//! it runs, so the extension exports a JSON copy and Compass only ever reads that copy.
#![cfg_attr(not(target_os = "windows"), allow(dead_code))]
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

const EXTENSION_FOLDER: &str = "CompassLibraryExport";
const MANIFEST: &str = include_str!("playnite_extension/extension.yaml");
const SCRIPT: &str = include_str!("playnite_extension/CompassLibraryExport.psm1");
const SCRIPT_FILE: &str = "CompassLibraryExport.psm1";
const EXPORT_LIMIT: u64 = 64 * 1024 * 1024;
const GAME_LIMIT: usize = 50_000;
const TEXT_LIMIT: usize = 512;
const PATH_LIMIT: usize = 4096;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Extension {
    Missing,
    Outdated,
    Installed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    pub id: String,
    pub name: String,
    /// Playnite's library plugin name, such as "Epic" or "EA app".
    pub source: String,
    /// Known store family, used for de-duplication and marks. Never a launch target.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub store: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steam_app_id: Option<u32>,
    pub installed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_path: Option<String>,
    pub platforms: Vec<String>,
    pub playtime: u64,
    pub last_played: u64,
    pub added_at: u64,
    pub hidden: bool,
    pub favorite: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub supported: bool,
    pub found: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extension: Option<Extension>,
    pub exported_at: u64,
    pub games: Vec<Game>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<&'static str>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Export {
    version: u32,
    #[serde(default)]
    exported_at: u64,
    games: Vec<RawGame>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct RawGame {
    id: String,
    name: Option<String>,
    source: Option<String>,
    plugin_id: Option<String>,
    game_id: Option<String>,
    installed: bool,
    install_directory: Option<String>,
    platforms: Vec<Option<String>>,
    playtime: u64,
    last_activity: u64,
    added: u64,
    hidden: bool,
    favorite: bool,
    cover: Option<String>,
    background: Option<String>,
    icon: Option<String>,
}

/// Playnite's own library plugin IDs; the source name is the fallback for renamed plugins.
fn store(plugin: Option<&str>, source: &str) -> Option<&'static str> {
    let plugin = plugin.unwrap_or_default().to_ascii_lowercase();
    let by_plugin = match plugin.as_str() {
        "cb91dfc9-b977-43bf-8e70-55f46e410fab" => Some("steam"),
        "00000002-dbd1-46c6-b5d0-b1ba559d10e4" => Some("epic"),
        "aebe8b7c-6dc3-4a66-af31-e7375c6b5e9e" => Some("gog"),
        "85dd7072-2f20-4e76-a007-41035e390724" => Some("ea"),
        "c2f038e5-8b92-4877-91f1-da9094155fc5" => Some("ubisoft"),
        "e3c26a3d-d695-4cb7-a769-5ff7612c7edd" => Some("battlenet"),
        "00000001-ebb2-4eec-abcb-7c89937a42bb" => Some("itch"),
        "7e4fbb5e-2ae3-48d4-8ba0-6b30e7a4e287" => Some("xbox"),
        "402674cd-4af6-4886-b6ec-0e695bfa0688" => Some("amazon"),
        _ => None,
    };
    by_plugin.or_else(|| match source.trim().to_ascii_lowercase().as_str() {
        "steam" => Some("steam"),
        "epic" | "epic games" => Some("epic"),
        "gog" => Some("gog"),
        "ea app" | "origin" | "ea" => Some("ea"),
        "ubisoft connect" | "uplay" | "ubisoft" => Some("ubisoft"),
        "battle.net" => Some("battlenet"),
        "itch.io" => Some("itch"),
        "xbox" => Some("xbox"),
        "amazon games" | "amazon" => Some("amazon"),
        _ => None,
    })
}

fn text(value: Option<String>, limit: usize) -> Option<String> {
    let value = value?.trim().to_string();
    (!value.is_empty() && value.len() <= limit && !value.contains('\0')).then_some(value)
}

/// Windows paths compare without case; a portable folder may be typed differently from Playnite's.
fn inside(path: &Path, root: &Path) -> bool {
    let fold = |path: &Path| PathBuf::from(path.to_string_lossy().to_lowercase());
    path.is_absolute()
        && !path.components().any(|part| matches!(part, Component::ParentDir))
        && fold(path).starts_with(fold(root))
}

/// Remote art is public HTTPS; local art must be one of Playnite's own library files.
fn image(value: Option<String>, files: &Path) -> Option<String> {
    let value = text(value, PATH_LIMIT)?;
    let lower = value.to_ascii_lowercase();
    if lower.starts_with("https://") {
        let url = url::Url::parse(&value).ok()?;
        return url.host_str().is_some().then(|| url.into());
    }
    if lower.contains("://") {
        return None;
    }
    inside(Path::new(&value), files).then_some(value)
}

fn game(raw: RawGame, files: &Path) -> Option<Game> {
    let id = uuid::Uuid::parse_str(raw.id.trim()).ok()?.hyphenated().to_string();
    let name = text(raw.name, TEXT_LIMIT)?;
    let source = text(raw.source, TEXT_LIMIT).unwrap_or_else(|| "Playnite".into());
    let store = store(raw.plugin_id.as_deref(), &source);
    let steam_app_id = (store == Some("steam"))
        .then(|| raw.game_id.as_deref()?.trim().parse::<u32>().ok())
        .flatten()
        .filter(|id| *id > 0);
    let install_path = raw
        .installed
        .then(|| text(raw.install_directory, PATH_LIMIT))
        .flatten()
        .filter(|path| Path::new(path).is_absolute());
    Some(Game {
        id,
        name,
        source,
        store,
        steam_app_id,
        installed: raw.installed,
        install_path,
        platforms: raw.platforms.into_iter().filter_map(|value| text(value, TEXT_LIMIT)).take(16).collect(),
        playtime: raw.playtime,
        last_played: raw.last_activity,
        added_at: raw.added,
        hidden: raw.hidden,
        favorite: raw.favorite,
        cover: image(raw.cover, files),
        background: image(raw.background, files),
        icon: image(raw.icon, files),
    })
}

fn parse(bytes: &[u8], data: &Path) -> Result<(u64, Vec<Game>), &'static str> {
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    let export: Export = serde_json::from_slice(bytes).map_err(|_| "playnite_export_invalid")?;
    if export.version != 1 || export.games.len() > GAME_LIMIT {
        return Err("playnite_export_invalid");
    }
    let files = data.join("library").join("files");
    let mut seen = std::collections::HashSet::new();
    let games = export
        .games
        .into_iter()
        .filter_map(|raw| game(raw, &files))
        .filter(|game| seen.insert(game.id.clone()))
        .collect();
    Ok((export.exported_at, games))
}

fn read_bounded(path: &Path) -> Result<Vec<u8>, &'static str> {
    let file = fs::File::open(path).map_err(|_| "playnite_export_missing")?;
    let meta = file.metadata().map_err(|_| "playnite_export_missing")?;
    if !meta.is_file() || meta.len() > EXPORT_LIMIT {
        return Err("playnite_export_invalid");
    }
    let mut bytes = Vec::new();
    file.take(EXPORT_LIMIT + 1).read_to_end(&mut bytes).map_err(|_| "playnite_export_missing")?;
    Ok(bytes)
}

/// Installed Playnite keeps data in %APPDATA%; a portable copy keeps it beside the program.
fn data_dir(folder: Option<&str>) -> Option<PathBuf> {
    let chosen = folder.map(str::trim).filter(|value| !value.is_empty()).map(PathBuf::from);
    let candidate = match chosen {
        Some(path) => path,
        None => PathBuf::from(std::env::var_os("APPDATA")?).join("Playnite"),
    };
    let valid = candidate.is_absolute()
        && (candidate.join("library").is_dir() || candidate.join("Playnite.DesktopApp.exe").is_file());
    valid.then_some(candidate)
}

fn extension_dir(data: &Path) -> PathBuf {
    data.join("Extensions").join(EXTENSION_FOLDER)
}

fn export_path(data: &Path) -> PathBuf {
    data.join("ExtensionsData").join(EXTENSION_FOLDER).join("library.json")
}

fn extension_state(data: &Path) -> Extension {
    let folder = extension_dir(data);
    match (fs::read_to_string(folder.join("extension.yaml")), fs::read_to_string(folder.join(SCRIPT_FILE))) {
        (Ok(manifest), Ok(script)) if manifest == MANIFEST && script == SCRIPT => Extension::Installed,
        (Ok(_), _) | (_, Ok(_)) => Extension::Outdated,
        _ => Extension::Missing,
    }
}

fn status_at(data: Option<PathBuf>) -> Status {
    let supported = cfg!(target_os = "windows");
    let Some(data) = data else {
        return Status { supported, ..Status::default() };
    };
    let extension = extension_state(&data);
    let (exported_at, games, error) = match read_bounded(&export_path(&data)).and_then(|bytes| parse(&bytes, &data)) {
        Ok((at, games)) => (at, games, None),
        Err(error) => (0, Vec::new(), Some(error)),
    };
    Status {
        supported,
        found: true,
        data_dir: Some(data.to_string_lossy().into_owned()),
        extension: Some(extension),
        exported_at,
        games,
        error,
    }
}

pub fn status(folder: Option<String>) -> Status {
    status_at(data_dir(folder.as_deref()))
}

/// Playnite loads new script extensions on its next start; the first export runs then.
pub fn install(folder: Option<String>) -> Result<Status, &'static str> {
    let data = data_dir(folder.as_deref()).ok_or("playnite_missing")?;
    let target = extension_dir(&data);
    fs::create_dir_all(&target).map_err(|_| "playnite_install_failed")?;
    for (name, contents) in [("extension.yaml", MANIFEST), (SCRIPT_FILE, SCRIPT)] {
        let temporary = target.join(format!("{name}.compass-tmp"));
        fs::write(&temporary, contents).map_err(|_| "playnite_install_failed")?;
        fs::rename(&temporary, target.join(name)).map_err(|_| {
            let _ = fs::remove_file(&temporary);
            "playnite_install_failed"
        })?;
    }
    Ok(status_at(Some(data)))
}

/// Only an ID from the current export is dispatched, and only to Playnite's own URI handler.
pub fn uri(folder: Option<String>, id: &str, action: &str) -> Result<String, &'static str> {
    let verb = match action {
        "start" => "start",
        "show" => "showgame",
        _ => return Err("playnite_action_invalid"),
    };
    let id = uuid::Uuid::parse_str(id).map_err(|_| "playnite_game_missing")?.hyphenated().to_string();
    let current = status(folder);
    let game = current.games.iter().find(|game| game.id == id).ok_or("playnite_game_missing")?;
    if verb == "start" && !game.installed {
        return Err("playnite_game_not_installed");
    }
    Ok(format!("playnite://playnite/{verb}/{id}"))
}

#[cfg(test)]
#[path = "playnite_tests.rs"]
mod tests;
