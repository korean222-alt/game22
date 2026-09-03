/* The office palette, plus the hex -> material mapping.

   Registering the map here means prop code can call m.box(..., P.oak) and get
   wood grain without naming a material at every call site. Where the mapping
   would be wrong — a metal-coloured plastic bin, say — a prop sets m.mat
   explicitly and that wins. */

import { MAT, setMatMap } from '../core/color.js';

export const P = {
  /* floors */
  carpet: '#8e9096', carpetDk: '#7f8187', carpetWarm: '#928a7e',
  tile: '#cfc9bb', tileDk: '#b9b2a2', vinyl: '#c2bcae', woodFloor: '#a87d4e',
  slab: '#9a9a9d',

  /* walls */
  wall: '#e9e5da', wallDk: '#d5d0c2', wallWarm: '#e2d8c2', wallCool: '#dfe3e8',
  accent: '#3f5a7a', accentWarm: '#7a4f3f', brick: '#9d6049',
  base: '#8d8371', ceil: '#f2efe4',

  /* glass + frames */
  glass: '#bcd6de', glassDk: '#a2c0c8', frame: '#7c7a6f', mullion: '#6e6c62',
  blind: '#e9e5d9', blindDk: '#d4cfc0',

  /* wood */
  oak: '#c08f57', oakDk: '#a5763f', walnut: '#7d5734', walnutDk: '#5f4227',
  lam: '#c9b18a', lamDk: '#a68f6b', door: '#93673f', doorDk: '#734e2e',
  birch: '#d9c39c',

  /* metal + plastic */
  steel: '#9d9fa3', steelDk: '#6c6e72', chrome: '#c3c6cb', black: '#2c2d31',
  charcoal: '#3d3f45', beige: '#ddd6c4', alu: '#adb1b6',

  /* fabric */
  chair: '#34363c', chairB: '#3b566d', chairG: '#41614c', chairR: '#6d3b3b',
  cubicle: '#93a08f', cubicle2: '#a1948a', couch: '#4a5f70', rug: '#6b5a4a',

  /* accents */
  paper: '#f6f3e8', screen: '#a8e2f2', screenDk: '#3d6a7c',
  plantPot: '#a45a3c', leaf: '#4e7c46', leafDk: '#3b6135',
  red: '#8e2f2f', gold: '#c9a13a', neon: '#5ad0ff', neonPink: '#ff6ea8',

  /* exterior */
  extWall: '#c6bda8', extTrim: '#6d6555', roof: '#7b7367', lot: '#5f6062',
  curb: '#c9c4b6', grass: '#7c8a55', ground: '#c9cacc', asphalt: '#54565a',

  /* skin tones */
  sk1: '#eabb8d', sk2: '#dda877', sk3: '#c08a55', sk4: '#a06a3c', sk5: '#7d4c2a',

  /* hair */
  hr1: '#2b2018', hr2: '#4a3524', hr3: '#7a5a35', hr4: '#a8823f', hr5: '#8e8b86',
};

/* Materials chosen so a colour implies a surface. Anything absent falls back to
   MAT.DEF, which is a generic slightly-noisy dielectric. */
const MAP = {};
const put = (mat, ...keys) => { for (const k of keys) MAP[P[k]] = mat; };

put(MAT.CARPET, 'carpet', 'carpetDk', 'carpetWarm', 'rug');
put(MAT.TILE, 'tile', 'tileDk', 'vinyl', 'slab');
put(MAT.WOOD, 'oak', 'oakDk', 'walnut', 'walnutDk', 'lam', 'lamDk', 'door', 'doorDk', 'woodFloor', 'birch');
put(MAT.WALL, 'wall', 'wallDk', 'wallWarm', 'wallCool', 'accent', 'accentWarm', 'base', 'extWall');
put(MAT.CEIL, 'ceil');
put(MAT.METAL, 'steel', 'steelDk', 'chrome', 'alu', 'frame', 'mullion');
put(MAT.FABRIC, 'chair', 'chairB', 'chairG', 'chairR', 'cubicle', 'cubicle2', 'couch', 'blind', 'blindDk');
put(MAT.PAPER, 'paper');
put(MAT.LEAF, 'leaf', 'leafDk');
put(MAT.SCREEN, 'screen');

setMatMap(MAP);

export const SKINS = [P.sk1, P.sk2, P.sk3, P.sk4, P.sk5];
export const HAIRS = [P.hr1, P.hr2, P.hr3, P.hr4, P.hr5];

/* Shirt colours a games studio would actually be wearing. */
export const SHIRTS = [
  '#4e6f96', '#7d4e5e', '#4d7a5f', '#8a7143', '#5a5566', '#3f4a58',
  '#a15f4a', '#4a7d8a', '#6b4f7a', '#88a0b8', '#d8d4c8', '#2f3238',
];
export const PANTS = ['#3a3b42', '#2f3540', '#4a4438', '#3f3a44', '#54504a'];
