import { useEffect, useRef, useState, type RefObject } from "react";
import { claimTrailerVideo, releaseTrailerVideo, trailerVideoHeldBy } from "@/lib/trailer-video";

const SRC_DELAY_MS = 120;

export function useTrailerVideo(opts: {
  src: string | null;
  active: boolean;
  playing: boolean;
  muted: boolean;
  volume?: number;
  className: string;
  loop: boolean;
  onEnded?: () => void;
  onAutoplayMuted?: () => void;
}): {
  slot: RefObject<HTMLDivElement | null>;
  video: RefObject<HTMLVideoElement | null>;
  ready: boolean;
} {
  const { src, active, playing, muted, volume = 1, className, loop, onEnded, onAutoplayMuted } = opts;
  const slot = useRef<HTMLDivElement | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const token = useRef<object>({});
  const finish = useRef(onEnded);
  finish.current = onEnded;
  const autoplayMuted = useRef(onAutoplayMuted);
  autoplayMuted.current = onAutoplayMuted;
  const [readySource, setReadySource] = useState<string | null>(null);
  const ready = active && !!src && readySource === src;

  useEffect(() => {
    const mount = slot.current;
    if (!src || !active || !mount) return;
    const mine = token.current;
    const node = claimTrailerVideo(mine, mount);
    video.current = node;
    node.className = className;
    node.loop = loop;
    node.playsInline = true;
    const ownsSource = () =>
      video.current === node && trailerVideoHeldBy(mine) && node.getAttribute("src") === src;
    setReadySource(ownsSource() && node.readyState >= 3 ? src : null);
    const onCanPlay = () => {
      if (ownsSource() && node.readyState >= 3) setReadySource(src);
    };
    const onFinish = () => {
      if (ownsSource()) finish.current?.();
    };
    node.addEventListener("canplay", onCanPlay);
    node.addEventListener("ended", onFinish);
    const timer = window.setTimeout(() => {
      if (video.current !== node || !trailerVideoHeldBy(mine)) return;
      if (node.getAttribute("src") === src) {
        onCanPlay();
        return;
      }
      node.preload = "auto";
      node.src = src;
    }, SRC_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      node.removeEventListener("canplay", onCanPlay);
      node.removeEventListener("ended", onFinish);
      video.current = null;
      setReadySource(null);
      releaseTrailerVideo(mine);
    };
  }, [src, active, className, loop]);

  useEffect(() => {
    const node = video.current;
    const mine = token.current;
    if (!node || !trailerVideoHeldBy(mine)) return;
    node.muted = muted;
    node.volume = volume;
  }, [src, active, className, loop, ready, muted, volume]);

  useEffect(() => {
    const node = video.current;
    const mine = token.current;
    if (!node || !trailerVideoHeldBy(mine)) return;
    if (!playing || !ready || node.getAttribute("src") !== src || node.readyState < 3) {
      node.pause();
      return;
    }
    let cancelled = false;
    node.play().catch((error: unknown) => {
      if (
        cancelled ||
        !trailerVideoHeldBy(mine) ||
        node.getAttribute("src") !== src ||
        (error as { name?: string } | null)?.name !== "NotAllowedError" ||
        node.muted
      ) {
        return;
      }
      node.muted = true;
      autoplayMuted.current?.();
      node.play().catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, [src, active, className, loop, playing, ready, muted]);

  return { slot, video, ready };
}
