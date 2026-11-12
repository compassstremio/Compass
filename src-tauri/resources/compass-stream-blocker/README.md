# Compass Stream Blocker

A local Manifest V3 extension bundled with Compass. It blocks ad requests on Twitch and Kick and filters
Twitch ad playlists. Nothing is fetched at runtime: every file here ships inside the app.

## Files

- `manifest.json`: declares the `declarativeNetRequest` permission and injects `twitch-vaft.js` into
  `https://*.twitch.tv/*` at `document_start`.
- `rules.json`: request-blocking rules, scoped to the `twitch.tv` and `kick.com` initiators. Generated from
  `src/lib/privacy/blocklist.ts` by `node scripts/build-stream-blocker.mjs`; do not edit by hand.
- `twitch-vaft.js`: the `vaft` solution from TwitchAdSolutions (version 37.0.0), vendored unmodified.
- `LICENSE-TwitchAdSolutions`: the MIT license of the vendored script.

## Vendored script provenance

`twitch-vaft.js` comes from <https://github.com/pixeltris/TwitchAdSolutions> (`vaft/vaft.user.js`) at commit
`c51ef2fe8f667f9dc9216eb550924cf0d732ce27`. To update it, replace the file, record the new commit hash here, and
update the `@version` expected by `tests/stream-blocker.test.mjs`.
