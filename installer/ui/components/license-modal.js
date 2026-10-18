import { t } from "../i18n.js";
import { saveLicense } from "../bridge.js";
import { openModal } from "../modal.js";
import { h } from "../lib/dom.js";

export function openLicense() {
  return openModal({
    label: t("MIT License"),
    action: {
      label: t("Download"),
      onClick: (button) => {
        button.disabled = true;
        saveLicense().then((path) => {
          if (path) {
            button.classList.add("is-done");
            button.title = t("Saved to Downloads");
            button.setAttribute("aria-label", t("Saved to Downloads"));
            return;
          }
          button.disabled = false;
        });
      },
    },
    build: (body) => {
      const pre = h("p", { class: "hb-modal-legal" });
      body.appendChild(pre);
      fetch("assets/LICENSE.txt")
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
        .then((text) => {
          pre.textContent = text.trim();
        })
        .catch(() => {
          pre.textContent = t("The licence file ships alongside Compass in the install folder.");
        });
    },
  });
}
