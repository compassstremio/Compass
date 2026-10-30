/**
 * The saved session restores the last track as paused so Music can resume it, but that is
 * not the listener asking for the dock. It opens once something plays in this session.
 */
export function dockActivated(already: boolean, phase: string): boolean {
  return already || phase === "playing" || phase === "resolving";
}
