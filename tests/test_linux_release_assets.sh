#!/usr/bin/env bash
# Tests for scripts/linux-release-assets.sh, run against a fake gh on PATH.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/linux-release-assets.sh"
FAILED=0

new_case() {
  CASE_DIR="$(mktemp -d)"
  mkdir -p "$CASE_DIR/bin"
  cat > "$CASE_DIR/bin/gh" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$GH_LOG"
if [ "$1 $2" = "release view" ] && [ "${FAKE_NO_RELEASE:-0}" = "1" ]; then exit 1; fi
exit 0
STUB
  chmod +x "$CASE_DIR/bin/gh"
  export GH_LOG="$CASE_DIR/gh.log"
  : > "$GH_LOG"
  export GITHUB_REPOSITORY="owner/repo" GH_TOKEN="x"
  unset FAKE_NO_RELEASE
}

make_arch() { # dir, files...
  local d="$CASE_DIR/$1"; shift
  mkdir -p "$d/nested"
  for f in "$@"; do echo "$f" > "$d/nested/$f"; done
}

run_script() { # required optional dirs...
  (cd "$CASE_DIR" && PATH="$CASE_DIR/bin:$PATH" bash "$SCRIPT" v1.2.3 SHA256SUMS-linux "$1" "$2" "${@:3}") \
    > "$CASE_DIR/out.txt" 2>&1
  RC=$?
}

check() { # name, condition-result
  if [ "$2" = "0" ]; then echo "PASS $1"; else echo "FAIL $1"; cat "$CASE_DIR/out.txt"; cat "$GH_LOG"; FAILED=1; fi
}

all_present_uploads_files_and_sums() {
  new_case
  make_arch x86_64 a_amd64.deb a_amd64.AppImage a.x86_64.rpm
  make_arch aarch64 a_arm64.deb a_arm64.AppImage a.aarch64.rpm
  run_script '*.deb,*.AppImage' '*.rpm' x86_64 aarch64
  local up; up="$(grep '^release upload' "$GH_LOG" || true)"
  [ "$RC" = 0 ] && [ "$(echo "$up" | wc -l)" = 1 ] \
    && for f in a_amd64.deb a_amd64.AppImage a.x86_64.rpm a_arm64.deb a_arm64.AppImage a.aarch64.rpm SHA256SUMS-linux; do
         echo "$up" | grep -q "$f" || { false; break; }
       done
  check all_present_uploads_files_and_sums $?
}

missing_required_fails() {
  new_case
  make_arch x86_64 a_amd64.deb a_amd64.AppImage
  make_arch aarch64 a_arm64.deb
  run_script '*.deb,*.AppImage' '*.rpm' x86_64 aarch64
  [ "$RC" = 1 ] && ! grep -q '^release upload' "$GH_LOG"
  check missing_required_fails $?
}

missing_optional_warns_and_continues() {
  new_case
  make_arch x86_64 a_amd64.deb a_amd64.AppImage
  make_arch aarch64 a_arm64.deb a_arm64.AppImage
  run_script '*.deb,*.AppImage' '*.rpm' x86_64 aarch64
  [ "$RC" = 0 ] && grep -q '::warning::' "$CASE_DIR/out.txt" \
    && grep '^release upload' "$GH_LOG" | grep -q 'a_arm64.AppImage'
  check missing_optional_warns_and_continues $?
}

no_release_warns_and_exits_zero() {
  new_case
  export FAKE_NO_RELEASE=1
  make_arch x86_64 a_amd64.deb a_amd64.AppImage
  run_script '*.deb,*.AppImage' '*.rpm' x86_64
  [ "$RC" = 0 ] && grep -q '::warning::' "$CASE_DIR/out.txt" && ! grep -q '^release upload' "$GH_LOG"
  check no_release_warns_and_exits_zero $?
}

all_present_uploads_files_and_sums
missing_required_fails
missing_optional_warns_and_continues
no_release_warns_and_exits_zero
exit $FAILED
