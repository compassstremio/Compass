// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { isLocalNetworkHostName, isLocalNetworkUrl } from "../src/lib/local-network.ts";

test("loopback and link-local targets count as local network", () => {
  for (const url of [
    "http://localhost/manifest.json",
    "http://localhost:3000/stream/movie/tt1.json",
    "http://sub.localhost:8080/x",
    "http://127.0.0.1:3000/stremio/x/manifest.json",
    "http://127.9.9.9/x",
    "https://127.0.0.1/x",
    "http://169.254.1.1/x",
    "http://0.0.0.0:11470/x",
    "http://255.255.255.255/x",
    "http://[::1]:3000/x",
    "http://[::]/x",
    "http://[fe80::1]/x",
    "http://[0:0:0:0:0:0:0:1]/x",
    "http://[::ffff:127.0.0.1]/x",
    "http://[::ffff:7f00:1]/x",
  ]) {
    assert.equal(isLocalNetworkUrl(url), true, url);
  }
});

test("public and unrelated targets are left to the guarded fetch", () => {
  for (const url of [
    "https://torrentio.strem.fun/manifest.json",
    "https://comet.elfhosted.com/x/manifest.json",
    "https://example.com/x",
    // RFC1918 is not part of the guard's blocked set, so it needs no opt-in.
    "https://192.168.1.5:3000/manifest.json",
    "https://10.0.0.7/x",
    "https://172.16.4.2/x",
    "https://[2001:db8::1]/x",
    "not a url",
    "",
  ]) {
    assert.equal(isLocalNetworkUrl(url), false, url);
  }
});

test("local hosts need an unambiguous address, not a name shape", () => {
  for (const host of [
    "localhost",
    "sub.localhost",
    "127.0.0.1",
    "127.9.9.9",
    "::1",
    "169.254.1.1",
    "10.0.0.5",
    "172.16.4.2",
    "172.31.255.254",
    "192.168.1.5",
    "fd00::1",
  ]) {
    assert.equal(isLocalNetworkHostName(host), true, host);
  }
  for (const host of [
    "example.com",
    "myaddon.local",
    "media.home.arpa",
    "subs.lan",
    "addon.internal",
    "100.64.0.5",
    "198.18.0.1",
    "8.8.8.8",
    "172.32.0.1",
    "2001:db8::1",
    "not a url",
    "",
  ]) {
    assert.equal(isLocalNetworkHostName(host), false, host);
  }
});
