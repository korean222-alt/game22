/* Furniture and architecture.

   Every function takes a MeshBuilder and writes into it. Positions are world
   space; `ry` is a Y rotation in radians. Nothing here knows about the game —
   these are just things a game studio's office contains. */

import { MAT, shade } from '../core/color.js';
import { P } from './palette.js';

export const FLOOR_Y = 0.0;
export const DESK_Y = 2.42;
export const STOREY = 13;         // slab-to-slab height of one floor

/* Facing helpers: which way a wall-mounted thing looks. */
export const FACE_S = Math.PI / 2;
export const FACE_N = -Math.PI / 2;
export const FACE_E = Math.PI;
export const FACE_W = 0;

function seedAt(x, z) { const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return v - Math.floor(v); }

/* ---------- architecture ---------- */

/* A wall segment. `cuttable` marks it flag 1 so the dollhouse view can dissolve
   it when it stands between the camera and what you are looking at. */
export function wall(m, x0, z0, x1, z1, h, t, col, cuttable, y0) {
  const prev = m.flag;
  m.flag = cuttable === false ? 3 : 1;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const ry = Math.atan2(dx, dz);
  const base = y0 || FLOOR_Y;
  m.boxY(cx, base + h / 2, cz, t, h, len, ry, col || P.wall);
  // A skirting board is the cheapest thing that stops a wall/floor join reading
  // as a seam in a flat-shaded engine.
  m.mat = MAT.WOOD;
  m.boxY(cx, base + 0.30, cz, t * 1.22, 0.60, len, ry, P.base);
  m.mat = 0;
  m.flag = prev;
}

export function floorField(m, x0, z0, x1, z1, col, tile, y) {
  const yy = y === undefined ? FLOOR_Y : y;
  const w = x1 - x0, d = z1 - z0;
  if (!tile) { m.noSolid = true; m.box((x0 + x1) / 2, yy - 0.15, (z0 + z1) / 2, w, 0.30, d, col); m.noSolid = false; return; }
  // Break the field into tiles so the AO bake and the colour jitter have
  // something to vary across; one giant quad reads as dead flat.
  const nx = Math.max(1, Math.round(w / tile)), nz = Math.max(1, Math.round(d / tile));
  m.noSolid = true;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const cx = x0 + (i + 0.5) * w / nx, cz = z0 + (j + 0.5) * d / nz;
    const s = seedAt(i * 3.1, j * 7.7);
    m.box(cx, yy - 0.15, cz, w / nx, 0.30, d / nz, s > 0.5 ? col : shade(col, 0.97));
  }
  m.noSolid = false;
}

/* Structural slab for a floor above ground, drawn as the ceiling of the floor
   below. Flag 3 keeps it out of the wall-cut so ceilings never flicker. */
export function slab(m, x0, z0, x1, z1, y) {
  const prev = m.flag; m.flag = 3;
  m.mat = MAT.CEIL;
  m.noSolid = true;
  m.box((x0 + x1) / 2, y, (z0 + z1) / 2, x1 - x0, 0.5, z1 - z0, P.ceil);
  m.noSolid = false;
  m.mat = 0; m.flag = prev;
}

export function glassWall(m, x0, z0, x1, z1, h, sill, y0) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz), ry = Math.atan2(dx, dz);
  const base = (y0 || FLOOR_Y) + (sill || 0);
  const prev = m.flag;
  m.flag = 3; m.mat = MAT.METAL;
  m.boxY(cx, base + 0.14, cz, 0.30, 0.28, len, ry, P.frame);      // sill rail
  m.boxY(cx, base + h - 0.14, cz, 0.30, 0.28, len, ry, P.frame);  // head rail
  const bays = Math.max(1, Math.round(len / 5));
  for (let i = 0; i <= bays; i++) {
    const t = i / bays - 0.5;
    m.boxY(cx + dx * t, base + h / 2, cz + dz * t, 0.26, h, 0.26, ry, P.mullion);
  }
  m.mat = 0;
  m.flag = 2;                                        // glass: its own blended pass
  // The pane blocks. It used to be noSolid, and the mullions every five units
  // were the only obstacles in the run — so you could stroll through the
  // meeting-room window between two of them. Glass is a wall you can see past,
  // not a wall you can walk past.
  m.boxY(cx, base + h / 2, cz, 0.09, h - 0.3, len - 0.2, ry, P.glass);
  m.flag = prev;
}

export function doorway(m, x, z, ry, w, h, col, openAng) {
  const prev = m.flag; m.flag = 3;
  m.mat = MAT.WOOD;
  // Jambs stand at the two SIDES of the opening, along the wall. `wall()` runs
  // its length down local +Z, which is world (sin ry, cos ry); offsetting by
  // (cos, -sin) instead puts the frame in front of and behind the wall, where
  // it blocks the very opening it is framing.
  const ux = Math.sin(ry), uz = Math.cos(ry);
  const k = w / 2 + 0.16;
  for (const sgn of [-1, 1]) {
    m.boxY(x + ux * sgn * k, h / 2, z + uz * sgn * k, 0.34, h, 0.34, ry, P.doorDk);
  }
  m.boxY(x, h + 0.18, z, 0.34, 0.36, w + 0.7, ry, P.doorDk);
  if (openAng !== undefined) {
    // Hinged on one jamb: at openAng 0 the leaf fills the opening, and it
    // swings out of the way from there.
    //
    // The leaf does not block. A standing-open door sweeps a quarter circle
    // across the very gap it is meant to reveal, and to the walk grid that is
    // a wall — which is what sealed the stair core off from the rest of the
    // floor. A door you can see through is a door you can walk through.
    const prevNav = m.noNav;
    m.noNav = true;
    const hx = x + ux * (w / 2), hz = z + uz * (w / 2);
    const a = ry + openAng;
    const lx = Math.sin(a), lz = Math.cos(a);
    m.boxY(hx - lx * (w / 2), h / 2, hz - lz * (w / 2), 0.16, h - 0.2, w, a, col || P.door);
    m.noNav = prevNav;
  }
  m.mat = 0; m.flag = prev;
}

/* Wall with a hole in it: two jambs plus a header, so people can walk through. */
export function wallDoor(m, x0, z0, x1, z1, h, t, col, dt, dw, dh, open) {
  const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len;
  const a0 = dt - dw / 2, a1 = dt + dw / 2;
  if (a0 > 0.05) wall(m, x0, z0, x0 + ux * a0, z0 + uz * a0, h, t, col, true);
  if (a1 < len - 0.05) wall(m, x0 + ux * a1, z0 + uz * a1, x1, z1, h, t, col, true);
  const prev = m.flag; m.flag = 1;
  const cx = x0 + ux * dt, cz = z0 + uz * dt;
  const ry = Math.atan2(dx, dz);
  m.boxY(cx, dh + (h - dh) / 2, cz, t, h - dh, dw, ry, col || P.wall);   // header
  m.flag = prev;
  doorway(m, cx, cz, ry, dw, dh, P.door, open);
}

export function extWindow(m, x, z, ry, w, h, sill) {
  const prev = m.flag; m.flag = 3;
  m.mat = MAT.METAL;
  m.boxY(x, sill + h / 2, z, 0.5, h + 0.5, w + 0.5, ry, P.frame);
  m.mat = 0;
  m.flag = 2; m.noSolid = true;
  m.boxY(x, sill + h / 2, z, 0.16, h, w, ry, P.glass);
  m.noSolid = false;
  m.flag = prev;
}

export function blinds(m, x0, z0, x1, z1, top, drop, open) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz), ry = Math.atan2(dx, dz);
  const prev = m.flag; m.flag = 3;
  m.mat = MAT.FABRIC;
  m.noSolid = true;
  const n = Math.max(2, Math.floor(drop / 0.42));
  for (let i = 0; i < n; i++) {
    const y = top - i * 0.42;
    if (y < top - drop) break;
    m.boxY(cx, y, cz, 0.10, 0.30, len, ry, i % 2 ? P.blind : P.blindDk);
  }
  m.noSolid = false;
  m.mat = 0; m.flag = prev;
  void open;
}

export function rug(m, cx, cz, w, d, col) {
  m.mat = MAT.CARPET;
  m.noSolid = true;
  m.box(cx, FLOOR_Y + 0.03, cz, w, 0.06, d, col || P.rug);
  m.noSolid = false;
  m.mat = 0;
}

/* ---------- seating ---------- */

export function chairTask(m, x, z, ry, col) {
  const c = col || P.chair;
  m.mat = MAT.METAL;
  m.cyl(x, 0.10, z, 1.15, 0.20, P.steelDk, 10);         // base
  for (let i = 0; i < 5; i++) {
    const a = ry + i * 1.2566;
    m.boxY(x + Math.cos(a) * 0.6, 0.14, z + Math.sin(a) * 0.6, 1.2, 0.22, 0.28, a, P.steelDk);
  }
  m.cyl(x, 0.75, z, 0.22, 1.30, P.chrome, 8);           // gas lift
  m.mat = MAT.FABRIC;
  m.boxY(x, 1.42, z, 1.72, 0.34, 1.66, ry, c);          // pan
  const bx = x - Math.cos(ry) * 0.78, bz = z + Math.sin(ry) * 0.78;
  m.boxY(bx, 2.30, bz, 0.30, 1.90, 1.62, ry, c);        // back
  m.mat = 0;
}

export function chairGuest(m, x, z, ry, col) {
  const c = col || P.chairB;
  m.mat = MAT.METAL;
  for (const s of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const lx = s[0] * 0.62, lz = s[1] * 0.62;
    const px = x + lx * Math.cos(ry) + lz * Math.sin(ry);
    const pz = z - lx * Math.sin(ry) + lz * Math.cos(ry);
    m.box(px, 0.70, pz, 0.16, 1.40, 0.16, P.steelDk);
  }
  m.mat = MAT.FABRIC;
  m.boxY(x, 1.46, z, 1.55, 0.22, 1.50, ry, c);
  const bx = x - Math.cos(ry) * 0.70, bz = z + Math.sin(ry) * 0.70;
  m.boxY(bx, 2.20, bz, 0.22, 1.60, 1.48, ry, c);
  m.mat = 0;
}

export function couch(m, x, z, ry, seats, col) {
  const c = col || P.couch, w = seats * 2.1;
  m.mat = MAT.FABRIC;
  m.boxY(x, 0.80, z, w, 1.20, 2.6, ry, c);
  m.boxY(x, 1.60, z, w - 0.6, 0.5, 2.3, ry, shade(c, 1.08));
  const bx = x - Math.cos(ry) * 1.0, bz = z + Math.sin(ry) * 1.0;
  m.boxY(bx, 2.20, bz, 0.55, 1.60, w, ry, c);
  for (const k of [-1, 1]) {
    const ax = x + Math.cos(ry + Math.PI / 2) * k * (w / 2 - 0.2);
    const az = z - Math.sin(ry + Math.PI / 2) * k * (w / 2 - 0.2);
    m.boxY(ax, 1.55, az, 0.45, 1.0, 2.5, ry, shade(c, 0.92));
  }
  m.mat = 0;
}

/* ---------- desks ---------- */

export function deskRect(m, x, z, ry, w, d, col) {
  const c = col || P.lam;
  m.mat = MAT.WOOD;
  m.boxY(x, DESK_Y, z, w, 0.22, d, ry, c, shade(c, 1.05));
  m.mat = MAT.METAL;
  for (const s of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const lx = s[0] * (w / 2 - 0.35), lz = s[1] * (d / 2 - 0.35);
    const px = x + lx * Math.cos(ry) + lz * Math.sin(ry);
    const pz = z - lx * Math.sin(ry) + lz * Math.cos(ry);
    m.box(px, DESK_Y / 2, pz, 0.22, DESK_Y, 0.22, P.steelDk);
  }
  // Modesty panel across the FRONT edge of the desk — the side away from the
  // sitter. It was previously offset along the desk's local X, which stood it
  // up as a 5-unit wall beside every workstation and quietly walled the floor
  // off from itself.
  const px = x - Math.sin(ry) * (d / 2 - 0.2);
  const pz = z - Math.cos(ry) * (d / 2 - 0.2);
  m.mat = MAT.WOOD;
  m.boxY(px, 1.35, pz, w - 0.5, 1.5, 0.14, ry, shade(c, 0.92));
  m.mat = 0;
}

export function pedestal(m, x, z, ry) {
  m.mat = MAT.METAL;
  m.boxY(x, 1.05, z, 1.5, 2.1, 1.9, ry, P.steel);
  for (let i = 0; i < 3; i++) {
    const fx = x + Math.cos(ry) * 0.98, fz = z - Math.sin(ry) * 0.98;
    m.boxY(fx, 0.42 + i * 0.66, fz, 0.10, 0.54, 1.4, ry, shade(P.steel, 0.9));
  }
  m.mat = 0;
}

/* A desk monitor, facing the person sitting at the desk.

   FACING. `ry` is the DESK's rotation, and boxY lays a box's width down
   (cos ry, -sin ry) and its depth down (sin ry, cos ry). The seat is 2.6 units
   along +depth, so the panel has to be WIDE across the width axis and THIN
   across the depth axis, with its screen looking back down +depth. It used to
   be built the other way round — a panel spanning the desk's depth, with the
   quad wound so its face pointed away as well — which put every screen edge-on
   to the person using it and lit from behind. */
export function monitor(m, x, z, ry, w, tilt) {
  const ww = w || 2.3, h = ww * 0.60;
  // Unit vectors: `a` runs across the desk, `n` runs from the desk to the seat.
  const ax = Math.cos(ry), az = -Math.sin(ry);
  const nx = Math.sin(ry), nz = Math.cos(ry);
  m.mat = MAT.METAL;
  m.boxY(x, DESK_Y + 0.20, z, 1.0, 0.14, 0.7, ry, P.charcoal);         // foot
  m.boxY(x, DESK_Y + 0.62, z, 0.26, 0.86, 0.26, ry, P.charcoal);       // stem
  const cy = DESK_Y + 1.32;
  m.boxY(x, cy, z, ww + 0.20, h + 0.24, 0.20, ry, P.black);            // bezel
  m.mat = MAT.SCREEN;
  // Screen face as an explicit UV quad so the shader's desktop lands square.
  // Wound p0→p1→p2 counter-clockwise seen from the seat, which is what makes
  // the generated normal point at the person rather than into the desk.
  const half = ww / 2, hh = h / 2;
  const ox = x + nx * 0.12, oz = z + nz * 0.12;
  const p0 = [ox - ax * half, cy - hh, oz - az * half];
  const p1 = [ox + ax * half, cy - hh, oz + az * half];
  const p2 = [ox + ax * half, cy + hh, oz + az * half];
  const p3 = [ox - ax * half, cy + hh, oz - az * half];
  m.quadUV(p0, p1, p2, p3, '#ffffff', MAT.SCREEN);
  m.mat = 0;
  void tilt;
}

export function keyboard(m, x, z, ry) {
  m.mat = MAT.GLOSS;
  m.boxY(x, DESK_Y + 0.17, z, 0.62, 0.12, 1.90, ry, P.charcoal);
  m.boxY(x + Math.cos(ry) * 1.35, DESK_Y + 0.18, z - Math.sin(ry) * 1.35, 0.42, 0.14, 0.62, ry, P.charcoal);
  m.mat = 0;
}

export function mug(m, x, z, col) {
  m.mat = MAT.GLOSS;
  m.cyl(x, DESK_Y + 0.38, z, 0.30, 0.60, col || '#e8e4d8', 10);
  m.mat = 0;
}

export function papers(m, x, z, ry, n) {
  m.mat = MAT.PAPER;
  for (let i = 0; i < (n || 3); i++) {
    m.boxY(x + i * 0.04, DESK_Y + 0.13 + i * 0.03, z + i * 0.03, 1.5, 0.03, 1.15, ry + i * 0.06, P.paper);
  }
  m.mat = 0;
}

export function penCup(m, x, z) {
  m.mat = MAT.GLOSS;
  m.cyl(x, DESK_Y + 0.40, z, 0.24, 0.64, P.charcoal, 8);
  for (let i = 0; i < 4; i++) {
    const a = i * 1.57;
    m.box(x + Math.cos(a) * 0.09, DESK_Y + 0.85, z + Math.sin(a) * 0.09, 0.07, 0.9, 0.07,
      ['#c94f4f', '#3f6bb8', '#3d8a4f', '#e0c04a'][i]);
  }
  m.mat = 0;
}

export function deskLamp(m, x, z, ry) {
  m.mat = MAT.METAL;
  m.cyl(x, DESK_Y + 0.16, z, 0.42, 0.10, P.charcoal, 10);
  m.box(x, DESK_Y + 0.90, z, 0.10, 1.4, 0.10, P.charcoal);
  const hx = x + Math.cos(ry) * 0.55, hz = z - Math.sin(ry) * 0.55;
  m.boxY(hx, DESK_Y + 1.55, hz, 0.55, 0.35, 0.75, ry, P.charcoal);
  m.mat = MAT.SCREEN;
  m.noSolid = true;
  m.box(hx, DESK_Y + 1.38, hz, 0.45, 0.06, 0.62, '#fff3d0');   // the lit underside
  m.noSolid = false;
  m.mat = 0;
}

export function plantSmall(m, x, z) {
  m.mat = MAT.DEF;
  m.cyl(x, DESK_Y + 0.35, z, 0.36, 0.55, P.plantPot, 9);
  m.mat = MAT.LEAF;
  m.ball(x, DESK_Y + 0.95, z, 0.52, 0.48, 0.52, P.leaf, 9, 5);
  m.mat = 0;
}

/* A fully dressed workstation: desk, chair, screens, clutter. `variant` just
   shuffles which clutter appears so no two desks are identical. */
export function workstation(m, x, z, ry, variant, dual) {
  deskRect(m, x, z, ry, 5.4, 3.0, P.lam);
  const R = (lx, lz) => [x + lx * Math.cos(ry) + lz * Math.sin(ry), z - lx * Math.sin(ry) + lz * Math.cos(ry)];
  const back = R(0, -1.05);
  if (dual) {
    const a = R(-1.25, -0.95), b = R(1.25, -0.95);
    monitor(m, a[0], a[1], ry + 0.16, 2.0);
    monitor(m, b[0], b[1], ry - 0.16, 2.0);
  } else {
    monitor(m, back[0], back[1], ry, 2.4);
  }
  const kb = R(0, 0.35); keyboard(m, kb[0], kb[1], ry);
  const p = R(-1.95, 0.55);
  const v = variant % 4;
  if (v === 0) mug(m, p[0], p[1], '#c95f4f');
  else if (v === 1) penCup(m, p[0], p[1]);
  else if (v === 2) plantSmall(m, p[0], p[1]);
  else papers(m, p[0], p[1], ry, 4);
  const q = R(2.0, 0.5);
  if (v === 3) mug(m, q[0], q[1], '#4f7fc9');
  else if (v === 1) deskLamp(m, q[0], q[1], ry);
  const ch = R(0, 2.6);
  chairTask(m, ch[0], ch[1], ry, [P.chair, P.chairB, P.chairG, P.chairR][variant % 4]);
  const pd = R(1.95, -0.4);
  pedestal(m, pd[0], pd[1], ry);
}

/* ---------- storage and equipment ---------- */

export function cubeWall(m, x, z, ry, len, h) {
  m.mat = MAT.FABRIC;
  m.boxY(x, (h || 4.2) / 2, z, 0.34, h || 4.2, len, ry, P.cubicle);
  m.mat = MAT.METAL;
  m.boxY(x, (h || 4.2) - 0.08, z, 0.42, 0.16, len, ry, P.steelDk);
  m.mat = 0;
}

export function fileCab(m, x, z, ry, drawers, w) {
  const ww = w || 2.4, h = (drawers || 4) * 1.15;
  m.mat = MAT.METAL;
  m.boxY(x, h / 2, z, ww, h, 2.2, ry, P.steel);
  for (let i = 0; i < (drawers || 4); i++) {
    const fx = x + Math.cos(ry) * 1.13, fz = z - Math.sin(ry) * 1.13;
    m.boxY(fx, 0.62 + i * 1.15, fz, 0.10, 0.9, ww - 0.3, ry, shade(P.steel, 0.92));
    m.boxY(fx, 0.62 + i * 1.15, fz, 0.16, 0.16, 0.9, ry, P.chrome);
  }
  m.mat = 0;
}

export function shelfUnit(m, x, z, ry, w, h, books) {
  m.mat = MAT.WOOD;
  m.boxY(x, h / 2, z, 1.6, h, w, ry, P.oakDk);
  const shelves = Math.max(2, Math.floor(h / 2.0));
  for (let i = 1; i < shelves; i++) {
    m.boxY(x, i * (h / shelves), z, 1.5, 0.16, w - 0.2, ry, P.oak);
  }
  if (books) {
    for (let i = 1; i < shelves; i++) {
      let off = -w / 2 + 0.5;
      while (off < w / 2 - 0.6) {
        const bw = 0.22 + seedAt(off * 3.3, i * 7.1) * 0.30;
        const bh = 1.1 + seedAt(off * 1.7, i * 2.9) * 0.5;
        const bx = x + off * Math.sin(ry), bz = z + off * Math.cos(ry);
        const cols = ['#8e4a3f', '#3f5a8e', '#4a7d5a', '#8a7a3f', '#5f4a7d', '#6b6b6b'];
        m.boxY(bx, i * (h / shelves) + bh / 2 + 0.1, bz, 1.1, bh, bw, ry,
          cols[Math.floor(seedAt(off * 5.5, i) * cols.length)]);
        off += bw + 0.03;
      }
    }
  }
  m.mat = 0;
}

export function serverRack(m, x, z, ry) {
  m.mat = MAT.METAL;
  m.boxY(x, 4.2, z, 2.6, 8.4, 3.4, ry, P.charcoal);
  m.mat = MAT.SCREEN;
  // Blinking status LEDs: emissive, so a server room glows in the bloom pass.
  for (let i = 0; i < 14; i++) {
    const fx = x + Math.cos(ry) * 1.75, fz = z - Math.sin(ry) * 1.75;
    const on = seedAt(i * 3.7, x + z) > 0.35;
    m.noSolid = true;
    m.boxY(fx, 0.8 + i * 0.54, fz, 0.06, 0.10, 1.9, ry, on ? '#5ad0ff' : '#1c3a44');
    m.noSolid = false;
  }
  m.mat = 0;
}

export function copier(m, x, z, ry) {
  m.mat = MAT.GLOSS;
  m.boxY(x, 1.8, z, 4.2, 3.6, 3.4, ry, '#dedad0');
  m.boxY(x, 3.85, z, 3.6, 0.5, 3.0, ry, '#c4c0b6');
  m.mat = MAT.SCREEN;
  const fx = x + Math.cos(ry) * 1.5, fz = z - Math.sin(ry) * 1.5;
  m.noSolid = true;
  m.boxY(fx, 3.2, fz, 0.08, 0.5, 1.0, ry, '#5ad0ff');
  m.noSolid = false;
  m.mat = 0;
}

export function waterCooler(m, x, z) {
  m.mat = MAT.GLOSS;
  m.box(x, 1.6, z, 1.6, 3.2, 1.6, '#e4e1d8');
  m.mat = MAT.SCREEN;
  m.cyl(x, 4.2, z, 0.85, 2.0, '#9fd8e8', 12);   // the bottle
  m.mat = 0;
}

export function vending(m, x, z, ry) {
  m.mat = MAT.GLOSS;
  m.boxY(x, 3.4, z, 3.2, 6.8, 2.4, ry, '#b03f3f');
  m.mat = MAT.SCREEN;
  const fx = x + Math.cos(ry) * 1.05, fz = z - Math.sin(ry) * 1.05;
  m.noSolid = true;
  m.boxY(fx, 4.2, fz, 0.10, 3.6, 2.2, ry, '#cfe8f2');
  m.noSolid = false;
  m.mat = 0;
}

export function whiteboard(m, x, y, z, ry, w, h) {
  const prev = m.flag; m.flag = 3;
  m.mat = MAT.METAL;
  m.boxY(x, y, z, 0.22, h + 0.34, w + 0.34, ry, P.alu);
  m.mat = MAT.BOARD;
  m.noSolid = true;
  m.boxY(x + Math.cos(ry) * 0.13, y, z - Math.sin(ry) * 0.13, 0.06, h, w, ry, '#f4f4f0');
  m.noSolid = false;
  m.mat = 0; m.flag = prev;
}

export function wallTV(m, x, y, z, ry, w, h) {
  const prev = m.flag; m.flag = 3;
  m.mat = MAT.GLOSS;
  m.boxY(x, y, z, 0.30, h + 0.26, w + 0.26, ry, P.black);
  m.mat = MAT.SCREEN;
  const ux = Math.sin(ry), uz = Math.cos(ry);
  const nx = Math.cos(ry), nz = -Math.sin(ry);
  const ox = x + nx * 0.18, oz = z + nz * 0.18;
  m.quadUV(
    [ox - ux * w / 2, y - h / 2, oz - uz * w / 2],
    [ox + ux * w / 2, y - h / 2, oz + uz * w / 2],
    [ox + ux * w / 2, y + h / 2, oz + uz * w / 2],
    [ox - ux * w / 2, y + h / 2, oz - uz * w / 2],
    '#ffffff', MAT.SCREEN);
  m.mat = 0; m.flag = prev;
}

export function signBoard(m, x, y, z, ry, w, h, bg) {
  const prev = m.flag; m.flag = 3;
  m.mat = MAT.BOARD;
  m.noSolid = true;
  m.boxY(x, y, z, 0.16, h, w, ry, bg || P.accent);
  m.noSolid = false;
  m.mat = 0; m.flag = prev;
}

export function plantTall(m, x, z, s) {
  const k = s || 1;
  m.mat = MAT.DEF;
  m.cyl(x, 0.85 * k, z, 1.05 * k, 1.7 * k, P.plantPot, 12);
  m.mat = MAT.LEAF;
  for (let i = 0; i < 5; i++) {
    const a = i * 1.2566 + x * 0.3;
    m.ball(x + Math.cos(a) * 0.75 * k, (2.6 + i * 0.55) * k, z + Math.sin(a) * 0.75 * k,
      1.35 * k, 0.75 * k, 1.35 * k, i % 2 ? P.leaf : P.leafDk, 9, 5);
  }
  m.mat = 0;
}

export function trashBin(m, x, z) {
  m.mat = MAT.GLOSS;
  m.cyl(x, 0.85, z, 0.62, 1.7, P.charcoal, 10);
  m.mat = 0;
}

/* Recessed ceiling light. Emissive, so it drives the bloom that makes an
   interior read as lit rather than merely bright. */
export function troffer(m, x, z, ry, y) {
  const prev = m.flag; m.flag = 3;
  m.mat = MAT.METAL;
  m.noSolid = true;
  m.boxY(x, (y || STOREY) - 0.42, z, 4.2, 0.30, 1.9, ry, P.alu);
  m.mat = MAT.SCREEN;
  m.boxY(x, (y || STOREY) - 0.60, z, 3.9, 0.10, 1.6, ry, '#fff8e8');
  m.noSolid = false;
  m.mat = 0; m.flag = prev;
}

export function confTable(m, x, z, ry, len, w) {
  m.mat = MAT.WOOD;
  m.boxY(x, DESK_Y, z, w || 5.5, 0.28, len, ry, P.walnut, shade(P.walnut, 1.08));
  m.mat = MAT.METAL;
  for (const k of [-1, 1]) {
    m.boxY(x + Math.sin(ry) * k * len * 0.28, DESK_Y / 2, z + Math.cos(ry) * k * len * 0.28,
      1.4, DESK_Y, 1.4, ry, P.steelDk);
  }
  m.mat = 0;
}

/* A straight flight ascending from (x,z) along `ry`. Local +Z is the direction
   of travel, matching `wall()`, so a tread is `run` deep along the climb and
   `width` across it. Getting these two the wrong way round builds a flight
   that is thirteen units wide and one tread long — which is what this was,
   and it walled the office in half. */
export function stairs(m, x, z, ry, steps, run, rise, width) {
  m.mat = MAT.TILE;
  // Treads shade but do not block: a flight is climbed, not walked around, and
  // feeding it to the walk grid sealed the stair core off entirely.
  const prevNav = m.noNav;
  m.noNav = true;
  const n = steps || 12, r = run || 0.8, h = rise || (STOREY / (steps || 12));
  const w = width || 4.0;
  const ux = Math.sin(ry), uz = Math.cos(ry);
  for (let i = 0; i < n; i++) {
    const d = (i + 0.5) * r;
    m.boxY(x + ux * d, (i + 0.5) * h, z + uz * d, w, h, r, ry, P.slab);
  }
  m.mat = MAT.METAL;
  // Handrails run along both edges, offset across the flight.
  const px = Math.cos(ry), pz = -Math.sin(ry);
  for (const k of [-1, 1]) {
    for (let i = 0; i < n; i += 3) {
      const d = (i + 0.5) * r;
      m.noSolid = true;
      m.boxY(x + ux * d + px * k * (w / 2), (i + 0.5) * h + 1.8, z + uz * d + pz * k * (w / 2),
        0.14, 3.4, 0.14, ry, P.chrome);
      m.noSolid = false;
    }
  }
  m.mat = 0;
  m.noNav = prevNav;
}

export { seedAt };

/* ═══════════════════════════════════════════════════════════════════════════
   A real office is not just desks. These are the things that make a floor read
   as a place people actually spend their day in: somewhere to be met, somewhere
   to make coffee, somewhere to take a call, somewhere to put your coat.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Reception counter with a raised transaction top and a company sign behind. */
export function receptionDesk(m, x, z, ry, w) {
  const W = w || 9;
  m.mat = MAT.WOOD;
  m.boxY(x, 1.35, z, 2.6, 2.7, W, ry, P.walnut);
  m.mat = MAT.GLOSS;
  m.boxY(x, 2.85, z, 3.2, 0.24, W + 0.5, ry, P.lam, shade(P.lam, 1.07));   // counter top
  const fx = x + Math.cos(ry) * 1.45, fz = z - Math.sin(ry) * 1.45;
  m.mat = MAT.METAL;
  m.boxY(fx, 1.5, fz, 0.10, 0.35, W - 0.8, ry, P.chrome);                  // kick rail
  m.mat = MAT.SCREEN;
  const bx = x - Math.cos(ry) * 0.7, bz = z + Math.sin(ry) * 0.7;
  m.noSolid = true;
  m.boxY(bx, 3.45, bz, 0.12, 0.9, 2.0, ry, '#5ad0ff');                     // a small monitor
  m.noSolid = false;
  m.mat = 0;
}

/* Kitchen counter: cabinets, worktop, upstand, and optionally a sink cut-out. */
export function counterRun(m, x, z, ry, len, sink) {
  m.mat = MAT.WOOD;
  m.boxY(x, 1.45, z, 2.4, 2.9, len, ry, P.lamDk);
  m.mat = MAT.GLOSS;
  m.boxY(x, 2.98, z, 2.6, 0.22, len + 0.2, ry, '#3f4248', '#4a4e55');      // worktop
  const bx = x - Math.cos(ry) * 1.1, bz = z + Math.sin(ry) * 1.1;
  m.boxY(bx, 3.9, bz, 0.22, 1.6, len, ry, shade(P.wall, 0.96));            // upstand
  m.mat = MAT.METAL;
  for (let i = 0; i < Math.max(2, Math.floor(len / 2.2)); i++) {
    const t = -len / 2 + (i + 0.5) * (len / Math.max(2, Math.floor(len / 2.2)));
    m.boxY(x + Math.cos(ry) * 1.15 + Math.sin(ry) * t, 2.2, z - Math.sin(ry) * 1.15 + Math.cos(ry) * t,
      0.10, 0.10, 0.9, ry, P.chrome);                                       // cabinet pulls
  }
  if (sink) {
    m.boxY(x, 3.02, z, 1.6, 0.16, 2.0, ry, '#8d9096');                     // basin
    m.cyl(x - Math.cos(ry) * 0.85, 3.6, z + Math.sin(ry) * 0.85, 0.09, 1.2, P.chrome, 8);
    m.boxY(x - Math.cos(ry) * 0.5, 4.16, z + Math.sin(ry) * 0.5, 0.8, 0.12, 0.12, ry, P.chrome);
  }
  m.mat = 0;
}

export function fridge(m, x, z, ry) {
  m.mat = MAT.METAL;
  m.boxY(x, 3.3, z, 2.6, 6.6, 2.6, ry, '#b9bcc1');
  const fx = x + Math.cos(ry) * 1.34, fz = z - Math.sin(ry) * 1.34;
  m.boxY(fx, 4.9, fz, 0.08, 2.9, 2.3, ry, shade('#b9bcc1', 0.94));
  m.boxY(fx, 1.6, fz, 0.08, 3.0, 2.3, ry, shade('#b9bcc1', 0.94));
  m.boxY(fx + Math.sin(ry) * 0.9, 3.9, fz + Math.cos(ry) * 0.9, 0.14, 1.4, 0.14, ry, P.chrome);
  m.mat = 0;
}

export function microwave(m, x, y, z, ry) {
  m.mat = MAT.GLOSS;
  m.boxY(x, y + 0.7, z, 1.5, 1.4, 2.2, ry, '#3c3f45');
  m.mat = MAT.SCREEN;
  m.noSolid = true;
  m.boxY(x + Math.cos(ry) * 0.78, y + 0.75, z - Math.sin(ry) * 0.78, 0.06, 0.9, 1.3, ry, '#2a4450');
  m.noSolid = false;
  m.mat = 0;
}

export function coffeeMaker(m, x, y, z, ry) {
  m.mat = MAT.GLOSS;
  m.boxY(x, y + 0.85, z, 1.1, 1.7, 1.3, ry, '#26282d');
  m.mat = MAT.METAL;
  m.cyl(x + Math.cos(ry) * 0.35, y + 0.35, z - Math.sin(ry) * 0.35, 0.34, 0.7, '#5a5d63', 10);
  m.mat = MAT.SCREEN;
  m.noSolid = true;
  m.boxY(x + Math.cos(ry) * 0.58, y + 1.35, z - Math.sin(ry) * 0.58, 0.05, 0.28, 0.5, ry, '#ff8a4a');
  m.noSolid = false;
  m.mat = 0;
}

/* A bank of personal lockers — instantly reads as a workplace. */
export function lockers(m, x, z, ry, bays) {
  const n = bays || 5, w = 1.7;
  m.mat = MAT.METAL;
  m.boxY(x, 3.4, z, 1.9, 6.8, n * w, ry, '#5f6b74');
  for (let i = 0; i < n; i++) {
    const t = -n * w / 2 + (i + 0.5) * w;
    const px = x + Math.cos(ry) * 0.98 + Math.sin(ry) * t;
    const pz = z - Math.sin(ry) * 0.98 + Math.cos(ry) * t;
    for (const yy of [1.9, 5.0]) {
      m.boxY(px, yy, pz, 0.10, 2.8, w - 0.14, ry, i % 2 ? '#68747d' : '#5a666f');
      m.boxY(px + Math.cos(ry) * 0.06, yy + 0.9, pz - Math.sin(ry) * 0.06, 0.10, 0.16, 0.5, ry, P.chrome);
    }
  }
  m.mat = 0;
}

/* Single-person focus booth: the modern office's phone box. */
export function phoneBooth(m, x, z, ry) {
  const W = 4.2, D = 4.2, H = 8.4;
  m.flag = 1;
  m.mat = MAT.WOOD;
  m.boxY(x, H / 2, z, W, H, 0.35, ry, P.lamDk);                     // back
  m.boxY(x + Math.sin(ry) * (D / 2), H / 2, z + Math.cos(ry) * (D / 2), 0.35, H, D, ry, P.lamDk);
  m.boxY(x - Math.sin(ry) * (D / 2), H / 2, z - Math.cos(ry) * (D / 2), 0.35, H, D, ry, P.lamDk);
  m.mat = MAT.CEIL;
  m.boxY(x, H, z, W + 0.3, 0.3, D + 0.3, ry, P.ceil);
  m.mat = 0;
  m.flag = 2;                                                       // glass front
  m.noSolid = true;
  m.boxY(x + Math.cos(ry) * (W / 2), H / 2 + 0.3, z - Math.sin(ry) * (W / 2), 0.10, H - 0.8, D - 0.5, ry, P.glass);
  m.noSolid = false;
  m.flag = 0;
  m.mat = MAT.WOOD;
  m.boxY(x - Math.cos(ry) * 1.0, 2.3, z + Math.sin(ry) * 1.0, 1.5, 0.18, 3.0, ry, P.oak);   // ledge
  m.mat = 0;
  chairTask(m, x + Math.cos(ry) * 0.4, z - Math.sin(ry) * 0.4, ry + Math.PI, P.chairG);
}

/* Window bar: a counter of laptop seats facing the glass. */
export function barCounter(m, x, z, ry, len) {
  m.mat = MAT.WOOD;
  m.boxY(x, 3.1, z, 2.2, 0.26, len, ry, P.oak, shade(P.oak, 1.06));
  m.mat = MAT.METAL;
  for (let i = 0; i <= 3; i++) {
    const t = -len / 2 + (i / 3) * len;
    m.boxY(x + Math.sin(ry) * t, 1.55, z + Math.cos(ry) * t, 0.22, 3.1, 0.22, ry, P.steelDk);
  }
  m.mat = 0;
}

export function stool(m, x, z) {
  m.mat = MAT.METAL;
  m.cyl(x, 0.10, z, 0.75, 0.20, P.steelDk, 10);
  m.cyl(x, 1.20, z, 0.16, 2.2, P.chrome, 8);
  m.mat = MAT.FABRIC;
  m.cyl(x, 2.42, z, 0.85, 0.30, P.chairB, 12);
  m.mat = 0;
}

/* Round café table for the break room. */
export function tableRound(m, x, z, r) {
  m.mat = MAT.WOOD;
  m.cyl(x, 2.40, z, r || 2.2, 0.22, P.birch, 16, shade(P.birch, 1.05));
  m.mat = MAT.METAL;
  m.cyl(x, 1.20, z, 0.26, 2.4, P.steelDk, 8);
  m.cyl(x, 0.10, z, 1.0, 0.20, P.steelDk, 12);
  m.mat = 0;
}

/* Cork board with pinned notes — the cheapest "people work here" signal. */
export function pinBoard(m, x, y, z, ry, w, h) {
  const prev = m.flag; m.flag = 3;
  m.mat = MAT.WOOD;
  m.boxY(x, y, z, 0.20, h + 0.3, w + 0.3, ry, P.oakDk);
  m.mat = MAT.FABRIC;
  m.noSolid = true;
  m.boxY(x + Math.cos(ry) * 0.11, y, z - Math.sin(ry) * 0.11, 0.06, h, w, ry, '#b08a5a');
  m.mat = MAT.PAPER;
  const cols = ['#f6f3e8', '#fff6b8', '#dbe9f6', '#f6dbe0'];
  for (let i = 0; i < 7; i++) {
    const t = (seedAt(i * 3.1, x) - 0.5) * (w - 1.4);
    const v = (seedAt(i * 7.7, z) - 0.5) * (h - 1.0);
    m.boxY(x + Math.cos(ry) * 0.16 + Math.sin(ry) * t, y + v, z - Math.sin(ry) * 0.16 + Math.cos(ry) * t,
      0.05, 0.95, 0.75, ry + (seedAt(i, 2) - 0.5) * 0.2, cols[i % cols.length]);
  }
  m.noSolid = false;
  m.mat = 0; m.flag = prev;
}

/* Supplies shelving beside the printer. */
export function supplyShelf(m, x, z, ry) {
  m.mat = MAT.METAL;
  m.boxY(x, 3.6, z, 1.8, 7.2, 5.0, ry, '#7d848c');
  for (let i = 1; i < 4; i++) m.boxY(x, i * 1.8, z, 1.7, 0.14, 4.8, ry, '#8d949c');
  m.mat = MAT.PAPER;
  for (let i = 0; i < 6; i++) {
    const t = (i % 3 - 1) * 1.4, lvl = 1 + Math.floor(i / 3);
    m.boxY(x + Math.sin(ry) * t, lvl * 1.8 + 0.6, z + Math.cos(ry) * t, 1.2, 1.0, 1.1, ry, P.paper);
  }
  m.mat = 0;
}

/* Standing desk: same footprint as a workstation top, raised. */
export function standDesk(m, x, z, ry) {
  m.mat = MAT.WOOD;
  m.boxY(x, 4.1, z, 5.2, 0.22, 2.6, ry, P.birch, shade(P.birch, 1.05));
  m.mat = MAT.METAL;
  for (const k of [-1, 1]) {
    m.boxY(x + Math.sin(ry) * k * 2.0, 2.0, z + Math.cos(ry) * k * 2.0, 0.55, 4.0, 0.55, ry, P.steelDk);
    m.boxY(x + Math.sin(ry) * k * 2.0, 0.14, z + Math.cos(ry) * k * 2.0, 1.4, 0.28, 2.2, ry, P.steelDk);
  }
  m.mat = 0;
  monitor(m, x, z - 0.9, ry, 2.4);
}

/* A potted ficus in a woven basket — softer than the moulded planter. */
export function plantBasket(m, x, z, s) {
  const k = s || 1;
  m.mat = MAT.FABRIC;
  m.cyl(x, 0.95 * k, z, 1.15 * k, 1.9 * k, '#b9a884', 12);
  m.mat = MAT.LEAF;
  for (let i = 0; i < 4; i++) {
    const a = i * 1.5708 + x * 0.4;
    m.ball(x + Math.cos(a) * 0.6 * k, (2.9 + i * 0.7) * k, z + Math.sin(a) * 0.6 * k,
      1.1 * k, 0.9 * k, 1.1 * k, i % 2 ? P.leaf : P.leafDk, 9, 5);
  }
  m.mat = 0;
}
