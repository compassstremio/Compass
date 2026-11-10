/**
 * The saved session restores the last track as paused so Music can resume it, but that is
 * not the listener asking for the dock. It opens once something plays in this session, or
 * once the listener moves to a different track than the one restored at launch.
 */
export function dockActivated(
  already: boolean,
  phase: string,
  restoredId: string | null,
  currentId: string | null,
): boolean {
  if (already) return true;
  if (phase === "playing" || phase === "resolving" || phase === "error") return true;
  return currentId !== null && restoredId !== null && currentId !== restoredId;
}
