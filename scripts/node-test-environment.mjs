// Node 24's experimental Web Locks can retain a lock after a rejected callback,
// hanging retry tests. Use the app's non-browser queue in Node; browser lock
// behavior remains testable with explicit mocks. Keep navigator for React DOM.
if (typeof navigator !== "undefined" && navigator.userAgent?.startsWith("Node.js/")) {
  Object.defineProperty(navigator, "locks", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}
