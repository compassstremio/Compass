export function validImdbRating(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 10 ? number.toFixed(1) : undefined;
}

export async function fetchDetailImdbRating(
  id: string,
  kind: "movie" | "series",
  fetchMeta: (
    kind: "movie" | "series",
    id: string,
    force: boolean,
  ) => Promise<{ imdbRating?: unknown } | null>,
): Promise<string | undefined> {
  if (!/^tt\d+$/.test(id)) return undefined;
  // The title/description provider toggle is independent of the IMDb detail badge.
  return validImdbRating((await fetchMeta(kind, id, true))?.imdbRating);
}

export function detailImdbRating(input: {
  id: string;
  inline?: unknown;
  fullId?: string;
  full?: unknown;
  detailId?: string | null;
  detail?: unknown;
  detailSource?: "imdb" | "tmdb";
  cinemeta?: unknown;
  omdb?: unknown;
  compass?: unknown;
}): string | undefined {
  const imdbId = input.id.startsWith("tt") ? input.id : input.detailId;
  // Services first, matching the order the shared src/lib/imdb-rating.ts uses for the hero cards, so
  // one title cannot show two different IMDb numbers. The metadata terms stay as fallbacks.
  const candidates = [
    input.compass,
    input.omdb,
    input.cinemeta,
    input.id.startsWith("tt") ? input.inline : undefined,
    imdbId && input.fullId === imdbId ? input.full : undefined,
    imdbId && input.detailSource === "imdb" && input.detailId === imdbId ? input.detail : undefined,
  ];
  for (const value of candidates) {
    const rating = validImdbRating(value);
    if (rating) return rating;
  }
  return undefined;
}
