/* Colour helpers and the hex -> material lookup.

   Every vertex carries a material id that selects a procedural surface in the
   fragment shader. Rather than tagging each call site, a palette hex maps to a
   material automatically; MeshBuilder.mat overrides when the mapping is wrong
   (a wooden-coloured plastic, say). */

import { clamp, lerp } from './math.js';

export const MAT = {
  DEF: 0, CARPET: 1, WOOD: 2, WALL: 3, METAL: 4, FABRIC: 5, SCREEN: 6,
  CEIL: 7, SKIN: 8, TILE: 9, GLOSS: 10, BOARD: 11, PAPER: 12, LEAF: 13,
  HAIR: 14, CLOTH: 15,
};

export function hex2rgb(h) {
  if (Array.isArray(h)) return h;
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function shade(c, f) {
  const v = hex2rgb(c);
  return [clamp(v[0] * f, 0, 1), clamp(v[1] * f, 0, 1), clamp(v[2] * f, 0, 1)];
}

export function mixc(a, b, t) {
  const x = hex2rgb(a), y = hex2rgb(b);
  return [lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)];
}

let _js = 1;
export function seedJit(s) { _js = s >>> 0; }
export function jit(c, amt) {
  const v = hex2rgb(c);
  _js = (_js * 1664525 + 1013904223) >>> 0;
  const r = ((_js >>> 16) / 65535 - 0.5) * 2 * (amt || 0.03);
  return [clamp(v[0] + r, 0, 1), clamp(v[1] + r, 0, 1), clamp(v[2] + r, 0, 1)];
}

/* Populated by world/palette.js once the palette exists — keeps this module
   free of any dependency on which colours the game happens to use. */
let MATMAP = null;
export function setMatMap(map) { MATMAP = map; }
export function matOf(col) {
  if (!MATMAP || typeof col !== 'string') return MAT.DEF;
  const m = MATMAP[col];
  return m === undefined ? MAT.DEF : m;
}
