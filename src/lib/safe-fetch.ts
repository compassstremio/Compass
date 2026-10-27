import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetchImpl } from "@tauri-apps/plugin-http";
import { TrackerBlockedError, isBlockedUrl, noteBlocked } from "./privacy/blocklist";
import { bridgeOutcome, recordBridge } from "./fetch-bridge-stats";
import {
  allowDirectHost,
  classifyDirectFailure,
  clearDirectFailures,
  directHostFor,
  noteDirectFailure,
} from "./direct-host-policy";
import { hasSensitiveRequestHeaders, shouldFallbackToPluginHttp } from "./fetch-fallback-policy";
import {
  isSafeProviderSubtitleUrl,
  SUBTITLE_PUBLIC_NETWORK_HEADER,
} from "./subtitles/provider-url";

const SUBTITLE_CREDENTIAL_HEADER = "x-compass-subtitle-credential";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

declare global {
  interface Window {
    __compassFetchCounts?: BridgeCounts;
  }
}

type BridgeKind = "direct" | "directFail" | "compassFetch" | "pluginHttp";

type BridgeCounts = {
  total: Record<BridgeKind, number>;
  byHost: Record<string, number>;
};

const bridgeCounts: BridgeCounts = {
  total: { direct: 0, directFail: 0, compassFetch: 0, pluginHttp: 0 },
  byHost: {},
};
if (typeof window !== "undefined") window.__compassFetchCounts = bridgeCounts;

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function countCrossing(kind: BridgeKind, url: string): void {
  bridgeCounts.total[kind] += 1;
  let host = "other";
  try {
    host = new URL(String(url)).hostname;
  } catch {}
  const key = `${kind}:${host}`;
  bridgeCounts.byHost[key] = (bridgeCounts.byHost[key] ?? 0) + 1;
}

// Torrentio sits behind Cloudflare that blocks datacenter IPs, so on web it
// MUST be fetched directly from the browser's residential IP (it sets CORS, so it
// works) — proxying it through the VPS gets 403'd. EVERYTHING ELSE routes through the
// VPS /api-proxy: it's required for addons that send no CORS header at all (OpenSubtitles)
// and for the CORS-less debrid REST APIs, and it's fine for the rest (Cinemeta, Comet).
const DIRECT_HOSTS = new Set(["torrentio.strem.fun"]);

const PROXY_HOSTS = new Set([
  "jikanfortheweebs.midnightignite.me",
  "mcp-api.op.gg",
  "v3-cinemeta.strem.io",
  "opensubtitles-v3.strem.io",
  "opensubtitles.strem.io",
  "opensubtitles.stremio.homes",
  "api.torbox.app",
  "zileanfortheweebs.midnightignite.me",
  "api.knaben.org",
  "stremthru.13377001.xyz",
  "api.real-debrid.com",
  "api.alldebrid.com",
  "debrid-link.com",
  "www.premiumize.me",
  "openlibrary.org",
  "covers.openlibrary.org",
  "graphql.anilist.co",
  "www.googleapis.com",
  "www.wikidata.org",
  "api.deepseek.com",
  "api.deezer.com",
  "api.igdb.com",
  "api.steampowered.com",
  "images.igdb.com",
  "store.steampowered.com",
  "steamcommunity.com",
  "www.speedrun.com",
  "partner.steamgames.com",
  "help.steampowered.com",
  "worldofwarcraft.blizzard.com",
  "api.warframe.com",
  "www.youtube.com",
  "www.pcgamingwiki.com",
  "kick.com",
  "prosettings.net",
  "cdn.cloudflare.steamstatic.com",
]);
const DEV_PROXY_HOSTS = new Set([
  "mcp-api.op.gg",
  "worldofwarcraft.blizzard.com",
  "api.warframe.com",
  "www.youtube.com",
  "www.pcgamingwiki.com",
  "kick.com",
  "prosettings.net",
  "api.steampowered.com",
  "store.steampowered.com",
  "steamcommunity.com",
  "www.speedrun.com",
  "partner.steamgames.com",
  "help.steampowered.com",
  "graphql.anilist.co",
  "openlibrary.org",
  "covers.openlibrary.org",
  "www.googleapis.com",
  "www.wikidata.org",
  "api.deepseek.com",
]);

const PROXY_SUFFIXES = [
  ".elfhosted.com",
  ".strem.fun",
  ".strem.io",
  ".stremio.homes",
  ".baby-beamup.club",
  ".workers.dev",
  ".debridio.com",
  ".code.run",
  ".fly.dev",
  ".onrender.com",
  ".vercel.app",
  ".netlify.app",
  ".railway.app",
  ".deno.dev",
  ".dzcdn.net",
];

function isCancellation(e: unknown): boolean {
  const err = e as { name?: string; message?: string } | undefined;
  if (err?.name === "AbortError" || err?.name === "TimeoutError") return true;
  return /request cancell?ed/i.test(err?.message ?? "");
}

let proxyOriginCache: boolean | null = null;
function webProxyAvailable(): boolean {
  if (proxyOriginCache !== null) return proxyOriginCache;
  try {
    proxyOriginCache = /(^|\.)compass\.sarl$/i.test(window.location.hostname);
  } catch {
    proxyOriginCache = false;
  }
  return proxyOriginCache;
}

function rewriteForWeb(url: string, init?: RequestInit): { url: string; init?: RequestInit } {
  if (isTauri) return { url, init };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { url, init };
  }
  if (DIRECT_HOSTS.has(parsed.hostname)) return { url, init };
  const proxiable =
    PROXY_HOSTS.has(parsed.hostname) || PROXY_SUFFIXES.some((s) => parsed.hostname.endsWith(s));
  if (!proxiable) return { url, init };
  const localDev = /^(?:localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
  if (!webProxyAvailable() && !(localDev && DEV_PROXY_HOSTS.has(parsed.hostname)))
    return { url, init };

  const proxied = `/api-proxy/${parsed.hostname}${parsed.pathname}${parsed.search}`;
  if (!init?.headers) return { url: proxied, init };
  const out = new Headers(init.headers as HeadersInit);
  const auth = out.get("authorization");
  if (auth && !localDev) {
    out.delete("authorization");
    out.set("x-compass-auth", auth);
  }
  return { url: proxied, init: { ...init, headers: out } };
}

type CompassFetchResponse = {
  status: number;
  ok: boolean;
  body: string;
  contentType: string | null;
  headers?: Record<string, string>;
  url?: string;
};

export const FINAL_URL_HEADER = "x-compass-final-url";

export { allowDirectHost };

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  // Every image crosses the native bridge through here, so this runs while rows are
  // scrolling into view. Uint8Array.from with a callback pays an iterator step and a JS
  // call per byte; writing straight into the buffer does the same work far cheaper.
  const size = binary.length;
  // Backed by a concrete ArrayBuffer so the result stays usable as a Response body.
  const bytes = new Uint8Array(new ArrayBuffer(size));
  for (let i = 0; i < size; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function invokeCompassFetch(
  input: string,
  init?: RequestInit,
  responseType?: "base64",
  timeoutMs = 30000,
  maxResponseBytes?: number,
  allowLocalNetwork = false,
): Promise<CompassFetchResponse> {
  countCrossing("compassFetch", input);
  const headers: Record<string, string> = {};
  let credentialHandle: string | undefined;
  let publicNetworkOnly = false;
  if (init?.headers) {
    const h = new Headers(init.headers as HeadersInit);
    h.forEach((v, k) => {
      if (k.toLowerCase() === SUBTITLE_CREDENTIAL_HEADER) {
        credentialHandle = v;
        return;
      }
      if (k.toLowerCase() === SUBTITLE_PUBLIC_NETWORK_HEADER.toLowerCase()) {
        publicNetworkOnly = v === "1" || v.toLowerCase() === "true";
        return;
      }
      headers[k] = v;
    });
  }
  const binaryBody =
    init?.body instanceof ArrayBuffer
      ? new Uint8Array(init.body)
      : ArrayBuffer.isView(init?.body)
        ? new Uint8Array(init.body.buffer, init.body.byteOffset, init.body.byteLength)
        : undefined;
  const body =
    typeof init?.body === "string"
      ? init.body
      : init?.body instanceof URLSearchParams
        ? init.body.toString()
        : init?.body && !binaryBody
          ? JSON.stringify(init.body)
          : undefined;
  const started = Date.now();
  const request = invoke<CompassFetchResponse>("compass_fetch", {
    args: {
      url: input,
      method: init?.method ?? "GET",
      headers,
      body,
      bodyBase64: binaryBody ? bytesToBase64(binaryBody) : undefined,
      timeoutMs: 30000,
      ...(timeoutMs === 30000 ? {} : { timeoutMs }),
      responseType,
      maxResponseBytes,
      credentialHandle,
      publicNetworkOnly,
      allowLocalNetwork,
      followRedirects:
        init?.redirect === "manual" || init?.redirect === "error" ? false : undefined,
    },
  });
  return request.then(
    (resp) => {
      recordBridge("compassFetch", input, Date.now() - started, "ok");
      return resp;
    },
    (error: unknown) => {
      recordBridge("compassFetch", input, Date.now() - started, bridgeOutcome(error));
      throw error;
    },
  );
}

async function tauriCompassFetch(
  input: string,
  init?: RequestInit,
  responseType?: "base64",
  timeoutMs = 30000,
  maxResponseBytes?: number,
  allowLocalNetwork = false,
): Promise<Response> {
  const resp = await invokeCompassFetch(
    input,
    init,
    responseType,
    timeoutMs,
    maxResponseBytes,
    allowLocalNetwork,
  );
  const responseHeaders = new Headers(
    resp.headers ?? (resp.contentType ? { "content-type": resp.contentType } : {}),
  );
  if (resp.url) responseHeaders.set(FINAL_URL_HEADER, resp.url);
  const bodyless = init?.method?.toUpperCase() === "HEAD" || [204, 205, 304].includes(resp.status);
  const body = bodyless ? null : responseType === "base64" ? base64ToBytes(resp.body) : resp.body;
  return new Response(body, {
    status: resp.status,
    headers: responseHeaders,
  });
}

export type Base64FetchResult = {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
  url?: string;
};

export function safeFetchBase64(
  target: string,
  init: RequestInit | undefined,
  timeoutMs = 30000,
  maxResponseBytes?: number,
): Promise<Base64FetchResult> | null {
  if (!isTauri) return null;
  const policyHeaders = new Headers(init?.headers as HeadersInit | undefined);
  if (
    policyHeaders.get(SUBTITLE_PUBLIC_NETWORK_HEADER) === "1" &&
    !isSafeProviderSubtitleUrl(target)
  ) {
    return Promise.reject(new TypeError("blocked non-public provider subtitle target"));
  }
  if (isBlockedUrl(target)) {
    noteBlocked();
    return Promise.reject(new TrackerBlockedError(new URL(target).hostname));
  }
  const raw = invokeCompassFetch(target, init, "base64", timeoutMs, maxResponseBytes).then(
    (resp) => ({
      status: resp.status,
      ok: resp.ok,
      headers: resp.headers ?? (resp.contentType ? { "content-type": resp.contentType } : {}),
      body: resp.body,
      url: resp.url,
    }),
  );
  return withDeadline(raw, init?.signal, timeoutMs + 5_000);
}

function isIdempotent(method: string | undefined): boolean {
  const m = (method ?? "GET").toUpperCase();
  return m === "GET" || m === "HEAD" || m === "OPTIONS";
}

// The Tauri http plugin rejects an aborted request with a plain Error("Request cancelled").
// Normalize it to a standard AbortError so callers (and the global rejection handler) treat
// a cancel as the benign abort it is instead of surfacing the app-wide error screen.
function normalizeAbort(p: Promise<Response>): Promise<Response> {
  return p.catch((e: unknown) => {
    const msg = (e as { message?: string } | undefined)?.message ?? "";
    if (/request cancell?ed/i.test(msg)) throw new DOMException("Aborted", "AbortError");
    throw e;
  });
}

function pluginHttpFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = urlOf(input);
  countCrossing("pluginHttp", url);
  const started = Date.now();
  return normalizeAbort(tauriFetchImpl(input, init) as Promise<Response>).then(
    (res) => {
      recordBridge("pluginHttp", url, Date.now() - started, "ok");
      return res;
    },
    (error: unknown) => {
      recordBridge("pluginHttp", url, Date.now() - started, bridgeOutcome(error));
      throw error;
    },
  );
}

async function materializeRequest(
  input: Request,
  init?: RequestInit,
): Promise<{ url: string; init: RequestInit }> {
  const request = new Request(input, init);
  const method = request.method.toUpperCase();
  const body =
    method !== "GET" && method !== "HEAD" && request.body ? await request.arrayBuffer() : undefined;
  return {
    url: request.url,
    init: {
      method: request.method,
      headers: new Headers(request.headers),
      body,
      signal: request.signal,
      cache: request.cache,
      credentials: request.credentials,
      integrity: request.integrity,
      keepalive: request.keepalive,
      mode: request.mode,
      redirect: request.redirect,
      referrer: request.referrer,
      referrerPolicy: request.referrerPolicy,
    },
  };
}

const COMPASS_FETCH_DEADLINE_MS = 35000;

function withDeadline<T>(
  p: Promise<T>,
  signal?: AbortSignal | null,
  deadlineMs = COMPASS_FETCH_DEADLINE_MS,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanups: Array<() => void> = [];
    const finish = (run: () => void) => {
      if (settled) return;
      settled = true;
      for (const c of cleanups) c();
      run();
    };
    const timer = setTimeout(
      () =>
        finish(() => reject(new DOMException("compass_fetch exceeded deadline", "TimeoutError"))),
      deadlineMs,
    );
    cleanups.push(() => clearTimeout(timer));
    if (signal) {
      const onAbort = () => finish(() => reject(new DOMException("Aborted", "AbortError")));
      signal.addEventListener("abort", onAbort);
      cleanups.push(() => signal.removeEventListener("abort", onAbort));
    }
    p.then(
      (v) => finish(() => resolve(v)),
      (e) => finish(() => reject(e)),
    );
  });
}

const DIRECT_ATTEMPT_MS = 12000;

function directAttempt(host: string, input: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const caller = init?.signal;
  const started = Date.now();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, DIRECT_ATTEMPT_MS);
  const relay = () => controller.abort();
  caller?.addEventListener("abort", relay);
  const release = () => {
    clearTimeout(timer);
    caller?.removeEventListener("abort", relay);
  };
  return fetch(input, { ...init, signal: controller.signal }).then(
    (res) => {
      release();
      recordBridge("direct", input, Date.now() - started, "ok");
      clearDirectFailures(host);
      return res;
    },
    (error: unknown) => {
      release();
      const verdict = classifyDirectFailure({
        callerAborted: caller?.aborted === true,
        timedOut,
        cancelled: isCancellation(error),
        idempotent: isIdempotent(init?.method),
      });
      recordBridge("direct", input, Date.now() - started, verdict.outcome);
      if (verdict.action === "rethrow") {
        if (caller?.aborted) throw new DOMException("Aborted", "AbortError");
        throw error;
      }
      if (verdict.demote) noteDirectFailure(host);
      if (verdict.action === "giveUp") {
        throw new DOMException(`direct host ${host} exceeded its attempt budget`, "TimeoutError");
      }
      countCrossing("directFail", input);
      return tauriCompassFetch(input, init);
    },
  );
}

function tauriStringFetch(input: string, init?: RequestInit): Promise<Response> {
  const directHost = hasSensitiveRequestHeaders(init?.headers) ? null : directHostFor(input);
  if (directHost) {
    countCrossing("direct", input);
    return withDeadline(directAttempt(directHost, input, init), init?.signal);
  }
  const exec = isIdempotent(init?.method)
    ? tauriCompassFetch(input, init).catch((e: unknown) => {
        if (isCancellation(e)) throw e;
        if (!shouldFallbackToPluginHttp(e, init)) throw e;
        return pluginHttpFetch(input, init);
      })
    : tauriCompassFetch(input, init);
  return withDeadline(exec, init?.signal);
}

function webStringFetch(input: string, init?: RequestInit): Promise<Response> {
  const rewritten = rewriteForWeb(input, init);
  return fetch(rewritten.url, rewritten.init);
}

export const safeFetch: typeof fetch = (input, init) => {
  const target = urlOf(input);
  if (isBlockedUrl(target)) {
    noteBlocked();
    let host = target;
    try {
      host = new URL(target).hostname;
    } catch {}
    return Promise.reject(new TrackerBlockedError(host));
  }
  if (isTauri) {
    if (typeof input === "string") return tauriStringFetch(input, init);
    if (input instanceof URL) return tauriStringFetch(input.href, init);
    return materializeRequest(input, init).then((request) =>
      tauriStringFetch(request.url, request.init),
    );
  }
  if (typeof input === "string") return webStringFetch(input, init);
  if (input instanceof URL) return webStringFetch(input.href, init);
  return materializeRequest(input, init).then((request) =>
    webStringFetch(request.url, request.init),
  );
};

export function safeFetchLocal(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const target = urlOf(input);
  if (isBlockedUrl(target)) {
    noteBlocked();
    let host = target;
    try {
      host = new URL(target).hostname;
    } catch {}
    return Promise.reject(new TrackerBlockedError(host));
  }
  if (isTauri) {
    const fetchPart =
      typeof input === "string"
        ? tauriCompassFetch(input, init, undefined, 30000, undefined, true)
        : input instanceof URL
          ? tauriCompassFetch(input.href, init, undefined, 30000, undefined, true)
          : materializeRequest(input, init).then((request) =>
              tauriCompassFetch(request.url, request.init, undefined, 30000, undefined, true),
            );
    return withDeadline(fetchPart, init?.signal);
  }
  if (typeof input === "string") return webStringFetch(input, init);
  if (input instanceof URL) return webStringFetch(input.href, init);
  return materializeRequest(input, init).then((request) =>
    webStringFetch(request.url, request.init),
  );
}

export const safeFetchStream: typeof fetch = (input, init) => {
  const target = typeof input === "string" ? input : input instanceof URL ? input.href : null;
  if (target && isBlockedUrl(target)) {
    noteBlocked();
    return Promise.reject(new TrackerBlockedError(new URL(target).hostname));
  }
  if (isTauri) return pluginHttpFetch(input, init);
  if (typeof input === "string") {
    const rewritten = rewriteForWeb(input, init);
    return fetch(rewritten.url, rewritten.init);
  }
  return fetch(input, init);
};

export function safeFetchBytes(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = 30000,
  maxResponseBytes?: number,
  allowLocalNetwork = false,
): Promise<Response> {
  const target = typeof input === "string" ? input : input instanceof URL ? input.href : null;
  const policyHeaders = new Headers(init?.headers as HeadersInit | undefined);
  const publicNetworkOnly = policyHeaders.get(SUBTITLE_PUBLIC_NETWORK_HEADER) === "1";
  policyHeaders.delete(SUBTITLE_PUBLIC_NETWORK_HEADER);
  const cleanInit = init
    ? {
        ...init,
        headers: policyHeaders,
      }
    : undefined;
  if (publicNetworkOnly && (!target || !isSafeProviderSubtitleUrl(target))) {
    return Promise.reject(new TypeError("blocked non-public provider subtitle target"));
  }
  if (!isTauri || !target) {
    let redirect = cleanInit?.redirect;
    if (
      publicNetworkOnly &&
      (hasSensitiveRequestHeaders(cleanInit?.headers) || /[?&]api_key=/iu.test(target ?? ""))
    ) {
      redirect = "error";
    }
    return safeFetch(input, cleanInit ? { ...cleanInit, redirect } : cleanInit);
  }
  if (isBlockedUrl(target)) {
    noteBlocked();
    return Promise.reject(new TrackerBlockedError(new URL(target).hostname));
  }
  return withDeadline(
    tauriCompassFetch(target, init, "base64", timeoutMs, maxResponseBytes, allowLocalNetwork),
    init?.signal,
    timeoutMs + 5_000,
  );
}
