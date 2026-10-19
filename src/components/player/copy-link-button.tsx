import { Check, Copy, Magnet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { parseMagnet, serializeMagnet } from "@/lib/torrent/magnet";
import { trackersFromSources } from "@/lib/torrent/stremio-stream";
import { copyText } from "@/lib/clipboard-text";
export { copyText } from "@/lib/clipboard-text";

export function resolveStreamLink(stream: {
  url?: string;
  externalUrl?: string;
  infoHash?: string;
  fileIdx?: number;
  sources?: string[];
  behaviorHints?: { filename?: string };
}): string | null {
  if (stream.url || stream.externalUrl) return stream.url || stream.externalUrl || null;
  const parsed = stream.infoHash ? parseMagnet(stream.infoHash) : null;
  if (parsed) {
    return serializeMagnet({
      infoHash: parsed.infoHash,
      name: stream.behaviorHints?.filename ?? null,
      trackers: trackersFromSources(stream.sources),
    });
  }
  return null;
}

export function CopyLinkButton({
  url,
  size = 13,
  className = "",
  label,
}: {
  url: string;
  size?: number;
  className?: string;
  label?: string;
}) {
  const t = useT();
  const isMagnetLink = url.startsWith("magnet:");
  const resolvedLabel = label ?? t(isMagnetLink ? "Copy magnet link" : "Copy link");
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  const Icon = isMagnetLink ? Magnet : Copy;

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    const ok = await copyText(url);
    if (!ok) return;
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <span
      role="button"
      tabIndex={0}
      title={copied ? t("Copied to clipboard") : resolvedLabel}
      aria-label={resolvedLabel}
      onClick={(e) => {
        e.stopPropagation();
        void copy();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          void copy();
        }
      }}
      className={`relative inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors duration-200 ${
        copied ? "bg-success/12 text-success" : "text-ink-subtle hover:bg-canvas/60 hover:text-ink"
      } ${className}`}
    >
      <Icon
        size={size}
        strokeWidth={2}
        className={`absolute transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
          copied ? "scale-50 opacity-0" : "scale-100 opacity-100"
        }`}
      />
      <Check
        size={size + 1}
        strokeWidth={2.6}
        className={`absolute transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
          copied ? "scale-100 opacity-100" : "scale-50 opacity-0"
        }`}
      />
    </span>
  );
}
