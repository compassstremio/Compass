import { safeFetch } from "@/lib/safe-fetch";
import { freshAccessToken, refreshSession } from "./auth";
import { BINGERS_API_BASE } from "./config";
import { errorCode, errorMessage } from "./tokens";

export class BingersApiError extends Error {
  status: number;
  code: string | null;
  retryAfterSec: number | null;

  constructor(
    status: number,
    code: string | null,
    message: string,
    retryAfterSec: number | null = null,
  ) {
    super(`Bingers HTTP ${status}: ${message.slice(0, 200)}`);
    this.name = "BingersApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

type RequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
};

function send(path: string, opts: RequestOptions, token: string): Promise<Response> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  return safeFetch(`${BINGERS_API_BASE}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function bingersRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const token = await freshAccessToken();
  if (!token) throw new BingersApiError(401, "not_connected", "Not connected to Bingers");

  let res = await send(path, opts, token);
  if (res.status === 401) {
    // An access token can die before its stated hour (a revoked grant, a key rotation);
    // one refresh tells a stale token apart from a disconnected app.
    const refreshed = await refreshSession();
    if (refreshed && refreshed.accessToken !== token)
      res = await send(path, opts, refreshed.accessToken);
  }

  const data = await readJson(res);
  if (!res.ok) {
    const retryAfter = Number(res.headers.get("Retry-After"));
    throw new BingersApiError(
      res.status,
      errorCode(data),
      errorMessage(data, res.status),
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    );
  }
  return data as T;
}
