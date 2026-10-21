const viewed = new Map<string, number>();

export function getViewedSeason(
  seriesId: string,
  seasons?: { seasonNumber: number }[],
): number | undefined {
  const season = viewed.get(seriesId);
  return season != null && (!seasons || seasons.some((s) => s.seasonNumber === season))
    ? season
    : undefined;
}

export function setViewedSeason(seriesId: string, season: number): void {
  if (Number.isFinite(season)) viewed.set(seriesId, season);
}
