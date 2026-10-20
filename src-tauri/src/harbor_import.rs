//! Brings a Harbor install into Compass. Harbor is Compass's former name and kept its data
//! under the `app.harbor` identifier, so an upgrade to Compass started from nothing.
//!
//! Runs from `run()` before the Tauri builder: once the builder starts, WebView2 holds the
//! Compass profile open and copying into it is no longer safe. Two cases import:
//! - a Compass that has never run (no settings file, no WebView profile), automatically;
//! - a request the listener made in Settings, after which Compass relaunches. Compass's own
//!   data is moved aside into an `<identifier>.before-harbor-<stamp>` folder, not deleted.
//!
//! The Harbor folders are only ever read. Storage keys inside the WebView profile keep their
//! `harbor.*` names here; src/lib/harbor-migration.ts renames them on the next start.
#![cfg_attr(not(windows), allow(dead_code))]

use std::fs;
use std::path::{Path, PathBuf};

const HARBOR_ID: &str = "app.harbor";
const REQUEST_FILE: &str = "harbor-import.request";
const DONE_FILE: &str = "harbor-import.done";
const WEBVIEW_DIR: &str = "EBWebView";
/// Recovery state and caches that belong to the Harbor build that wrote them.
const SKIP_ENTRIES: &[&str] = &[
    "crash-recovery",
    "update-recovery",
    "mpv-cache",
    REQUEST_FILE,
    DONE_FILE,
];
/// WebView2 rebuilds these itself; together they are most of a profile's size.
const WEBVIEW_CACHES: &[&str] = &[
    "Cache",
    "Code Cache",
    "GPUCache",
    "DawnGraphiteCache",
    "DawnWebGPUCache",
    "GrShaderCache",
    "ShaderCache",
    "Crashpad",
    "lockfile",
];
#[cfg(windows)]
const RELAUNCH_WAIT: std::time::Duration = std::time::Duration::from_secs(10);

/// The roaming folder (`app_data_dir`: settings, secrets) and the local folder
/// (`app_local_data_dir`: the WebView2 profile) of one identifier.
#[derive(Clone, Debug)]
struct Roots {
    roaming: PathBuf,
    local: PathBuf,
}

impl Roots {
    #[cfg(windows)]
    fn of(identifier: &str) -> Option<Self> {
        let roaming = std::env::var_os("APPDATA")?;
        let local = std::env::var_os("LOCALAPPDATA")?;
        Some(Self {
            roaming: PathBuf::from(roaming).join(identifier),
            local: PathBuf::from(local).join(identifier),
        })
    }

    fn with_suffix(&self, suffix: &str) -> Self {
        let renamed = |path: &Path| {
            let mut name = path.file_name().unwrap_or_default().to_os_string();
            name.push(suffix);
            path.with_file_name(name)
        };
        Self {
            roaming: renamed(&self.roaming),
            local: renamed(&self.local),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode {
    /// Compass has never run: nothing of it exists to keep.
    Fresh,
    /// The listener asked for it: Compass's current data moves into a backup first.
    Replace,
}

/// `harbor.x`, `harbor-x` and `harborX` become `compass.x`, `compass-x` and `compassX`.
/// Mirrors renameHarborKey in src/lib/harbor-migration.ts.
fn rename_harbor_name(name: &str) -> Option<String> {
    let rest = name.strip_prefix("harbor")?;
    match rest.chars().next() {
        Some('.') | Some('-') => Some(format!("compass{rest}")),
        Some(c) if c.is_ascii_uppercase() => Some(format!("compass{rest}")),
        _ => None,
    }
}

fn harbor_present(harbor: &Roots) -> bool {
    harbor.roaming.join("settings.json").is_file() || harbor.local.join(WEBVIEW_DIR).is_dir()
}

fn compass_fresh(compass: &Roots) -> bool {
    !compass.roaming.join("settings.json").exists()
        && !compass.local.join(WEBVIEW_DIR).exists()
        && !compass.roaming.join(DONE_FILE).exists()
}

/// WebView2 keeps `lockfile` open without sharing for as long as a profile is in use.
#[cfg(windows)]
fn webview_in_use(local: &Path) -> bool {
    use std::os::windows::fs::OpenOptionsExt;
    let lock = local.join(WEBVIEW_DIR).join("lockfile");
    if !lock.exists() {
        return false;
    }
    fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&lock)
        .is_err()
}

/// Secret keys carry the old name, e.g. `harbor.trakt.session.v1.<profile>`.
fn renamed_secrets(raw: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    let entries = value.as_object()?;
    let renamed: serde_json::Map<String, serde_json::Value> = entries
        .iter()
        .map(|(key, value)| (rename_harbor_name(key).unwrap_or_else(|| key.clone()), value.clone()))
        .collect();
    serde_json::to_string(&renamed).ok()
}

fn copy_dir(src: &Path, dst: &Path, skip: &[&str]) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("create {}: {e}", dst.display()))?;
    for entry in fs::read_dir(src).map_err(|e| format!("read {}: {e}", src.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        if skip.iter().any(|s| name == *s) {
            continue;
        }
        let from = entry.path();
        let to = dst.join(&name);
        if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            copy_dir(&from, &to, skip)?;
        } else {
            fs::copy(&from, &to).map_err(|e| format!("copy {}: {e}", from.display()))?;
        }
    }
    Ok(())
}

fn copy_entry(src: &Path, dst: &Path) -> Result<(), String> {
    let is_webview = src.file_name().is_some_and(|name| name == WEBVIEW_DIR);
    if src.is_dir() {
        return copy_dir(src, dst, if is_webview { WEBVIEW_CACHES } else { &[] });
    }
    if src.file_name().is_some_and(|name| name == "secrets.json") {
        let raw = fs::read_to_string(src).map_err(|e| format!("read {}: {e}", src.display()))?;
        if let Some(renamed) = renamed_secrets(&raw) {
            return fs::write(dst, renamed).map_err(|e| format!("write {}: {e}", dst.display()));
        }
    }
    fs::copy(src, dst)
        .map(|_| ())
        .map_err(|e| format!("copy {}: {e}", src.display()))
}

fn remove_path(path: &Path) {
    let _ = if path.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
}

/// What one import step changed, so a failed import can put everything back.
struct Step {
    written: PathBuf,
    moved_aside: Option<PathBuf>,
}

fn undo(steps: Vec<Step>) {
    for step in steps.into_iter().rev() {
        remove_path(&step.written);
        if let Some(backup) = step.moved_aside {
            let _ = fs::rename(&backup, &step.written);
        }
    }
}

/// Copies every entry of one Harbor folder into the matching Compass folder.
fn import_folder(
    src: &Path,
    dst: &Path,
    backup: Option<&Path>,
    steps: &mut Vec<Step>,
) -> Result<(), String> {
    let Ok(entries) = fs::read_dir(src) else {
        return Ok(());
    };
    fs::create_dir_all(dst).map_err(|e| format!("create {}: {e}", dst.display()))?;
    // The WebView profile goes first: when Compass still holds it, moving it aside fails
    // before anything else has changed.
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|entry| entry.file_name() != WEBVIEW_DIR);
    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        if SKIP_ENTRIES.contains(&name.as_str()) || name.ends_with(".log") {
            continue;
        }
        let target_name = rename_harbor_name(&name).unwrap_or(name);
        let target = dst.join(&target_name);
        let mut moved_aside = None;
        if target.exists() {
            // A fresh Compass keeps whatever is already there; a replace sets it aside.
            let Some(backup) = backup else { continue };
            fs::create_dir_all(backup).map_err(|e| format!("create {}: {e}", backup.display()))?;
            let aside = backup.join(&target_name);
            fs::rename(&target, &aside)
                .map_err(|e| format!("move {} aside: {e}", target.display()))?;
            moved_aside = Some(aside);
        }
        let copied = copy_entry(&entry.path(), &target);
        steps.push(Step {
            written: target,
            moved_aside,
        });
        copied?;
    }
    Ok(())
}

fn import(harbor: &Roots, compass: &Roots, mode: Mode, stamp: u64) -> Result<(), String> {
    let backup =
        (mode == Mode::Replace).then(|| compass.with_suffix(&format!(".before-harbor-{stamp}")));
    let mut steps = Vec::new();
    let result = import_folder(
        &harbor.local,
        &compass.local,
        backup.as_ref().map(|b| b.local.as_path()),
        &mut steps,
    )
    .and_then(|()| {
        import_folder(
            &harbor.roaming,
            &compass.roaming,
            backup.as_ref().map(|b| b.roaming.as_path()),
            &mut steps,
        )
    });
    if let Err(error) = result {
        undo(steps);
        return Err(error);
    }
    let note = serde_json::json!({
        "importedAt": stamp,
        "mode": if mode == Mode::Fresh { "fresh" } else { "replace" },
        "backup": backup.as_ref().map(|b| [b.roaming.display().to_string(), b.local.display().to_string()]),
    });
    let _ = fs::write(compass.roaming.join(DONE_FILE), note.to_string());
    let _ = fs::remove_file(compass.roaming.join(REQUEST_FILE));
    Ok(())
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Called from `run()` before any window exists. Never fails startup: a postponed or
/// failed import leaves Compass exactly as it was.
pub fn run_pending(identifier: &str) {
    #[cfg(windows)]
    if let Err(error) = run_pending_windows(identifier) {
        eprintln!("[harbor-import] {error}");
    }
    #[cfg(not(windows))]
    let _ = identifier;
}

#[cfg(windows)]
fn run_pending_windows(identifier: &str) -> Result<(), String> {
    let (Some(harbor), Some(compass)) = (Roots::of(HARBOR_ID), Roots::of(identifier)) else {
        return Ok(());
    };
    if !harbor_present(&harbor) {
        return Ok(());
    }
    let mode = if compass.roaming.join(REQUEST_FILE).exists() {
        Mode::Replace
    } else if compass_fresh(&compass) {
        Mode::Fresh
    } else {
        return Ok(());
    };
    if webview_in_use(&harbor.local) {
        return Err("Harbor is open; the import waits for the next start".into());
    }
    // A relaunch starts this process while the previous one is still letting go of WebView2.
    let deadline = std::time::Instant::now() + RELAUNCH_WAIT;
    while webview_in_use(&compass.local) {
        if std::time::Instant::now() >= deadline {
            return Err("Compass is still open; the import waits for the next start".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    import(&harbor, &compass, mode, unix_now())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarborImportStatus {
    /// A Harbor install exists on this machine.
    available: bool,
    /// Its data has been imported into this Compass at least once.
    imported: bool,
}

#[tauri::command]
pub fn harbor_import_status(app: tauri::AppHandle) -> HarborImportStatus {
    #[cfg(windows)]
    {
        let identifier = &app.config().identifier;
        let (Some(harbor), Some(compass)) = (Roots::of(HARBOR_ID), Roots::of(identifier)) else {
            return HarborImportStatus { available: false, imported: false };
        };
        HarborImportStatus {
            available: harbor_present(&harbor),
            imported: compass.roaming.join(DONE_FILE).exists(),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        HarborImportStatus { available: false, imported: false }
    }
}

/// Asks the next start to import Harbor; the caller relaunches Compass right after.
#[tauri::command]
pub fn harbor_import_request(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        let compass = Roots::of(&app.config().identifier).ok_or("no data folder")?;
        fs::create_dir_all(&compass.roaming).map_err(|e| e.to_string())?;
        fs::write(compass.roaming.join(REQUEST_FILE), unix_now().to_string())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("importing Harbor is only available on Windows".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> Roots {
        let base = std::env::temp_dir().join(format!(
            "compass-harbor-import-{name}-{}-{}",
            std::process::id(),
            unix_now()
        ));
        let _ = fs::remove_dir_all(&base);
        Roots {
            roaming: base.join("roaming").join("app.id"),
            local: base.join("local").join("app.id"),
        }
    }

    fn write(path: &Path, content: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    fn harbor_fixture(name: &str) -> Roots {
        let harbor = scratch(&format!("{name}-harbor"));
        write(&harbor.roaming.join("settings.json"), r##"{"tmdbKey":"k","harborColor":"#fff"}"##);
        write(
            &harbor.roaming.join("secrets.json"),
            r#"{"harbor.trakt.session.v1.p1":"t","other":"o"}"#,
        );
        write(&harbor.roaming.join("harbor-subs").join("a.srt"), "sub");
        write(&harbor.roaming.join("harbor-mpv.log"), "log");
        write(&harbor.roaming.join("crash-recovery").join("x"), "x");
        let profile = harbor.local.join(WEBVIEW_DIR).join("Default");
        write(&profile.join("Local Storage").join("leveldb").join("000003.log"), "ls");
        write(&profile.join("Cache").join("data_0"), "cache");
        write(&harbor.local.join(WEBVIEW_DIR).join("lockfile"), "");
        harbor
    }

    #[test]
    fn renames_only_harbor_prefixed_names() {
        assert_eq!(rename_harbor_name("harbor.settings").as_deref(), Some("compass.settings"));
        assert_eq!(rename_harbor_name("harbor-subs").as_deref(), Some("compass-subs"));
        assert_eq!(rename_harbor_name("harborColor").as_deref(), Some("compassColor"));
        assert_eq!(rename_harbor_name("harborcommunity"), None);
        assert_eq!(rename_harbor_name("settings.json"), None);
    }

    #[test]
    fn fresh_import_copies_data_without_caches_logs_or_recovery() {
        let harbor = harbor_fixture("fresh");
        let compass = scratch("fresh-compass");
        assert!(compass_fresh(&compass));

        import(&harbor, &compass, Mode::Fresh, 1).unwrap();

        let settings = fs::read_to_string(compass.roaming.join("settings.json")).unwrap();
        assert!(settings.contains("\"tmdbKey\":\"k\""));
        let secrets: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(compass.roaming.join("secrets.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(secrets["compass.trakt.session.v1.p1"], "t");
        assert_eq!(secrets["other"], "o");
        assert!(secrets.get("harbor.trakt.session.v1.p1").is_none());
        assert!(compass.roaming.join("compass-subs").join("a.srt").is_file());
        assert!(!compass.roaming.join("harbor-mpv.log").exists());
        assert!(!compass.roaming.join("crash-recovery").exists());
        let profile = compass.local.join(WEBVIEW_DIR).join("Default");
        assert!(profile.join("Local Storage").join("leveldb").join("000003.log").is_file());
        assert!(!profile.join("Cache").exists());
        assert!(!compass.local.join(WEBVIEW_DIR).join("lockfile").exists());
        assert!(compass.roaming.join(DONE_FILE).is_file());
        assert!(!compass_fresh(&compass));
        // Harbor is only read.
        assert!(harbor.roaming.join("harbor-subs").join("a.srt").is_file());
    }

    #[test]
    fn replace_moves_compass_data_into_a_backup() {
        let harbor = harbor_fixture("replace");
        let compass = scratch("replace-compass");
        write(&compass.roaming.join("settings.json"), "{\"old\":true}");
        write(&compass.roaming.join("only-compass"), "keep");
        write(&compass.local.join(WEBVIEW_DIR).join("Default").join("Prefs"), "old");
        write(&compass.roaming.join(REQUEST_FILE), "1");

        import(&harbor, &compass, Mode::Replace, 7).unwrap();

        let backup = compass.with_suffix(".before-harbor-7");
        assert_eq!(
            fs::read_to_string(backup.roaming.join("settings.json")).unwrap(),
            "{\"old\":true}"
        );
        assert!(backup.local.join(WEBVIEW_DIR).join("Default").join("Prefs").is_file());
        assert!(fs::read_to_string(compass.roaming.join("settings.json"))
            .unwrap()
            .contains("tmdbKey"));
        assert!(!compass.local.join(WEBVIEW_DIR).join("Default").join("Prefs").exists());
        assert_eq!(fs::read_to_string(compass.roaming.join("only-compass")).unwrap(), "keep");
        assert!(!compass.roaming.join(REQUEST_FILE).exists());
    }

    #[test]
    fn failed_import_restores_compass() {
        let harbor = harbor_fixture("undo");
        let compass = scratch("undo-compass");
        write(&compass.roaming.join("settings.json"), "{\"old\":true}");
        write(&compass.local.join(WEBVIEW_DIR).join("Default").join("Prefs"), "old");
        // compass-subs cannot be moved aside onto the folder already in the backup, so the
        // roaming half fails after the WebView profile was already replaced.
        write(&compass.roaming.join("compass-subs"), "blocking file");
        fs::create_dir_all(compass.with_suffix(".before-harbor-9").roaming.join("compass-subs"))
            .unwrap();

        assert!(import(&harbor, &compass, Mode::Replace, 9).is_err());

        assert_eq!(
            fs::read_to_string(compass.roaming.join("settings.json")).unwrap(),
            "{\"old\":true}"
        );
        assert_eq!(
            fs::read_to_string(compass.local.join(WEBVIEW_DIR).join("Default").join("Prefs"))
                .unwrap(),
            "old"
        );
        assert!(!compass.roaming.join(DONE_FILE).exists());
    }
}
