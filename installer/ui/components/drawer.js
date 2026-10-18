import { t } from "../i18n.js";
import { h } from "../lib/dom.js";
import { fetchChangelog } from "../bridge.js";
import { parseNotes, formatDate } from "../lib/notes.js";
import { openOverlay } from "./overlay.js";

function entry(item) {
  const date = formatDate(item.pub_date);
  const blocks = parseNotes(item.notes, item.version).map((block) => {
    if (block.kind === "head") return h("p", { class: "t-eyebrow", text: block.text });
    return h("p", { class: "t-prose", text: (block.kind === "item" ? "• " : "") + block.text });
  });
  return h(
    "article",
    { class: "cn-note" },
    h("div", { class: "cn-note-stamp" }, h("span", { class: "cn-note-ver", text: item.version }), date ? h("span", { class: "t-meta", text: date }) : null),
    ...blocks,
  );
}

const skeleton = () => [58, 100, 92, 74, 40].map((w) => h("div", { class: "cn-skeleton", style: `width:${w}%` }));

export function openDrawer() {
  return openOverlay({
    kind: "drawer",
    label: t("What's new"),
    build: (panel, close) => {
      let versions = [];
      let channel = "beta";
      let dead = false;
      const body = h("div", { class: "cn-drawer-body" }, ...skeleton());
      const tabs = h("div", { class: "cn-tabs" });
      const buttons = {};

      function paint() {
        const list = versions.filter((v) => (channel === "stable" ? v.channel === "stable" : v.channel !== "stable"));
        body.replaceChildren(
          ...(list.length ? list.map(entry) : [h("p", { class: "t-prose", text: t("No {channel} releases listed yet.", { channel: t(channel) }) })]),
        );
        body.scrollTop = 0;
      }

      function load() {
        fetchChangelog()
          .then((data) => {
            if (dead) return;
            versions = (Array.isArray(data && data.versions) ? data.versions : []).filter((v) => v && typeof v.version === "string");
            paint();
          })
          .catch(() => {
            if (dead) return;
            body.replaceChildren(
              h("p", { class: "t-prose", text: t("Release notes need a connection.") }),
              h("button", {
                type: "button",
                class: "cn-mini",
                text: t("Try again"),
                onclick: () => {
                  body.replaceChildren(...skeleton());
                  load();
                },
              }),
            );
          });
      }

      [["beta", "Beta"], ["stable", "Stable"]].forEach(([key, label]) => {
        buttons[key] = h("button", {
          type: "button",
          class: "cn-tab",
          "aria-pressed": String(key === channel),
          text: t(label),
          onclick: () => {
            channel = key;
            Object.entries(buttons).forEach(([k, b]) => b.setAttribute("aria-pressed", String(k === key)));
            paint();
          },
        });
        tabs.appendChild(buttons[key]);
      });

      panel.append(
        h("div", { class: "cn-drawer-head" }, h("h2", { text: t("What's new") }), h("button", { type: "button", class: "cn-mini", text: t("Close"), onclick: close })),
        tabs,
        body,
      );
      load();

      const stop = new MutationObserver(() => {
        if (!panel.isConnected) {
          dead = true;
          stop.disconnect();
        }
      });
      stop.observe(document.getElementById("hb-window"), { childList: true });
    },
  });
}
