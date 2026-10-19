import type { Meta } from "./cinemeta";
import type { Episode } from "./providers/tmdb";

type Video = NonNullable<Meta["videos"]>[number];

export function specificEpisodeTitle(
  name: string | undefined,
  episode: number,
): string | undefined {
  const title = name?.trim();
  if (!title || new RegExp(`^episode\\s*0*${episode}$`, "i").test(title)) return undefined;
  return title;
}

export function episodeSearchVideos(
  videos: Meta["videos"],
  fetched: Episode[],
  visible: Episode[],
): Video[] {
  const byNumber = new Map<string, Video>();
  for (const video of videos ?? []) {
    if (video.season == null || video.episode == null) continue;
    byNumber.set(`${video.season}:${video.episode}`, video);
  }
  for (const episode of [...fetched, ...visible]) {
    const key = `${episode.seasonNumber}:${episode.episodeNumber}`;
    const previous = byNumber.get(key);
    const thumbnail =
      episode.stillUrl ||
      (episode.stillPath ? `https://image.tmdb.org/t/p/w500${episode.stillPath}` : undefined);
    byNumber.set(key, {
      ...previous,
      id: previous?.id ?? `tmdb:${episode.id}`,
      season: episode.seasonNumber,
      episode: episode.episodeNumber,
      name: episode.name || previous?.name || previous?.title,
      overview: episode.overview || previous?.overview || previous?.description,
      thumbnail: thumbnail || previous?.thumbnail,
    });
  }
  return [...byNumber.values()];
}

export function matchingEpisodeVideos(videos: Video[], query: string): Video[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [];
  return videos
    .filter((video) => video.season != null && video.season >= 1 && video.episode != null)
    .filter((video) =>
      [
        video.name,
        video.title,
        video.overview,
        video.description,
        String(video.episode),
        `s${video.season}e${video.episode}`,
      ].some((value) => value?.toLocaleLowerCase().includes(q)),
    )
    .sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0));
}
