import { mediaServerToken } from "./connections";
import { mediaServerRequest, normalizeServerOrigin } from "./transport";
import type {
  AuthResult,
  MediaIdentity,
  MediaServerAdapter,
  MediaServerCollection,
  MediaServerConnection,
  MediaServerItem,
  MediaServerLibrary,
  MediaServerPlayback,
  MediaServerProgress,
  MediaServerProvider,
  SyncPage,
} from "./types";
import type { MediaServerPlaybackRequest } from "./types";
import { qualityPreset, versionFitsQuality } from "./quality";
import { parseEpisodeSpan } from "@/lib/episode-span";

type ApiItem = Record<string, any>;
const fields =
  "ProviderIds,MediaSources,RunTimeTicks,DateCreated,UserData,ParentId,SeriesId,IndexNumber,ParentIndexNumber,ProductionYear,Path,ImageTags";
const ticksMs = (value: unknown) =>
  typeof value === "number" ? Math.round(value / 10_000) : undefined;
const dateMs = (value: unknown) =>
  typeof value === "string" ? Date.parse(value) || undefined : undefined;
// The server reports the true pixel height, which for 2.00:1 shows is 960 even
// though the release is a 1080p source. Prefer the resolution named in the
// filename (matching what the badges and every other client show) and only fall
// back to the measured height.
function resolutionLabel(name: string | undefined, height: number | undefined): string | undefined {
  const match = name?.match(
    /(?:^|[^0-9a-z])(2160p|1440p|1080p|1080i|720p|576p|480p|360p|240p|4k|8k|uhd)(?:[^0-9a-z]|$)/i,
  );
  if (match) {
    const token = match[1].toLowerCase();
    if (token === "4k" || token === "uhd") return "2160p";
    if (token === "8k") return "4320p";
    return token;
  }
  return height ? `${height}p` : undefined;
}

function normalized(
  connectionId: string,
  library: MediaServerLibrary,
  raw: ApiItem,
): MediaServerItem | null {
  const map: Record<string, MediaServerItem["kind"]> = {
    Movie: "movie",
    Series: "series",
    Season: "season",
    Episode: "episode",
  };
  const kind = map[raw.Type];
  if (!kind || !raw.Id) return null;
  const ids = raw.ProviderIds ?? {};
  const filename =
    String(raw.Path ?? "")
      .split(/[\\/]/)
      .pop() || undefined;
  const episodeHint =
    kind === "episode" ? parseEpisodeSpan(filename ?? String(raw.Name ?? "")) : null;
  const season =
    kind === "episode" ? Number(raw.ParentIndexNumber ?? episodeHint?.season) : undefined;
  const episode = kind === "episode" ? Number(raw.IndexNumber ?? episodeHint?.episode) : undefined;
  return {
    id: raw.Id,
    connectionId,
    libraryId: library.id,
    libraryName: library.name,
    parentId: kind === "episode" ? (raw.SeriesId ?? raw.ParentId) : raw.ParentId,
    kind,
    title: raw.Name ?? "Untitled",
    year: raw.ProductionYear,
    identity: {
      tmdbId: ids.Tmdb ? Number(ids.Tmdb) : undefined,
      imdbId: ids.Imdb,
      tvdbId: ids.Tvdb ? Number(ids.Tvdb) : undefined,
      season: Number.isFinite(season) ? season : undefined,
      episode: Number.isFinite(episode) ? episode : undefined,
      episodeEnd: episodeHint?.episodeEnd,
    },
    posterPath: raw.ImageTags?.Primary
      ? `Items/${raw.Id}/Images/Primary?tag=${encodeURIComponent(raw.ImageTags.Primary)}&maxHeight=600&quality=90`
      : undefined,
    versions: (raw.MediaSources ?? []).map((source: ApiItem) => {
      const streams = source.MediaStreams ?? raw.MediaStreams ?? [];
      const video = streams.find((stream: ApiItem) => stream.Type === "Video");
      const audio = streams.find((stream: ApiItem) => stream.Type === "Audio");
      const videoRange = String(video?.VideoRangeType ?? video?.VideoRange ?? "");
      const audioProfile = String(audio?.Profile ?? "");
      const subtitles = streams
        .filter((stream: ApiItem) => stream.Type === "Subtitle" && stream.IsExternal !== false)
        .map((stream: ApiItem) => ({
          id: String(stream.Index),
          language: stream.Language,
          title: stream.DisplayTitle ?? stream.Title,
          url: stream.DeliveryUrl,
          index: stream.Index,
          codec: stream.Codec,
        }));
      const sourceFilename =
        String(source.Path ?? filename ?? "")
          .split(/[\\/]/)
          .pop() || undefined;
      const sourceSpan = parseEpisodeSpan(sourceFilename ?? "");
      return {
        id: source.Id ?? raw.Id,
        name: source.Name,
        filename: sourceFilename,
        season: sourceSpan?.season,
        episode: sourceSpan?.episode,
        episodeEnd: sourceSpan?.episodeEnd,
        container: source.Container,
        videoCodec: video?.Codec,
        audioCodec: audio?.Codec,
        width: video?.Width,
        height: video?.Height,
        resolution: resolutionLabel(sourceFilename, video?.Height),
        videoProfile: video?.Profile,
        hdr: /hdr/i.test(videoRange) ? videoRange : undefined,
        dolbyVisionProfile: /dovi|dolby.?vision/i.test(videoRange)
          ? (video?.Profile ?? videoRange)
          : undefined,
        audioProfile: audio?.Profile,
        atmos: /atmos/i.test(`${audio?.Title ?? ""} ${audioProfile}`),
        channels: audio?.Channels,
        bitrateKbps: source.Bitrate ? Math.round(source.Bitrate / 1000) : undefined,
        sizeBytes: source.Size,
        edition: raw.EditionName ?? source.EditionName,
        runtimeMs: ticksMs(source.RunTimeTicks),
        directPlayable: source.SupportsDirectPlay !== false,
        subtitles,
      };
    }),
    progress: raw.UserData
      ? {
          positionMs: ticksMs(raw.UserData.PlaybackPositionTicks) ?? 0,
          durationMs: ticksMs(raw.RunTimeTicks),
          played: !!raw.UserData.Played,
          updatedAt: dateMs(raw.UserData.LastPlayedDate) ?? Date.now(),
        }
      : undefined,
    addedAt: dateMs(raw.DateCreated),
    updatedAt: dateMs(raw.DateLastSaved) ?? Date.now(),
  };
}

export class JellyfinEmbyAdapter implements MediaServerAdapter {
  constructor(
    readonly provider: Extract<MediaServerProvider, "jellyfin" | "emby">,
    private origin: string,
  ) {
    this.origin = normalizeServerOrigin(origin);
  }
  private headers(connection?: MediaServerConnection, token?: string): Record<string, string> {
    const auth = token ?? (connection ? mediaServerToken(connection) : null);
    const value = `MediaBrowser Client="Compass", Device="Compass", DeviceId="compass", Version="1"${auth ? `, Token="${auth}"` : ""}`;
    // Jellyfin (and current Emby) authenticate with the standard Authorization
    // header. The X-Emby-Authorization header is legacy: some Jellyfin
    // deployments reject it with a 400, so Jellyfin never sends it. Emby still
    // reads X-Emby-Authorization.
    return this.provider === "emby"
      ? { Accept: "application/json", "X-Emby-Authorization": value }
      : { Accept: "application/json", Authorization: value };
  }
  // Playback (mpv) requests are authorised by header, not by the URL. Jellyfin
  // rejects the X-Emby-Token header and the api_key query param on current
  // builds, so it uses a comma-free Authorization header (mpv treats commas as
  // header separators). Emby keeps its X-Emby-Token.
  private playbackHeaders(connection: MediaServerConnection): Record<string, string> {
    const token = mediaServerToken(connection);
    if (!token) return {};
    return this.provider === "emby"
      ? { "X-Emby-Token": token }
      : { Authorization: `MediaBrowser Token="${token}"` };
  }
  async authenticate(input: Record<string, string>): Promise<AuthResult> {
    const response = await mediaServerRequest<ApiItem>(this.origin, "/Users/AuthenticateByName", {
      method: "POST",
      headers: this.headers(),
      body: { Username: input.username, Pw: input.password },
    });
    return {
      userId: response.body.User?.Id,
      userName: response.body.User?.Name,
      token: response.body.AccessToken,
    };
  }
  async libraries(connection: MediaServerConnection): Promise<MediaServerLibrary[]> {
    const r = await mediaServerRequest<{ Items?: ApiItem[] }>(
      connection.origin,
      `/Users/${encodeURIComponent(connection.userId)}/Views`,
      { headers: this.headers(connection) },
    );
    return (r.body.Items ?? []).map((x) => ({
      id: x.Id,
      connectionId: connection.id,
      name: x.Name,
      kind:
        x.CollectionType === "movies"
          ? "movie"
          : x.CollectionType === "tvshows"
            ? "series"
            : "mixed",
      enabled: true,
    }));
  }
  async collections(connection: MediaServerConnection): Promise<MediaServerCollection[]> {
    const params = new URLSearchParams({
      Recursive: "true",
      IncludeItemTypes: "BoxSet",
      Fields: "ChildCount,ImageTags",
      SortBy: "SortName",
    });
    const r = await mediaServerRequest<{ Items?: ApiItem[] }>(
      connection.origin,
      `/Users/${encodeURIComponent(connection.userId)}/Items?${params}`,
      { headers: this.headers(connection) },
    );
    return (r.body.Items ?? []).map((x) => ({
      id: x.Id,
      connectionId: connection.id,
      name: x.Name ?? "Untitled",
      childCount: typeof x.ChildCount === "number" ? x.ChildCount : undefined,
      posterPath: x.ImageTags?.Primary
        ? `Items/${x.Id}/Images/Primary?tag=${encodeURIComponent(x.ImageTags.Primary)}&maxHeight=600&quality=90`
        : undefined,
    }));
  }
  async collectionItemIds(
    connection: MediaServerConnection,
    collectionId: string,
  ): Promise<string[]> {
    const ids: string[] = [];
    let start = 0;
    for (;;) {
      const params = new URLSearchParams({
        ParentId: collectionId,
        Recursive: "false",
        IncludeItemTypes: "Movie,Series",
        StartIndex: String(start),
        Limit: "500",
      });
      const r = await mediaServerRequest<{ Items?: ApiItem[] }>(
        connection.origin,
        `/Users/${encodeURIComponent(connection.userId)}/Items?${params}`,
        { headers: this.headers(connection) },
      );
      const raw = r.body.Items ?? [];
      ids.push(...raw.map((x) => x.Id));
      if (raw.length < 500) break;
      start += raw.length;
    }
    return ids;
  }
  private async fetchItemsPage(
    connection: MediaServerConnection,
    library: MediaServerLibrary,
    start: number,
    limit: number,
  ): Promise<{ raw: ApiItem[]; total: number }> {
    const params = new URLSearchParams({
      ParentId: library.id,
      Recursive: "true",
      IncludeItemTypes: "Movie,Series,Season,Episode",
      Fields: fields,
      StartIndex: String(start),
      Limit: String(limit),
      SortBy: "SortName",
    });
    const r = await mediaServerRequest<{ Items?: ApiItem[]; TotalRecordCount?: number }>(
      connection.origin,
      `/Users/${encodeURIComponent(connection.userId)}/Items?${params}`,
      { headers: this.headers(connection) },
    );
    const raw = r.body.Items ?? [];
    return { raw, total: r.body.TotalRecordCount ?? start + raw.length };
  }
  async synchronize(
    connection: MediaServerConnection,
    library: MediaServerLibrary,
    cursor?: string,
  ): Promise<SyncPage> {
    const start = Number(cursor ?? 0);
    const PAGE = 1000;
    // Fetch one page to learn the total, then a few more at the same time.
    // Keeps each response small while cutting the wall-clock time of a large
    // library by roughly the concurrency factor.
    const first = await this.fetchItemsPage(connection, library, start, PAGE);
    const total = first.total;
    const pages = [first];
    if (first.raw.length === PAGE) {
      const offsets: number[] = [];
      for (let index = 1; index < 4; index += 1) {
        const offset = start + index * PAGE;
        if (offset >= total) break;
        offsets.push(offset);
      }
      const rest = await Promise.all(
        offsets.map((offset) => this.fetchItemsPage(connection, library, offset, PAGE)),
      );
      pages.push(...rest);
    }
    const raw = pages.flatMap((page) => page.raw);
    const items = raw
      .map((x) => normalized(connection.id, library, x))
      .filter((x): x is MediaServerItem => !!x);
    // Advance by what the server actually returned. A batch with no items at
    // all ends the library (some servers report a TotalRecordCount larger than
    // the items they return, which would otherwise loop forever), while a short
    // page keeps the index moving instead of truncating it.
    const consumed = pages.reduce((sum, page) => sum + page.raw.length, 0);
    return {
      items,
      cursor: consumed > 0 && start + consumed < total ? String(start + consumed) : undefined,
      processed: Math.min(total, start + raw.length),
      total,
    };
  }
  async lookup(
    connection: MediaServerConnection,
    identity: MediaIdentity,
  ): Promise<MediaServerItem[]> {
    const libraries = await this.libraries(connection);
    const pages = await Promise.all(
      libraries.map((library) => this.synchronize(connection, library)),
    );
    return pages
      .flatMap((p) => p.items)
      .filter(
        (item) =>
          (identity.tmdbId && item.identity.tmdbId === identity.tmdbId) ||
          (identity.imdbId && item.identity.imdbId === identity.imdbId) ||
          (identity.tvdbId && item.identity.tvdbId === identity.tvdbId),
      )
      .filter(
        (item) =>
          identity.season == null ||
          (item.identity.season === identity.season && item.identity.episode === identity.episode),
      );
  }
  async playback(
    connection: MediaServerConnection,
    item: MediaServerItem,
    request: MediaServerPlaybackRequest,
  ): Promise<MediaServerPlayback> {
    const versionId = request.versionId;
    let versions = item.versions;
    const cachedVersion = versions.find((entry) => entry.id === versionId) ?? versions[0];
    if (!cachedVersion?.subtitles?.length) {
      try {
        const response = await mediaServerRequest<ApiItem>(
          connection.origin,
          `/Users/${encodeURIComponent(connection.userId)}/Items/${encodeURIComponent(item.id)}?Fields=${encodeURIComponent(fields)}`,
          { headers: this.headers(connection) },
        );
        const refreshed = normalized(
          connection.id,
          {
            id: item.libraryId,
            connectionId: connection.id,
            name: item.libraryName ?? "",
            kind: item.kind,
            enabled: true,
          },
          response.body,
        );
        if (refreshed?.versions.length) versions = refreshed.versions;
      } catch {
        // Cached playback remains usable when the server cannot refresh details.
      }
    }
    const version = versions.find((v) => v.id === versionId) ?? versions[0];
    if (!version) throw new Error("No playable media version");
    const direct =
      version.directPlayable &&
      connection.directPlay &&
      versionFitsQuality(version, request.quality);
    const subtitles = (version.subtitles ?? []).map((subtitle) => {
      const relative =
        subtitle.url ??
        `Videos/${encodeURIComponent(item.id)}/${encodeURIComponent(version.id)}/Subtitles/${subtitle.index ?? subtitle.id}/Stream.${encodeURIComponent(subtitle.codec ?? "srt")}`;
      return {
        id: subtitle.id,
        language: subtitle.language,
        title: subtitle.title,
        url: new URL(relative.replace(/^\//, ""), `${connection.origin}/`).toString(),
      };
    });
    const token = mediaServerToken(connection) ?? "";
    const playbackHeaders = this.playbackHeaders(connection);
    if (direct)
      return {
        url: new URL(
          `Videos/${encodeURIComponent(item.id)}/stream?Static=true&MediaSourceId=${encodeURIComponent(version.id)}`,
          `${connection.origin}/`,
        ).toString(),
        protocol: "http",
        direct: true,
        versionId: version.id,
        headers: playbackHeaders,
        subtitles,
        effectiveQuality: request.quality,
        decision: "direct-play",
      };
    if (!connection.transcodeFallback)
      throw new Error("Transcoding is disabled for this server. Choose Original quality.");
    const preset = qualityPreset(request.quality);
    const sessionId = request.playbackSessionId ?? crypto.randomUUID();
    const maxBitrate = (preset.maxBitrateKbps ?? version.bitrateKbps ?? 100_000) * 1000;
    let playbackInfo: ApiItem = {};
    try {
      playbackInfo = (
        await mediaServerRequest<ApiItem>(
          connection.origin,
          `/Items/${encodeURIComponent(item.id)}/PlaybackInfo?UserId=${encodeURIComponent(connection.userId)}&StartTimeTicks=${Math.max(0, request.startPositionMs ?? 0) * 10_000}`,
          {
            method: "POST",
            headers: this.headers(connection),
            body: {
              UserId: connection.userId,
              MediaSourceId: version.id,
              MaxStreamingBitrate: maxBitrate,
              AutoOpenLiveStream: true,
              EnableDirectPlay: false,
              EnableDirectStream: false,
              EnableTranscoding: true,
              AllowVideoStreamCopy: false,
              AllowAudioStreamCopy: false,
              PlaySessionId: sessionId,
              DeviceProfile: {
                Name: "Compass",
                MaxStreamingBitrate: maxBitrate,
                MaxStaticBitrate: maxBitrate,
                MusicStreamingTranscodingBitrate: 192000,
                DirectPlayProfiles: [],
                TranscodingProfiles: [
                  {
                    Container: "ts",
                    Type: "Video",
                    VideoCodec: "h264",
                    AudioCodec: "aac",
                    Protocol: "hls",
                    Context: "Streaming",
                    MaxAudioChannels: "8",
                    MinSegments: 1,
                    BreakOnNonKeyFrames: true,
                  },
                ],
                CodecProfiles: [],
                SubtitleProfiles: [
                  { Format: "srt", Method: "External" },
                  { Format: "ass", Method: "External" },
                  { Format: "vtt", Method: "External" },
                ],
              },
            },
          },
        )
      ).body;
    } catch {
      // Older Emby/Jellyfin releases accept the HLS endpoint even when they reject
      // a modern DeviceProfile. The explicit capped URL below remains valid.
    }
    const source =
      (playbackInfo.MediaSources ?? []).find((entry: ApiItem) => String(entry.Id) === version.id) ??
      playbackInfo.MediaSources?.[0];
    const playSessionId = playbackInfo.PlaySessionId ?? sessionId;
    const fallback = new URL(
      `Videos/${encodeURIComponent(item.id)}/master.m3u8`,
      `${connection.origin}/`,
    );
    fallback.search = new URLSearchParams({
      MediaSourceId: version.id,
      VideoCodec: "h264",
      AudioCodec: "aac",
      MaxStreamingBitrate: String(maxBitrate),
      VideoBitrate: String(Math.max(1, maxBitrate - 192_000)),
      AudioBitrate: "192000",
      MaxWidth: String(preset.maxWidth ?? 3840),
      MaxHeight: String(preset.maxHeight ?? 2160),
      SegmentContainer: "ts",
      MinSegments: "1",
      BreakOnNonKeyFrames: "true",
      PlaySessionId: playSessionId,
      StartTimeTicks: String(Math.max(0, request.startPositionMs ?? 0) * 10_000),
      api_key: token,
    }).toString();
    const relative = source?.TranscodingUrl;
    const selected = relative
      ? new URL(String(relative).replace(/^\//, ""), `${connection.origin}/`)
      : fallback;
    if (!selected.searchParams.has("api_key") && token) selected.searchParams.set("api_key", token);
    const url = selected.toString();
    return {
      url,
      protocol: "hls",
      direct: false,
      versionId: version.id,
      headers: playbackHeaders,
      subtitles,
      effectiveQuality: request.quality,
      playbackSessionId: playSessionId,
      decision: "transcode",
      transcodeReason: "quality-limit",
    };
  }
  async reportProgress(
    connection: MediaServerConnection,
    item: MediaServerItem,
    progress: MediaServerProgress,
  ) {
    await mediaServerRequest(connection.origin, "/Sessions/Playing/Progress", {
      method: "POST",
      headers: this.headers(connection),
      body: { ItemId: item.id, PositionTicks: progress.positionMs * 10_000, IsPaused: false },
    });
  }
  async stopPlayback(
    connection: MediaServerConnection,
    item: MediaServerItem,
    playbackSessionId: string,
    positionMs = 0,
  ) {
    await mediaServerRequest(connection.origin, "/Sessions/Playing/Stopped", {
      method: "POST",
      headers: this.headers(connection),
      body: {
        ItemId: item.id,
        MediaSourceId: item.versions[0]?.id,
        PlaySessionId: playbackSessionId,
        PositionTicks: positionMs * 10_000,
      },
    });
  }
  async setWatched(connection: MediaServerConnection, item: MediaServerItem, watched: boolean) {
    await mediaServerRequest(
      connection.origin,
      `/Users/${encodeURIComponent(connection.userId)}/PlayedItems/${encodeURIComponent(item.id)}`,
      { method: watched ? "POST" : "DELETE", headers: this.headers(connection) },
    );
  }
}
