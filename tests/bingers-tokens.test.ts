import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyRefresh,
  classifyTokenPoll,
  errorCode,
  parseDeviceCode,
  parseMe,
  sessionFromTokens,
} from "../src/lib/bingers/tokens.ts";
import type { BingersSession } from "../src/lib/bingers/types.ts";

const NOW = 1_760_000_000_000;

const session: BingersSession = {
  accessToken: "old-access",
  refreshToken: "old-refresh",
  expiresAt: NOW,
  scope: "library:read library:write offline_access profile",
  name: "Sam",
  handle: "sam",
  connectedAt: NOW - 86_400_000,
};

test("a device code keeps the server's pages only when they are bingers.app over https", () => {
  const device = parseDeviceCode({
    device_code: "dev",
    user_code: "ABCD-1234",
    verification_uri: "https://bingers.app/activate",
    verification_uri_complete: "https://bingers.app/activate?code=ABCD-1234",
    expires_in: 900,
    interval: 5,
  });
  assert.deepEqual(device, {
    deviceCode: "dev",
    userCode: "ABCD-1234",
    verificationUrl: "https://bingers.app/activate",
    verificationUrlComplete: "https://bingers.app/activate?code=ABCD-1234",
    expiresIn: 900,
    pollIntervalSec: 5,
  });

  const hostile = parseDeviceCode({
    device_code: "dev",
    user_code: "ABCD-1234",
    verification_uri: "https://bingers.app.evil.example/activate",
    verification_uri_complete: "http://bingers.app/activate",
  });
  assert.equal(hostile?.verificationUrl, "https://bingers.app/activate");
  assert.equal(hostile?.verificationUrlComplete, null);
  assert.equal(hostile?.expiresIn, 600);
  assert.equal(hostile?.pollIntervalSec, 5);
});

test("a device code without its codes is rejected", () => {
  assert.equal(parseDeviceCode({ user_code: "ABCD" }), null);
  assert.equal(parseDeviceCode(null), null);
});

test("polling maps the RFC 8628 answers", () => {
  assert.deepEqual(classifyTokenPoll(400, { error: "authorization_pending" }, NOW), {
    kind: "pending",
  });
  assert.deepEqual(classifyTokenPoll(400, { error: "slow_down" }, NOW), { kind: "slow_down" });
  assert.deepEqual(classifyTokenPoll(400, { error: "expired_token" }, NOW), { kind: "expired" });
  assert.deepEqual(classifyTokenPoll(400, { error: "access_denied" }, NOW), { kind: "denied" });
  assert.deepEqual(
    classifyTokenPoll(
      400,
      { error: "invalid_client", error_description: "Metadata document fetch returned HTTP 404" },
      NOW,
    ),
    { kind: "error", message: "Metadata document fetch returned HTTP 404" },
  );
  assert.deepEqual(classifyTokenPoll(502, null, NOW), { kind: "error", message: "HTTP 502" });
});

test("an authorized poll becomes a session that expires on the server's clock", () => {
  const result = classifyTokenPoll(
    200,
    { access_token: "a", refresh_token: "r", expires_in: 3600, scope: "library:read" },
    NOW,
  );
  assert.equal(result.kind, "authorized");
  if (result.kind !== "authorized") return;
  assert.equal(result.session.accessToken, "a");
  assert.equal(result.session.refreshToken, "r");
  assert.equal(result.session.expiresAt, NOW + 3_600_000);
  assert.equal(result.session.connectedAt, NOW);
  assert.equal(classifyTokenPoll(200, { token_type: "Bearer" }, NOW).kind, "error");
});

test("a refresh that does not rotate keeps the refresh token and the identity", () => {
  const next = sessionFromTokens({ access_token: "new-access", expires_in: 3600 }, NOW, session);
  assert.deepEqual(next, {
    ...session,
    accessToken: "new-access",
    expiresAt: NOW + 3_600_000,
  });
  const rotated = sessionFromTokens({ access_token: "a2", refresh_token: "r2" }, NOW, session);
  assert.equal(rotated?.refreshToken, "r2");
});

test("only a rejected grant signs the user out; other refresh failures retry later", () => {
  assert.deepEqual(classifyRefresh(400, { error: "invalid_grant" }, NOW, session), {
    kind: "revoked",
  });
  assert.deepEqual(classifyRefresh(401, null, NOW, session), { kind: "revoked" });
  assert.deepEqual(classifyRefresh(503, null, NOW, session), { kind: "failed" });
  assert.deepEqual(classifyRefresh(429, { error: "rate_limited" }, NOW, session), {
    kind: "failed",
  });
  assert.equal(classifyRefresh(200, { access_token: "x" }, NOW, session).kind, "ok");
});

test("error codes read from both the OAuth and the REST shapes", () => {
  assert.equal(errorCode({ error: "invalid_grant" }), "invalid_grant");
  assert.equal(
    errorCode({ error: { code: "insufficient_scope", message: "m" } }),
    "insufficient_scope",
  );
  assert.equal(errorCode("nope"), null);
});

test("the account name is read flat or nested under user", () => {
  assert.deepEqual(parseMe({ name: "Sam", handle: "sam" }), { name: "Sam", handle: "sam" });
  assert.deepEqual(parseMe({ user: { name: "Sam", username: "sam" }, scopes: [] }), {
    name: "Sam",
    handle: "sam",
  });
  assert.deepEqual(parseMe({ user: { name: null, handle: null } }), { name: null, handle: null });
});
