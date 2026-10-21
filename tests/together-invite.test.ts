import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInviteUrl,
  emitTogetherInvite,
  onTogetherInvite,
  parseTogetherDeepLink,
  type ParsedInvite,
} from "../src/lib/together/invite";

test("shared invites use the hosted apex and reach the native invite parser", () => {
  const relay = "wss://relay.example.test/base?region=eu&version=11";
  const shared = new URL(buildInviteUrl(relay, "abc234"));
  assert.equal(shared.origin, "https://compass.sarl");
  assert.deepEqual(parseTogetherDeepLink(`compass://together?${shared.searchParams}`), {
    relayUrl: relay,
    roomCode: "ABC234",
  });
});

test("native invites reject other schemes, malformed relays and incomplete rooms", () => {
  const query = new URLSearchParams({ "compass-relay": "wss://relay.example.test", "compass-room": "ABC234" });
  assert.equal(parseTogetherDeepLink(`https://together?${query}`), null);
  assert.equal(parseTogetherDeepLink(`compass://together/other?${query}`), null);
  assert.equal(parseTogetherDeepLink(`compass://together?${query}&compass-room=XYZ789`), null);
  for (const relay of ["javascript:alert(1)", "https://relay.example.test", "wss://user:password@relay.example.test", "wss://relay.example.test/#fragment"]) {
    query.set("compass-relay", relay);
    assert.equal(parseTogetherDeepLink(`compass://together?${query}`), null);
  }
  query.set("compass-relay", "wss://relay.example.test");
  for (const room of ["ABC", "ABC2345", "ABC-23"]) {
    query.set("compass-room", room);
    assert.equal(parseTogetherDeepLink(`compass://together?${query}`), null);
  }
});

test("an invite carrying the retired public relay joins through the replacement", () => {
  const query = new URLSearchParams({ "compass-relay": "wss://pub.compass.sarl", "compass-room": "ABC234" });
  assert.deepEqual(parseTogetherDeepLink(`compass://together?${query}`), {
    relayUrl: "wss://pub.compass.sarl",
    roomCode: "ABC234",
  });
});

test("a launch invite is delivered once when the provider subscribes", () => {
  const invite = { relayUrl: "wss://relay.example.test", roomCode: "ABC234" };
  emitTogetherInvite(invite);
  const received: ParsedInvite[] = [];
  const stop = onTogetherInvite((value) => received.push(value));
  assert.deepEqual(received, [invite]);
  stop();
  const stopNext = onTogetherInvite((value) => received.push(value));
  assert.equal(received.length, 1);
  emitTogetherInvite({ ...invite, roomCode: "XYZ789" });
  assert.equal(received[1].roomCode, "XYZ789");
  stopNext();
});
