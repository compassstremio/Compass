# Compass Pokémon engine

This is the separately built, offline helper process used by Compass's Pokémon
workspace. `Program.cs` provides the JSON stdin/stdout protocol around PKForge;
Compass owns file paths, backups and the explicit commit of save changes.

## Source and license

[`upstream.json`](upstream.json) is authoritative for protocol version 1 and the
immutable source revisions of PKForge, its PKHeX fork and PKHeX-Plugins/AutoMod.
`build.mjs` checks all three checkout HEADs against those pins and rejects
reported source changes before building. Do not update a dependency independently
or build from a moving branch.

The wrapper declares `GPL-3.0-or-later`; see [LICENSE](LICENSE). Each upstream
source archive retains its own license and notices. Keep the complete
corresponding-source bundle and licenses with the helper when packaging it.

## Build

Use Git, the repository's Node.js environment and .NET SDK **10.0.401**, as pinned
by the application build workflows. The first build needs access to the pinned
Git repositories and NuGet. The helper's offline runtime does not make its build
offline.

Run from the Compass repository root, using an unused source directory and an
artifacts directory outside the checkout:

```sh
node tools/pokemon-engine/build.mjs --fetch-source ../compass-pokemon-source --output src-tauri/resources/pokemon-engine --artifacts ../compass-pokemon-build
```

`--fetch-source` initializes a missing directory at the pinned PKForge revision
and initializes its submodules. An existing directory is validated, not repaired
or updated automatically. For a prepared checkout with initialized submodules,
replace `--fetch-source` with `--source` and use the same remaining arguments.
Extracted source ZIPs alone are not Git checkouts and do not satisfy this strict
checkout validation.

The runtime identifier defaults to the current platform and architecture.
Override it with `--rid win-x64`, `win-arm64`, `linux-x64`, `linux-arm64`, `osx-x64`
or `osx-arm64`. Use `--dotnet <SDK executable>` if the required SDK is not on PATH.

## Output and verification

The output contains the self-contained .NET publish files, including
`Compass.PokemonEngine.exe` on Windows or `Compass.PokemonEngine` elsewhere. Package
the whole output directory, not just that executable. `sources/` contains:

- `pkforge.zip`, `pkhex.zip` and `automod.zip` from the exact validated revisions.
- The wrapper's `Program.cs`, project file, `upstream.json`, `LICENSE`,
  `build.mjs` and this README, so its build inputs and instructions travel with it.

Only after publishing and copying all sources does the script write
`engine.json`, recording the protocol, runtime identifier, PKForge revision,
executable SHA-256, source directory and declared license. A successful run ends
with `Engine and corresponding sources: ...`.

An executable left by a failed run is not proof of complete staging. Resolve the
reported error and rerun the script; do not fabricate `engine.json`, skip required
source/license files or disable the engine to make packaging pass. Generated
engine output and build artifacts are not repository source files.
