use std::path::PathBuf;

use serde::Serialize;

const MARKER: &str = "compass-install.json";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallFeatures {
    plugins: bool,
    games: bool,
    music: bool,
    ebook: bool,
    manga: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallMarker {
    disabled_features: Option<Vec<String>>,
}

/// The managed installer records what it left out in a marker beside the executable. No marker,
/// no key or a marker that does not parse means every feature is on: that is every NSIS install,
/// every dev run, and every platform the managed installer does not cover.
fn disabled_features() -> Vec<String> {
    let Some(directory) = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(PathBuf::from))
    else {
        return Vec::new();
    };
    let Ok(text) = std::fs::read_to_string(directory.join(MARKER)) else {
        return Vec::new();
    };
    let Ok(marker) = serde_json::from_str::<InstallMarker>(&text) else {
        return Vec::new();
    };
    marker.disabled_features.unwrap_or_default()
}

#[tauri::command]
pub fn install_features() -> InstallFeatures {
    let disabled = disabled_features();
    let on = |key: &str| !disabled.iter().any(|off| off == key);
    InstallFeatures {
        plugins: on("plugins"),
        games: on("games"),
        music: on("music"),
        ebook: on("ebook"),
        manga: on("manga"),
    }
}

pub(crate) fn require_plugins() -> Result<(), String> {
    if install_features().plugins {
        Ok(())
    } else {
        Err("Plugins are disabled for this installation. Use Modify installation in Settings to enable them.".into())
    }
}
