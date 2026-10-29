import { getRating, setRatingLocal, removeRatingLocal } from "./store";
import { upsertRating, deleteRatingRemote } from "@/lib/social/ratings-api";
import { profileForId, trackEvent } from "@/lib/discover/store";
import type { MyRating, RatingTarget } from "./types";

const LIKE_SCORE = 8;
const DISLIKE_SCORE = 4;

function feedTaste(itemKey: string, score: number): void {
  if (score < LIKE_SCORE && score > DISLIKE_SCORE) return;
  const profile = profileForId(itemKey);
  if (!profile) return;
  trackEvent(itemKey, score >= LIKE_SCORE ? "vote_up" : "vote_down", profile);
}

function statusOf(e: unknown): number | undefined {
  return (e as { status?: number })?.status;
}

export async function rate(
  target: RatingTarget,
  score: number,
  extra?: { review?: string; spoiler?: boolean },
): Promise<void> {
  const prev = getRating(target.itemKey);
  const review = extra?.review?.trim() || undefined;
  const spoiler = extra?.spoiler || undefined;
  const optimistic: MyRating = {
    itemKey: target.itemKey,
    mediaType: target.mediaType,
    score,
    review,
    spoiler,
    title: target.title,
    poster: target.poster,
    updatedAt: Date.now(),
  };
  setRatingLocal(optimistic);
  feedTaste(target.itemKey, score);
  try {
    const saved = await upsertRating({ ...target, score, review, spoiler });
    setRatingLocal(saved);
  } catch (e) {
    const status = statusOf(e);
    if (status && status >= 400 && status < 500 && status !== 429) {
      if (prev) setRatingLocal(prev);
      else removeRatingLocal(target.itemKey);
    }
    throw e;
  }
}

export async function unrate(itemKey: string): Promise<void> {
  const prev = getRating(itemKey);
  removeRatingLocal(itemKey);
  try {
    await deleteRatingRemote(itemKey);
  } catch (e) {
    if (prev) setRatingLocal(prev);
    throw e;
  }
}
