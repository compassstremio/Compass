import { safeFetch } from "@/lib/safe-fetch";

const BASE = "https://api.torbox.app/v1/api";
export type CloudKind = "torrents" | "usenet" | "webdl";
export type CloudFile = { id: number; name: string; size: number };
export type CloudItem = {
  kind: CloudKind;
  id: number;
  name: string;
  size: number;
  files: CloudFile[];
};

type RawFile = { id: number; name?: string; short_name?: string; size?: number };
type RawItem = {
  id: number;
  name?: string;
  size?: number;
  download_finished?: boolean;
  download_present?: boolean;
  files?: RawFile[];
};
type Envelope<T> = { success: boolean; detail?: string; data?: T };

async function request<T>(key: string, path: string, signal: AbortSignal): Promise<T> {
  const response = await safeFetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal,
  });
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "Invalid TorBox API key"
        : `TorBox request failed (${response.status})`,
    );
  const body = (await response.json()) as Envelope<T>;
  if (!body.success) throw new Error(body.detail || "TorBox request failed");
  return body.data as T;
}

export async function listTorboxCloud(key: string, signal: AbortSignal): Promise<CloudItem[]> {
  const kinds: CloudKind[] = ["torrents", "usenet", "webdl"];
  const results = await Promise.allSettled(
    kinds.map(async (kind) => {
      const items: CloudItem[] = [];
      for (let offset = 0; ; offset += 1000) {
        const page = await request<RawItem[]>(
          key,
          `/${kind}/mylist?offset=${offset}&limit=1000`,
          signal,
        );
        if (!Array.isArray(page)) break;
        items.push(
          ...page
            .filter((item) => item.download_finished || item.download_present)
            .map((item) => ({
              kind,
              id: item.id,
              name: item.name || `TorBox ${item.id}`,
              size: item.size || 0,
              files: (item.files || []).map((file) => ({
                id: file.id,
                name: file.name || file.short_name || `File ${file.id}`,
                size: file.size || 0,
              })),
            })),
        );
        if (page.length < 1000) break;
      }
      return items;
    }),
  );
  const fulfilled = results.filter(
    (result): result is PromiseFulfilledResult<CloudItem[]> => result.status === "fulfilled",
  );
  if (!fulfilled.length) throw (results[0] as PromiseRejectedResult).reason;
  return fulfilled.flatMap((result) => result.value);
}

export async function torboxCloudLink(
  key: string,
  item: CloudItem,
  file: CloudFile,
  signal: AbortSignal,
): Promise<string> {
  const idParam =
    item.kind === "torrents" ? "torrent_id" : item.kind === "usenet" ? "usenet_id" : "web_id";
  const params = new URLSearchParams({
    token: key,
    [idParam]: String(item.id),
    file_id: String(file.id),
    zip_link: "false",
  });
  const url = await request<string>(key, `/${item.kind}/requestdl?${params}`, signal);
  if (typeof url !== "string" || !/^https?:\/\//i.test(url))
    throw new Error("TorBox did not return a playable link");
  return url;
}
