const listeners = new Set<(url: string) => void>();
let pending: string | null = null;

export function isMalCallback(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === "compass:" && url.hostname === "mal" &&
      (!url.pathname || url.pathname === "/") && !url.username && !url.password && !url.port &&
      !url.hash && url.searchParams.getAll("code").length === 1 &&
      url.searchParams.getAll("state").length === 1;
  } catch {
    return false;
  }
}

export function receiveMalCallback(url: string): boolean {
  if (!isMalCallback(url)) return false;
  if (listeners.size === 0) pending = url;
  else listeners.forEach((listener) => listener(url));
  return true;
}

export function onMalCallback(listener: (url: string) => void): () => void {
  listeners.add(listener);
  const url = pending;
  pending = null;
  if (url) listener(url);
  return () => { listeners.delete(listener); };
}
