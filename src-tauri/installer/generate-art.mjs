import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, "..", "..", "src", "assets");

const compassIcon = join(here, "..", "icons", "icon.png");

function markPng(size) {
  return sharp(compassIcon).resize(size, size).png().toBuffer();
}

function wordmarkSvg(fill) {
  return readFileSync(join(assets, "compass-wordmark.svg"), "utf8").replace(/fill="#f3f3f3"/g, `fill="${fill}"`);
}

function rasterByWidth(svg, width) {
  return new Resvg(svg, { fitTo: { mode: "width", value: Math.round(width) } }).render().asPng();
}

function rasterByHeight(svg, height) {
  return new Resvg(svg, { fitTo: { mode: "height", value: Math.round(height) } }).render().asPng();
}

function rasterIntrinsic(svg) {
  return new Resvg(svg, {}).render().asPng();
}

function writeBmp24(path, width, height, rgb) {
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const pixels = rowSize * height;
  const buf = Buffer.alloc(54 + pixels);
  buf.write("BM", 0);
  buf.writeUInt32LE(54 + pixels, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(pixels, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y;
    let off = 54 + y * rowSize;
    for (let x = 0; x < width; x++) {
      const si = (srcY * width + x) * 3;
      buf[off++] = rgb[si + 2];
      buf[off++] = rgb[si + 1];
      buf[off++] = rgb[si];
    }
  }
  writeFileSync(path, buf);
}

async function finishBmp(composedPng, w, h, bg, bmpPath, previewPath) {
  const png = await sharp(composedPng).resize(w, h).flatten({ background: bg }).png().toBuffer();
  writeFileSync(previewPath, png);
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  writeBmp24(bmpPath, info.width, info.height, data);
}

async function sidebar() {
  const W = 164, H = 314, s = 2;
  const base = rasterIntrinsic(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W * s}" height="${H * s}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c1f26"/><stop offset="0.55" stop-color="#15171c"/><stop offset="1" stop-color="#0d0f13"/></linearGradient></defs><rect width="${W * s}" height="${H * s}" fill="url(#g)"/></svg>`,
  );
  const mark = await markPng(86 * s);
  const word = rasterByWidth(wordmarkSvg("#eef0f2"), 122 * s);
  const mm = await sharp(mark).metadata();
  const wm = await sharp(word).metadata();
  const gap = 28 * s;
  const startY = Math.round((H * s - (mm.height + gap + wm.height)) / 2);
  const composed = await sharp(base)
    .composite([
      { input: mark, left: Math.round((W * s - mm.width) / 2), top: startY },
      { input: word, left: Math.round((W * s - wm.width) / 2), top: startY + mm.height + gap },
    ])
    .png()
    .toBuffer();
  await finishBmp(composed, W, H, "#0d0f13", join(here, "sidebar.bmp"), join(here, "sidebar-preview.png"));
}

async function header() {
  const W = 150, H = 57, s = 2;
  const base = rasterIntrinsic(`<svg xmlns="http://www.w3.org/2000/svg" width="${W * s}" height="${H * s}"><rect width="${W * s}" height="${H * s}" fill="#ffffff"/></svg>`);
  const mark = await markPng(36 * s);
  const mm = await sharp(mark).metadata();
  const composed = await sharp(base)
    .composite([{ input: mark, left: 16 * s, top: Math.round((H * s - mm.height) / 2) }])
    .png()
    .toBuffer();
  await finishBmp(composed, W, H, "#ffffff", join(here, "header.bmp"), join(here, "header-preview.png"));
}

await sidebar();
await header();
console.log("done");
