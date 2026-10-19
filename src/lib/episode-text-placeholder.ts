// Keep this independent of provider merges so every selection path shares the rule.
const PLACEHOLDER = /^(?:tba|tbd|tbc|n\/?a|unknown|to be announced|to be determined)\b/i;

export function isPlaceholderEpisodeText(text: string | null | undefined): boolean {
  const value = text?.trim();
  return !!value && PLACEHOLDER.test(value);
}
