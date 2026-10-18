export function mb(bytes) {
  if (!bytes) return "0 MB";
  const m = bytes / 1048576;
  if (m >= 1024) return (m / 1024).toFixed(2) + " GB";
  return Math.round(m) + " MB";
}

export function compareVersions(a, b) {
  const pa = String(a || "").split(".").map(Number);
  const pb = String(b || "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

export function samePath(a, b) {
  const norm = (value) => String(value || "").replace(/[\\/]+$/, "").toLowerCase();
  return norm(a) !== "" && norm(a) === norm(b);
}

// The folder picker returns the parent; Compass always lives in a folder named Compass.
export function compassDir(picked) {
  const trimmed = String(picked || "").replace(/[\\/]+$/, "");
  const tail = trimmed.split(/[\\/]/).filter(Boolean).pop() || "";
  return tail.toLowerCase() === "compass" ? trimmed : trimmed + "\\Compass";
}

// Keeps "558 MB" or "0.9.134" in reading order when it sits inside Arabic text.
export function isolate(text) {
  return "⁦" + String(text) + "⁩";
}

export function clampPct(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}
