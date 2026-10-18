import { t } from "../i18n.js";
import { h, svgCheck } from "../lib/dom.js";
import { runUninstall, closeWindow, openExternal } from "../bridge.js";

export const id = "removed";

export function render(mount, ctx) {
  ctx.setDim(true);
  ctx.setState({ busy: true });
  let live = true;

  const badge = h("div", { class: "cn-badge" }, svgCheck());
  const lead = h("h1", { class: "cn-title cn-title-sm", text: t("Uninstalling Compass") });
  const sub = h("p", { class: "cn-tagline", text: t("This takes a moment.") });
  const note = h("p", { class: "t-prose" });
  const actions = h("div", { class: "cn-actions" });
  mount.append(h("div", { class: "cn-stack" }, badge, lead, sub, note, actions));

  runUninstall({
    dest: ctx.state.dest,
    removeData: ctx.state.removeData === true,
    onProgress: (_value, label) => {
      if (live && label) sub.textContent = t(label);
    },
  })
    .then(() => {
      if (!live) return;
      ctx.setState({ busy: false });
      badge.classList.add("hb-draw");
      lead.textContent = t("Compass has been removed");
      sub.textContent = ctx.state.removeData ? t("Your data was removed as well.") : t("Thanks for giving it a run.");
      if (!ctx.state.removeData) {
        note.textContent = t("Your library and settings are still on this computer, so reinstalling picks up exactly where you left off.");
      }
      actions.append(
        h("button", { type: "button", class: "cn-link", text: t("Download Compass again"), onclick: () => openExternal("https://compass.sarl") }),
        h("button", { type: "button", class: "cn-cta", text: t("Close"), onclick: () => closeWindow() }),
      );
    })
    .catch(() => {
      if (!live) return;
      ctx.setState({ busy: false });
      lead.textContent = t("Compass could not be removed");
      sub.textContent = t("Close Compass if it is running, then try again.");
      actions.append(h("button", { type: "button", class: "cn-cta", text: t("Close"), onclick: () => closeWindow() }));
    });

  return () => {
    live = false;
  };
}
