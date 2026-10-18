import { t } from "../i18n.js";
import { h, svgCheck } from "../lib/dom.js";
import { isolate } from "../lib/format.js";
import { launch, closeWindow } from "../bridge.js";
import { checkbox } from "../components/checkbox.js";

export const id = "finished";

function repairLines(report) {
  const broken = (report.missing || 0) + (report.damaged || 0);
  const lines = [
    broken
      ? t("Checked {total} files and restored {count}.", { total: report.checked, count: broken })
      : t("Checked {total} files. Nothing needed repair.", { total: report.checked }),
  ];
  if (report.shortcut_restored) lines.push(t("The Start Menu shortcut was put back."));
  if (report.registry_restored) lines.push(t("The uninstall entry was rewritten."));
  lines.push(t("Your library and settings were not touched."));
  return lines;
}

export function render(mount, ctx) {
  ctx.setDim(false);
  ctx.setState({ busy: false });
  const report = ctx.state.repair || null;
  const launchNow = ctx.state.launchNow !== false;
  ctx.setState({ launchNow });

  const cta = h("button", { type: "button", class: "cn-cta", onclick: finish });
  const paint = () => {
    cta.textContent = ctx.state.launchNow ? t("Launch") : t("Close");
  };

  async function finish() {
    document.dispatchEvent(new CustomEvent("hb:finish", { detail: { launchNow: ctx.state.launchNow } }));
    if (ctx.state.launchNow) await launch(ctx.state.dest);
    await closeWindow();
  }

  const badge = h("div", { class: "cn-badge hb-draw" }, svgCheck());
  const size = ctx.state.installedSize ? isolate(ctx.state.installedSize) : "";
  const sub = t("Version {version}, {size}", { version: isolate(ctx.state.version), size }).replace(/[,،]\s*$/, "");

  mount.append(
    h(
      "div",
      { class: "cn-stack" },
      badge,
      h("h1", { class: "cn-title cn-title-sm", text: report ? t("Compass is repaired") : t("Compass is installed") }),
      h("p", { class: "cn-tagline", text: sub }),
      report ? h("div", { class: "cn-lines" }, ...repairLines(report).map((line) => h("p", { class: "t-body", text: line }))) : null,
      h("p", { class: "t-meta", text: t("Installed to {path}", { path: ctx.state.dest || "" }) }),
      checkbox({
        label: t("Launch Compass now"),
        checked: launchNow,
        onChange: (value) => {
          ctx.setState({ launchNow: value });
          paint();
        },
      }),
      cta,
    ),
  );
  paint();
}
