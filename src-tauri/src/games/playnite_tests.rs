use super::*;
use serde_json::{json, Value};

struct Fixture {
    root: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("compass-playnite-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("library").join("files")).unwrap();
        Self { root }
    }
    fn export(&self, value: &Value) {
        self.write(&value.to_string());
    }
    fn write(&self, text: &str) {
        let path = export_path(&self.root);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }
    fn file(&self, name: &str) -> String {
        self.files().join(name).to_string_lossy().into_owned()
    }
    fn files(&self) -> PathBuf {
        self.root.join("library").join("files")
    }
    fn folder(&self) -> Option<String> {
        Some(self.root.to_string_lossy().into_owned())
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

const STEAM: &str = "cb91dfc9-b977-43bf-8e70-55f46e410fab";
const EPIC: &str = "00000002-DBD1-46C6-B5D0-B1BA559D10E4";
const ONE: &str = "8a1f4c62-1d3e-4b5a-9c7d-0e2f3a4b5c6d";
const TWO: &str = "2b3c4d5e-6f70-4812-9a3b-4c5d6e7f8091";

fn epic(id: &str) -> Value {
    json!({
        "id": id, "name": "Fortnite", "source": "Epic", "pluginId": EPIC, "gameId": "fn",
        "installed": true, "installDirectory": "C:\\Games\\Fortnite", "platforms": ["PC (Windows)", null],
        "playtime": 3600, "lastActivity": 1_700_000_000_000u64, "added": 1_600_000_000_000u64,
        "hidden": false, "favorite": true
    })
}

#[test]
fn reads_games_and_store_identity() {
    let fixture = Fixture::new();
    let portal = json!({"id": TWO, "name": "Portal", "source": "Steam", "pluginId": STEAM, "gameId": "400", "installed": false});
    fixture.export(&json!({"version": 1, "exportedAt": 5, "games": [epic(ONE), portal]}));
    let status = status_at(Some(fixture.root.clone()));
    assert!(status.found);
    assert_eq!(status.error, None);
    assert_eq!(status.exported_at, 5);
    assert_eq!(status.games.len(), 2);
    let first = &status.games[0];
    assert_eq!(first.store, Some("epic"));
    assert_eq!(first.platforms, vec!["PC (Windows)".to_string()]);
    assert_eq!(first.playtime, 3600);
    assert!(first.favorite);
    let second = &status.games[1];
    assert_eq!(second.steam_app_id, Some(400));
    assert_eq!(second.install_path, None);
}

#[test]
fn accepts_a_byte_order_mark() {
    let fixture = Fixture::new();
    fixture.write(&format!("\u{feff}{}", json!({"version": 1, "games": [epic(ONE)]})));
    assert_eq!(status_at(Some(fixture.root.clone())).games.len(), 1);
}

#[test]
fn rejects_unknown_versions_and_bad_ids() {
    let fixture = Fixture::new();
    fixture.export(&json!({"version": 2, "games": [epic(ONE)]}));
    assert_eq!(status_at(Some(fixture.root.clone())).error, Some("playnite_export_invalid"));
    fixture.export(&json!({"version": 1, "games": [epic("not-a-guid"), epic(ONE), epic(ONE)]}));
    let status = status_at(Some(fixture.root.clone()));
    assert_eq!(status.games.len(), 1);
    assert_eq!(status.games[0].id, ONE);
}

#[test]
fn keeps_only_playnite_files_and_https_art() {
    let fixture = Fixture::new();
    let mut game = epic(ONE);
    game["cover"] = json!(fixture.file("cover.jpg"));
    game["background"] = json!("https://cdn.example.com/a.jpg");
    game["icon"] = json!("http://cdn.example.com/a.png");
    fixture.export(&json!({"version": 1, "games": [game]}));
    let read = &status_at(Some(fixture.root.clone())).games[0];
    assert_eq!(read.cover.as_deref(), Some(fixture.file("cover.jpg").as_str()));
    assert_eq!(read.background.as_deref(), Some("https://cdn.example.com/a.jpg"));
    assert_eq!(read.icon, None);
    let outside = std::env::temp_dir().join("elsewhere.jpg").to_string_lossy().into_owned();
    assert_eq!(image(Some(outside), &fixture.files()), None);
    let escape = fixture.files().join("..").join("..").join("secret.jpg").to_string_lossy().into_owned();
    assert_eq!(image(Some(escape), &fixture.files()), None);
    assert_eq!(image(Some("file:///etc/passwd".into()), &fixture.files()), None);
}

#[test]
fn reports_a_missing_export_without_games() {
    let fixture = Fixture::new();
    let status = status_at(Some(fixture.root.clone()));
    assert_eq!(status.error, Some("playnite_export_missing"));
    assert_eq!(status.extension, Some(Extension::Missing));
    assert!(status.games.is_empty());
}

#[test]
fn installs_and_recognises_the_current_extension() {
    let fixture = Fixture::new();
    assert_eq!(install(fixture.folder()).unwrap().extension, Some(Extension::Installed));
    fs::write(extension_dir(&fixture.root).join(SCRIPT_FILE), "old").unwrap();
    assert_eq!(status(fixture.folder()).extension, Some(Extension::Outdated));
}

#[test]
fn dispatches_only_exported_installed_games() {
    let fixture = Fixture::new();
    let owned = json!({"id": TWO, "name": "Owned", "installed": false});
    fixture.export(&json!({"version": 1, "games": [epic(ONE), owned]}));
    assert_eq!(uri(fixture.folder(), &ONE.to_uppercase(), "start").unwrap(), format!("playnite://playnite/start/{ONE}"));
    assert_eq!(uri(fixture.folder(), TWO, "start"), Err("playnite_game_not_installed"));
    assert_eq!(uri(fixture.folder(), TWO, "show").unwrap(), format!("playnite://playnite/showgame/{TWO}"));
    assert_eq!(uri(fixture.folder(), "3c4d5e6f-7081-4923-8a4b-5c6d7e8f90a1", "start"), Err("playnite_game_missing"));
    assert_eq!(uri(fixture.folder(), ONE, "uninstall"), Err("playnite_action_invalid"));
}

#[test]
fn ignores_folders_that_are_not_playnite() {
    let root = std::env::temp_dir().join(format!("compass-playnite-empty-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    assert!(data_dir(Some(&root.to_string_lossy())).is_none());
    assert!(data_dir(Some("relative/Playnite")).is_none());
    let _ = fs::remove_dir_all(root);
}
