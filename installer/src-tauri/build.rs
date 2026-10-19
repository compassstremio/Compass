use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    bundle_changelog();
    tauri_build::build()
}

/// Every release drops a `<version>-changelog.json` into installer/changelog, written in the
/// same shape as docs/release-notes/<version>.json. Bundle them into one newest-first feed
/// next to the build output so the installer embeds its patch notes offline, and fail the
/// build when a file is malformed or missing its note.
fn bundle_changelog() {
    let dir = Path::new("../changelog");
    let mut entries: Vec<(Vec<u64>, String)> = Vec::new();

    if let Ok(read) = fs::read_dir(dir) {
        for entry in read.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let Some(version) = name.strip_suffix("-changelog.json") else {
                continue;
            };
            let raw = fs::read_to_string(entry.path())
                .unwrap_or_else(|e| panic!("cannot read {}: {e}", entry.path().display()));
            let value: serde_json::Value = serde_json::from_str(&raw)
                .unwrap_or_else(|e| panic!("{name} is not valid JSON: {e}"));
            let channel = value
                .get("channel")
                .and_then(|c| c.as_str())
                .unwrap_or("stable");
            if channel != "stable" && channel != "beta" {
                panic!("{name} has channel \"{channel}\"; use stable or beta");
            }
            let Some(note) = value.get("notes").and_then(|notes| notes.get(version)) else {
                panic!("{name} must hold \"notes\": {{ \"{version}\": {{ ... }} }}");
            };
            for key in ["title", "intro"] {
                let present = note
                    .get(key)
                    .and_then(|v| v.as_str())
                    .map_or(false, |s| !s.is_empty());
                if !present {
                    panic!("{name} is missing a non-empty \"{key}\" for {version}");
                }
            }
            let sections = note
                .get("sections")
                .and_then(|v| v.as_array())
                .filter(|sections| !sections.is_empty())
                .unwrap_or_else(|| panic!("{name} has no sections for {version}"));
            for section in sections {
                let heading = section
                    .get("heading")
                    .and_then(|v| v.as_str())
                    .map_or(false, |s| !s.is_empty());
                let items = section
                    .get("items")
                    .and_then(|v| v.as_array())
                    .map_or(false, |items| !items.is_empty());
                if !heading || !items {
                    panic!("{name} has a section without a heading or items");
                }
            }

            let bundled = serde_json::json!({
                "version": version,
                "channel": channel,
                "pub_date": value.get("pub_date").and_then(|v| v.as_str()),
                "note": note,
            });
            let order = version.split('.').map(|n| n.parse().unwrap_or(0)).collect();
            entries.push((order, bundled.to_string()));
        }
    }

    entries.sort_by(|a, b| b.0.cmp(&a.0));
    let joined = entries
        .into_iter()
        .map(|(_, body)| body)
        .collect::<Vec<_>>()
        .join(",\n");
    let out = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR")).join("changelog.json");
    fs::write(&out, format!("{{\n  \"versions\": [\n{joined}\n  ]\n}}\n"))
        .expect("write the bundled changelog");
    println!("cargo:rerun-if-changed=../changelog");
}
