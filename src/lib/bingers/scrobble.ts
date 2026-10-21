import { BingersApiError, bingersRequest } from "./client";
import { BINGERS_MAX_BATCH } from "./config";
import {
  listPendingWatches,
  pendingGeneration,
  recordPendingWatch,
  removePendingWatches,
  type PendingWatch,
} from "./pending-sync";
import { accessForError, outcomeForStatus, outcomesFor, scrobbleItem } from "./scrobble-body";
import { getSession, setAccess } from "./session";
import type { BingersTarget, ScrobbleOutcome } from "./types";

async function sendWatches(batch: PendingWatch[]): Promise<ScrobbleOutcome[]> {
  try {
    const data = await bingersRequest<unknown>("/scrobble", {
      method: "POST",
      body: { items: batch.map((p) => scrobbleItem(p.target, p.watchedAt)) },
    });
    setAccess("ok");
    return outcomesFor(data, batch.length);
  } catch (err) {
    if (!(err instanceof BingersApiError)) return batch.map(() => "failed");
    const access = accessForError(err.status, err.code);
    if (access) setAccess(access);
    return batch.map(() => outcomeForStatus(err.status));
  }
}

async function flushOnce(): Promise<void> {
  if (!getSession()) return;
  const batch = listPendingWatches().slice(0, BINGERS_MAX_BATCH);
  if (batch.length === 0) return;
  const generation = pendingGeneration();
  const outcomes = await sendWatches(batch);
  // A disconnect or another account cleared the queue meanwhile; never write it back.
  if (generation !== pendingGeneration()) return;
  removePendingWatches(new Set(batch.filter((_, i) => outcomes[i] !== "failed").map((p) => p.key)));
}

let flushing: Promise<void> | null = null;
let again = false;

/** Sends everything queued in one batch; calls made meanwhile join the next pass. */
export function flushPendingWatches(): Promise<void> {
  if (flushing) {
    again = true;
    return flushing;
  }
  flushing = (async () => {
    try {
      do {
        again = false;
        await flushOnce();
      } while (again);
    } catch {
      /* a failed pass leaves the queue for the next trigger */
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

/**
 * Queued before it is sent, so quitting mid-request cannot lose the watch; a replay is
 * harmless because Bingers ignores a repeat within 12 hours.
 */
export function recordWatch(
  target: BingersTarget,
  watchedAt = new Date().toISOString(),
): Promise<void> {
  if (!getSession()) return Promise.resolve();
  recordPendingWatch(target, watchedAt);
  return flushPendingWatches();
}
