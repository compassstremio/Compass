import { useEffect } from "react";
import { effectiveBinding, eventToBinding, shouldHandleGlobalKeyboardEvent } from "@/lib/hotkeys";
import { useSearchActions, useSearchOpen } from "@/lib/search-context";
import { useSettings } from "@/lib/settings";

export function SearchHotkey() {
  const { setOpen } = useSearchActions();
  const open = useSearchOpen();
  const { settings } = useSettings();

  // Ctrl/Cmd+K toggles the box from anywhere, including while typing in a field. It reads the
  // physical key so it still works on a non-Latin keyboard layout, and it listens during capture
  // so a focused control can't swallow it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.isComposing) return;
      if (e.code !== "KeyK" && e.key?.toLowerCase() !== "k") return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      setOpen(!open);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, setOpen]);

  const binding = effectiveBinding("globalSearchFocus", settings.hotkeys ?? {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!shouldHandleGlobalKeyboardEvent(e)) return;
      if (eventToBinding(e) !== binding) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [binding, setOpen]);
  return null;
}
