import { setLocale, onLocaleChange } from "./i18n.js";
import { pickLocale } from "./lib/locale-detect.js";
import {
  isNative,
  isUninstallMode,
  compassVersion,
  closeWindow,
  minimizeWindow,
  toggleMaximizeWindow,
  isMaximized,
  onWindowResized,
} from "./bridge.js";
import { mountWall } from "./components/wall.js";

const LOADERS = {
  main: () => import("./screens/main.js"),
  installing: () => import("./screens/installing.js"),
  finished: () => import("./screens/finished.js"),
  uninstall: () => import("./screens/uninstall.js"),
  removed: () => import("./screens/removed.js"),
};

// The old flow started this at false, so no desktop shortcut was ever made by default even though the
// components list promised one. It is now chosen before installing, in "Customize installation".
const DEFAULT_DESKTOP_SHORTCUT = true;
const BASE_W = 1028;
const BASE_H = 632;

const preview = isNative() ? null : new URLSearchParams(window.location.search);

const state = {
  accepted: preview ? preview.get("accepted") === "1" : false,
  dest: "",
  mode: "install",
  kind: "install",
  from: "",
  version: "",
  installedSize: "",
  facts: null,
  prior: null,
  repair: null,
  error: "",
  launchNow: true,
  desktopShortcut: DEFAULT_DESKTOP_SHORTCUT,
  removeData: false,
  busy: false,
};
if (preview) {
  Object.assign(state, { dest: String.raw`C:\Users\you\AppData\Local\Compass`, version: "0.9.134", installedSize: "558 MB" });
}

const host = document.getElementById("screen");
const wallEl = document.getElementById("cn-wall");
const versionEl = document.getElementById("hb-version");
const stage = document.getElementById("hb-window");

let current = null;
let token = 0;

const ctx = {
  state,
  preview,
  setState(patch) {
    return Object.assign(state, patch || {});
  },
  goTo,
  setDim(on) {
    wallEl.dataset.dim = String(Boolean(on));
  },
};

async function goTo(id) {
  const mine = ++token;
  let screen;
  try {
    screen = await LOADERS[id]();
  } catch (err) {
    console.error('[compass-installer] cannot load screen "' + id + '"', err);
    return;
  }
  if (mine !== token) return;

  if (current && typeof current.cleanup === "function") {
    try {
      current.cleanup();
    } catch (err) {
      console.error("[compass-installer] cleanup threw", err);
    }
  }

  host.replaceChildren();
  host.classList.remove("cn-in");
  void host.offsetWidth;
  host.classList.add("cn-in");

  let cleanup = null;
  try {
    cleanup = screen.render(host, ctx);
  } catch (err) {
    console.error('[compass-installer] render threw in screen "' + id + '"', err);
  }
  current = { id, cleanup: typeof cleanup === "function" ? cleanup : null };
}

document.getElementById("hb-close").addEventListener("click", () => {
  if (state.busy) {
    document.dispatchEvent(new CustomEvent("cn:close-blocked"));
    return;
  }
  document.dispatchEvent(new CustomEvent("hb:close"));
  closeWindow();
});

// Language is changed from the main screen only; never re-render while a job is running.
onLocaleChange(() => {
  if (current && !state.busy) goTo(current.id);
});

function fitStage(maxed) {
  document.body.classList.toggle("is-maximized", !!maxed);
  if (!maxed) {
    stage.style.transform = "";
    return;
  }
  const k = Math.min(window.innerWidth / BASE_W, window.innerHeight / BASE_H);
  stage.style.transform = k > 1.001 ? "scale(" + k.toFixed(4) + ")" : "";
}

async function syncWindowState() {
  fitStage(await isMaximized());
}

onWindowResized(syncWindowState);
window.addEventListener("resize", syncWindowState);
syncWindowState();
document.getElementById("hb-min").addEventListener("click", () => minimizeWindow());
document.getElementById("hb-max").addEventListener("click", () => toggleMaximizeWindow().then(fitStage));

async function start() {
  const wanted = preview && preview.get("lang") ? [preview.get("lang")] : navigator.languages;
  setLocale(pickLocale(wanted));
  mountWall(wallEl);

  versionEl.textContent = state.version ? "v" + state.version : "";
  compassVersion().then((v) => {
    if (!v) return;
    state.version = v;
    versionEl.textContent = "v" + v;
  });
  if (preview) {
    const tag = document.createElement("span");
    tag.className = "hb-preview-tag";
    tag.textContent = "PREVIEW DATA";
    versionEl.appendChild(tag);
  }

  const uninstalling = await isUninstallMode();
  goTo((preview && preview.get("screen")) || (uninstalling ? "uninstall" : "main"));
}

start();
