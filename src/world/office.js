/* The office tower.

   One MeshBuilder holds the whole building; floors above the one being
   inspected are dissolved by the shader's uFloorY cut rather than by swapping
   meshes, so there is nothing to rebuild when the player changes floor.

   Coordinates: -Z is north. A desk with ry = 0 faces north, and the person
   sitting at it is 2.6 units to the south of the desk centre.

   The generator also emits the game-facing furniture: a desk slot list the
   staff system assigns people to, and named rooms for the label overlay. */

import { MeshBuilder } from '../core/meshbuilder.js';
import { MAT } from '../core/color.js';
import { mulberry32 } from '../core/math.js';
import { P } from './palette.js';
import {
  wall, wallDoor, glassWall, floorField, slab, workstation, chairGuest, confTable,
  whiteboard, wallTV, signBoard, plantTall, trashBin, troffer, fileCab, shelfUnit,
  serverRack, copier, waterCooler, vending, couch, cubeWall, stairs, rug,
  STOREY, FLOOR_Y,
} from './props.js';

export const BUILDING = {
  x0: 0, z0: 0, x1: 64, z1: 44,     // interior extents
  storey: STOREY,
  wallH: STOREY - 1.2,
  thick: 0.7,
};

/* Each floor gets a purpose. The staff system reads `role` to decide who
   belongs where — the original's tip that writers and developers want separate
   floors is the reason floors have a role at all. */
export const FLOOR_PLANS = [
  { name: '1F · 로비 / 개발실', role: 'dev', accent: P.accent },
  { name: '2F · 개발실', role: 'dev', accent: '#3f6a5a' },
  { name: '3F · 기획실', role: 'plan', accent: '#6a5a3f' },
  { name: '4F · 사운드 / 아트', role: 'art', accent: '#5a3f6a' },
  { name: '5F · 네트워크실', role: 'net', accent: '#3f5a6a' },
];

const CORE = { x0: 27, x1: 39, z0: 17, z1: 27 };   // lift + stair core

function isInCore(x, z) {
  return x > CORE.x0 - 1 && x < CORE.x1 + 1 && z > CORE.z0 - 1 && z < CORE.z1 + 1;
}

/* ---------- one floor ---------- */
function buildFloor(m, fi, plan, out) {
  const B = BUILDING;
  const base = fi * B.storey;
  const rnd = mulberry32(0x9e37 + fi * 7919);
  const wallH = B.wallH;

  // Slab and carpet. Flag 4+fi tags the floor plate so the wall-cut leaves it
  // alone while still letting per-floor logic identify it later.
  m.flag = 3;
  floorField(m, B.x0, B.z0, B.x1, B.z1, fi === 0 ? P.carpetWarm : P.carpet, 4, base + FLOOR_Y);
  m.flag = 0;

  // Perimeter: glass to north and south (the daylight sides), solid east/west.
  glassWall(m, B.x0, B.z0, B.x1, B.z0, wallH, 0.9, base);
  glassWall(m, B.x0, B.z1, B.x1, B.z1, wallH, 0.9, base);
  wall(m, B.x0, B.z0, B.x0, B.z1, wallH, B.thick, P.wall, false, base);
  wall(m, B.x1, B.z0, B.x1, B.z1, wallH, B.thick, P.wall, false, base);

  // ---- service core ----
  m.flag = 1;
  wall(m, CORE.x0, CORE.z0, CORE.x1, CORE.z0, wallH, 0.6, plan.accent, true, base);
  wall(m, CORE.x0, CORE.z1, CORE.x1, CORE.z1, wallH, 0.6, plan.accent, true, base);
  wall(m, CORE.x0, CORE.z0, CORE.x0, CORE.z1, wallH, 0.6, P.wallDk, true, base);
  wallDoor(m, CORE.x1, CORE.z0, CORE.x1, CORE.z1, wallH, 0.6, P.wallDk, 5, 4, 6.4, 0.9);
  m.flag = 0;

  // Lift doors, plus the stair run that connects to the floor above.
  m.mat = MAT.METAL;
  for (let i = 0; i < 2; i++) {
    m.box(CORE.x0 + 3 + i * 5, base + 3.4, CORE.z0 - 0.5, 3.4, 6.8, 0.30, P.chrome);
  }
  m.mat = 0;
  if (fi < FLOOR_PLANS.length - 1) {
    const sm = new MeshBuilder();
    stairs(sm, CORE.x0 + 2, CORE.z1 - 2.5, -Math.PI / 2, 16, 0.85, B.storey / 16);
    for (let i = 1; i < sm.p.length; i += 3) sm.p[i] += base;
    for (let i = 1; i < sm.solids.length; i += 6) { sm.solids[i] += base; sm.solids[i + 3] += base; }
    m.append(sm);
  }

  signBoard(m, CORE.x0 + 6, base + 8.4, CORE.z0 - 0.75, -Math.PI / 2, 8, 1.6, plan.accent);

  // ---- meeting room, north-east corner ----
  const MR = { x0: 46, x1: 62, z0: 2, z1: 15 };
  m.flag = 1;
  glassWall(m, MR.x0, MR.z0, MR.x0, MR.z1, wallH, 0, base);
  wallDoor(m, MR.x0, MR.z1, MR.x1, MR.z1, wallH, 0.5, P.wall, 4, 4, 6.4, 1.0);
  m.flag = 0;
  confTable(m, (MR.x0 + MR.x1) / 2, (MR.z0 + MR.z1) / 2, 0, 9, 4.4);
  for (let i = 0; i < 3; i++) {
    chairGuest(m, (MR.x0 + MR.x1) / 2 - 3.4, MR.z0 + 4 + i * 3.2, Math.PI / 2, P.chairB);
    chairGuest(m, (MR.x0 + MR.x1) / 2 + 3.4, MR.z0 + 4 + i * 3.2, -Math.PI / 2, P.chairB);
  }
  whiteboard(m, MR.x1 - 0.5, base + 6.4, (MR.z0 + MR.z1) / 2, Math.PI, 9, 4.6);
  wallTV(m, MR.x0 + 0.4, base + 6.4, MR.z0 + 3.6, 0, 5.2, 3.0);
  out.rooms.push({ name: '회의실', x: (MR.x0 + MR.x1) / 2, y: base + 7, z: (MR.z0 + MR.z1) / 2, floor: fi });

  // ---- break area, south-west ----
  const BR = { x0: 2, x1: 17, z0: 30, z1: 42 };
  m.flag = 1;
  wall(m, BR.x1, BR.z0, BR.x1, BR.z1, wallH, 0.5, P.wallWarm, true, base);
  wallDoor(m, BR.x0, BR.z0, BR.x1, BR.z0, wallH, 0.5, P.wallWarm, 8, 4.5, 6.4, 1.1);
  m.flag = 0;
  rug(m, 9, 36, 9, 7, P.rug);
  couch(m, 6.5, 36, -Math.PI / 2, 2, P.couch);
  waterCooler(m, 15, 33);
  vending(m, 12.5, 41, Math.PI);
  plantTall(m, 3.5, 40.5, 1.1);
  out.rooms.push({ name: '휴게실', x: 9, y: base + 7, z: 36, floor: fi });

  // ---- desk field ----
  // Two bands along the daylight walls plus one interior band, skipping any pod
  // that would land in the core or in a room.
  const bands = [
    { z: 9.5, ry: 0 },              // north band, facing the window
    { z: 22.5, ry: Math.PI },       // interior band, facing south
    { z: 36.5, ry: Math.PI },       // south band, facing the window
  ];
  let slot = 0;
  for (const band of bands) {
    for (let x = 5; x <= 58; x += 8.2) {
      if (isInCore(x, band.z)) continue;
      if (x > MR.x0 - 3 && band.z < MR.z1 + 2) continue;
      if (x < BR.x1 + 3 && band.z > BR.z0 - 2) continue;
      const variant = Math.floor(rnd() * 4);
      const dual = rnd() > 0.45;
      const sm = new MeshBuilder();
      workstation(sm, x, band.z, band.ry, variant, dual);
      for (let i = 1; i < sm.p.length; i += 3) sm.p[i] += base;
      for (let i = 1; i < sm.solids.length; i += 6) { sm.solids[i] += base; sm.solids[i + 3] += base; }
      m.append(sm);

      // Where the person sits, in world space, on this floor.
      const cos = Math.cos(band.ry), sin = Math.sin(band.ry);
      out.desks.push({
        id: `f${fi}s${slot++}`,
        floor: fi, role: plan.role,
        x, z: band.z, ry: band.ry,
        seatX: x + 2.6 * sin, seatZ: band.z + 2.6 * cos,
        y: base,
      });
      if (rnd() > 0.6) cubeWall(m, x + 4.1, band.z, band.ry, 3.2, 4.0);
    }
  }

  // ---- odds and ends ----
  fileCab(m, 42, 3, Math.PI, 4, 2.4);
  fileCab(m, 42, 6, Math.PI, 4, 2.4);
  shelfUnit(m, 22, 2.4, Math.PI / 2, 8, 6.5, true);
  copier(m, 25, 41, 0);
  trashBin(m, 40, 41);
  plantTall(m, 61, 22, 1.2);
  plantTall(m, 2.5, 22, 1.0);
  if (plan.role === 'net') {
    for (let i = 0; i < 4; i++) serverRack(m, 52 + i * 3.2, 24, 0);
    out.rooms.push({ name: '서버실', x: 57, y: base + 7, z: 24, floor: fi });
  }

  // ---- ceiling lights + the slab above ----
  for (let x = 6; x < 62; x += 11) {
    for (let z = 5; z < 42; z += 9) {
      if (isInCore(x, z)) continue;
      troffer(m, x, z, 0, base + B.storey);
    }
  }
  slab(m, B.x0 - 1, B.z0 - 1, B.x1 + 1, B.z1 + 1, base + B.storey - 0.3);

  out.rooms.push({ name: plan.name.split('·')[1]?.trim() || plan.name, x: 32, y: base + 8, z: 6, floor: fi });
}

/* ---------- ground and shell ---------- */
const SITE = 4;      // exempt from the wall cut and the floor cut alike

function buildSite(m, floors) {
  const B = BUILDING;
  const top = floors * B.storey;
  m.flag = SITE;
  m.noSolid = true;
  m.mat = MAT.DEF;                                       // not TILE: its 1-unit
  m.box(32, -1.2, 22, 260, 2, 260, P.ground);            // grout would tile the
                                                         // whole plaza as graph paper
  m.mat = MAT.DEF;
  m.box(32, -0.55, 78, 200, 1, 46, P.asphalt);           // the street
  m.mat = 0;
  m.noSolid = false;

  // Exterior piers between the glazing. These are cuttable like walls: from a
  // low camera they would otherwise fence off the floor you are inspecting.
  m.flag = 1;
  m.mat = MAT.WALL;
  for (let x = -2; x <= 66; x += 8) {
    m.box(x, top / 2, -1.6, 2.2, top, 2.2, P.extWall);
    m.box(x, top / 2, 45.6, 2.2, top, 2.2, P.extWall);
  }
  m.box(-1.6, top / 2, 22, 2.4, top, 48, P.extWall);
  m.box(65.6, top / 2, 22, 2.4, top, 48, P.extWall);
  // A parapet RING, not a cap: a solid roof slab would sit above the floor-cut
  // threshold and dissolve into dither across the whole frame. Flag 3, not
  // SITE, so looking at a lower floor removes it instead of leaving it hanging.
  m.flag = 3;
  m.mat = MAT.WALL;
  for (const [cx, cz, w, d] of [[32, -2.2, 70, 2.4], [32, 46.2, 70, 2.4],
                                [-2.2, 22, 2.4, 50], [66.2, 22, 2.4, 50]]) {
    m.noSolid = true;
    m.box(cx, top + 1.0, cz, w, 2.0, d, P.roof);
    m.noSolid = false;
  }
  m.mat = 0;
  m.flag = 0;

  // A few neighbours, so the windows look out on a city rather than a void.
  const rnd = mulberry32(4242);
  m.flag = SITE;
  m.mat = MAT.WALL;
  for (let i = 0; i < 14; i++) {
    const a = rnd() * 6.2831853;
    const r = 120 + rnd() * 110;
    const bx = 32 + Math.cos(a) * r, bz = 22 + Math.sin(a) * r;
    if (Math.abs(bz - 78) < 30 && Math.abs(bx - 32) < 90) continue;
    const h = 24 + rnd() * 90, w = 18 + rnd() * 26, d = 18 + rnd() * 26;
    m.noSolid = true;
    m.box(bx, h / 2, bz, w, h, d, rnd() > 0.5 ? '#9aa0a8' : '#a8a094');
    m.noSolid = false;
  }
  m.mat = 0;
  m.flag = 0;
}

/* ---------- entry point ---------- */
export function buildOffice(floorCount = FLOOR_PLANS.length) {
  const m = new MeshBuilder();
  const out = { desks: [], rooms: [] };
  const n = Math.max(1, Math.min(FLOOR_PLANS.length, floorCount));
  for (let fi = 0; fi < n; fi++) buildFloor(m, fi, FLOOR_PLANS[fi], out);
  buildSite(m, n);
  return { mesh: m, desks: out.desks, rooms: out.rooms, floors: n };
}

export { STOREY };
