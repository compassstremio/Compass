#!/usr/bin/env bash
# Attach built Linux packages to an existing GitHub Release.
#
# Usage: linux-release-assets.sh <tag> <sums-name> <required-globs> <optional-globs> <dir>...
#   required-globs / optional-globs: comma-separated file name globs (optional may be empty).
#   A required glob matching nothing in any <dir> is an error. An optional one is a warning.
#   If the Release for <tag> does not exist, warn and exit 0: releases are written by hand.
# Needs GH_TOKEN and GITHUB_REPOSITORY in the environment, and gh on PATH.
set -euo pipefail

if [ "$#" -lt 5 ]; then
  echo "usage: $0 <tag> <sums-name> <required-globs> <optional-globs> <dir>..." >&2
  exit 2
fi

tag="$1"; sums="$2"; required="$3"; optional="$4"; shift 4
files=()

collect() { # glob, dir -> appends matches to files, returns 1 if none
  local glob="$1" dir="$2" found=0 f
  while IFS= read -r -d '' f; do
    files+=("$f"); found=1
  done < <(find "$dir" -type f -name "$glob" -print0)
  [ "$found" = 1 ]
}

split_globs() { [ -n "$1" ] && tr ',' '\n' <<<"$1" || true; }

failed=0
for dir in "$@"; do
  while IFS= read -r glob; do
    [ -n "$glob" ] || continue
    if ! collect "$glob" "$dir"; then
      echo "::error::No $glob in $dir, so nothing can be attached for $tag from it."
      failed=1
    fi
  done < <(split_globs "$required")
  while IFS= read -r glob; do
    [ -n "$glob" ] || continue
    collect "$glob" "$dir" || echo "::warning::No $glob in $dir. Continuing without it."
  done < <(split_globs "$optional")
done
[ "$failed" = 0 ] || exit 1

if ! gh release view "$tag" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
  echo "::warning::$tag has no release, so nothing was attached. This script never creates one, because releases are written by hand. Publish the release for $tag and re-run the job."
  exit 0
fi

: > "$sums"
for f in "${files[@]}"; do
  (cd "$(dirname "$f")" && sha256sum "$(basename "$f")") >> "$sums"
done

gh release upload "$tag" "${files[@]}" "$sums" --repo "$GITHUB_REPOSITORY" --clobber
