import { applyAuthResult, applyServerUser, type RawUser } from "@/lib/theme-auth";
import { osClass } from "@/lib/platform";
import { openUrl } from "@/lib/window";
import { postJson } from "./client";

const TIMEOUT_MS = 300000;

type LoopbackStart = { state: string; authorizeUrl: string };
type LinkResult = { token: string; refresh: string; user: RawUser };
type CallbackResult = { code: string } | { error: string };

function codedError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

// Desktop only: Discord redirects to a fixed port on this machine
// (src-tauri/src/discord_auth.rs), which a browser build or a TV cannot listen on.
export function canLinkDiscord(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window &&
    ["windows", "linux", "macos"].includes(osClass())
  );
}

// Only the callback carrying the state this attempt started with counts. Anything
// else that reaches the local port (a stale tab, another page) is ignored.
export function readDiscordCallback(payload: unknown, state: string): CallbackResult | null {
  const p = (payload ?? {}) as { code?: unknown; state?: unknown; error?: unknown };
  if (typeof p.state !== "string" || p.state !== state) return null;
  if (typeof p.code === "string" && p.code) return { code: p.code };
  if (typeof p.error === "string" && p.error) return { error: p.error };
  return null;
}

async function waitForCode(state: string, authorizeUrl: string): Promise<string> {
  const { listen } = await import("@tauri-apps/api/event");
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let unlisten: (() => void) | null = null;
    let timer = 0;
    const finish = () => {
      settled = true;
      if (timer) window.clearTimeout(timer);
      if (unlisten) unlisten();
    };
    timer = window.setTimeout(() => {
      if (settled) return;
      finish();
      reject(codedError("discord_timeout"));
    }, TIMEOUT_MS);
    void listen("discord-auth", (e) => {
      if (settled) return;
      const result = readDiscordCallback(e.payload, state);
      if (!result) return;
      finish();
      if ("code" in result) resolve(result.code);
      else reject(codedError("discord_cancelled"));
    }).then((fn) => {
      if (settled) fn();
      else unlisten = fn;
      openUrl(authorizeUrl);
    });
  });
}

export async function linkDiscord(): Promise<void> {
  if (!canLinkDiscord()) throw new Error("Linking Discord needs the desktop app.");
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("discord_auth_start").catch(() => {
    throw codedError("discord_port_busy");
  });
  const { state, authorizeUrl } = await postJson<LoopbackStart>(
    "/identity/api/discord/loopback/start",
    {},
    { bearer: true },
  );
  const code = await waitForCode(state, authorizeUrl);
  const d = await postJson<LinkResult>(
    "/identity/api/discord/link",
    { state, mode: "link", code },
    { bearer: true },
  );
  applyAuthResult(d);
}

// Unlinking rotates the recovery key when there is one, because the old key may
// have been sent over the Discord DM that outlives the link.
export async function unlinkDiscord(): Promise<{ recoveryCode?: string }> {
  const d = await postJson<{ user: RawUser; recoveryCode?: string }>(
    "/identity/api/discord/unlink",
    {},
    { bearer: true },
  );
  applyServerUser(d.user);
  return { recoveryCode: d.recoveryCode };
}
