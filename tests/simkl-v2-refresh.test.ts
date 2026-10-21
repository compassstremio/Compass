// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { sessionNeedsRefresh } from "../src/lib/simkl/refresh-policy.ts";
import type { SimklSession } from "../src/lib/simkl/types";

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

function session(overrides: Partial<SimklSession>): SimklSession {
  return { accessToken: "simkl_at_x", username: "u", ...overrides };
}

test("a legacy PIN session without a refresh token never needs refreshing", () => {
  assert.equal(sessionNeedsRefresh(session({}), NOW), false);
  assert.equal(sessionNeedsRefresh(session({ expiresAt: NOW - HOUR }), NOW), false);
});

test("a V2 session far from expiry is left alone", () => {
  const s = session({ refreshToken: "simkl_rt_x", expiresAt: NOW + 24 * HOUR });
  assert.equal(sessionNeedsRefresh(s, NOW), false);
});

test("a V2 session inside the refresh margin or already expired is refreshed", () => {
  const soon = session({ refreshToken: "simkl_rt_x", expiresAt: NOW + 5 * 60 * 1000 });
  const dead = session({ refreshToken: "simkl_rt_x", expiresAt: NOW - HOUR });
  assert.equal(sessionNeedsRefresh(soon, NOW), true);
  assert.equal(sessionNeedsRefresh(dead, NOW), true);
});

test("no session means nothing to refresh", () => {
  assert.equal(sessionNeedsRefresh(null, NOW), false);
});
