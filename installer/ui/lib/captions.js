export const CAPTIONS = [
  "Your library and settings stay on this computer.",
  "Addons you choose bring the catalogs and sources.",
  "Skip intros and recaps automatically.",
  "Themes, trackers and sync are one click away.",
];

export function captionIndex(elapsedMs, stepMs = 4200) {
  return Math.floor(Math.max(0, elapsedMs) / stepMs) % CAPTIONS.length;
}
