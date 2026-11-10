#!/usr/bin/env bash
# Builds Compass PC for macOS on a Mac laptop. Same steps as the macOS jobs of .github/workflows/tauri-build.yml.
# Usage (from the repo root):  bash scripts/build-macos-local.sh
# Needs: macOS, Xcode command line tools, Homebrew, Rust (rustup), Node 22, pnpm, python3, .NET SDK 10.0.401 (for the Pokémon engine).
# Updater signing (optional): copy compass-updater.key from the PC (C:\Users\pc\.tauri\) to ~/.tauri/ on the Mac. Without it the
# installers are built but there are no signed updater artifacts. If the key has a password: export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=...
# Output: src-tauri/target/<target>/release/bundle/ (dmg, Compass.app, Compass_<version>_<arch>.app.tar.gz).
set -euo pipefail

[ "$(uname)" = Darwin ] || { echo "This script must run on macOS." >&2; exit 1; }
cd "$(dirname "$0")/.."

need() { command -v "$1" >/dev/null || { echo "Missing: $1 ($2)" >&2; exit 1; }; }
need brew "install Homebrew from https://brew.sh"
need cargo "install Rust: https://rustup.rs"
need rustup "install Rust: https://rustup.rs"
need node "install Node 22"
need pnpm "npm install -g pnpm"
need python3 "xcode-select --install"
need dotnet "install the .NET SDK 10.0.401"
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || { echo "Node 22 or newer is required (found $(node --version))." >&2; exit 1; }

case "$(uname -m)" in
  arm64) TARGET=aarch64-apple-darwin; FFARCH=arm ;;
  x86_64) TARGET=x86_64-apple-darwin; FFARCH=intel ;;
  *) echo "Unknown CPU: $(uname -m)" >&2; exit 1 ;;
esac
echo "Building for $TARGET"

brew install mpv pkg-config
export PKG_CONFIG_PATH="$(brew --prefix mpv)/lib/pkgconfig:${PKG_CONFIG_PATH:-}"
rustup target add "$TARGET"

# Pokémon engine and its source bundle (as in CI).
TMP="$(mktemp -d)"
node tools/pokemon-engine/build.mjs --fetch-source "$TMP/compass-pokemon-source" --output src-tauri/resources/pokemon-engine --artifacts "$TMP/compass-pokemon-build"

pnpm install --frozen-lockfile
cargo test --manifest-path scripts/http-redirect-tests/Cargo.toml --locked --lib

# External binaries the app launches.
mkdir -p src-tauri/binaries
(
  cd src-tauri/binaries
  curl --retry 6 --retry-delay 4 --retry-all-errors -L "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos" -o "yt-dlp-$TARGET"
  chmod +x "yt-dlp-$TARGET"
  curl --retry 6 --retry-delay 4 --retry-all-errors -L "https://www.osxexperts.net/ffmpeg6$FFARCH.zip" -o ffmpeg.zip
  curl --retry 6 --retry-delay 4 --retry-all-errors -L "https://www.osxexperts.net/ffprobe6$FFARCH.zip" -o ffprobe.zip
  unzip -o ffmpeg.zip && unzip -o ffprobe.zip
  mv -f ffmpeg "ffmpeg-$TARGET" && mv -f ffprobe "ffprobe-$TARGET"
  chmod +x "ffmpeg-$TARGET" "ffprobe-$TARGET"
  rm -f ffmpeg.zip ffprobe.zip
)

( cd compass-core && cargo check && cargo test --all-targets )

# Updater signing key: read from the file, never printed.
SIGN_ARGS=()
KEY="${TAURI_KEY_FILE:-$HOME/.tauri/compass-updater.key}"
if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ] && [ -f "$KEY" ]; then
  export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY")"
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
fi
if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  SIGN_ARGS=(--config src-tauri/tauri.updater.conf.json)
  echo "Updater signing: on"
else
  echo "Updater signing: off (no key at $KEY). Installers only."
fi

# Bundle libmpv into the app.
FRAMEWORKS_DIR="$TMP/compass-macos-frameworks-$TARGET"
CONFIG_PATH="$TMP/tauri-macos-libmpv-$TARGET.json"
python3 tests/test_macos_mpv_bundle.py
python3 tests/test_macos_signature.py
python3 tests/test_macos_resign.py
python3 tests/test_macos_startup.py
python3 scripts/macos-bundle-libmpv.py prepare --frameworks "$FRAMEWORKS_DIR" --config "$CONFIG_PATH" --target "$TARGET"
export COMPASS_MACOS_FRAMEWORKS_DIR="$FRAMEWORKS_DIR"
export COMPASS_MACOS_LIB_DIR="$FRAMEWORKS_DIR/link"

pnpm tauri build --target "$TARGET" ${SIGN_ARGS[@]+"${SIGN_ARGS[@]}"} --config "$CONFIG_PATH"

BUNDLE="src-tauri/target/$TARGET/release/bundle"
APP_PATH="$(find "$BUNDLE" -type d -name 'Compass.app' -print -quit)"
[ -n "$APP_PATH" ] || { echo "Compass.app was not produced" >&2; exit 1; }
python3 scripts/macos-bundle-libmpv.py verify-app --app "$APP_PATH" --target "$TARGET"
python3 scripts/macos-verify-signature.py --app "$APP_PATH"
python3 scripts/macos-startup-check.py --app "$APP_PATH" --output "$TMP/compass-macos-startup" --seconds 20

VERSION="$(node -p "JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json')).version")"
tar -czf "$BUNDLE/Compass_${VERSION}_${TARGET%%-*}.app.tar.gz" -C "$(dirname "$APP_PATH")" Compass.app

echo
echo "Done. Output in $BUNDLE"
find "$BUNDLE" -maxdepth 3 \( -name '*.dmg' -o -name '*.app.tar.gz' -o -name '*.sig' \) -print
echo "Without an Apple certificate the app is ad-hoc signed: on first run use  xattr -dr com.apple.quarantine /Applications/Compass.app"
