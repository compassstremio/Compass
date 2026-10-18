import { t } from "../i18n.js";
import { h } from "../lib/dom.js";
import { mb, compassDir, isolate } from "../lib/format.js";
import { installAction } from "../lib/install-action.js";
import { pickFolder, freeSpaceAt } from "../bridge.js";
import { checkbox } from "./checkbox.js";
import { openOverlay } from "./overlay.js";

const ROWS = [
  { name: "Compass", keys: ["compass", "support"] },
  { name: "mpv playback engine", keys: ["mpv"] },
  { name: "ffmpeg and ffprobe", keys: ["ffmpeg"] },
  { name: "yt-dlp", keys: ["ytdlp"] },
];

function neededBytes(facts) {
  if (!facts) return 0;
  return facts.installed_bytes + (facts.webview2_present ? 0 : facts.webview2_bytes || 0);
}

export function openSheet(ctx, { onChange }) {
  const facts = ctx.state.facts;
  const sizes = {};
  ((facts && facts.components) || []).forEach((c) => {
    sizes[c.key] = c.bytes;
  });

  return openOverlay({
    kind: "sheet",
    label: t("Customize installation"),
    build: (panel, close) => {
      const path = h("span", { class: "t-path", text: ctx.state.dest });
      const free = h("span", { class: "t-meta" });

      async function refreshFree() {
        const bytes = await freeSpaceAt(ctx.state.dest);
        free.textContent = bytes ? t("{size} free", { size: isolate(mb(bytes)) }) : t("Free space unknown");
        free.classList.toggle("is-tight", Boolean(bytes) && bytes < neededBytes(facts));
      }

      const change = h("button", {
        type: "button",
        class: "cn-mini",
        "aria-label": t("Change the install location"),
        text: t("Change"),
        onclick: async () => {
          const picked = await pickFolder(ctx.state.dest);
          if (!picked) return;
          const dest = compassDir(picked);
          const action = installAction(ctx.state.prior, ctx.state.version, dest);
          ctx.setState({ dest, mode: action.mode, kind: action.kind, from: action.from });
          path.textContent = dest;
          refreshFree();
          onChange();
        },
      });

      const components = h(
        "ul",
        { class: "cn-components" },
        ...ROWS.map((row) =>
          h("li", { class: "t-body" }, h("span", { text: t(row.name) }), h("span", { class: "t-meta", text: isolate(mb(row.keys.reduce((sum, k) => sum + (sizes[k] || 0), 0))) })),
        ),
      );

      panel.append(
        h("h2", { text: t("Customize installation") }),
        h(
          "div",
          { class: "cn-sheet-row" },
          h("div", { class: "cn-sheet-meta" }, h("span", { class: "t-label", text: t("Install location") }), path, free),
          change,
        ),
        components,
        checkbox({
          label: t("Create a desktop shortcut"),
          checked: ctx.state.desktopShortcut !== false,
          onChange: (value) => ctx.setState({ desktopShortcut: value }),
        }),
        checkbox({
          label: t("Launch Compass now"),
          checked: ctx.state.launchNow !== false,
          onChange: (value) => ctx.setState({ launchNow: value }),
        }),
        h("div", { class: "cn-sheet-actions" }, h("button", { type: "button", class: "cn-cta", text: t("Done"), onclick: close })),
      );
      refreshFree();
    },
  });
}
