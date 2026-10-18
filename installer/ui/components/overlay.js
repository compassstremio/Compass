import { h } from "../lib/dom.js";

// A dimmed layer inside the installer window holding one panel (sheet or drawer).
// Esc, a click on the dimmed area, or the returned close() dismiss it and restore focus.
export function openOverlay({ kind, label, build }) {
  const restore = document.activeElement;
  const panel = h("div", { class: `cn-${kind}`, role: "dialog", "aria-modal": "true", "aria-label": label, tabindex: "-1" });
  const scrim = h("div", { class: `cn-overlay cn-overlay-${kind}` }, panel);
  let shut = false;

  function onKey(event) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
  }

  function close() {
    if (shut) return;
    shut = true;
    document.removeEventListener("keydown", onKey, true);
    scrim.classList.add("is-out");
    window.setTimeout(() => {
      scrim.remove();
      if (restore && typeof restore.focus === "function") restore.focus();
    }, 200);
  }

  scrim.addEventListener("mousedown", (event) => {
    if (event.target === scrim) close();
  });
  document.addEventListener("keydown", onKey, true);
  build(panel, close);
  document.getElementById("hb-window").appendChild(scrim);
  // preventScroll: the panel is still sliding in, and a plain focus() would scroll the window to reveal it.
  window.requestAnimationFrame(() => panel.focus({ preventScroll: true }));
  return close;
}
