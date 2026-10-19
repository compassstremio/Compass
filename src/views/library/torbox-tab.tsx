import { isPlayableVideoPath } from "@/lib/media-file";
import { ChevronLeft, Folder, LoaderCircle, Play, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import torboxLogo from "@/assets/addon-logos/torbox.png";
import {
  listTorboxCloud,
  torboxCloudLink,
  type CloudFile,
  type CloudItem,
} from "@/lib/debrid/torbox-cloud";
import { useSettings } from "@/lib/settings";
import { useView } from "@/lib/view";

const formatSize = (bytes: number) => (bytes ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : "");

export function TorboxTab() {
  const { settings } = useSettings();
  const { openPlayer, openSettings } = useView();
  const [items, setItems] = useState<CloudItem[]>([]);
  const [selected, setSelected] = useState<CloudItem | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const key = settings.tbKey?.trim() || "";
  const playRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    setItems([]);
    setSelected(null);
    setQuery("");
    setError("");
    setPlaying(null);
    if (!key) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void listTorboxCloud(key, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setItems(result);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Could not load TorBox cloud");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      playRequest.current?.abort();
      playRequest.current = null;
    };
  }, [key, revision]);

  const files = useMemo(
    () => selected?.files.filter((file) => isPlayableVideoPath(file.name)) || [],
    [selected],
  );
  const visible = useMemo(
    () =>
      (selected ? files : items).filter((entry) =>
        entry.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [selected, files, items, query],
  );
  const play = async (item: CloudItem, file: CloudFile) => {
    const id = `${item.kind}:${item.id}:${file.id}`;
    playRequest.current?.abort();
    const controller = new AbortController();
    playRequest.current = controller;
    setPlaying(id);
    setError("");
    try {
      const url = await torboxCloudLink(key, item, file, controller.signal);
      if (controller.signal.aborted) return;
      openPlayer({
        meta: { id: `torbox:${id}`, type: "movie", name: file.name },
        url,
        title: file.name,
        subtitle: `TorBox · ${item.name}`,
        notWebReady: true,
        resume: true,
        suppressCloudSync: true,
      });
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Could not play this file");
    } finally {
      if (playRequest.current === controller) {
        playRequest.current = null;
        setPlaying(null);
      }
    }
  };

  if (!key)
    return (
      <div className="rounded-2xl bg-elevated/40 p-8 text-ink-muted">
        <p>
          Add your TorBox API key in Streaming Sources to browse and play your cloud files here.
        </p>
        <button
          type="button"
          onClick={() => openSettings("streaming")}
          className="mt-4 rounded-full bg-ink px-5 py-2 text-canvas"
        >
          Connect TorBox
        </button>
      </div>
    );

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        {selected && (
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setQuery("");
            }}
            className="rounded-full bg-elevated px-3 py-2 text-ink"
          >
            <ChevronLeft size={18} />
          </button>
        )}
        <img src={torboxLogo} alt="" className="h-8 w-8 rounded-lg object-contain" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-semibold text-ink">
            {selected?.name || "TorBox cloud"}
          </h2>
          <p className="text-sm text-ink-muted">
            {selected ? `${files.length} playable files` : `${items.length} completed downloads`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRevision((value) => value + 1)}
          disabled={loading}
          title="Refresh TorBox cloud"
          className="rounded-full bg-elevated p-2.5 text-ink"
        >
          <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={selected ? "Search files" : "Search cloud downloads"}
        className="w-full rounded-full bg-elevated/60 px-5 py-3 text-ink outline-none placeholder:text-ink-subtle"
      />
      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 p-4 text-red-300">
          {error}
        </p>
      )}
      {loading && (
        <div className="flex items-center gap-2 text-ink-muted">
          <LoaderCircle size={18} className="animate-spin" />
          Loading TorBox cloud…
        </div>
      )}
      {!loading && !visible.length && (
        <p className="py-10 text-center text-ink-muted">
          {selected ? "No playable video files in this download." : "No completed downloads found."}
        </p>
      )}
      <div className="flex flex-col gap-2">
        {visible.map((entry) => {
          const item = selected || (entry as CloudItem);
          const file = selected ? (entry as CloudFile) : null;
          const playable = selected
            ? []
            : item.files.filter((candidate) => isPlayableVideoPath(candidate.name));
          const target = file ?? (playable.length === 1 ? playable[0] : null);
          return (
            <button
              key={selected ? file!.id : `${item.kind}:${item.id}`}
              type="button"
              onClick={() => (target ? void play(item, target) : (setSelected(item), setQuery("")))}
              className="flex items-center gap-4 rounded-xl bg-elevated/40 px-4 py-3 text-left text-ink transition-colors hover:bg-elevated"
            >
              {playing === `${item.kind}:${item.id}:${target?.id}` ? (
                <LoaderCircle size={20} className="shrink-0 animate-spin" />
              ) : target ? (
                <Play size={20} className="shrink-0" />
              ) : (
                <Folder size={20} className="shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              <span className="shrink-0 text-xs text-ink-muted">
                {file ? formatSize(file.size) : `${item.kind} · ${playable.length} videos`}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
