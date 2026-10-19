import { getCurrentWindow } from "@tauri-apps/api/window";
import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/App";
import { hydrateCustomThemes } from "@/lib/custom-themes";
import { getUiLanguage } from "@/lib/i18n/store";
import { ensureUiLocale } from "@/lib/i18n/load-locale";
import { applyOsDataset } from "@/lib/platform";
import { loadSecrets } from "@/lib/secret-store";
import { initializeMusic } from "@/lib/music/player";
import { initSubtitleCache } from "@/lib/subtitles/subtitle-cache";
import { CaptionsApp } from "@/views/captions-app";
import { DjDeckApp } from "@/views/dj-deck-app";
import { ModalOverlayApp } from "@/views/modal-overlay-app";
import { HdrOverlayApp } from "@/views/hdr-overlay-app";
import { hdrOverlayEmitAction } from "@/lib/hdr-overlay";
import { PipApp } from "@/views/pip";
import { VideoPipApp } from "@/views/video-pip";
import "@/lib/awards-history-eager";
import "@/index.css";
import "flag-icons/css/flag-icons.min.css";
import { startTaskbarProgress } from "@/lib/download/taskbar-progress";
import { completeBetaReturnPreferences } from "@/lib/updater/beta-return";

let returnPreferencesReady = true;

function detectRemoteMode(): boolean {
  try {
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    if (path === "/remote" || path.endsWith("/remote")) return true;
    if (path === "/reader" || path.endsWith("/reader")) return true;
    const q = new URLSearchParams(window.location.search);
    if (q.get("remote") === "1" || q.get("reader") === "1") return true;
  } catch {}
  return false;
}

function detectPipMode(): boolean {
  if (new URLSearchParams(window.location.search).get("pip") === "1") return true;
  try {
    const w = getCurrentWindow();
    if (w.label === "compass-pip") return true;
  } catch {}
  return false;
}

/** The detached player window: chrome only, with the live mpv surface behind it. */
function detectVideoPip(): boolean {
  if (new URLSearchParams(window.location.search).get("compass-video-pip") === "1") return true;
  try {
    const w = getCurrentWindow();
    if (w.label === "compass-video-pip") return true;
  } catch {}
  return false;
}

function detectModalOverlay(): boolean {
  if (new URLSearchParams(window.location.search).get("compass-modal") === "1") return true;
  try {
    const w = getCurrentWindow();
    if (w.label === "compass-modal-overlay") return true;
  } catch {}
  return false;
}

function detectDjDeck(): boolean {
  if (new URLSearchParams(window.location.search).get("compass-dj") === "1") return true;
  try {
    if (getCurrentWindow().label === "compass-dj") return true;
  } catch {}
  return false;
}

function detectCaptions(): boolean {
  if (new URLSearchParams(window.location.search).get("compass-captions") === "1") return true;
  try {
    const w = getCurrentWindow();
    if (w.label === "compass-captions") return true;
  } catch {}
  return false;
}

function detectHdrOverlay(): boolean {
  if (new URLSearchParams(window.location.search).get("compass-overlay") === "1") return true;
  try {
    const w = getCurrentWindow();
    if (w.label === "compass-hdr-overlay") return true;
  } catch {}
  return false;
}

const isPip = detectPipMode();
const isVideoPip = detectVideoPip();
const isModal = detectModalOverlay();
const isHdrOverlay = detectHdrOverlay();
const isCaptions = detectCaptions();
const isDjDeck = detectDjDeck();
if (isDjDeck) {
  void initializeMusic().catch(() => {});
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" || (event.ctrlKey && event.key.toLowerCase() === "w")) {
      void import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => getCurrentWindow().close())
        .catch(() => {});
    }
  });
}
const isRemote = detectRemoteMode();
applyOsDataset();
if (isRemote) {
  document.documentElement.style.overflow = "auto";
  document.body.style.overflow = "auto";
  document.body.style.userSelect = "auto";
  document.body.style.cursor = "auto";
}
if (isModal || isHdrOverlay || isVideoPip) {
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
  document.body.style.backgroundColor = "transparent";
  const root = document.getElementById("root");
  if (root) {
    root.style.background = "transparent";
    root.style.backgroundColor = "transparent";
  }
}
if (import.meta.env.DEV)
  console.log(
    "[compass] entry: pip =",
    isPip,
    "modal =",
    isModal,
    "hdr =",
    isHdrOverlay,
    "remote =",
    isRemote,
    "label =",
    (() => {
      try {
        return getCurrentWindow().label;
      } catch {
        return "?";
      }
    })(),
  );
if (import.meta.env.DEV && !isPip && !isVideoPip && !isModal && !isHdrOverlay && !isRemote) {
  void import("./lib/streams/__fixtures__/verify").then((m) => m.logVerificationReport());
}
function revealRoot() {
  const root = document.getElementById("root");
  if (root instanceof HTMLElement) {
    root.removeAttribute("data-startup-hidden");
    root.inert = false;
  }
}

function StartupReady() {
  useEffect(() => {
    requestAnimationFrame(() => {
      document.getElementById("compass-boot")?.remove();
      document.getElementById("compass-boot-chrome")?.remove();
      revealRoot();
    });
  }, []);
  return null;
}

/**
 * Minimum time the boot splash stays up before the app is revealed.
 *
 * The seconds after mount are the heaviest in the app's life: the home feed loads dozens of rows
 * and every background runner starts at once. Revealing during that window shows the user raw
 * loading jank; holding the splash through it means the first frame they see is a settled one.
 * This is the one constant to tune — raise it to hide more of the load, lower it to reach content
 * sooner.
 */
const MIN_BOOT_MS = 1800;

function MainRoot() {
  const [appReady, setAppReady] = useState(false);
  const markAppReady = useCallback(() => setAppReady(true), []);
  const mountedAt = useRef(performance.now());

  // Acknowledge startup and take focus as soon as the app is mounted. The window is already on
  // screen showing the splash, and holding focus back would let the user click elsewhere first.
  useEffect(() => {
    if (!appReady || !("__TAURI_INTERNALS__" in window)) return;
    void import("@tauri-apps/api/core").then(async ({ invoke }) => {
      await invoke("compass_startup_ready").catch(() => {});
      if (returnPreferencesReady) {
        try {
          await invoke("handoff_confirm");
          const pending = JSON.parse(localStorage.getItem("compass.update.pending") ?? "null");
          if (pending?.recoverable && pending.version === __APP_VERSION__) {
            localStorage.removeItem("compass.update.pending");
          }
        } catch {
          /* Keep pending state and recovery files if startup cannot be acknowledged. */
        }
      }
    });
  }, [appReady]);

  useEffect(() => {
    if (!appReady) return;
    const wait = Math.max(0, MIN_BOOT_MS - (performance.now() - mountedAt.current));
    const timer = window.setTimeout(() => {
      revealRoot();
      const boot = document.getElementById("compass-boot");
      if (boot) {
        boot.classList.add("gone");
        setTimeout(() => boot.remove(), 280);
      }
    }, wait);
    return () => window.clearTimeout(timer);
  }, [appReady]);

  return <App onReady={markAppReady} />;
}

async function mount() {
  if (
    "__TAURI_INTERNALS__" in window &&
    !isHdrOverlay &&
    !isModal &&
    !isCaptions &&
    !isPip &&
    !isVideoPip &&
    !isDjDeck &&
    !isRemote
  ) {
    returnPreferencesReady = completeBetaReturnPreferences(__APP_VERSION__);
  }
  await Promise.all([
    loadSecrets(),
    hydrateCustomThemes().catch(() => {}),
    ensureUiLocale(getUiLanguage()),
    !isHdrOverlay && !isModal && !isCaptions && !isPip && !isVideoPip && !isDjDeck
      ? initializeMusic()
      : Promise.resolve(),
  ]);
  if (!isHdrOverlay && !isModal && !isCaptions && !isDjDeck) void initSubtitleCache();
  if (!isHdrOverlay && !isModal && !isCaptions && !isPip && !isVideoPip && !isDjDeck)
    startTaskbarProgress();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      {isHdrOverlay ? (
        <HdrOverlayApp />
      ) : isDjDeck ? (
        <DjDeckApp />
      ) : isCaptions ? (
        <CaptionsApp />
      ) : isModal ? (
        <ModalOverlayApp />
      ) : isVideoPip ? (
        <VideoPipApp />
      ) : isPip ? (
        <PipApp />
      ) : (
        <MainRoot />
      )}
      {(isModal || isPip || isVideoPip || isCaptions || isDjDeck) && <StartupReady />}
    </StrictMode>,
  );
}
void mount().catch(() => {
  if (isHdrOverlay) {
    void hdrOverlayEmitAction("hdr-stage://dead", {
      stageId: new URLSearchParams(window.location.search).get("stageId"),
    });
  }
  console.error("[compass] application startup failed");
});
