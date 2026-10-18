import { compareVersions, samePath } from "./format.js";

// What pressing the primary button does, given an install the engine may already see at `dest`.
export function installAction(prior, version, dest) {
  if (!prior || !samePath(prior.path, dest)) return { mode: "install", kind: "install", from: "" };
  const was = prior.version || "";
  const cmp = compareVersions(version, was);
  if (cmp > 0) return { mode: "install", kind: "update", from: was };
  if (cmp < 0) return { mode: "install", kind: "downgrade", from: was };
  return { mode: "repair", kind: "repair", from: was };
}
