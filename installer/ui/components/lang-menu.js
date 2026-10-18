import { t, getLocale, setLocale, VARIANTS } from "../i18n.js";
import { h } from "../lib/dom.js";

export function langMenu() {
  const list = h("div", { class: "cn-menu-list", role: "radiogroup", "aria-label": t("Language"), hidden: true });
  const trigger = h("button", {
    type: "button",
    class: "cn-link",
    "aria-haspopup": "true",
    "aria-expanded": "false",
    text: t("Language") + " ▾",
  });
  const root = h("div", { class: "cn-menu" }, trigger, list);

  function setOpen(open) {
    list.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
  }

  VARIANTS.forEach((variant) => {
    const item = h("button", {
      type: "button",
      class: "cn-menu-item",
      role: "radio",
      lang: variant.code,
      "aria-checked": String(variant.code === getLocale()),
      text: variant.label,
      onclick: () => {
        setOpen(false);
        setLocale(variant.code);
      },
    });
    list.appendChild(item);
  });

  trigger.addEventListener("click", () => setOpen(list.hidden));
  const onDocClick = (event) => {
    if (!root.isConnected) return document.removeEventListener("mousedown", onDocClick, true);
    if (!root.contains(event.target)) setOpen(false);
  };
  document.addEventListener("mousedown", onDocClick, true);
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });
  root.open = () => setOpen(true);
  return root;
}
