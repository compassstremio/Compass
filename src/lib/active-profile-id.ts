const KEY = "compass.profiles.v1";

type MinimalProfile = { id: string; isPrimary?: boolean };
type MinimalState = { profiles?: MinimalProfile[]; activeId?: string | null };

function readState(): MinimalState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as MinimalState;
  } catch {
    return null;
  }
}

export function activeProfileId(): string {
  const s = readState();
  return s?.activeId || "default";
}

export function activeProfileIsPrimary(): boolean {
  const s = readState();
  if (!s || !Array.isArray(s.profiles) || s.profiles.length === 0) return true;
  const active = s.profiles.find((p) => p.id === s.activeId);
  return active?.isPrimary === true;
}

/**
 * Profile ids whose stored copies a shared session may be adopted from: the active
 * profile first, then the main profile, then the rest.
 */
export function profilesForSessionAdoption(): string[] {
  const s = readState();
  const list = Array.isArray(s?.profiles) ? s.profiles : [];
  const active = s?.activeId || "default";
  const primary = list.filter((p) => p.isPrimary).map((p) => p.id);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of [active, ...primary, ...list.map((p) => p.id)]) {
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
