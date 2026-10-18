import { t } from "../i18n.js";
import { h } from "../lib/dom.js";
import { mb, isolate } from "../lib/format.js";
import { installAction } from "../lib/install-action.js";
import { installFacts, existingInstall, openExternal } from "../bridge.js";
import { checkbox } from "../components/checkbox.js";
import { langMenu } from "../components/lang-menu.js";
import { openTerms } from "../components/terms-modal.js";
import { openLicense } from "../components/license-modal.js";

export const id = "main";

const LABELS = { install: "Install", update: "Update", downgrade: "Downgrade", repair: "Repair" };

const LINKS = [
  { lead: "Website", url: "https://compass.sarl" },
  { lead: "Source", url: "https://github.com/compassstremio/compass" },
  { lead: "Bugs", url: "https://github.com/compassstremio/compass/issues" },
  { lead: "Community", url: "https://discord.gg/pQBRmN9XdD" },
];

function previewPrior(ctx, facts) {
  const kind = ctx.preview && ctx.preview.get("kind");
  const version = { update: "0.9.100", downgrade: "0.9.200", repair: facts.version }[kind];
  return version ? { path: facts.dest, version } : null;
}

async function loadFacts(ctx) {
  if (ctx.state.facts) return;
  const [facts, found] = await Promise.all([installFacts(), existingInstall()]);
  const prior = found && found.path ? found : previewPrior(ctx, facts);
  const dest = prior ? prior.path : facts.dest;
  const action = installAction(prior, facts.version, dest);
  ctx.setState({
    facts,
    prior,
    dest,
    version: facts.version || ctx.state.version,
    installedSize: mb(facts.installed_bytes),
    mode: action.mode,
    kind: action.kind,
    from: action.from,
  });
}

export function render(mount, ctx) {
  ctx.setDim(false);
  let live = true;

  const consent = checkbox({
    label: t("I accept the Compass Terms of Service"),
    checked: ctx.state.accepted,
    onChange: (value) => {
      ctx.setState({ accepted: value });
      paint();
    },
  });
  const terms = h("button", { type: "button", class: "cn-link", text: t("Read the terms"), onclick: openTerms });
  const cta = h("button", {
    type: "button",
    class: "cn-cta",
    disabled: true,
    onclick: () => ctx.goTo("installing"),
  });
  const hint = h("p", { class: "cn-hint", text: t("Accept the terms to continue.") });
  const meta = h("p", { class: "cn-hint" });

  function paint() {
    const ready = Boolean(ctx.state.facts);
    cta.textContent = t(LABELS[ctx.state.kind]);
    cta.disabled = !ctx.state.accepted || !ready;
    hint.hidden = ctx.state.accepted;
    const parts = [];
    if (ctx.state.from) {
      const key = ctx.state.kind === "downgrade" ? "Rolls back from {version}" : ctx.state.kind === "repair" ? "Repairs {version}" : "Replaces {version}";
      parts.push(t(key, { version: isolate(ctx.state.from) }));
    }
    if (ready && ctx.state.kind !== "repair") parts.push(t("{size} on disk", { size: isolate(ctx.state.installedSize) }));
    meta.textContent = parts.join(" · ");
  }

  const openSheetLazy = () => import("../components/sheet.js").then((m) => m.openSheet(ctx, { onChange: paint }));
  const openDrawerLazy = () => import("../components/drawer.js").then((m) => m.openDrawer());
  const lang = langMenu();

  const quiet = h(
    "div",
    { class: "cn-linkrow" },
    h("button", { type: "button", class: "cn-link", text: t("Customize installation"), onclick: openSheetLazy }),
    h("span", { class: "cn-sep", text: "·" }),
    h("button", { type: "button", class: "cn-link", text: t("What's new"), onclick: openDrawerLazy }),
    h("span", { class: "cn-sep", text: "·" }),
    lang,
  );

  const legal = h(
    "div",
    { class: "cn-legal" },
    ...LINKS.flatMap((link, i) => [
      i ? h("span", { class: "cn-sep", text: "·" }) : null,
      h("button", { type: "button", class: "cn-link", text: t(link.lead), onclick: () => openExternal(link.url) }),
    ]),
    h("span", { class: "cn-sep", text: "·" }),
    h("button", { type: "button", class: "cn-link", text: t("MIT License"), onclick: openLicense }),
  );

  mount.append(
    h(
      "div",
      { class: "cn-stack" },
      h("div", { class: "cn-mark" }),
      h("h1", { class: "cn-title", text: t("Welcome to Compass") }),
      h("p", { class: "cn-tagline", text: t("Everything you watch, in one place.") }),
      h("div", { class: "cn-linkrow" }, consent, terms),
      cta,
      hint,
      meta,
      quiet,
    ),
    legal,
  );

  paint();
  loadFacts(ctx)
    .catch((err) => console.error("[compass-installer] install facts failed", err))
    .finally(() => {
      if (live) paint();
    });

  const open = ctx.preview && ctx.preview.get("open");
  if (open) {
    window.setTimeout(() => {
      if (open === "sheet") openSheetLazy();
      if (open === "drawer") openDrawerLazy();
      if (open === "terms") openTerms();
      if (open === "license") openLicense();
      if (open === "lang") lang.open();
    }, 120);
  }

  return () => {
    live = false;
  };
}
