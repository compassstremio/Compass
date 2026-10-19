import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "ui");
const PORT = Number(process.argv[2]) || 4599;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".avif": "image/avif",
  ".webp": "image/webp",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

createServer(async (req, res) => {
  let url = decodeURIComponent(req.url.split("?")[0]);
  if (url === "/") url = "/index.html";
  if (url === "/changelog.json") {
    try {
      const dir = join(HERE, "changelog");
      const files = (await readdir(dir)).filter((name) => name.endsWith("-changelog.json"));
      const versions = [];
      for (const name of files) {
        const version = name.slice(0, -"-changelog.json".length);
        const doc = JSON.parse(await readFile(join(dir, name), "utf8"));
        const note = doc.notes && doc.notes[version];
        if (!note) continue;
        versions.push({
          version,
          channel: doc.channel === "beta" ? "beta" : "stable",
          pub_date: doc.pub_date || null,
          note,
        });
      }
      versions.sort((a, b) => {
        const pa = String(a.version).split(".").map(Number);
        const pb = String(b.version).split(".").map(Number);
        for (let i = 0; i < 3; i++) {
          const d = (pb[i] || 0) - (pa[i] || 0);
          if (d) return d;
        }
        return 0;
      });
      res.writeHead(200, { "Content-Type": TYPES[".json"], "Cache-Control": "no-store" });
      res.end(JSON.stringify({ versions }));
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 changelog.json");
    }
    return;
  }
  const path = normalize(join(ROOT, url));
  if (path !== ROOT && !path.startsWith(ROOT + sep)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const body = await readFile(path);
    res.writeHead(200, {
      "Content-Type": TYPES[extname(path).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 " + url);
  }
}).listen(PORT, () => {
  console.log("Compass Setup prototype: http://127.0.0.1:" + PORT + "/");
});
