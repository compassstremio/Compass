import { t } from "../i18n.js";
import { h } from "../lib/dom.js";
import { mb, isolate } from "../lib/format.js";
import { uninstallFacts, closeWindow } from "../bridge.js";
import { checkbox } from "../components/checkbox.js";

export const id = "uninstall";

const KEPT = [
  "Your library, watch history and continue watching",
  "Settings, themes, addons and profiles",
  "Downloaded manga and subtitle caches",
];

export function render(mount, ctx) {
  ctx.setDim(false);
  ctx.setState({ removeData: false, busy: false });
  let live = true;

  const goes = h("ul");
  const stays = h("ul", {}, ...KEPT.map((line) => h("li", { class: "t-prose", text: t(line) })));
  const wipe = checkbox({
    label: t("Remove my data too"),
    onChange: (value) => {
      ctx.setState({ removeData: value });
      stays.classList.toggle("is-struck", value);
    },
  });
  const wipeLabel = wipe.querySelector(".cn-choice-label");

  mount.append(
    h(
      "div",
      { class: "cn-stack" },
      h("h1", { class: "cn-title cn-title-sm", text: t("Uninstall Compass") }),
      h("p", { class: "cn-tagline", text: t("This removes the Compass app from this computer. Nothing else is touched.") }),
      h(
        "div",
        { class: "cn-lists" },
        h("div", {}, h("p", { class: "t-eyebrow", text: t("What gets removed") }), goes),
        h("div", {}, h("p", { class: "t-eyebrow", text: t("What stays") }), stays),
      ),
      wipe,
      h(
        "div",
        { class: "cn-actions" },
        h("button", { type: "button", class: "cn-ghost", text: t("Keep Compass"), onclick: () => closeWindow() }),
        h("button", { type: "button", class: "cn-danger", text: t("Uninstall"), onclick: () => ctx.goTo("removed") }),
      ),
    ),
  );

  uninstallFacts().then((facts) => {
    if (!live || !facts) return;
    ctx.setState({ dest: facts.dest, version: facts.version });
    const versionEl = document.getElementById("hb-version");
    if (versionEl && facts.version) versionEl.firstChild.textContent = "v" + facts.version;
    goes.replaceChildren(
      h("li", { class: "t-prose", text: t("Compass {version} and its player files", { version: isolate(facts.version) }) }),
      h("li", { class: "t-prose", text: t("{size} in {path}", { size: isolate(mb(facts.program_bytes)), path: isolate(facts.dest) }) }),
      h("li", { class: "t-prose", text: t("Start Menu and desktop shortcuts") }),
    );
    if (facts.data_bytes) wipeLabel.textContent = t("Remove my data too ({size})", { size: isolate(mb(facts.data_bytes)) });
  });

  return () => {
    live = false;
  };
}
