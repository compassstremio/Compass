import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

export function addonConfigurationKey(base: string): string | undefined {
  if (!/^https?:\/\//i.test(base)) return undefined;
  const normalized = base.replace(/\/manifest\.json$/, "");
  return bytesToHex(sha256(new TextEncoder().encode(normalized)));
}
