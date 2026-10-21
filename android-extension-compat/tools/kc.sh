#!/bin/sh
# Kotlin compiler driver. Runs the embeddable compiler in-process so no Gradle daemon
# ever competes with the app build for this machine.
set -e
R=$(cd "$(dirname "$0")/.." && pwd)
. "$R/tools/portable.sh"
KC=$(cp_join "$R"/tools/*.jar)
CP=${KC_CLASSPATH:-$(cp_join "$R"/libs/*.jar)}
# Java expands this file after launch, avoiding Windows' command-line size limit.
# Convert paths here: Git Bash cannot convert paths inside an argument file.
ARGS=$(mktemp "${TMPDIR:-/tmp}/kc.XXXXXX")
trap 'rm -f "$ARGS"' EXIT HUP INT TERM
arg() {
  printf '"%s"\n' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')" >> "$ARGS"
}
for value in -Xmx2g -cp "$KC" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler \
  -no-stdlib -nowarn -jvm-target 17 -classpath "$CP"; do
  arg "$value"
done
for value in "$@"; do
  if [ -e "$value" ]; then value=$(hostpath "$value"); fi
  arg "$value"
done
"${JBIN}java" "@$(hostpath "$ARGS")"
