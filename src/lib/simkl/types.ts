export type SimklSession = {
  accessToken: string;
  username: string | null;
  /** Present on OAuth 2.0 (V2) sessions only; legacy PIN sessions never expire. */
  refreshToken?: string;
  /** Epoch ms when accessToken stops working (V2 tokens last 7 days). */
  expiresAt?: number;
};

export type SimklPin = {
  /** Secret handle the app polls with; never shown to the user. */
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  deepLinkUrl: string;
  expiresIn: number;
  pollIntervalSec: number;
};

export type SimklIds = {
  simkl?: number;
  imdb?: string;
  tmdb?: number | string;
  tvdb?: number;
  mal?: number;
  anidb?: number;
  kitsu?: number;
};

export type SimklTarget =
  | { kind: "movie"; ids: SimklIds }
  | { kind: "episode"; show: { ids: SimklIds }; season: number; number: number }
  | { kind: "show"; ids: SimklIds }
  | { kind: "anime"; ids: SimklIds }
  | { kind: "anime-episode"; anime: { ids: SimklIds }; season: number; number: number };

export type SimklItem = {
  type: "movie" | "show";
  title: string;
  year: number | null;
  ids: SimklIds;
  watchedAt?: string;
};

export type SimklUser = {
  name: string;
  avatar?: string | null;
  type?: string;
};
