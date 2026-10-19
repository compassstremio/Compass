type LiveSrc = {
  meta: { id?: string; type?: string; addonOrigin?: { id?: string; name?: string } };
  streamRef?: { addonId?: string | null };
  isLive?: boolean;
};

export function isLivePlaybackSrc(src: LiveSrc): boolean {
  if (src.isLive === true) return true;
  if (src.meta.id?.startsWith("iptv:") === true) return true;
  if (src.isLive === false) return false;
  // Easynews catalogs can use a generic TV type for indexed video files.
  const origin = src.meta.addonOrigin;
  if (
    [origin?.id, origin?.name, src.streamRef?.addonId, src.meta.id].some((value) =>
      /easynews/i.test(value ?? ""),
    )
  )
    return false;
  const type = src.meta.type ? String(src.meta.type).toLowerCase() : "";
  return type === "tv" || type === "channel";
}
