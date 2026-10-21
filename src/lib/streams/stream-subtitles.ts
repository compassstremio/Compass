import { isLocalAddonSubtitleUrl } from "@/lib/subtitles/provider-url";
import type { StreamSubtitle } from "./types";

export type StreamSubtitleSeed = {
  url: string;
  lang?: string;
  id?: string;
  trustedSource?: boolean;
};

/**
 * Stream-attached subtitles keep the streaming addon's local trust: a
 * user-installed addon on a local address serves its own subtitles, while a
 * public addon never gains local reach and its subtitles stay
 * public-network-only.
 */
export function streamSubtitles(
  stream: { subtitles?: StreamSubtitle[]; addonUrl?: string },
): StreamSubtitleSeed[] | undefined {
  if (!stream.subtitles) return undefined;
  return stream.subtitles.map((s) => ({
    url: s.url,
    lang: s.lang,
    id: s.id,
    ...(stream.addonUrl && isLocalAddonSubtitleUrl(s.url, stream.addonUrl)
      ? { trustedSource: true as const }
      : {}),
  }));
}
