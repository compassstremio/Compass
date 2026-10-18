import { h } from "../lib/dom.js";

const HUES = [24, 200, 345, 95, 48, 235, 290, 170, 15, 260, 355, 140, 40, 215];

export function mountWall(host) {
  host.replaceChildren(...HUES.map((hue, i) => h("i", { style: `--hue:${hue};--i:${i}` })));
}
