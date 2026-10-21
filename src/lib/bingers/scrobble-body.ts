import type { BingersAccess, BingersTarget, ScrobbleOutcome } from "./types";

export type ScrobbleItem = BingersTarget & { watched_at: string };

export function scrobbleItem(target: BingersTarget, watchedAt: string): ScrobbleItem {
  return { ...target, watched_at: watchedAt };
}

type ActionResult = { index?: unknown; status?: unknown };

function outcomeOf(status: unknown): ScrobbleOutcome {
  if (status === "unresolved") return "unresolved";
  // A per-item error is the server's; the item itself was valid, so it is worth a retry.
  if (status === "error") return "failed";
  return "recorded";
}

/**
 * Maps a 200 answer onto the items sent. `already` (a repeat within 12 hours) counts as
 * recorded. An answer that names no result for an item still means the batch was taken,
 * so the item is not resent forever.
 */
export function outcomesFor(data: unknown, count: number): ScrobbleOutcome[] {
  const out: ScrobbleOutcome[] = Array.from({ length: count }, () => "recorded");
  const results = (data as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return out;
  results.forEach((raw, position) => {
    const r = raw as ActionResult | null;
    const index = typeof r?.index === "number" ? r.index : position;
    if (Number.isInteger(index) && index >= 0 && index < count) out[index] = outcomeOf(r?.status);
  });
  return out;
}

/** Network trouble, rate limits and server errors are retried; anything else never will work. */
export function outcomeForStatus(status: number | null): ScrobbleOutcome {
  if (status == null || status === 401 || status === 408 || status === 429 || status >= 500) {
    return "failed";
  }
  return "refused";
}

export function accessForError(status: number, code: string | null): BingersAccess | null {
  if (status !== 403) return null;
  return code === "insufficient_scope" ? "reauth" : "plan-required";
}
