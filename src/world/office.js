/* The office tower.

   One MeshBuilder holds the whole building; floors above the one being
   inspected are dissolved by the shader's uFloorY cut rather than by swapping
   meshes, so there is nothing to rebuild when the player changes floor.

   Coordinates: -Z is north. A desk with ry = 0 faces north, and the person
   sitting at it is 2.6 units to the south of the desk centre.

   FACING CONVENTION
     Every seat this file emits carries `yaw`, which is the RIG yaw: a rig at
     yaw y faces the world direction (sin y, cos y). Furniture takes its own
     rotation, and for a chair that is `yaw - PI/2`. Keeping the seat's facing
     and the chair's rotation derived from one number is what stops people
     sitting backwards.

   The generator also emits the game-facing furniture: desk slots the staff
   system assigns people to, meeting seats the meeting scene walks them to,
   idle spots the ambient behaviour wanders between, and named rooms for the
   label overlay. */

import { MeshBuilder } from '../core/meshbuilder.js';
import { MAT } from '../core/color.js';
import { mulberry32 } from '../core/math.js';
import { P } from './palette.js';
import {
  wall, wallDoor, glassWall, floorField, slab, workstation, chairGuest, chairTask, confTable,
  whiteboard, wallTV, signBoard, plantTall, trashBin, troffer, fileCab, shelfUnit,
  serverRack, copier, waterCooler, vending, couch, cubeWall, stairs, rug,
  receptionDesk, counterRun, fridge, microwave, coffeeMaker, lockers, phoneBooth,
  barCounter, stool, tableRound, pinBoard, supplyShelf, standDesk, plantBasket,
  STOREY, FLOOR_Y, DESK_Y,
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
  { name: '1F · 로비 / 개발실', short: '로비·개발', role: 'dev', accent: P.accent },
  { name: '2F · 개발실', short: '개발실', role: 'dev', accent: '#3f6a5a' },
  { name: '3F · 기획실', short: '기획실', role: 'plan', accent: '#6a5a3f' },
  { name: '4F · 아트 / 사운드', short: '아트·사운드', role: 'art', accent: '#5a3f6a' },
  { name: '5F · 네트워크실', short: '네트워크실', role: 'net', accent: '#3f5a6a' },
];

const CORE = { x0: 27, x1: 39, z0: 17, z1: 27 };   // lift + stair core
const MR = { x0: 45, x1: 62, z0: 2, z1: 16 };      // meeting room
const BR = { x0: 2, x1: 18, z0: 29, z1: 42 };      // break room + pantry

function inRect(r, x, z, pad = 0) {
  return x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;
}

/* Translate a sub-mesh built at ground level up to a floor. Building props in
   their own MeshBuilder and lifting them keeps every prop function free of a
   base-height argument it would otherwise have to thread everywhere. */
function liftInto(m, sub, base) {
  for (let i = 1; i < sub.p.length; i += 3) sub.p[i] += base;
  for (let i = 1; i < sub.solids.length; i += 6) { sub.solids[i] += base; sub.solids[i + 3] += base; }
  m.append(sub);
}

/* ---------- one floor ---------- */
function buildFloor(m, fi, plan, out) {
  const B = BUILDING;
  const base = fi * B.storey;
  const rnd = mulberry32(0x9e37 + fi * 7919);
  const wallH = B.wallH;
  const isGround = fi === 0;

  const put = (fn) => { const s = new MeshBuilder(); fn(s); liftInto(m, s, base); };

  /* ---- slab and floor finishes ---- */
  m.flag = 3;
  floorField(m, B.x0, B.z0, B.x1, B.z1, isGround ? P.carpetWarm : P.carpet, 4, base + FLOOR_Y);
  // Hard floor where people walk in wet shoes or spill coffee, exactly as a
  // real fit-out would zone it.
  floorField(m, BR.x0, BR.z0, BR.x1, BR.z1, P.tile, 2.5, base + FLOOR_Y + 0.01);
  if (isGround) floorField(m, 22, 27.5, 44, 36, P.tile, 2.5, base + FLOOR_Y + 0.01);
  m.flag = 0;

  /* ---- perimeter: glass north and south, solid east and west ---- */
  glassWall(m, B.x0, B.z0, B.x1, B.z0, wallH, 0.9, base);
  glassWall(m, B.x0, B.z1, B.x1, B.z1, wallH, 0.9, base);
  wall(m, B.x0, B.z0, B.x0, B.z1, wallH, B.thick, P.wall, false, base);
  wall(m, B.x1, B.z0, B.x1, B.z1, wallH, B.thick, P.wall, false, base);

  /* ---- service core ---- */
  m.flag = 1;
  wall(m, CORE.x0, CORE.z0, CORE.x1, CORE.z0, wallH, 0.6, plan.accent, true, base);
  wall(m, CORE.x0, CORE.z1, CORE.x1, CORE.z1, wallH, 0.6, plan.accent, true, base);
  wall(m, CORE.x0, CORE.z0, CORE.x0, CORE.z1, wallH, 0.6, P.wallDk, true, base);
  wallDoor(m, CORE.x1, CORE.z0, CORE.x1, CORE.z1, wallH, 0.6, P.wallDk, 5, 4, 6.4, 0.9);
  m.flag = 0;

  put((s) => {
    // lift doors facing the north lobby strip
    s.mat = MAT.METAL;
    for (let i = 0; i < 2; i++) s.box(CORE.x0 + 2.5 + i * 3.8, 3.4, CORE.z0 - 0.5, 3.4, 6.8, 0.30, P.chrome);
    s.mat = MAT.SCREEN;
    s.noSolid = true;
    for (let i = 0; i < 2; i++) s.box(CORE.x0 + 2.5 + i * 3.8, 7.3, CORE.z0 - 0.62, 0.9, 0.5, 0.06, '#ffb45a');
    s.noSolid = false;
    s.mat = 0;
    // The flight lives inside the core, east of the lifts. Eleven treads at 0.8
    // fit the core's ten-unit depth; a longer run would spill onto the floor.
    if (fi < FLOOR_PLANS.length - 1) {
      stairs(s, CORE.x1 - 3.0, CORE.z0 + 1.0, 0, 11, 0.8, B.storey / 11, 4.0);
    }
  });
  signBoard(m, CORE.x0 + 6, base + 9.0, CORE.z0 - 0.75, -Math.PI / 2, 8, 1.6, plan.accent);

  /* ---- meeting room ---- */
  m.flag = 1;
  glassWall(m, MR.x0, MR.z0, MR.x0, MR.z1, wallH, 0, base);
  // Swings INTO the room (negative angle). Opening outward parked the leaf
  // across the corridor that serves the desks east of it and stranded them.
  wallDoor(m, MR.x0, MR.z1, MR.x1, MR.z1, wallH, 0.5, P.wall, 5, 4.5, 6.4, -1.0);
  m.flag = 0;

  const mcx = (MR.x0 + MR.x1) / 2, mcz = (MR.z0 + MR.z1) / 2 + 1;
  const seats = [];
  let headSeat = null;
  put((s) => {
    confTable(s, mcx, mcz, 0, 9.5, 4.6);
    // Three a side, plus the head of the table. yaw is the rig facing; the
    // chair takes yaw - PI/2 so the person never sits backwards.
    for (let i = 0; i < 3; i++) {
      const sz = mcz - 3.2 + i * 3.2;
      seats.push({ x: mcx - 3.7, z: sz, yaw: Math.PI / 2 });    // west side, faces +x
      seats.push({ x: mcx + 3.7, z: sz, yaw: -Math.PI / 2 });   // east side, faces -x
    }
    for (const st of seats) chairGuest(s, st.x, st.z, st.yaw - Math.PI / 2, P.chairB);
    // Head of the table, under the screen: where the boss sits.
    headSeat = { x: mcx, z: mcz - 6.2, yaw: 0 };                // faces +z
    chairGuest(s, headSeat.x, headSeat.z, headSeat.yaw - Math.PI / 2, P.chairR);

    s.mat = MAT.PAPER;
    for (let i = 0; i < 5; i++) {
      s.boxY(mcx + (i % 2 ? 1.5 : -1.5), DESK_Y + 0.16, mcz - 3.0 + i * 1.6, 1.4, 0.05, 1.1,
        (rnd() - 0.5) * 0.3, P.paper);
    }
    s.mat = 0;
    for (let i = 0; i < 3; i++) {
      s.mat = MAT.GLOSS;
      s.cyl(mcx + (i - 1) * 2.4, DESK_Y + 0.4, mcz + 2.6, 0.28, 0.6, ['#e8e4d8', '#c95f4f', '#4f7fc9'][i], 10);
      s.mat = 0;
    }
  });
  whiteboard(m, MR.x1 - 0.5, base + 6.4, mcz + 2, Math.PI, 8, 4.4);
  wallTV(m, mcx, base + 6.6, MR.z0 + 0.45, Math.PI / 2, 7.0, 4.0);
  out.rooms.push({ name: '회의실', x: mcx, y: base + 8.4, z: mcz, floor: fi });
  out.meetings.push({
    id: `mtg${fi}`, floor: fi,
    center: [mcx, base + 5.5, mcz],
    seats: seats.map((s) => ({ ...s, floor: fi })),
    head: { ...headSeat, floor: fi },
    door: { x: MR.x0 + 5, z: MR.z1 + 2.2 },
  });

  /* ---- break room and pantry ---- */
  m.flag = 1;
  wall(m, BR.x1, BR.z0, BR.x1, BR.z1, wallH, 0.5, P.wallWarm, true, base);
  wallDoor(m, BR.x0, BR.z0, BR.x1, BR.z0, wallH, 0.5, P.wallWarm, 9, 5, 6.4, 1.1);
  m.flag = 0;
  rug(m, 8, 38.5, 10, 6.5, P.rug);
  put((s) => {
    // Pantry down the west wall, seating down the east, and a clear lane at
    // x 6-11 straight in from the door so the room is one connected space.
    counterRun(s, BR.x0 + 1.6, 35, -Math.PI / 2, 9, true);
    coffeeMaker(s, BR.x0 + 1.7, 3.1, 31.6, -Math.PI / 2);
    microwave(s, BR.x0 + 1.7, 3.1, 38.2, -Math.PI / 2);
    fridge(s, BR.x0 + 1.7, 41.0, -Math.PI / 2);
    tableRound(s, 14.2, 33.0, 1.8);
    for (let i = 0; i < 3; i++) {
      const a = i * 2.094 + 1.1;
      stool(s, 14.2 + Math.cos(a) * 2.9, 33.0 + Math.sin(a) * 2.9);
    }
    couch(s, 14.6, 39.6, Math.PI, 2, P.couch);
    waterCooler(s, BR.x1 - 1.6, 30.4);
    vending(s, BR.x1 - 1.8, 41.0, -Math.PI / 2);
    trashBin(s, 11.6, 41.4);
    plantBasket(s, 4.0, 30.2, 0.95);
  });
  pinBoard(m, BR.x1 - 0.35, base + 5.6, 36.5, Math.PI, 5.5, 3.4);
  out.rooms.push({ name: '휴게실', x: 9.5, y: base + 8.0, z: 36, floor: fi });
  out.spots.push(
    { kind: 'coffee', floor: fi, x: 6.6, z: 31.8, yaw: -Math.PI / 2 },
    { kind: 'water', floor: fi, x: BR.x1 - 3.8, z: 30.6, yaw: Math.PI / 2 },
    { kind: 'sofa', floor: fi, x: 10.6, z: 39.4, yaw: Math.PI / 2 },
    { kind: 'table', floor: fi, x: 10.4, z: 33.2, yaw: Math.PI / 2 },
  );

  /* ---- reception, ground floor only ----
     Everything here stays south of z = 31.5. The strip z 27.5–31.5 is the
     floor's only full-width cross corridor, and furniture placed in it — a
     counter, a plant, a waiting couch — severs the north half of the building
     from the south half. */
  if (isGround) {
    put((s) => {
      receptionDesk(s, 33, 34.0, Math.PI / 2, 9);          // faces +z, toward the doors
      chairTask(s, 33, 37.0, -Math.PI / 2, P.chairG);
      couch(s, 22.0, 35.0, Math.PI / 2, 2, '#5a4f63');
      tableRound(s, 25.6, 35.0, 1.5);
      plantTall(s, 39.5, 35.0, 1.05);
      plantTall(s, 19.0, 39.5, 1.05);
      barCounter(s, 32, 3.0, Math.PI / 2, 16);             // window bar on the north glass
      for (let i = 0; i < 5; i++) stool(s, 26 + i * 3, 5.0);
    });
    signBoard(m, 33, base + 7.6, 31.6, Math.PI / 2, 11, 2.1, plan.accent);
    out.rooms.push({ name: '리셉션', x: 33, y: base + 6.5, z: 34, floor: fi });
    out.spots.push({ kind: 'window', floor: fi, x: 32, z: 6.2, yaw: 0 });
  } else {
    put((s) => {
      barCounter(s, 32, 3.0, Math.PI / 2, 20);
      for (let i = 0; i < 6; i++) stool(s, 24 + i * 3.2, 5.0);
    });
    out.spots.push({ kind: 'window', floor: fi, x: 30, z: 6.2, yaw: 0 });
  }

  /* ---- amenities down the east side of the core ---- */
  put((s) => {
    // Everything here hugs a wall or a corner: the east spine (x 40–44.5) and
    // the cross corridors have to stay clear or the floor stops connecting.
    lockers(s, 3.6, 24.5, 0, 4);              // west wall, clear of the core
    phoneBooth(s, 60.0, 21.5, Math.PI);
    phoneBooth(s, 60.0, 27.5, Math.PI);
    copier(s, 45.0, 41.2, 0);
    supplyShelf(s, 49.5, 41.4, 0);
    trashBin(s, 41.5, 41.4);
    shelfUnit(s, 20.5, 2.6, Math.PI / 2, 7, 6.5, true);
    fileCab(s, 62.0, 33, Math.PI, 4, 2.4);
    fileCab(s, 62.0, 36, Math.PI, 4, 2.4);
    plantTall(s, 62.0, 41.0, 1.15);
    plantTall(s, 2.8, 17.5, 1.0);
    if (fi >= 2) standDesk(s, 33, 30.0, Math.PI);
  });
  out.spots.push(
    { kind: 'printer', floor: fi, x: 45.0, z: 38.4, yaw: Math.PI },
    { kind: 'locker', floor: fi, x: 7.0, z: 24.5, yaw: -Math.PI / 2 },
  );

  if (plan.role === 'net') {
    put((s) => { for (let i = 0; i < 4; i++) serverRack(s, 50 + i * 3.4, 24, 0); });
    out.rooms.push({ name: '서버실', x: 55, y: base + 8.0, z: 24, floor: fi });
  }

  /* ---- desk field ----
     Desks are placed in PODS separated by corridors, not as a continuous band.
     A 5.4-wide desk every 6.6 units leaves a 1.2 gap, which the navigation
     grid's body dilation closes — so a solid band of them is a wall, and the
     floor becomes unwalkable. Aisles have to be designed in, not hoped for.

     Reserved circulation, in world units:
       z 6.5–9.5   north walk lane, behind the window bar
       z 16.5–20   cross corridor between the north and middle pods
       z 27.5–31.5 cross corridor between the middle and south pods
       x 21–25.5   west spine        x 40–44.5  east spine (lift core to rooms)
  */
  // Chairs sit 2.6 behind the desk and are themselves obstacles, so a pod needs
  // roughly 4 units of clear floor behind it. The strip directly north of the
  // lift core has no room for that and is left as lobby.
  const PODS = isGround ? [
    { z: 11.0, ry: 0, xs: [7.5, 14.1] },
    { z: 23.0, ry: Math.PI, xs: [7.5, 14.1] },
    { z: 23.0, ry: Math.PI, xs: [48.0, 54.6] },
    // No south pod on the ground floor: that half is reception, lounge and the
    // print bay, and desks there would leave nowhere to walk.
  ] : [
    { z: 11.0, ry: 0, xs: [7.5, 14.1] },
    { z: 11.0, ry: 0, xs: [28.5, 35.1] },
    { z: 23.0, ry: Math.PI, xs: [7.5, 14.1] },
    { z: 23.0, ry: Math.PI, xs: [48.0, 54.6] },
    { z: 36.0, ry: Math.PI, xs: [25.0, 31.6] },
    { z: 36.0, ry: Math.PI, xs: [48.0, 54.6] },
  ];

  let slot = 0;
  for (const pod of PODS) {
    for (const x of pod.xs) {
      const variant = Math.floor(rnd() * 4);
      const dual = rnd() > 0.45;
      put((s) => workstation(s, x, pod.z, pod.ry, variant, dual));
      out.desks.push({
        id: `f${fi}s${slot++}`,
        floor: fi, role: plan.role,
        x, z: pod.z, ry: pod.ry,
        // The chair sits 2.6 behind the desk; the rig faces the desk, so its
        // yaw is the desk's rotation turned around.
        seatX: x + 2.6 * Math.sin(pod.ry),
        seatZ: pod.z + 2.6 * Math.cos(pod.ry),
        yaw: pod.ry + Math.PI,
        y: base,
      });
    }
    // A low screen at the end of each pod, clear of the aisle.
    put((s) => cubeWall(s, pod.xs[pod.xs.length - 1] + 3.6, pod.z, pod.ry, 3.0, 3.6));
  }

  /* ---- ceiling lights + the slab above ---- */
  for (let x = 6; x < 62; x += 10) {
    for (let z = 5; z < 42; z += 8.5) {
      if (inRect(CORE, x, z, 1)) continue;
      troffer(m, x, z, 0, base + B.storey);
    }
  }
  slab(m, B.x0 - 1, B.z0 - 1, B.x1 + 1, B.z1 + 1, base + B.storey - 0.3);

  out.rooms.push({ name: plan.short, x: 20, y: base + 9.0, z: 14, floor: fi });
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
  m.box(32, -0.55, 78, 200, 1, 46, P.asphalt);           // the street
  m.mat = 0;
  m.noSolid = false;

  // Exterior piers between the glazing. Flag 3, not 1: they are thin enough to
  // see between, so putting them in the wall cut only speckles the facade with
  // dither without revealing anything.
  m.flag = 3;
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
  const out = { desks: [], rooms: [], meetings: [], spots: [] };
  const n = Math.max(1, Math.min(FLOOR_PLANS.length, floorCount));
  for (let fi = 0; fi < n; fi++) buildFloor(m, fi, FLOOR_PLANS[fi], out);
  buildSite(m, n);
  return { mesh: m, ...out, floors: n };
}

export { STOREY, CORE, MR, BR };
