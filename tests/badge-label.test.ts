import { test } from "node:test";
import assert from "node:assert/strict";

import { badgeLabel } from "../src/lib/social/badge-label";

test("badge names are shown with spaces instead of underscores", () => {
  assert.equal(badgeLabel("theme_creator"), "theme creator");
  assert.equal(badgeLabel("content_creator"), "content creator");
  assert.equal(badgeLabel("top_theme_creator"), "top theme creator");
  assert.equal(badgeLabel("community_manager"), "community manager");
});

test("names without underscores and missing input are left alone", () => {
  assert.equal(badgeLabel("verified"), "verified");
  assert.equal(badgeLabel("og"), "og");
  assert.equal(badgeLabel(""), "");
  assert.equal(badgeLabel(undefined), "");
  assert.equal(badgeLabel(null), "");
});

test("the stored badge key is not changed by labelling it", () => {
  const stored = "theme_creator";
  badgeLabel(stored);
  assert.equal(stored, "theme_creator");
});
