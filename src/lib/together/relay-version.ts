export const REQUIRED_RELAY_VERSION = 11;
export const COMPASS_PUBLIC_RELAY = "wss://pub.compass.sarl";

export function migratePublicRelayUrl(url: string): string {
  return /^(?:(?:wss?|https?):\/\/)?pub\.compass\.sarl\/?$/i.test(url.trim())
    ? COMPASS_PUBLIC_RELAY
    : url;
}

export function relayOutdated(version: number | null | undefined): boolean {
  return version == null || version < REQUIRED_RELAY_VERSION;
}

export function isPublicRelay(url: string): boolean {
  const host = url
    .trim()
    .toLowerCase()
    .replace(/^(wss?|https?):\/\//, "")
    .replace(/\/.*$/, "");
  return host === "pub.compass.sarl";
}
