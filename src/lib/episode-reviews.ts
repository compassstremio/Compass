import { safeFetch } from "@/lib/safe-fetch";
import { fetchComments } from "@/lib/trakt/comments";

// Reviews for a single episode, merged from two public sources:
//  - IMDb user reviews of the episode itself (each with the reviewer's /10 rating), read from
//    IMDb's public GraphQL endpoint;
//  - Trakt comments on the episode (with the commenter's own rating), through Compass's
//    existing Trakt client.

export type EpisodeReviewSource = "imdb" | "trakt";

export type EpisodeReview = {
  id: string;
  source: EpisodeReviewSource;
  author: string;
  avatar: string | null;
  /** 1-10, when the reviewer rated the episode. */
  rating: number | null;
  date: string | null;
  likes: number;
  title: string;
  text: string;
  spoiler: boolean;
  url: string | null;
};

export type EpisodeReviewSort = "liked" | "recent" | "highest" | "lowest" | "longest";

export type EpisodeReviews = {
  reviews: EpisodeReview[];
  imdbCount: number;
  traktCount: number;
  /** Mean of the reviewers' own ratings, 1-10. */
  average: number | null;
};

const IMDB_GRAPHQL = "https://api.graphql.imdb.com/";
const IMDB_PAGES = 3; // 50 reviews per page
const TRAKT_PAGES = 3; // 100 comments per page

async function imdbQuery<T>(query: string): Promise<T | null> {
  try {
    const res = await safeFetch(IMDB_GRAPHQL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-imdb-client-name": "imdb-web-next-localized" },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { data?: T }).data ?? null;
  } catch {
    return null;
  }
}

const IMDB_ID = /^tt\d+$/;
const seasonEpisodes = new Map<string, Map<string, string>>();

/** IMDb id of an episode, from the series' IMDb id. */
export async function imdbEpisodeId(seriesImdbId: string, season: number, episode: number): Promise<string | null> {
  if (!IMDB_ID.test(seriesImdbId)) return null;
  const key = `${seriesImdbId}:${season}`;
  let byNumber = seasonEpisodes.get(key);
  if (!byNumber) {
    type Data = {
      title?: {
        episodes?: {
          episodes?: {
            edges: { node: { id: string; series?: { displayableEpisodeNumber?: { episodeNumber?: { text?: string } } } } }[];
          };
        };
      };
    };
    const data = await imdbQuery<Data>(
      `{ title(id:"${seriesImdbId}"){ episodes{ episodes(first:250, filter:{includeSeasons:["${season}"]}){ edges{ node{ id series{ displayableEpisodeNumber{ episodeNumber{text} } } } } } } } }`,
    );
    byNumber = new Map();
    for (const { node } of data?.title?.episodes?.episodes?.edges ?? []) {
      const n = node.series?.displayableEpisodeNumber?.episodeNumber?.text;
      if (n) byNumber.set(n, node.id);
    }
    if (byNumber.size) seasonEpisodes.set(key, byNumber);
  }
  return byNumber.get(String(episode)) ?? null;
}

async function imdbReviews(episodeImdbId: string): Promise<EpisodeReview[]> {
  type Node = {
    id: string;
    author?: { nickName?: string };
    authorRating?: number | null;
    summary?: { originalText?: string };
    text?: { originalText?: { plainText?: string } };
    submissionDate?: string;
    helpfulness?: { upVotes?: number };
    spoiler?: boolean;
  };
  type Data = {
    title?: { reviews?: { pageInfo?: { hasNextPage?: boolean; endCursor?: string }; edges: { node: Node }[] } };
  };
  const out: EpisodeReview[] = [];
  let after: string | null = null;
  for (let page = 0; page < IMDB_PAGES; page++) {
    const data: Data | null = await imdbQuery<Data>(
      `{ title(id:"${episodeImdbId}"){ reviews(first:50${after ? `, after:"${after}"` : ""}, sort:{by:HELPFULNESS_SCORE, order:DESC}){ pageInfo{hasNextPage endCursor} edges{ node{ id author{nickName} authorRating summary{originalText} text{originalText{plainText}} submissionDate helpfulness{upVotes} spoiler } } } } }`,
    );
    const reviews: NonNullable<Data["title"]>["reviews"] = data?.title?.reviews;
    if (!reviews) break;
    for (const { node } of reviews.edges) {
      out.push({
        id: `imdb:${node.id}`,
        source: "imdb",
        author: node.author?.nickName || "IMDb",
        avatar: null,
        rating: node.authorRating ?? null,
        date: node.submissionDate ?? null,
        likes: node.helpfulness?.upVotes ?? 0,
        title: node.summary?.originalText ?? "",
        text: node.text?.originalText?.plainText ?? "",
        spoiler: !!node.spoiler,
        url: `https://www.imdb.com/review/${node.id}/`,
      });
    }
    if (!reviews.pageInfo?.hasNextPage || !reviews.pageInfo.endCursor) break;
    after = reviews.pageInfo.endCursor;
  }
  return out;
}

async function traktComments(seriesImdbId: string, season: number, episode: number): Promise<EpisodeReview[]> {
  const target = { kind: "episode" as const, show: { ids: { imdb: seriesImdbId } }, season, number: episode };
  const out: EpisodeReview[] = [];
  for (let page = 1; page <= TRAKT_PAGES; page++) {
    const comments = await fetchComments(target, "likes", page, 100);
    for (const c of comments) {
      out.push({
        id: `trakt:${c.id}`,
        source: "trakt",
        author: c.user.name || c.user.username,
        avatar: c.user.avatar,
        rating: c.userRating,
        date: c.createdAt,
        likes: c.likes,
        title: "",
        text: c.comment,
        spoiler: c.spoiler,
        url: `https://trakt.tv/comments/${c.id}`,
      });
    }
    if (comments.length < 100) break;
  }
  return out;
}

export async function fetchEpisodeReviews(
  seriesImdbId: string,
  season: number,
  episode: number,
): Promise<EpisodeReviews> {
  const [imdb, trakt] = await Promise.all([
    imdbEpisodeId(seriesImdbId, season, episode)
      .then((id) => (id ? imdbReviews(id) : []))
      .catch(() => [] as EpisodeReview[]),
    traktComments(seriesImdbId, season, episode).catch(() => [] as EpisodeReview[]),
  ]);
  const reviews = [...imdb, ...trakt].filter((r) => r.text.trim());
  const ratings = reviews.map((r) => r.rating).filter((v): v is number => v != null);
  return {
    reviews,
    imdbCount: imdb.length,
    traktCount: trakt.length,
    average: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
  };
}

export function sortEpisodeReviews(reviews: EpisodeReview[], sort: EpisodeReviewSort): EpisodeReview[] {
  const time = (r: EpisodeReview) => (r.date ? Date.parse(r.date) || 0 : 0);
  const key: Record<EpisodeReviewSort, (a: EpisodeReview, b: EpisodeReview) => number> = {
    liked: (a, b) => b.likes - a.likes,
    recent: (a, b) => time(b) - time(a),
    // Unrated reviews go last in both rating orders.
    highest: (a, b) => (b.rating ?? -1) - (a.rating ?? -1),
    lowest: (a, b) => (a.rating ?? 11) - (b.rating ?? 11),
    longest: (a, b) => b.text.length - a.text.length,
  };
  return [...reviews].sort(key[sort]);
}
