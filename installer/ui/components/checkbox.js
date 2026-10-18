import { h, svgCheck } from "../lib/dom.js";

export function checkbox({ label, checked = false, onChange }) {
  const box = h("span", { class: "hb-check", "aria-hidden": "true", "aria-checked": String(checked) }, svgCheck());
  const row = h(
    "button",
    { type: "button", class: "cn-choice", role: "checkbox", "aria-checked": String(checked) },
    box,
    h("span", { class: "cn-choice-label t-body", text: label }),
  );
  row.addEventListener("click", () => {
    const value = row.getAttribute("aria-checked") !== "true";
    row.setAttribute("aria-checked", String(value));
    box.setAttribute("aria-checked", String(value));
    if (typeof onChange === "function") onChange(value);
  });
  return row;
}
