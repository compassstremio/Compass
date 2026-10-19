import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  Download,
  Info,
  Layers,
  ListVideo,
  LoaderCircle,
  Play,
  RefreshCw,
  Server,
  Wand2,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Poster } from "@/components/poster";
import { VirtualGrid } from "@/components/virtual-grid";
import type { Meta } from "@/lib/cinemeta";
import {
  mediaServerConnections,
  mediaServerToken,
  subscribeMediaServerConnections,
} from "@/lib/media-server/connections";
import {
  mediaServerItems,
  mediaServerMetadata,
  putMediaServerMetadata,
  setManualMapping,
} from "@/lib/media-server/index-store";
import { dedupePhysicalEpisodeItems, groupMediaServerTitles } from "@/lib/media-server/selectors";
import {
  currentMediaServerSyncProgress,
  mediaServerAdapter,
  subscribeMediaServerSyncProgress,
  synchronizeMediaServer,
} from "@/lib/media-server/sync";
import type {
  MediaServerCollection,
  MediaServerConnection,
  MediaServerItem,
  MediaServerTitle,
} from "@/lib/media-server/types";
import { activeProfileId } from "@/lib/active-profile-id";
import { useSettings } from "@/lib/settings";
import { useT } from "@/lib/i18n";
import { useView } from "@/lib/view";
import { hydrateLibraryMeta } from "./hydrate-meta";
import { FilterBar, type TypeKey } from "./shared";
import { useReportFeatured } from "./featured-context";
import { IdentifyModal, type IdentifyResolution } from "./local-tab/identify-modal";
import { CardIconButton, LocalMoreActions } from "./local-tab/card-actions";
import { useContextTarget } from "@/lib/context-menu";
import { executeContextAction, type ContextAction } from "@/lib/context-actions";
import { alertDialog } from "@/lib/dialog";
import {
  assertServerContextConnection,
  resolveServerContextCopy,
} from "@/lib/media-server/context-copy";
import type { LocalEntry } from "@/lib/local-library";
import { openLocalEpisodes } from "@/lib/player/local-episodes-modal";
import { openLocalVersions } from "@/lib/player/local-versions-modal";
import { serverPlayableCopies } from "@/lib/media-server/selectors";
import { enqueueDownload } from "@/lib/download/downloads-store";
import { GenreMenu, SortMenu, type LocalSortKey, type SortDir } from "./local-tab/toolbar";
import { MediaServerBrand } from "@/components/media-server-brand";
import { readLibraryFilterPreferences, writeLibraryFilterPreferences } from "./filter-preferences";

type Card = { title: MediaServerTitle; meta: Meta };
const fallbackMeta = (title: MediaServerTitle): Meta => ({
  id: title.key,
  type: title.kind,
  name: title.fallbackTitle,
  releaseInfo: title.year ? String(title.year) : undefined,
});
const REVIEW_DISMISSED_KEY = "compass.media-server.review-dismissed.v2";
const reviewDismissedStorageKey = () => `${REVIEW_DISMISSED_KEY}.${activeProfileId()}`;

export function MediaServersTab({ scrollRef }: { scrollRef?: RefObject<HTMLElement | null> }) {
  const t = useT();
  const { settings } = useSettings();
  const { openMeta, openSettings } = useView();
  const initialProgress = currentMediaServerSyncProgress();
  const [items, setItems] = useState<MediaServerItem[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [revision, setRevision] = useState(0);
  const [syncing, setSyncing] = useState(initialProgress?.active ?? false);
  const [loading, setLoading] = useState(true);
  const [metadataLoading, setMetadataLoading] = useState(true);
  const [showLoading, setShowLoading] = useState(false);
  const metaCache = useRef(new Map<string, Meta>());
  const lastSyncReload = useRef(0);
  const lastGridType = useRef<TypeKey>("all");
  const [collections, setCollections] = useState<MediaServerCollection[] | null>(null);
  const [activeCollection, setActiveCollection] = useState<MediaServerCollection | null>(null);
  const [collectionIds, setCollectionIds] = useState<Set<string> | null>(null);
  const collectionIdsCache = useRef(new Map<string, Set<string>>());
  // Count-based dismissal (like the local library's review banner): a dismissal
  // silences exactly the titles seen so far, and a later sync that adds more
  // unmatched titles brings the banner back. Profile-scoped so one profile's
  // dismissal cannot hide another's.
  const [reviewDismissedCount, setReviewDismissedCount] = useState(() => {
    try {
      const stored = localStorage.getItem(reviewDismissedStorageKey());
      if (stored != null) return Number(stored) || 0;
      return localStorage.getItem("compass.media-server.review-dismissed.v1") === "1"
        ? Number.MAX_SAFE_INTEGER
        : 0;
    } catch {
      return 0;
    }
  });
  const unmatchedRef = useRef(0);
  const dismissReview = () => {
    setReviewDismissedCount(unmatchedRef.current);
    try {
      localStorage.setItem(reviewDismissedStorageKey(), String(unmatchedRef.current));
    } catch {
      /* ignore */
    }
  };
  const [syncMessage, setSyncMessage] = useState(initialProgress?.message ?? "");
  const [reviewing, setReviewing] = useState<MediaServerTitle | null>(null);
  const [syncCount, setSyncCount] = useState<{ processed?: number; total?: number }>({
    processed: initialProgress?.processed,
    total: initialProgress?.total,
  });
  const savedFilters = useMemo(() => readLibraryFilterPreferences("media-servers"), []);
  const [type, setType] = useState<TypeKey>(savedFilters.type ?? "all");
  const [query, setQuery] = useState("");
  const [server, setServer] = useState(savedFilters.server ?? "all");
  const [library, setLibrary] = useState(savedFilters.library ?? "all");
  const [selectedGenres, setSelectedGenres] = useState<Set<string>>(
    () => new Set(savedFilters.genres ?? []),
  );
  const [sort, setSort] = useState<LocalSortKey>(savedFilters.sort ?? "added");
  const [sortDir, setSortDir] = useState<SortDir>(savedFilters.sortDir ?? "desc");
  const connections = useMemo(() => mediaServerConnections(), [revision]);
  useEffect(() => {
    writeLibraryFilterPreferences("media-servers", {
      type,
      genres: [...selectedGenres],
      sort,
      sortDir,
      server,
      library,
    });
  }, [type, selectedGenres, sort, sortDir, server, library]);
  useEffect(() => {
    if (server !== "all" && !connections.some((connection) => connection.id === server))
      setServer("all");
  }, [connections, server]);
  const reload = useCallback(async () => {
    setItems(await mediaServerItems());
    setRevision((value) => value + 1);
    setLoading(false);
  }, []);
  useEffect(() => {
    void reload();
    return subscribeMediaServerConnections(() => {
      setRevision((value) => value + 1);
      void reload();
    });
  }, [reload]);
  useEffect(
    () =>
      subscribeMediaServerSyncProgress((progress) => {
        setSyncing(progress.active);
        setSyncMessage(progress.message);
        setSyncCount({ processed: progress.processed, total: progress.total });
        // Only read the store when the sync finishes. Re-reading mid-sync made
        // the grid and its posters re-render on every page (a visible flicker).
        if (!progress.active) {
          // Collection membership may have changed; drop the cached ids.
          collectionIdsCache.current.clear();
          void reload();
        } else {
          // Stream items in as they arrive, throttled, so a fresh connection is
          // not blank until the whole library is indexed.
          const now = Date.now();
          if (now - lastSyncReload.current >= 1500) {
            lastSyncReload.current = now;
            void reload();
          }
        }
      }),
    [reload],
  );
  const titles = useMemo(
    () =>
      groupMediaServerTitles(
        items.filter((item) =>
          connections.some(
            (connection) => connection.id === item.connectionId && connection.enabled,
          ),
        ),
      ),
    [items, connections],
  );
  const itemByKey = useMemo(
    () => new Map(items.map((item) => [`${item.connectionId}:${item.id}`, item])),
    [items],
  );
  const connectionById = useMemo(
    () => new Map(connections.map((connection) => [connection.id, connection])),
    [connections],
  );
  // The server's own poster is the first choice; TMDB artwork is the fallback.
  const serverPoster = useCallback(
    (title: MediaServerTitle): string | undefined => {
      if (!title.posterPath || !title.posterConnectionId) return undefined;
      const connection = connectionById.get(title.posterConnectionId);
      if (!connection) return undefined;
      let url: URL;
      try {
        url = new URL(title.posterPath.replace(/^\/+/, ""), `${connection.origin}/`);
      } catch {
        return undefined;
      }
      const token = mediaServerToken(connection);
      if (token) {
        if (connection.provider === "plex") url.searchParams.set("X-Plex-Token", token);
        else url.searchParams.set("api_key", token);
      }
      return url.toString();
    },
    [connectionById],
  );
  const collectionPoster = useCallback(
    (collection: MediaServerCollection): string | undefined => {
      if (!collection.posterPath) return undefined;
      const connection = connectionById.get(collection.connectionId);
      if (!connection) return undefined;
      let url: URL;
      try {
        url = new URL(collection.posterPath.replace(/^\/+/, ""), `${connection.origin}/`);
      } catch {
        return undefined;
      }
      const token = mediaServerToken(connection);
      if (token) {
        if (connection.provider === "plex") url.searchParams.set("X-Plex-Token", token);
        else url.searchParams.set("api_key", token);
      }
      return url.toString();
    },
    [connectionById],
  );
  const languageKey = `${settings.tmdbLanguage || "en"}:${(settings.tmdbImageLangs ?? []).join(",")}`;
  const metaKey = useCallback(
    (title: MediaServerTitle) => `${title.key}:locale:${languageKey}`,
    [languageKey],
  );
  // TMDB fallback hydration is a persistent, deduplicated pool so it can run
  // while a sync is still streaming items in. Driving it from the metadata
  // effect instead cancelled it on every 1.5s reload, so titles the server had
  // no poster for stayed blank until the whole sync finished.
  const metaPending = useRef(new Set<string>());
  const metaTried = useRef(new Set<string>());
  const metaQueue = useRef<MediaServerTitle[]>([]);
  const metaActive = useRef(0);
  const mountedRef = useRef(true);
  const hydrateDeps = useRef({ serverPoster, tmdbKey: settings.tmdbKey, metaKey });
  useEffect(() => {
    hydrateDeps.current = { serverPoster, tmdbKey: settings.tmdbKey, metaKey };
  });
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const pumpMeta = useCallback(() => {
    const MAX = 6;
    while (metaActive.current < MAX && metaQueue.current.length > 0) {
      const title = metaQueue.current.shift()!;
      const { serverPoster: posterFor, tmdbKey, metaKey: keyFor } = hydrateDeps.current;
      const key = keyFor(title);
      if (metaCache.current.has(key)) {
        metaPending.current.delete(key);
        continue;
      }
      metaActive.current += 1;
      void (async () => {
        try {
          const resolved = await hydrateLibraryMeta(title.key, title.kind, tmdbKey).catch(
            () => null,
          );
          if (resolved) {
            const poster = posterFor(title);
            const meta = poster ? { ...resolved, poster } : resolved;
            metaCache.current.set(key, meta);
            await putMediaServerMetadata(key, meta);
            if (mountedRef.current) {
              setCards((current) =>
                current.map((entry) =>
                  entry.title.key === title.key ? { ...entry, meta } : entry,
                ),
              );
            }
          }
        } finally {
          metaTried.current.add(key);
          metaPending.current.delete(key);
          metaActive.current -= 1;
          pumpMeta();
        }
      })();
    }
  }, []);
  const enqueueMeta = useCallback(
    (titles: MediaServerTitle[]) => {
      const { serverPoster: posterFor, metaKey: keyFor } = hydrateDeps.current;
      for (const title of titles) {
        if (posterFor(title)) continue;
        const key = keyFor(title);
        if (
          metaCache.current.has(key) ||
          metaPending.current.has(key) ||
          metaTried.current.has(key)
        )
          continue;
        metaPending.current.add(key);
        metaQueue.current.push(title);
      }
      pumpMeta();
    },
    [pumpMeta],
  );
  const connectionsKey = connections.map((connection) => connection.id).join(",");
  useEffect(() => {
    let alive = true;
    const capable = connections.filter(
      (connection) => connection.enabled && mediaServerAdapter(connection).collections,
    );
    void Promise.all(
      capable.map((connection) =>
        mediaServerAdapter(connection).collections!(connection).catch(
          () => [] as MediaServerCollection[],
        ),
      ),
    ).then((lists) => {
      if (alive) setCollections(lists.flat());
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionsKey]);
  useEffect(() => {
    if (!activeCollection) {
      setCollectionIds(null);
      return;
    }
    // Look the connection up at run time instead of depending on the memoized
    // map: the connection list refreshes when a sync finishes, which used to
    // re-run this effect, blank the member set, and empty the collection.
    const connection = mediaServerConnections().find(
      (entry) => entry.id === activeCollection.connectionId,
    );
    const adapter = connection ? mediaServerAdapter(connection) : null;
    if (!connection || !adapter?.collectionItemIds) {
      setCollectionIds(new Set());
      return;
    }
    let alive = true;
    const prefix = `${connection.id}:`;
    const cacheKey = `${connection.id}:${activeCollection.id}`;
    const cached = collectionIdsCache.current.get(cacheKey);
    if (cached) {
      setCollectionIds(cached);
      return;
    }
    setCollectionIds(null);
    void adapter
      .collectionItemIds(connection, activeCollection.id)
      .then((ids) => {
        const set = new Set(ids.map((id) => `${prefix}${id}`));
        collectionIdsCache.current.set(cacheKey, set);
        if (alive) setCollectionIds(set);
      })
      .catch(() => {
        if (alive) setCollectionIds(new Set());
      });
    return () => {
      alive = false;
    };
  }, [activeCollection]);
  useEffect(() => {
    if (type === "collections") return;
    // Remember the last real filter so the grid can stay mounted (and keep its
    // posters) while the Collections list is on screen.
    lastGridType.current = type;
    setActiveCollection(null);
  }, [type]);
  useEffect(() => {
    if (loading || library === "all") return;
    if (!items.some((item) => item.libraryId === library)) setLibrary("all");
  }, [items, library, loading]);
  useEffect(() => {
    if (loading) return;
    let alive = true;
    if (syncing) {
      // Stream items into the grid without resetting it: keep the cards we
      // already have (and their posters) and only append new titles, so a fresh
      // connection fills in without the grid flickering. Merge against the
      // latest state and the metadata cache so a poster that just hydrated is
      // not overwritten, and refresh the server poster in case a title first
      // arrived before its series item did.
      const titleByKey = new Map(titles.map((title) => [title.key, title]));
      setCards((current) => {
        const seen = new Set<string>();
        // Update existing cards in place so they keep their position (and their
        // already-loaded posters), then append genuinely new titles at the end.
        const next = current.map((card) => {
          const title = titleByKey.get(card.title.key);
          if (!title) return card;
          seen.add(card.title.key);
          const base = metaCache.current.get(metaKey(title)) ?? card.meta;
          const poster = serverPoster(title);
          return { title, meta: poster && poster !== base.poster ? { ...base, poster } : base };
        });
        for (const title of titles) {
          if (seen.has(title.key)) continue;
          const base = metaCache.current.get(metaKey(title)) ?? fallbackMeta(title);
          const poster = serverPoster(title);
          next.push({ title, meta: poster && poster !== base.poster ? { ...base, poster } : base });
        }
        return next;
      });
      // Fall back to TMDB for anything the server has no poster for, even while
      // the sync is still running.
      enqueueMeta(titles);
      return;
    }
    setMetadataLoading(true);
    // Paint the grid immediately from cached metadata (session cache first,
    // then the index store) or the filename fallback. A large library must not
    // sit blank while every title's metadata is fetched one by one.
    void (async () => {
      const initial = await Promise.all(
        titles.map(async (title) => {
          const key = metaKey(title);
          let meta = metaCache.current.get(key);
          if (!meta) {
            const cached = await mediaServerMetadata<Meta>(key);
            if (cached) {
              meta = cached;
              metaCache.current.set(key, cached);
            }
          }
          const base = meta ?? fallbackMeta(title);
          const poster = serverPoster(title);
          return { title, meta: poster ? { ...base, poster } : base };
        }),
      );
      if (!alive) return;
      setCards(initial);
      setMetadataLoading(false);
      // Fill in the posters for titles that had nothing cached, updating each
      // card as it lands. The shared pool keeps TMDB traffic sane.
      enqueueMeta(titles);
    })();
    return () => {
      alive = false;
    };
  }, [loading, titles, syncing, serverPoster, enqueueMeta, metaKey]);
  useEffect(() => {
    if (!loading && !metadataLoading && !syncing) {
      setShowLoading(false);
      return;
    }
    setShowLoading(false);
    const timer = window.setTimeout(() => setShowLoading(true), 250);
    return () => window.clearTimeout(timer);
  }, [loading, metadataLoading, syncing]);
  useReportFeatured(useMemo(() => cards.map((card) => card.meta), [cards]));
  const counts = useMemo(
    () => ({
      all: titles.length,
      movie: titles.filter((title) => title.kind === "movie").length,
      series: titles.filter((title) => title.kind === "series").length,
    }),
    [titles],
  );
  const genres = useMemo(
    () =>
      [...new Set(cards.flatMap((card) => card.meta.genres ?? []))].sort().map((name) => ({
        name,
        count: cards.filter((card) => card.meta.genres?.includes(name)).length,
      })),
    [cards],
  );
  const gridType: TypeKey = type === "collections" ? lastGridType.current : type;
  const visible = useMemo(() => {
    if (type === "collections" && activeCollection && collectionIds) {
      return cards.filter((card) => card.title.itemKeys.some((key) => collectionIds.has(key)));
    }
    const mul = sortDir === "asc" ? 1 : -1;
    const filtered = cards.filter(
      (card) =>
        (gridType === "all" || card.title.kind === gridType) &&
        (server === "all" || card.title.connectionIds.includes(server)) &&
        (library === "all" || card.title.libraryIds.includes(library)) &&
        [...selectedGenres].every((name) => card.meta.genres?.includes(name)) &&
        (!query.trim() || card.meta.name.toLowerCase().includes(query.trim().toLowerCase())),
    );
    // While a sync streams items in, keep their arrival order. Re-sorting on
    // every reload shuffles cards between virtual rows, which remounts them and
    // aborts in-flight poster loads, so the grid looked blank until the sync
    // finished. The chosen sort is applied once the sync ends.
    if (syncing) return filtered;
    return filtered.sort((a, b) => {
      if (sort === "title") return mul * a.meta.name.localeCompare(b.meta.name);
      const value = (entry: Card) =>
        sort === "year"
          ? Number(entry.meta.releaseInfo?.slice(0, 4) ?? 0)
          : sort === "rating"
            ? Number(entry.meta.imdbRating ?? 0)
            : sort === "runtime"
              ? Number(entry.meta.runtime?.match(/\d+/)?.[0] ?? 0)
              : (entry.title.addedAt ?? 0);
      return mul * (value(a) - value(b));
    });
  }, [
    cards,
    gridType,
    type,
    server,
    library,
    selectedGenres,
    query,
    sort,
    sortDir,
    syncing,
    activeCollection,
    collectionIds,
  ]);
  const unmatched = titles.filter(
    (title) => !title.identity.tmdbId && !title.identity.imdbId && !title.identity.tvdbId,
  );
  useEffect(() => {
    unmatchedRef.current = unmatched.length;
  }, [unmatched]);
  const syncAll = async () => {
    setSyncing(true);
    setSyncMessage(t("Connecting to home servers…"));
    try {
      for (const connection of connections.filter((entry) => entry.enabled))
        await synchronizeMediaServer(connection, setSyncMessage);
      await reload();
    } finally {
      setSyncing(false);
      setSyncMessage("");
    }
  };
  const resolveReview = async (title: MediaServerTitle, resolution: IdentifyResolution) => {
    const targets = items.filter((item) =>
      title.itemKeys.includes(`${item.connectionId}:${item.id}`),
    );
    await Promise.all(
      targets.map((item) =>
        setManualMapping(item.connectionId, item.id, {
          tmdbId: resolution.tmdbId,
          imdbId: resolution.imdbId ?? undefined,
          ...(item.kind === "episode"
            ? { season: item.identity.season, episode: item.identity.episode }
            : {}),
        }),
      ),
    );
    await reload();
  };
  const localTarget = reviewing
    ? ([
        {
          id: reviewing.key,
          path: "",
          filename: reviewing.fallbackTitle,
          title: reviewing.fallbackTitle,
          year: reviewing.year ?? null,
          type: reviewing.kind === "series" ? ("show" as const) : ("movie" as const),
          addedAt: reviewing.addedAt ?? Date.now(),
        },
      ] satisfies LocalEntry[])
    : null;
  const renderCard = useCallback(
    (card: Card) => {
      const physical = card.title.itemKeys.flatMap((key) => {
        const item = itemByKey.get(key);
        return item ? [item] : [];
      });
      const cardConnections = card.title.connectionIds.flatMap((id) => {
        const connection = connectionById.get(id);
        return connection ? [connection] : [];
      });
      return (
        <ServerCard
          card={card}
          physical={physical}
          connections={connections}
          cardConnections={cardConnections}
          onOpen={() => openMeta(card.meta)}
          onReview={() => setReviewing(card.title)}
        />
      );
    },
    [connectionById, connections, itemByKey, openMeta],
  );
  if (connections.length === 0)
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-edge-soft bg-canvas/30 px-8 py-16 text-center">
        <Server size={32} className="text-ink-subtle" />
        <div>
          <h2 className="text-[18px] font-semibold text-ink">
            {t("You haven’t connected a media server")}
          </h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            {t("Connect Jellyfin, Emby, or Plex in Streaming sources.")}
          </p>
        </div>
        <button
          className="rounded-md bg-ink px-4 py-2 text-[12.5px] font-semibold text-canvas"
          onClick={() => {
            sessionStorage.setItem("compass.settings.streaming.home-servers", "1");
            openSettings("streaming");
          }}
        >
          {t("Connect now")}
        </button>
      </div>
    );
  return (
    <section className="flex flex-col gap-4">
      <FilterBar
        type={type}
        setType={setType}
        query={query}
        setQuery={setQuery}
        counts={counts}
        collections={collections?.length ?? 0}
        trailing={
          <div className="ms-auto flex flex-wrap gap-2">
            <FilterSelect
              value={server}
              onChange={setServer}
              options={[
                { value: "all", label: t("All servers") },
                ...connections.map((connection) => ({
                  value: connection.id,
                  label: connection.name,
                })),
              ]}
            />
            <FilterSelect
              value={library}
              onChange={setLibrary}
              options={[
                { value: "all", label: t("All libraries") },
                ...Array.from(
                  new Map(
                    items.map((item) => [item.libraryId, item.libraryName || item.libraryId]),
                  ).entries(),
                ).map(([id, name]) => ({ value: id, label: name })),
              ]}
            />
            <GenreMenu
              options={genres}
              selected={selectedGenres}
              onToggle={(name) =>
                setSelectedGenres((current) => {
                  const next = new Set(current);
                  if (next.has(name)) next.delete(name);
                  else next.add(name);
                  return next;
                })
              }
              onClear={() => setSelectedGenres(new Set())}
            />
            <SortMenu
              sortKey={sort}
              setSortKey={setSort}
              sortDir={sortDir}
              setSortDir={setSortDir}
            />
            {showLoading && (loading || metadataLoading || syncing) ? (
              <div
                className="flex h-9 items-center gap-2 rounded-full bg-raised px-3.5 text-[12px] font-medium tabular-nums text-ink-muted"
                title={syncMessage || t("Loading your media server library…")}
              >
                <LoaderCircle size={13} className="animate-spin" />
                {syncCount.processed != null && syncCount.total != null
                  ? `${syncCount.processed} / ${syncCount.total}`
                  : t("Loading…")}
              </div>
            ) : (
              <button
                title={t("Refresh")}
                onClick={() => void syncAll()}
                className="grid h-9 w-9 place-items-center rounded-full bg-raised text-ink-muted"
              >
                <RefreshCw size={14} />
              </button>
            )}
          </div>
        }
      />
      {unmatched.length > 0 && unmatched.length > reviewDismissedCount && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-500/12 px-3.5 py-2.5 ring-1 ring-amber-500/30">
          <button
            type="button"
            onClick={() => setReviewing(unmatched[0])}
            className="flex flex-1 items-center gap-2 text-start"
          >
            <AlertTriangle size={15} className="text-amber-500" />
            <span className="text-[12.5px] text-ink">
              {t("{n} titles need review — help us identify them.", { n: unmatched.length })}
            </span>
            <span className="ms-auto rounded-full bg-amber-500 px-3 py-1 text-[11px] font-semibold text-black">
              {t("Review")}
            </span>
          </button>
          <button
            type="button"
            aria-label={t("Dismiss")}
            title={t("Dismiss")}
            onClick={dismissReview}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-amber-500/80 transition-colors hover:text-amber-400"
          >
            <X size={15} />
          </button>
        </div>
      )}
      {type === "collections" &&
        !activeCollection &&
        (collections && collections.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-8">
            {collections.map((collection) => {
              const poster = collectionPoster(collection);
              const connection = connectionById.get(collection.connectionId);
              return (
                <button
                  key={`${collection.connectionId}:${collection.id}`}
                  type="button"
                  onClick={() => setActiveCollection(collection)}
                  className="group flex flex-col gap-2 text-start"
                >
                  <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-raised ring-1 ring-edge-soft">
                    {poster ? (
                      <img
                        src={poster}
                        alt={collection.name}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-ink-subtle">
                        <Layers size={22} />
                      </div>
                    )}
                  </div>
                  <span className="truncate text-[13px] font-semibold text-ink">
                    {collection.name}
                  </span>
                  <span className="truncate text-[11px] text-ink-subtle">
                    {connection?.name}
                    {collection.childCount != null ? ` · ${collection.childCount}` : ""}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-edge-soft px-6 py-10 text-center text-[13px] text-ink-muted">
            {t("No collections on these servers.")}
          </div>
        ))}
      {/* Keep the title grid mounted (only hidden) while the Collections list is
          on screen, so switching back does not tear its posters down and refetch
          them. */}
      <div
        className={type === "collections" && !activeCollection ? "hidden" : "flex flex-col gap-4"}
      >
        {type === "collections" && activeCollection && (
          <button
            type="button"
            onClick={() => setActiveCollection(null)}
            className="flex items-center gap-1.5 self-start text-[13px] font-semibold text-ink-muted hover:text-ink"
          >
            <ChevronLeft size={16} />
            {activeCollection.name}
          </button>
        )}
        {type === "collections" && activeCollection && collectionIds == null ? (
          <div className="grid place-items-center py-10 text-ink-subtle">
            <LoaderCircle size={18} className="animate-spin" />
          </div>
        ) : !loading && !metadataLoading && !syncing && visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-edge-soft px-6 py-10 text-center text-[13px] text-ink-muted">
            {t("No matches for these filters.")}
          </div>
        ) : (
          visible.length > 0 &&
          (scrollRef ? (
            <VirtualGrid
              items={visible}
              scrollRef={scrollRef}
              minColumnWidth={Math.round(150 * settings.posterScale)}
              gapX={16}
              gapY={32}
              overscan={6}
              paused={type === "collections" && !activeCollection}
              estimateRowHeight={Math.round(150 * settings.posterScale * 1.5) + 46}
              getKey={(card) => card.title.key}
              renderItem={renderCard}
            />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-8">
              {visible.map((card) => (
                <div key={card.title.key}>{renderCard(card)}</div>
              ))}
            </div>
          ))
        )}
      </div>
      <IdentifyModal
        target={localTarget}
        onClose={() => setReviewing(null)}
        onResolved={(_, resolution) => reviewing && void resolveReview(reviewing, resolution)}
      />
    </section>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const selected = options.find((option) => option.value === value) ?? options[0];
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex h-9 items-center gap-1.5 rounded-full bg-raised px-3.5 text-[12.5px] font-semibold text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
      >
        {selected?.label}
        <ChevronDown size={13} className={open ? "rotate-180" : ""} />
      </button>
      {open && (
        <div className="absolute end-0 top-[calc(100%+6px)] z-50 min-w-44 rounded-xl border border-edge bg-elevated p-1 shadow-[0_18px_50px_-15px_rgba(0,0,0,0.7)]">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={`flex h-9 w-full items-center justify-between gap-3 rounded-lg px-3 text-start text-[13px] ${option.value === value ? "bg-raised text-ink" : "text-ink-muted hover:bg-raised/60 hover:text-ink"}`}
            >
              <span className="truncate">{option.label}</span>
              {option.value === value && <Check size={14} className="text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const ServerCard = memo(function ServerCard({
  card,
  physical,
  connections,
  cardConnections,
  onOpen,
  onReview,
}: {
  card: Card;
  physical: MediaServerItem[];
  connections: MediaServerConnection[];
  cardConnections: MediaServerConnection[];
  onOpen: () => void;
  onReview: () => void;
}) {
  const { openPlayer, openSettings } = useView();
  const t = useT();
  const matched =
    card.title.identity.tmdbId != null ||
    !!card.title.identity.imdbId ||
    card.title.identity.tvdbId != null;
  const currentCopy = async (item: MediaServerItem, versionId?: string) => {
    const expected = connections.find((connection) => connection.id === item.connectionId);
    if (!expected) throw new Error(t("This server connection is no longer available."));
    return resolveServerContextCopy(expected, item.id, versionId);
  };
  const playCopy = async (selected: MediaServerItem, versionId?: string) => {
    const { connection, item } = await currentCopy(selected, versionId);
    const quality = connection.preferredQuality;
    await mediaServerAdapter(connection)
      .playback(connection, item, {
        versionId,
        quality,
        startPositionMs: item.progress?.positionMs,
      })
      .then((source) => {
        assertServerContextConnection(connection);
        openPlayer({
          meta: card.meta,
          imdbId: card.title.identity.imdbId,
          episode:
            item.kind === "episode"
              ? { season: item.identity.season ?? 0, episode: item.identity.episode ?? 0 }
              : undefined,
          url: source.url,
          headers: source.headers,
          subtitles: source.subtitles?.map((track) => ({
            id: track.id,
            url: track.url,
            lang: track.language,
            trustedSource: true,
          })),
          title: card.meta.name,
          subtitle: `${connection.name} · ${source.direct ? "Direct play" : "Transcode"}`,
          notWebReady: true,
          resume: (item.progress?.positionMs ?? 0) > 0,
          homeServer: {
            connectionId: connection.id,
            itemId: item.id,
            versionId: source.versionId,
            quality: source.effectiveQuality,
            playbackSessionId: source.playbackSessionId,
          },
        });
      });
  };
  const playItems = (
    playableItems: MediaServerItem[],
    direct = false,
    intent: "play" | "download" = "play",
  ) => {
    const copies = serverPlayableCopies(playableItems, mediaServerConnections());
    const selectedItem = (copy: (typeof copies)[number]) =>
      playableItems.find(
        (item) => item.connectionId === copy.connectionId && item.id === copy.itemId,
      );
    if (direct && copies.length === 1) {
      const item = selectedItem(copies[0]);
      if (item)
        void playCopy(item, copies[0].version.id).catch((error) =>
          alertDialog(error instanceof Error ? error.message : String(error)),
        );
      return;
    }
    openLocalVersions({
      intent,
      title: card.meta.name,
      poster: card.meta.poster,
      entries: [],
      onPlayLocal: () => {},
      serverCopies: copies,
      onPlayServer: async (copy) => {
        const item = selectedItem(copy);
        if (!item) throw new Error(t("This server item is no longer available."));
        await playCopy(item, copy.version.id);
      },
      onDownloadServer: async (copy) => {
        const item = selectedItem(copy);
        if (!item) throw new Error(t("This server item is no longer available."));
        await downloadItem(item, undefined, copy.version.id);
      },
    });
  };
  const downloadItem = async (
    selected: MediaServerItem,
    episode?: LocalEntry,
    versionId?: string,
  ) => {
    const { connection, item } = await currentCopy(selected, versionId);
    const source = await mediaServerAdapter(connection).playback(connection, item, {
      versionId,
      quality: "original",
    });
    assertServerContextConnection(connection);
    await enqueueDownload({
      meta: card.meta,
      episode:
        (episode?.season ?? item.identity.season) != null &&
        (episode?.episode ?? item.identity.episode) != null
          ? {
              season: (episode?.season ?? item.identity.season)!,
              episode: (episode?.episode ?? item.identity.episode)!,
            }
          : undefined,
      url: source.url,
      headers: source.headers,
      streamLabel: connection.name,
    });
  };
  const activate = (intent: "play" | "download" = "play") => {
    if (!matched) return onReview();
    if (card.title.kind === "series") {
      const episodes = dedupePhysicalEpisodeItems(
        physical.filter(
          (item) =>
            item.kind === "episode" &&
            item.identity.season != null &&
            item.identity.episode != null,
        ),
      );
      const synthetic = episodes.map((item): LocalEntry => {
        const version = item.versions[0];
        return {
          id: `${item.connectionId}:${item.id}`,
          path: "",
          filename: version?.filename ?? version?.name ?? item.title,
          title: card.meta.name,
          year: card.title.year ?? null,
          type: "show",
          resolution: version?.resolution,
          size: version?.sizeBytes,
          tmdbId: card.title.identity.tmdbId ?? null,
          imdbId: card.title.identity.imdbId ?? null,
          season: version?.season ?? item.identity.season ?? null,
          episode: version?.episode ?? item.identity.episode ?? null,
          episodeEnd:
            version?.episodeEnd ?? item.identity.episodeEnd ?? item.identity.episode ?? null,
          addedAt: item.addedAt ?? Date.now(),
        };
      });
      const entrySources = Object.fromEntries(
        episodes.map((item) => {
          const connection = connections.find((candidate) => candidate.id === item.connectionId);
          return [
            `${item.connectionId}:${item.id}`,
            {
              kind: "home-server" as const,
              label: connection?.name ?? t("Home server"),
              provider: connection?.provider ?? "jellyfin",
            },
          ];
        }),
      );
      openLocalEpisodes({
        title: card.meta.name,
        tmdbId: card.title.identity.tmdbId ?? null,
        imdbId: card.title.identity.imdbId ?? null,
        poster: card.meta.poster,
        videos: card.meta.videos,
        entries: synthetic,
        entrySources,
        sourceLabel: t("{n} episodes on home servers", { n: episodes.length }),
        onPlayLocal: (entry) => {
          const item = episodes.find(
            (candidate) => `${candidate.connectionId}:${candidate.id}` === entry.id,
          );
          if (!item) throw new Error(t("This server episode is no longer available."));
          playItems(
            physical.filter(
              (candidate) =>
                candidate.kind === "episode" &&
                candidate.identity.season === item.identity.season &&
                candidate.identity.episode === item.identity.episode,
            ),
            false,
            intent,
          );
        },
        onDownload: async (entry) => {
          const item = episodes.find(
            (candidate) => `${candidate.connectionId}:${candidate.id}` === entry.id,
          );
          if (!item) throw new Error(t("This server episode is no longer available."));
          playItems(
            physical.filter(
              (candidate) =>
                candidate.kind === "episode" &&
                candidate.identity.season === item.identity.season &&
                candidate.identity.episode === item.identity.episode,
            ),
            false,
            "download",
          );
        },
      });
    } else {
      const movies = physical.filter((item) => item.kind === "movie");
      if (movies.length > 0) playItems(movies, false, intent);
    }
  };
  const download = () => activate("download");
  const contextId = `home-server-title:${card.title.key}`;
  const source = {
    kind: "actions" as const,
    id: contextId,
    label: card.meta.name,
    subscribe: subscribeMediaServerConnections,
    isValid: () =>
      card.title.connectionIds.some((id) =>
        mediaServerConnections().some((connection) => connection.id === id),
      ),
    actions: (): ContextAction[] => [
      {
        id: `${contextId}:open`,
        label: card.title.kind === "series" ? t("Choose episode") : t("Choose version"),
        icon: <Play size={14} />,
        restoreFocus: false,
        run: activate,
      },
      {
        id: `${contextId}:details`,
        label: t("View details"),
        icon: <Info size={14} />,
        restoreFocus: false,
        run: onOpen,
      },
      {
        id: `${contextId}:match`,
        label: t("Fix match"),
        icon: <Wand2 size={14} />,
        restoreFocus: false,
        run: onReview,
      },
      {
        id: `${contextId}:download`,
        label: t("Choose version to download"),
        icon: <Download size={14} />,
        restoreFocus: false,
        run: download,
      },
      {
        id: `${contextId}:manage`,
        label: t("Manage home servers"),
        icon: <Server size={14} />,
        restoreFocus: false,
        run: () => {
          sessionStorage.setItem("compass.settings.streaming.home-servers", "1");
          openSettings("streaming");
        },
      },
    ],
  };
  const contextRef = useContextTarget(() => source);
  const runOpen = () => {
    void executeContextAction(source, `${contextId}:open`).catch((error) =>
      alertDialog(error instanceof Error ? error.message : String(error)),
    );
  };
  return (
    <article ref={contextRef} className="group flex flex-col gap-2 text-start">
      <div
        role="button"
        tabIndex={0}
        onClick={runOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            runOpen();
          }
        }}
        className="relative aspect-[2/3] overflow-hidden rounded-xl bg-elevated text-start outline-none focus-visible:ring-2 focus-visible:ring-ink"
      >
        <Poster
          src={card.meta.poster}
          seed={card.title.key}
          lazy
          className="h-full w-full transition-transform group-hover:scale-[1.02]"
        />
        <span className="absolute start-2 top-2 max-w-[70%] rounded-md bg-canvas/85 px-2 py-0.5 text-[10px] font-semibold text-ink">
          {cardConnections[0] && (
            <MediaServerBrand
              provider={cardConnections[0].provider}
              name={
                card.title.connectionIds.length > 1
                  ? `${cardConnections[0].name} +${card.title.connectionIds.length - 1}`
                  : cardConnections[0].name
              }
            />
          )}
        </span>
        <button
          type="button"
          aria-label={t("Play")}
          onClick={(event) => {
            event.stopPropagation();
            runOpen();
          }}
          className="absolute start-1/2 top-1/2 grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-ink text-canvas opacity-0 shadow-xl transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Play size={18} fill="currentColor" />
        </button>
        <span className="absolute bottom-2 end-2 inline-flex items-center gap-1 rounded-md bg-canvas/85 px-2 py-0.5 text-[10px] text-ink">
          {card.title.kind === "series" ? <ListVideo size={10} /> : <Layers size={10} />}{" "}
          {card.title.kind === "series" ? card.title.episodeCount : card.title.versionCount}
        </span>
        <div className="absolute end-2 top-2 flex flex-col gap-1.5">
          <CardIconButton title={t("Open details")} onClick={onOpen}>
            <Info size={11} />
          </CardIconButton>
          <CardIconButton title={t("Fix match")} onClick={onReview}>
            <Wand2 size={11} />
          </CardIconButton>
          <CardIconButton title={t("Choose version to download")} onClick={download}>
            <Download size={11} />
          </CardIconButton>
        </div>
      </div>
      <div className="flex items-start gap-1">
        <button onClick={runOpen} className="min-w-0 flex-1 text-start">
          <p className="truncate text-[13px] font-medium text-ink">{card.meta.name}</p>
          <p className="truncate text-[11.5px] text-ink-subtle">
            {card.meta.releaseInfo ?? ""}
            {card.title.kind === "series"
              ? ` · ${card.title.episodeCount} episodes`
              : card.title.versionCount > 1
                ? ` · ${card.title.versionCount} versions`
                : ""}
          </p>
        </button>
        <LocalMoreActions target={source} />
      </div>
    </article>
  );
});
