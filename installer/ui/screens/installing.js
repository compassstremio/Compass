import { t } from "../i18n.js";
import { h } from "../lib/dom.js";
import { clampPct } from "../lib/format.js";
import { CAPTIONS, captionIndex } from "../lib/captions.js";
import { isNative, install as runInstall, repair as runRepair, openExternal } from "../bridge.js";

export const id = "installing";

const HOLD_MS = 900;
const CAPTION_MS = 4200;
const PREVIEW_MS = 6000;
const ISSUES_URL = "https://github.com/compassstremio/compass/issues";
const PREVIEW_STEPS = [
  [8, "Preparing install location"],
  [54, "Copying application files"],
  [80, "Registering file associations"],
  [100, "Finishing up"],
];

// In the browser preview there is no engine; fake a run (and a failure with ?fail=1).
function previewJob(ctx, repairing, onProgress) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      const pct = ((Date.now() - started) / PREVIEW_MS) * 100;
      const step = PREVIEW_STEPS.find(([to]) => pct <= to) || PREVIEW_STEPS[PREVIEW_STEPS.length - 1];
      onProgress(Math.min(100, pct), step[1]);
      if (ctx.preview.get("fail") === "1" && pct >= 60) {
        window.clearInterval(timer);
        reject(new Error("Access is denied. (os error 5)"));
      } else if (pct >= 100) {
        window.clearInterval(timer);
        resolve(repairing ? { checked: 1234, missing: 2, damaged: 1, shortcut_restored: true, registry_restored: false } : undefined);
      }
    }, 100);
  });
}

function startJob(ctx, repairing, onProgress) {
  if (!isNative()) return previewJob(ctx, repairing, onProgress);
  return repairing
    ? runRepair({ dest: ctx.state.dest, onProgress })
    : runInstall({ dest: ctx.state.dest, desktopShortcut: ctx.state.desktopShortcut !== false, onProgress });
}

export function render(mount, ctx) {
  const repairing = ctx.state.mode === "repair";
  let live = true;
  let shownStep = "";
  let shownCaption = -1;
  const startedAt = Date.now();
  ctx.setState({ busy: true, repair: null, error: "" });
  ctx.setDim(true);

  const percent = h("p", { class: "cn-pct t-num", text: "0%" });
  const fill = h("div", { class: "cn-bar-fill" });
  const step = h("p", { class: "cn-step t-body", "aria-live": "polite" });
  const caption = h("p", { class: "cn-caption t-prose" });
  const warn = h("p", { class: "cn-warn t-sub", role: "alert", hidden: true, text: t("Please wait until the install finishes before closing.") });
  const progress = h("div", { class: "cn-progress" }, percent, h("div", { class: "cn-bar" }, fill), step, caption, warn);
  const failure = h("div", { class: "cn-failure", hidden: true });

  mount.append(
    h(
      "div",
      { class: "cn-stack" },
      h("h1", { class: "cn-title cn-title-sm", text: repairing ? t("Repairing Compass") : t("Installing Compass") }),
      progress,
      failure,
    ),
  );

  function onProgress(pct, label) {
    if (!live) return;
    const value = clampPct(pct);
    percent.textContent = value + "%";
    fill.style.width = value + "%";
    if (label && label !== shownStep) {
      shownStep = label;
      step.textContent = t(label);
    }
  }

  const ticker = window.setInterval(() => {
    const index = captionIndex(Date.now() - startedAt, CAPTION_MS);
    if (index === shownCaption) return;
    shownCaption = index;
    caption.textContent = t(CAPTIONS[index]);
    caption.classList.remove("is-in");
    void caption.offsetWidth;
    caption.classList.add("is-in");
  }, 250);

  const onBlocked = () => {
    warn.hidden = false;
  };
  document.addEventListener("cn:close-blocked", onBlocked);

  function showFailure(message) {
    const details = [
      "Compass installer " + (ctx.state.version || ""),
      "Action: " + (repairing ? "repair" : "install"),
      "Destination: " + ctx.state.dest,
      "Error: " + message,
    ].join("\n");
    const copy = h("button", {
      type: "button",
      class: "cn-ghost",
      text: t("Copy details"),
      onclick: () => {
        const done = () => {
          copy.textContent = t("Copied");
        };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(details).then(done, () => {});
      },
    });
    progress.hidden = true;
    failure.hidden = false;
    failure.replaceChildren(
      h("p", { class: "cn-fail-title", text: t("Something went wrong") }),
      h("p", { class: "t-prose", text: repairing ? t("Repair failed: {error}", { error: message }) : t("Install failed: {error}", { error: message }) }),
      h("pre", { class: "cn-details", text: details }),
      h(
        "div",
        { class: "cn-linkrow" },
        h("button", { type: "button", class: "cn-cta", text: t("Retry"), onclick: () => ctx.goTo("installing") }),
        copy,
        h("button", { type: "button", class: "cn-link", text: t("Report a problem"), onclick: () => openExternal(ISSUES_URL) }),
      ),
    );
  }

  startJob(ctx, repairing, onProgress)
    .then((report) => {
      if (!live) return;
      onProgress(100, "");
      ctx.setState({ busy: false, repair: repairing ? report || null : null });
      window.setTimeout(() => {
        if (live) ctx.goTo("finished");
      }, HOLD_MS);
    })
    .catch((err) => {
      if (!live) return;
      const message = String(err && err.message ? err.message : err);
      ctx.setState({ busy: false, error: message });
      showFailure(message);
    });

  return () => {
    live = false;
    window.clearInterval(ticker);
    document.removeEventListener("cn:close-blocked", onBlocked);
  };
}
