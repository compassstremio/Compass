import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeBack,
  hasBackHandlers,
  pushBackHandler,
  subscribeBackHandlers,
} from "../src/lib/back-intercept.ts";
import { requestAppBack } from "../src/lib/app-back.ts";

test("page Back availability follows registered section handlers without requiring a route history", () => {
  const availability: boolean[] = [];
  const unsubscribe = subscribeBackHandlers(() => availability.push(hasBackHandlers()));
  let inner = 0;
  let outer = 0;
  const removeOuter = pushBackHandler(() => {
    outer++;
    return true;
  });
  const removeInner = pushBackHandler(() => {
    inner++;
    return true;
  });
  try {
    const events = new EventTarget();
    assert.equal(
      requestAppBack(
        hasBackHandlers(),
        () => {
          consumeBack();
        },
        events,
      ),
      true,
    );
    assert.equal(inner, 1);
    assert.equal(outer, 0);
    removeInner();
    assert.equal(
      requestAppBack(
        hasBackHandlers(),
        () => {
          consumeBack();
        },
        events,
      ),
      true,
    );
    assert.equal(outer, 1);
  } finally {
    removeInner();
    removeOuter();
    unsubscribe();
  }
  assert.deepEqual(availability, [true, true, true, false]);
  assert.equal(
    requestAppBack(
      hasBackHandlers(),
      () => assert.fail("must not navigate Home"),
      new EventTarget(),
    ),
    false,
  );
});
