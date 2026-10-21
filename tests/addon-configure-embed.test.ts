// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { framesAllowedByHeaders } from "../src/lib/addons-store/configure-embed.ts";

// The exact pair SubMaker's configure page answers with; the iframe shows Chromium's
// "refused to connect" error page for these, which still fires the iframe's load event.
const SUBMAKER_HEADERS = {
  xFrameOptions: "SAMEORIGIN",
  contentSecurityPolicy:
    "default-src 'self';base-uri 'self';frame-ancestors 'self';img-src 'self' data:;object-src 'none'",
};

test("configure pages that forbid framing are detected from their headers", () => {
  assert.equal(framesAllowedByHeaders({}), true);
  assert.equal(framesAllowedByHeaders({ xFrameOptions: null, contentSecurityPolicy: null }), true);
  assert.equal(framesAllowedByHeaders(SUBMAKER_HEADERS), false);
  assert.equal(framesAllowedByHeaders({ xFrameOptions: "DENY" }), false);
  assert.equal(framesAllowedByHeaders({ xFrameOptions: "sameorigin" }), false);
  assert.equal(framesAllowedByHeaders({ contentSecurityPolicy: "frame-ancestors 'self'" }), false);
  assert.equal(
    framesAllowedByHeaders({ contentSecurityPolicy: "frame-ancestors https://compass.sarl" }),
    false,
  );
  assert.equal(framesAllowedByHeaders({ contentSecurityPolicy: "frame-ancestors *" }), true);
  assert.equal(
    framesAllowedByHeaders({ contentSecurityPolicy: "default-src 'self'; img-src https:" }),
    true,
  );
});

test("the installer viewport preflights framing and never embeds a blocked page", () => {
  const source = readFileSync(
    new URL("../src/components/installer-viewport.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /canEmbedConfigurePage\(url\)/, "the preflight must run on open");
  assert.match(source, /embed === "ok" && \(/, "the iframe only renders when framing is allowed");
  assert.match(source, /blocked \|\| embed === "blocked"/, "blocked pages show the fallback");
});
