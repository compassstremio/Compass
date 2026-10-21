import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchMediaListCollection, readCachedCollection } from "@/lib/anilist/lists";
import { deleteListEntry, saveListEntry } from "@/lib/anilist/mutations";
import { useAnilist } from "@/lib/anilist/provider";
import type { AnilistListGroup, AnilistMediaEntry, MediaListStatus } from "@/lib/anilist/types";
import { RAIL_ORDER } from "@/lib/use-anilist-anime-rails";
import { useT } from "@/lib/i18n";
import { AnilistEntryCard } from "./anilist-entry-card";
import { FilterBar, Grid, type TypeKey } from "./shared";

function entryName(e: AnilistMediaEntry): string {
  return e.media.title.userPreferred || e.media.title.english || e.media.title.romaji || "";
}

function entryType(e: AnilistMediaEntry): "movie" | "series" {
  return e.media.format === "MOVIE" ? "movie" : "series";
}

/** A title in a custom list also sits in its status list, so counts must not double it. */
function uniqueEntries(entries: AnilistMediaEntry[]): AnilistMediaEntry[] {
  const seen = new Set<number>();
  return entries.filter((entry) => (seen.has(entry.id) ? false : (seen.add(entry.id), true)));
}

export function AnilistTab() {
  const t = useT();
  const { session } = useAnilist();
  const userId = session?.userId;
  const [groups, setGroups] = useState<AnilistListGroup[]>(() =>
    userId != null ? readCachedCollection(userId) ?? [] : [],
  );
  const [status, setStatus] = useState<"loading" | "ready" | "error">(() =>
    userId != null && readCachedCollection(userId) != null ? "ready" : "loading",
  );
  const [type, setType] = useState<TypeKey>("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    if (userId == null) return;
    let cancelled = false;
    const cached = readCachedCollection(userId);
    if (cached) {
      setGroups(cached);
      setStatus("ready");
    } else {
      setStatus("loading");
    }
    fetchMediaListCollection(userId)
      .then((next) => {
        if (cancelled) return;
        setGroups(next);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled && readCachedCollection(userId) == null) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const setBusyFor = useCallback((id: number, on: boolean) => {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const applyLocal = useCallback((id: number, patch: Partial<AnilistMediaEntry>) => {
    setGroups((prev) =>
      prev.map((group) => ({
        ...group,
        entries: group.entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
      })),
    );
  }, []);

  const commitStatus = useCallback(
    async (entry: AnilistMediaEntry, next: MediaListStatus) => {
      setBusyFor(entry.id, true);
      const total = entry.media.episodes;
      const completing = next === "COMPLETED" && total != null;
      applyLocal(entry.id, { status: next, ...(completing ? { progress: total } : {}) });
      try {
        const saved = await saveListEntry({
          mediaId: entry.media.id,
          status: next,
          ...(completing ? { progress: total } : {}),
        });
        applyLocal(entry.id, { status: saved.status, progress: saved.progress });
      } catch {
        applyLocal(entry.id, { status: entry.status, progress: entry.progress });
      } finally {
        setBusyFor(entry.id, false);
      }
    },
    [applyLocal, setBusyFor],
  );

  const commitProgress = useCallback(
    async (entry: AnilistMediaEntry, next: number) => {
      setBusyFor(entry.id, true);
      applyLocal(entry.id, { progress: next });
      try {
        const saved = await saveListEntry({ mediaId: entry.media.id, progress: next });
        applyLocal(entry.id, { status: saved.status, progress: saved.progress });
      } catch {
        applyLocal(entry.id, { progress: entry.progress });
      } finally {
        setBusyFor(entry.id, false);
      }
    },
    [applyLocal, setBusyFor],
  );

  const commitPrivate = useCallback(
    async (entry: AnilistMediaEntry, next: boolean) => {
      setBusyFor(entry.id, true);
      applyLocal(entry.id, { private: next });
      try {
        await saveListEntry({ mediaId: entry.media.id, private: next });
      } catch {
        applyLocal(entry.id, { private: entry.private === true });
      } finally {
        setBusyFor(entry.id, false);
      }
    },
    [applyLocal, setBusyFor],
  );

  const commitRemove = useCallback(
    async (entry: AnilistMediaEntry) => {
      setBusyFor(entry.id, true);
      // Removing an entry clears it from every list it was in, so a failure restores all of them.
      const before = groups;
      setGroups((prev) =>
        prev.map((group) => ({
          ...group,
          entries: group.entries.filter((item) => item.id !== entry.id),
        })),
      );
      try {
        await deleteListEntry(entry.id);
      } catch {
        setGroups(before);
      } finally {
        setBusyFor(entry.id, false);
      }
    },
    [groups, setBusyFor],
  );

  const matches = useCallback(
    (entry: AnilistMediaEntry) => {
      if (type !== "all" && entryType(entry) !== type) return false;
      const q = query.trim().toLowerCase();
      return !q || entryName(entry).toLowerCase().includes(q);
    },
    [type, query],
  );

  const statusEntries = useMemo(
    () => groups.filter((group) => !group.isCustomList).flatMap((group) => group.entries),
    [groups],
  );

  const sections = useMemo(
    () =>
      RAIL_ORDER.map((section) => ({
        key: section.key,
        title: section.title,
        items: statusEntries
          .filter((entry) => section.statuses.includes(entry.status))
          .filter(matches),
      })).filter((section) => section.items.length > 0),
    [statusEntries, matches],
  );

  const customSections = useMemo(
    () =>
      groups
        .filter((group) => group.isCustomList && group.name)
        .map((group) => ({
          key: `custom:${group.name}`,
          name: group.name as string,
          items: group.entries.filter(matches),
        }))
        .filter((section) => section.items.length > 0),
    [groups, matches],
  );

  const counts = useMemo(() => {
    const visible = uniqueEntries([
      ...sections.flatMap((section) => section.items),
      ...customSections.flatMap((section) => section.items),
    ]);
    return {
      all: visible.length,
      movie: visible.filter((e) => entryType(e) === "movie").length,
      series: visible.filter((e) => entryType(e) === "series").length,
    };
  }, [sections, customSections]);

  const empty = useMemo(() => groups.every((group) => group.entries.length === 0), [groups]);

  if (status === "loading") {
    return <p className="text-[13px] text-ink-muted">{t("Loading your AniList…")}</p>;
  }
  if (status === "error") {
    return (
      <p className="rounded-lg bg-danger/15 px-3 py-2 text-[12px] text-danger ring-1 ring-danger/30">
        {t("Couldn't reach AniList. Try refreshing.")}
      </p>
    );
  }
  if (empty) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-edge-soft bg-canvas/30 px-8 py-16 text-center">
        <h2 className="text-[16px] font-semibold text-ink">{t("Your AniList is empty")}</h2>
        <p className="max-w-md text-[13px] leading-relaxed text-ink-muted">
          {t("Add anime to your AniList and they show up here, grouped by status and ready to edit.")}
        </p>
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-10">
      <FilterBar type={type} setType={setType} query={query} setQuery={setQuery} counts={counts} />
      {sections.map((section) => (
        <div key={section.key} className="flex flex-col gap-4">
          <div className="flex items-baseline gap-3">
            <h2 className="text-[18px] font-semibold text-ink">{t(section.title)}</h2>
            <span className="text-[12px] text-ink-muted">{section.items.length}</span>
          </div>
          <Grid>
            {section.items.map((entry) => (
              <AnilistEntryCard
                key={entry.id}
                entry={entry}
                busy={busy.has(entry.id)}
                onStatus={(s) => void commitStatus(entry, s)}
                onProgress={(p) => void commitProgress(entry, p)}
                onPrivate={(next) => void commitPrivate(entry, next)}
                onRemove={() => void commitRemove(entry)}
              />
            ))}
          </Grid>
        </div>
      ))}
      {customSections.map((section) => (
        <div key={section.key} className="flex flex-col gap-4">
          <div className="flex items-baseline gap-3">
            <h2 className="text-[18px] font-semibold text-ink">{section.name}</h2>
            <span className="text-[12px] text-ink-muted">{section.items.length}</span>
          </div>
          <Grid>
            {section.items.map((entry) => (
              <AnilistEntryCard
                key={entry.id}
                entry={entry}
                busy={busy.has(entry.id)}
                onStatus={(s) => void commitStatus(entry, s)}
                onProgress={(p) => void commitProgress(entry, p)}
                onPrivate={(next) => void commitPrivate(entry, next)}
                onRemove={() => void commitRemove(entry)}
              />
            ))}
          </Grid>
        </div>
      ))}
    </section>
  );
}
