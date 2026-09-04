/* Turning the player's furniture list into geometry.

   `buildPlaced` walks the saved list and calls the same prop functions the
   office generator uses, into a MeshBuilder of its own. That separation is the
   point: the building is uploaded once at boot and never touched, while this
   mesh is thrown away and rebuilt every time something is moved — a few hundred
   triangles, cheap enough to do on every drag frame of the placement ghost.

   It also emits the desk slots the staff system assigns people to. Desks are no
   longer generated with the floor; a desk exists because the player bought one
   and put it down, which is what makes hiring cost furniture as well as salary. */

import { MeshBuilder } from '../core/meshbuilder.js';
import { MAT } from '../core/color.js';
import { P } from './palette.js';
import { FURNITURE_BY_ID, footprint } from '../game/furniture.js';
import { FLOOR_PLANS } from './office.js';
import {
  workstation, standDesk, cubeWall, shelfUnit, fileCab, supplyShelf, lockers,
  plantBasket, plantTall, couch, tableRound, coffeeMaker, waterCooler, vending,
  rug, whiteboard, pinBoard, serverRack, copier, phoneBooth, counterRun,
  STOREY, DESK_Y,
} from './props.js';

/* Each entry draws one piece at the origin-relative position it was placed at.
   `ry` is the piece's own rotation; a workstation's occupant faces the desk, so
   the seat is derived from it rather than stored. */
const DRAW = {
  desk: (m, x, z, ry, i) => workstation(m, x, z, ry, i % 4, false),
  deskDual: (m, x, z, ry, i) => workstation(m, x, z, ry, i % 4, true),
  standDesk: (m, x, z, ry) => standDesk(m, x, z, ry),
  cubeWall: (m, x, z, ry) => cubeWall(m, x, z, ry, 3.6, 4.0),
  shelf: (m, x, z, ry) => shelfUnit(m, x, z, ry, 7.0, 6.2, true),
  fileCab: (m, x, z, ry) => fileCab(m, x, z, ry, 4, 2.4),
  supplyShelf: (m, x, z, ry) => supplyShelf(m, x, z, ry),
  lockers: (m, x, z, ry) => lockers(m, x, z, ry, 3),
  plant: (m, x, z) => plantBasket(m, x, z, 0.9),
  plantTall: (m, x, z) => plantTall(m, x, z, 1.1),
  couch: (m, x, z, ry) => couch(m, x, z, ry, 2, P.couch),
  tableRound: (m, x, z) => tableRound(m, x, z, 1.8),
  // A machine wants something to stand on; the counter is part of the piece.
  coffee: (m, x, z, ry) => { counterRun(m, x, z, ry, 3.0, false); coffeeMaker(m, x, 3.1, z, ry); },
  waterCooler: (m, x, z) => waterCooler(m, x, z),
  vending: (m, x, z, ry) => vending(m, x, z, ry),
  rug: (m, x, z, ry) => {
    const f = footprint({ w: 8, d: 6 }, ry === 0 || Math.abs(ry - Math.PI) < 0.1 ? 0 : 1);
    rug(m, x, z, f.w, f.d, P.rug);
  },
  // Freestanding, on a pair of legs: the wall-mounted versions need a wall, and
  // the player can put one in the middle of the floor.
  whiteboard: (m, x, z, ry) => {
    m.mat = MAT.METAL;
    for (const k of [-1, 1]) {
      m.boxY(x + Math.sin(ry) * k * 2.4, 1.5, z + Math.cos(ry) * k * 2.4, 0.3, 3.0, 0.3, ry, P.steelDk);
    }
    m.boxY(x, 0.12, z, 0.9, 0.24, 5.4, ry, P.steelDk);
    m.mat = 0;
    whiteboard(m, x, 5.0, z, ry, 5.4, 3.4);
  },
  pinBoard: (m, x, z, ry) => {
    m.mat = MAT.METAL;
    for (const k of [-1, 1]) {
      m.boxY(x + Math.sin(ry) * k * 2.0, 1.4, z + Math.cos(ry) * k * 2.0, 0.28, 2.8, 0.28, ry, P.steelDk);
    }
    m.mat = 0;
    pinBoard(m, x, 4.4, z, ry, 4.4, 3.0);
  },
  serverRack: (m, x, z, ry) => serverRack(m, x, z, ry),
  copier: (m, x, z, ry) => copier(m, x, z, ry),
  phoneBooth: (m, x, z, ry) => phoneBooth(m, x, z, ry),
};

export function hasDrawer(id) { return !!DRAW[id]; }

/* Lift a sub-mesh built at ground level onto its storey. Same trick the office
   generator uses, and for the same reason: no prop function has to know which
   floor it is being drawn on. */
function liftInto(m, sub, base) {
  for (let i = 1; i < sub.p.length; i += 3) sub.p[i] += base;
  for (let i = 1; i < sub.solids.length; i += 6) { sub.solids[i] += base; sub.solids[i + 3] += base; }
  m.append(sub);
}

/* Build every placed piece into one mesh, and return the desk slots with it.

   `placed` entries are `{ uid, id, floor, x, z, rot }` where `rot` is a number
   of quarter turns. Anything whose id is unknown is skipped rather than
   throwing — a save written by a newer build must still load. */
export function buildPlaced(placed) {
  const m = new MeshBuilder();
  const desks = [];
  let i = 0;
  for (const it of placed || []) {
    const def = FURNITURE_BY_ID.get(it.id);
    const draw = DRAW[it.id];
    if (!def || !draw) continue;
    const ry = (it.rot || 0) * (Math.PI / 2);
    const base = it.floor * STOREY;
    const sub = new MeshBuilder();
    // A rug is walked over, not around, so it must not enter the solids list.
    sub.noSolid = !!def.flat;
    try {
      draw(sub, it.x, it.z, ry, i);
    } catch (e) {
      console.warn('furniture draw failed', it.id, e);
      continue;
    }
    liftInto(m, sub, base);

    if (def.seats) {
      const plan = FLOOR_PLANS[it.floor] || FLOOR_PLANS[0];
      // The chair sits 2.6 behind the desk and the occupant faces the desk, so
      // their yaw is the desk's rotation turned around — the same convention
      // the generated pods used, kept identical so agents seat the same way.
      desks.push({
        id: it.uid,
        floor: it.floor, role: plan.role,
        x: it.x, z: it.z, ry,
        seatX: it.x + 2.6 * Math.sin(ry),
        seatZ: it.z + 2.6 * Math.cos(ry),
        yaw: ry + Math.PI,
        y: base,
        kind: it.id,
      });
    }
    i++;
  }
  return { mesh: m, desks };
}

/* A translucent preview of one piece at a candidate spot. Drawn through the
   same code path as the real thing so what you see while dragging is exactly
   what lands — a separate "ghost box" always ends up lying about the footprint. */
export function buildGhost(id, floor, x, z, rot) {
  const def = FURNITURE_BY_ID.get(id);
  const draw = DRAW[id];
  if (!def || !draw) return null;
  const m = new MeshBuilder();
  const sub = new MeshBuilder();
  sub.noSolid = true;
  try { draw(sub, x, z, (rot || 0) * (Math.PI / 2), 0); } catch (e) { return null; }
  liftInto(m, sub, floor * STOREY);
  return m;
}

export { DESK_Y };
