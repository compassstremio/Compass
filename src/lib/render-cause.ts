/**
 * Diagnostic probe that attributes a component's re-render to the store or context that changed.
 *
 * A store's notify path calls `noteNotify(label)`; a component calls `recordRenderCause(name)` at
 * the top of its render, which credits the label that fired within the last few milliseconds, or
 * `unattributed` when the render came from a parent or the component's own state. Off unless the
 * memory profiler is running, and read only by its dump — nothing here costs anything in normal
 * use.
 */

let active = false;
const notifications = new Map<string, number>();
const causes = new Map<string, Map<string, number>>();
const probes = new Map<string, number>();
let lastLabel = "";
let lastAt = -1e9;

export function setRenderCauseActive(value: boolean): void {
  active = value;
  if (!value) resetRenderCauses();
}

export function resetRenderCauses(): void {
  notifications.clear();
  causes.clear();
  probes.clear();
  lastLabel = "";
  lastAt = -1e9;
}

/**
 * Counts a diagnostic event that is not itself a render — an image falling back, a retry ladder
 * step — so a large `state` slice can be attributed to the code path that produced it. Must be
 * called from an event handler or effect, never from inside a state updater, which React can run
 * twice in development.
 */
export function noteProbe(label: string): void {
  if (!active) return;
  probes.set(label, (probes.get(label) ?? 0) + 1);
}

/** Called from a store's notify path, before it calls its listeners. */
export function noteNotify(label: string): void {
  if (!active) return;
  notifications.set(label, (notifications.get(label) ?? 0) + 1);
  lastLabel = label;
  lastAt = performance.now();
}

/** Called at the top of a component's render. An explicit `cause` overrides the notifier heuristic. */
export function recordRenderCause(component: string, cause?: string, maxAgeMs = 5): void {
  if (!active) return;
  const label = cause ?? (performance.now() - lastAt <= maxAgeMs ? lastLabel : "unattributed");
  let forComponent = causes.get(component);
  if (!forComponent) {
    forComponent = new Map();
    causes.set(component, forComponent);
  }
  forComponent.set(label, (forComponent.get(label) ?? 0) + 1);
}

export type RenderCauseRow = {
  component: string;
  causes: Array<{ label: string; count: number }>;
};

export function renderCauseRows(): RenderCauseRow[] {
  const rows: RenderCauseRow[] = [...causes].map(([component, table]) => ({
    component,
    causes: [...table]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
  }));
  const total = (row: RenderCauseRow) => row.causes.reduce((n, c) => n + c.count, 0);
  return rows.sort((a, b) => total(b) - total(a));
}

export function storeNotifyRows(): Array<{ label: string; count: number }> {
  return [...notifications]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

export function probeRows(): Array<{ label: string; count: number }> {
  return [...probes].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}
