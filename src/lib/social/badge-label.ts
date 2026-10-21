/**
 * Badge names are stored with underscores (`theme_creator`). They key the icon and the "shown badges"
 * setting, so they must not change. People read them with spaces.
 */
export function badgeLabel(name?: string | null): string {
  return (name ?? "").replace(/_/g, " ");
}
