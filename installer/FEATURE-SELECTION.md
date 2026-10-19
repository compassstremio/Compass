# Installer feature selection

Plan for letting the user choose optional features during installation of the
managed installer (`compass-setup.exe`), and for the installed app to honor that
choice.

Feasibility is covered by two facts established from the current tree:

- **Components** staged as separate payload files can be truly not installed:
  the extension runtime (`capstan/`, ~40 MB packed / ~56 MB on disk) and the
  games engine (`resources/pokemon-engine/`, currently not staged at all).
  The app already degrades gracefully when either is absent.
- **UI features** (Music, eBook, Manga) are React views compiled into
  `compass.exe`. The installer cannot remove them from disk; a toggle can only
  hide their tabs. Their views are lazy chunks and cost nothing unless opened.

All five rows default to on, so a build with no selection behaves exactly like
today's installer.

## Feature model

One key per user-visible feature. Keys are stable and used in the installer UI,
the install marker and the app's runtime gating.

| Key | What it controls | Payload prefix skipped when off |
| --- | --- | --- |
| `plugins` | Extension support (Capstan JVM runtime + jars) and the Plugins tab | `capstan/` |
| `games` | Games tab and the local Pokémon engine | `resources/pokemon-engine/` |
| `music` | Music tab, dock and related entry points | none (UI in `compass.exe`) |
| `ebook` | eBook tab | none |
| `manga` | Manga tab | none |

Everything not listed is core and always installed: `compass.exe`,
`uninstall.exe`, mpv/libmpv, ffmpeg/ffprobe, yt-dlp, fonts, notices.

## Marker contract

The installer already writes `compass-install.json` next to `compass.exe`
(`write_install_marker` in `installer/src-tauri/src/install.rs`), and the app
already reads it (`src-tauri/src/installer_handoff.rs`). Add one key:

```json
{
  "payloadVersion": 9132,
  "version": "0.9.132",
  "installedAt": 1780000000,
  "installer": "compass-setup",
  "disabledFeatures": ["plugins", "music"]
}
```

Rules:

- **Absent key = nothing disabled.** Legacy NSIS installs, bootstrap markers
  (`compass-bootstrap`) and any marker written by an older setup keep every
  feature on. This is the whole backward-compatibility story.
- **Exclusion semantics, not inclusion.** The list records what the user took
  away. A feature added in a future release is therefore on by default for
  existing installs; the user can turn it off the next time setup runs.
  (Alternative inclusion lists were rejected because they silently hide new
  features from existing users.)
- Unknown keys are ignored by both sides, so forward compatibility needs no
  versioning.
- The installer always writes the key (possibly `[]`) from the first
  feature-aware version onward; the app never writes it.

## Installer changes

### 1. Payload staging — `installer/scripts/make-payload.mjs`

- Stage `src-tauri/resources/pokemon-engine/` as `resources/pokemon-engine/`
  (recursive copy, mirroring how fonts are copied). This is the path
  `pokemon_bank::engine_path` already resolves via `resource_dir()`.
- Gate it like Capstan: fail the build when the directory is missing or empty
  unless `COMPASS_POKEMON_OPTIONAL=1` is set. CI builds the engine before the
  payload step (`tauri-build.yml`), so the failure only hits checkout builds.
- Optional: extend `scripts/verify-managed-payload.mjs` to assert the engine
  is present when staging succeeded.

### 2. Extraction filter — `installer/src-tauri/src/install.rs`

- Pure helper, unit-testable:

  ```rust
  fn entry_allowed(rel: &Path, disabled: &[String]) -> bool
  ```

  Skips entries whose first segments match `capstan/` or
  `resources/pokemon-engine/` when the matching key is disabled; everything
  else passes.
- `extract_payload` takes the disabled list and skips disallowed entries.
  The `shipped` set keeps only extracted files, so the existing `prune_stale`
  removes previously installed files for newly disabled features on any
  reinstall/update — deselecting cleans up.
- `run_install` command gains `features: Option<Vec<String>>` (camelCase
  `features` from JS). `None` means "all on" and exists for compat with an old
  UI talking to a new setup binary.
- Config-marker plumbing:
  - `write_install_marker(dest, version, disabled)` writes
    `"disabledFeatures"`.
  - New command `installed_features(dest) -> Vec<String>` reads the current
    marker so the Repair/Update screen can seed the toggles from what is
    actually installed (missing marker or key → empty list).
- `install_facts`: add buckets `plugins` (`capstan` names) and `games`
  (`pokemon-engine` names) to `bucket_for`, so the Components screen can show
  per-feature sizes and compute the selected total live.

### 3. Update and repair carry-over

Every automatic path must preserve the recorded choice; otherwise updates
silently re-add removed components.

- `install_core(dest, desktop, disabled: Option<&[String]>, progress)`:
  `None` → read the existing marker (all-on when absent). `update.rs`'s
  non-recoverable path keeps calling it and now inherits the choice.
- `run_recoverable` (`update.rs`): read the marker **before**
  `Transaction::begin` moves the old tree; pass the list into
  `prepare_recoverable`, which extracts with the filter and writes the marker
  with the same list; `finish_recoverable` keeps it.
- `run_repair`: read the marker, filter the payload check/restore to allowed
  entries, and prune disabled prefixes the same way install does — repair must
  never resurrect a feature the user removed. The report counts shrink
  accordingly.
- `bridge.js` `repair()` passes the features currently shown on the screen so
  a repair can also change the selection.
- Uninstall is unchanged: it removes the whole tree either way.

### 4. Installer UI — `installer/ui/`

- State: `features: { plugins: true, games: true, music: true, ebook: true,
  manga: true }` in `app.js`; `installing.js` passes the disabled list to
  `runInstall` / `runRepair`.
- `screens/welcome.js` ("What gets installed") grows two groups below the
  existing core rows:
  - **Optional components** — Extension support (`plugins`, size from facts),
    Game engine (`games`, hidden when the payload has no engine bytes).
  - **Optional tabs** — Music, eBook, Manga, each noted as hiding the tab.
  Rows are toggle buttons following the existing `hb-welcome-row` markup;
  disabling a row subtracts its bytes from the `needed` total and the free
  space check. The row list already comes from a static array, so this is
  additive.
- For Repair/Update on an existing managed install, seed the toggles from
  `installed_features` and keep the current action label logic untouched.
- Strings: English literals via `t()`; add keys to
  `ui/locales/{ar,pt,pt-PT,ru}.js` as translations land.

## App-side gating

### 1. Rust

- New module `src-tauri/src/install_features.rs`:
  `install_features() -> InstallFeatures` reads `<exe dir>/compass-install.json`
  (same lookup as `installer_handoff.rs`), maps `disabledFeatures` to five
  booleans, all true when the marker or key is absent, and always true on
  macOS/Linux. Register it in `lib.rs`.
- Keep the struct independent of `installer_handoff.rs`'s private
  `InstallMarker`; the two readers serve different purposes and should be able
  to evolve separately.

### 2. Frontend

- New `src/lib/features/install.ts`: one-time load plus `useInstallFeatures()`
  following the `src/lib/sports/enabled.ts` store pattern (safe defaults until
  loaded, so nothing flickers off).
- `src/chrome/nav-items.tsx`:
  - `useAvailableNavItems` also filters `music`, `ebook`, `manga` by feature.
  - Replace the `GAMES_IN_NAV` constant with `features.games && GAMES_IN_NAV`
    (the constant stays as the compile-time kill switch).
  - `plugins` keeps its existing `usePluginCataloguesAvailable` gate; both
    must pass.
- `src/App.tsx`: gate the lazy layers (`musicTop`, `mangaAlive`, `ebookAlive`)
  and add a central guard so navigation to a disabled view — deep links
  (`compass://`, `stremio://`), context menus, search commits — is dropped
  instead of mounting a hidden view.
- Entry-point affordances that point at disabled tabs should disappear rather
  than dead-click: the music dock (`src/components/music/music-dock.tsx`),
  soundtrack rows, Spooktober playlist links, the anime hero's "Read the
  Manga/eBook" button, and the search overlay's Music row/filter
  (`search-overlay.tsx`, `search-filter-bar.tsx`).
- Settings: the navigation customization lists derive from the available nav
  items, so disabled features simply never appear there. No settings changes
  in v1 — see open decisions for the "change later" story.

## Compatibility and edge cases

- **Legacy marker / no marker** → everything on. Nothing changes for NSIS
  installs, macOS, Linux or Flatpak.
- **NSIS reinstall over a managed install** writes all files back while the
  marker keeps the choice; the app stays gated, but `capstan/` and the engine
  reappear on disk. Accepted limitation of v1: feature choice is a managed
  installer capability. Document it; revisit if NSIS ever gets components.
- **Download size does not shrink.** One embedded zip means the setup exe
  stays the same size; only disk usage changes. Per-feature payloads are out
  of scope.
- **Changing your mind**: Settings → Updates & backup → **Modify installation**
  opens Compass Setup with the toggles seeded from the marker; enabling or
  disabling then applies through Repair. The row reuses a setup left in the
  temp folder by a previous update when its `.sig` still verifies, and asks
  before downloading the full installer when none is usable. Compass closes
  first with the same graceful flush an update uses. Re-running
  `compass-setup.exe` by hand always works too.
- **Deep links to disabled tabs** resolve to the current view; no error UI.
- **Repair on a damaged install with disabled features** only verifies what
  should exist; it must not flag disabled components as missing.

## Phases

1. **Components, end to end** — payload staging, extraction filter, marker,
   `run_install`/`installed_features`, facts buckets, welcome rows for
   `plugins` and `games`, update/repair carry-over, app-side `games` tab
   gating. Self-contained and user-visible on its own.
2. **Tabs** — `music`/`ebook`/`manga` rows plus all frontend gating
   (nav, layers, search, entry points, central guard).
3. **Polish** — locale keys, README/website copy, marker docs, optional
   `verify-managed-payload` assertions.

Estimated effort: roughly 3–5 focused days, dominated by phase 2's entry
point sweep and manual update/repair verification.

## Testing

- Rust unit tests in `install.rs`: `entry_allowed` mapping (including nested
  paths and `resources/pokemon-engine` vs unrelated `resources` files),
  marker round-trip, all-off and partial selections, unknown keys ignored.
- `node installer/serve.mjs` preview for the welcome toggles (non-native mode
  has no install to run; verify state wiring through `CompassInstaller.state`).
- Manual matrix on Windows:
  - fresh install with each single feature off and with all off — inspect the
    install tree, confirm launch, confirm disabled tabs absent;
  - repair with an unchanged and a changed selection — no resurrection, no
    removal of enabled files;
  - `--update` over a selection — payload files for disabled features stay
    gone, marker keeps the list;
  - recoverable update path — same assertions after the swap;
  - uninstall — full removal either way;
  - disabled plugin runtime while an extension is installed — existing
    "runtime is missing" error path still holds.
- Frontend: unit test for the nav filter pure function; manual deep-link and
  search checks with features off.

## Open decisions

1. **Marker shape** — this plan uses `disabledFeatures` (exclusion list). If
   the product prefers "new features are off until chosen", switch to an
   inclusion list before implementation; every other section is unaffected.
2. **Tabs coverage** — the plan hides disabled tabs everywhere (nav, layers,
   search results, entry points). A lighter v1 could hide only the nav item
   and accept reachable deep links; not recommended.
3. **Change-later flow** — v1 re-runs setup. A follow-up can add a Settings
   action that launches `compass-setup.exe --modify` with the current selection
   surfaced in the UI.
4. **NSIS channel** — accepted as unaffected in v1. Adding real components to
   NSIS would require custom sections and is a separate project.
