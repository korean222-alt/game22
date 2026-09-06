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
import { buildCity } from './city.js';
import {
  wall, wallDoor, glassWall, doorway, floorField, slab, chairGuest, chairTask, confTable,
  whiteboard, wallTV, signBoard, plantTall, trashBin, troffer, fileCab, shelfUnit,
  serverRack, copier, waterCooler, vending, couch, stairs, rug,
  receptionDesk, counterRun, fridge, microwave, coffeeMaker, lockers, phoneBooth,
  barCounter, stool, tableRound, pinBoard, supplyShelf, plantBasket,
  STOREY, FLOOR_Y, DESK_Y, CEIL_FLAG,
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
/* The front doors, in the south glass on the ground floor. People you hire walk
   in through here and people who leave walk out through here, so the roster
   changing is something you watch happen rather than a number ticking. */
const DOOR = { x0: 29.5, x1: 36.5 };

/* ---------- 열린 문의 각도 ----------
   문짝은 한쪽 문설주에 경첩이 달려 있고, 0 이면 출입구를 막고 PI 면 옆 벽에
   납작하게 붙는다. 1.0 라디안(57°)으로 서 있던 동안 폭 4.5 · 높이 6.4 짜리
   판이 방 안쪽으로 3.8 유닛이나 튀어나와 있었다 — 화면에서는 바닥 한복판에
   갈색 판때기가 떠 있는 것으로 보였고, 실제로 "사물이 겹쳐 보인다" 는 말이
   가리킨 것 중 하나가 이것이다. 2.85 는 벽에 거의 붙은 채로 활짝 열린
   각도다: 문이 거기 있다는 것은 보이고, 통로는 비어 있다. */
const DOOR_OPEN = 2.85;

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
  if (isGround) {
    // Two runs of glass with the entrance between them. The sill is dropped to
    // zero either side of the opening so the doorway reads as a way in rather
    // than as a missing pane.
    glassWall(m, B.x0, B.z1, DOOR.x0, B.z1, wallH, 0.9, base);
    glassWall(m, DOOR.x1, B.z1, B.x1, B.z1, wallH, 0.9, base);
    put((s) => doorway(s, (DOOR.x0 + DOOR.x1) / 2, B.z1, Math.PI / 2,
      DOOR.x1 - DOOR.x0, 7.0, P.frame));
    out.entrance = {
      floor: fi,
      x: (DOOR.x0 + DOOR.x1) / 2, z: B.z1 - 2.6, yaw: Math.PI,   // just inside, facing north
      outX: (DOOR.x0 + DOOR.x1) / 2, outZ: B.z1 + 3.0,
    };
    out.rooms.push({ name: '정문', x: (DOOR.x0 + DOOR.x1) / 2, y: base + 5.0, z: B.z1 - 1.2, floor: fi });
  } else {
    glassWall(m, B.x0, B.z1, B.x1, B.z1, wallH, 0.9, base);
  }
  wall(m, B.x0, B.z0, B.x0, B.z1, wallH, B.thick, P.wall, false, base);
  wall(m, B.x1, B.z0, B.x1, B.z1, wallH, B.thick, P.wall, false, base);

  /* ---- service core ---- */
  m.flag = 1;
  wall(m, CORE.x0, CORE.z0, CORE.x1, CORE.z0, wallH, 0.6, plan.accent, true, base);
  wall(m, CORE.x0, CORE.z1, CORE.x1, CORE.z1, wallH, 0.6, plan.accent, true, base);
  wall(m, CORE.x0, CORE.z0, CORE.x0, CORE.z1, wallH, 0.6, P.wallDk, true, base);
  wallDoor(m, CORE.x1, CORE.z0, CORE.x1, CORE.z1, wallH, 0.6, P.wallDk, 5, 4, 6.4, DOOR_OPEN);
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
    // 계단은 코어의 **서쪽**에 붙는다. 예전에는 동쪽(CORE.x1 - 3)에 있었는데,
    // 코어로 들어오는 문이 바로 그 동쪽 벽에 있다. 문을 열면 눈앞이 계단
    // 옆구리였고, 층을 오르려는 사람이 매번 계단을 돌아 나가야 했다.
    // 열한 단 × 0.8 은 코어의 깊이(10)에 맞춘 길이다.
    if (fi < FLOOR_PLANS.length - 1) {
      stairs(s, CORE.x0 + 3.0, CORE.z0 + 1.0, 0, 11, 0.8, B.storey / 11, 4.0);
    }
  });
  signBoard(m, CORE.x0 + 6, base + 9.0, CORE.z0 - 0.75, -Math.PI / 2, 8, 1.6, plan.accent);

  /* ---- meeting room ---- */
  m.flag = 1;
  glassWall(m, MR.x0, MR.z0, MR.x0, MR.z1, wallH, 0, base);
  // Swings INTO the room (negative angle). Opening outward parked the leaf
  // across the corridor that serves the desks east of it and stranded them.
  wallDoor(m, MR.x0, MR.z1, MR.x1, MR.z1, wallH, 0.5, P.wall, 5, 4.5, 6.4, -DOOR_OPEN);
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
  wallDoor(m, BR.x0, BR.z0, BR.x1, BR.z0, wallH, 0.5, P.wallWarm, 9, 5, 6.4, DOOR_OPEN);
  m.flag = 0;
  rug(m, 8, 38.5, 10, 6.5, P.rug);
  put((s) => {
    /* 문 앞을 비우는 것이 이 방의 유일한 규칙이다.

       예전에는 조리대가 방을 가로질러 놓여 있었고(회전이 90도 틀어져 있었다),
       원탁의 스툴 하나가 문 바로 안쪽 x 11 에 서 있었다. 둘이 겹쳐서 폭
       2 유닛짜리 틈만 남았고, 반지름 0.9 짜리 몸은 그 틈을 통과하지 못했다 —
       휴게실 문이 열려 있는데 들어갈 수가 없었던 이유다.

       지금은 조리대가 서쪽 벽을 따라 세로로 서고(원래 의도), 앉는 자리는
       전부 동쪽으로 물러났다. 문(x 8.5~13.5)에서 소파까지 x 9~12 가
       세로로 뚫려 있다. */
    counterRun(s, BR.x0 + 1.7, 35, 0, 9, true);          // 서쪽 벽, z 30.5~39.5
    coffeeMaker(s, BR.x0 + 1.7, 3.1, 31.6, 0);
    microwave(s, BR.x0 + 1.7, 3.1, 38.2, 0);
    fridge(s, BR.x0 + 1.7, 41.0, 0);
    tableRound(s, 14.0, 34.6, 1.7);
    // 스툴은 동쪽 반원에만. 서쪽으로 돌면 그게 곧 문 앞이다.
    for (const a of [-0.9, 0.5, 2.0]) {
      stool(s, 14.0 + Math.cos(a) * 2.7, 34.6 + Math.sin(a) * 2.7);
    }
    couch(s, 14.6, 39.6, Math.PI, 2, P.couch);
    waterCooler(s, BR.x1 - 1.6, 30.4);
    vending(s, BR.x1 - 1.8, 41.0, -Math.PI / 2);
    trashBin(s, 11.6, 41.4);
    plantBasket(s, 6.2, 30.4, 0.95);
  });
  pinBoard(m, BR.x1 - 0.35, base + 5.6, 36.5, Math.PI, 5.5, 3.4);
  out.rooms.push({ name: '휴게실', x: 9.5, y: base + 8.0, z: 36, floor: fi });
  out.spots.push(
    { kind: 'coffee', floor: fi, x: 6.6, z: 31.8, yaw: -Math.PI / 2 },
    { kind: 'water', floor: fi, x: BR.x1 - 3.8, z: 30.6, yaw: Math.PI / 2 },
    { kind: 'sofa', floor: fi, x: 10.6, z: 39.4, yaw: Math.PI / 2 },
    { kind: 'table', floor: fi, x: 11.4, z: 34.6, yaw: Math.PI / 2 },
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

  /* ---- amenities down the east side of the core ----

     설비는 벽이나 구석에 붙되, **배치 구역(PLACE_ZONES) 안에는 들어가지
     않는다**. 예전에는 사물함이 서쪽 베이 한복판에, 폰 부스 둘이 동쪽 베이
     안에, 서류함 둘이 남동쪽 베이 안에 서 있었다. 그 자리에 책상을 놓으려
     하면 유령이 빨갛게 변하는데 화면에는 파란 바닥밖에 안 보였고, 놓인
     가구와 설비가 눈으로는 겹쳐 보였다. 지금은 구역이 곧 빈 바닥이다. */
  put((s) => {
    // 사물함은 서쪽 베이가 아니라 그 위의 가로 복도(z 16.5–20)로 옮겼다.
    // 90도 돌려서 복도 방향으로 눕히면 깊이 1.9 만 먹는다.
    lockers(s, 8.0, 18.2, Math.PI / 2, 4);
    // 폰 부스는 동쪽 벽에 그대로. 대신 동쪽 베이가 x 57.5 에서 끝난다.
    phoneBooth(s, 60.0, 21.5, Math.PI);
    phoneBooth(s, 60.0, 27.5, Math.PI);
    copier(s, 45.0, 41.2, 0);
    supplyShelf(s, 49.5, 41.4, 0);
    trashBin(s, 41.5, 41.4);
    shelfUnit(s, 20.5, 2.6, Math.PI / 2, 7, 6.5, true);
    fileCab(s, 62.0, 33, Math.PI, 4, 2.4);
    fileCab(s, 62.0, 36, Math.PI, 4, 2.4);
    plantTall(s, 62.0, 41.0, 1.15);
    // 잎이 반지름 1.9 만큼 퍼진다. z 17.5 에서는 북서쪽 베이(z ≤ 16) 안으로
    // 잎이 넘어와 책상과 겹쳐 보였다.
    plantTall(s, 2.8, 18.2, 1.0);
  });
  out.spots.push(
    { kind: 'printer', floor: fi, x: 45.0, z: 38.4, yaw: Math.PI },
    // 사물함 앞. 복도 쪽에서 북쪽(-Z)을 보고 선다.
    { kind: 'locker', floor: fi, x: 8.0, z: 20.2, yaw: Math.PI },
  );

  if (plan.role === 'net') {
    put((s) => { for (let i = 0; i < 4; i++) serverRack(s, 50 + i * 3.4, 24, 0); });
    out.rooms.push({ name: '서버실', x: 55, y: base + 8.0, z: 24, floor: fi });
  }

  /* ---- the desk field is no longer generated ----
     Desks used to be laid out here in pods. They are now bought and placed by
     the player, which is why a new studio opens onto bare floor plate: the
     first spending decision is how many people you can afford to seat.

     What the generator still owes the placement system is honest circulation.
     These lanes are left permanently clear, and PLACE_ZONES below describes the
     bays between them — the rectangles a desk is expected to land in:
       z 6.5–9.5   north walk lane, behind the window bar
       z 16.5–20   cross corridor between the north and middle bays
       z 27.5–31.5 cross corridor between the middle and south bays
       x 21–25.5   west spine        x 40–44.5  east spine (lift core to rooms)

     Nothing enforces them. A player who walls off a corridor gets staff who
     cut straight to their desk instead of walking, which is a fair price for
     being allowed to arrange your own office. */

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
  // 아스팔트. city.js 의 차선·연석이 x −110…180 을 덮으므로 같은 폭이어야
  // 한다. 200 이던 동안 길 끝에서 노란 선이 허공으로 이어졌다.
  m.box(35, -0.55, 78, 290, 1, 46, P.asphalt);           // the street
  m.mat = 0;
  m.noSolid = false;

  // Exterior piers between the glazing. Flag 3, not 1: they are thin enough to
  // see between, so putting them in the wall cut only speckles the facade with
  // dither without revealing anything.
  // CEIL_FLAG: 층 자르기에서 **디더 없이** 잘린다. 3 이던 동안 기둥의 위쪽
  // 0.7 유닛이 페이드 구간에 걸려 외벽마다 흰 점이 얼룩졌다.
  m.flag = CEIL_FLAG;
  m.mat = MAT.WALL;
  for (let x = -2; x <= 66; x += 8) {
    m.box(x, top / 2, -1.6, 2.2, top, 2.2, P.extWall);
    m.box(x, top / 2, 45.6, 2.2, top, 2.2, P.extWall);
  }
  m.box(-1.6, top / 2, 22, 2.4, top, 48, P.extWall);
  m.box(65.6, top / 2, 22, 2.4, top, 48, P.extWall);
  // A parapet RING, not a cap: a solid roof slab would fill the frame. CEIL_FLAG,
  // not SITE, so looking at a lower floor removes it instead of leaving it
  // hanging — and removes it cleanly rather than in a dithered band.
  m.flag = CEIL_FLAG;
  m.mat = MAT.WALL;
  for (const [cx, cz, w, d] of [[32, -2.2, 70, 2.4], [32, 46.2, 70, 2.4],
                                [-2.2, 22, 2.4, 50], [66.2, 22, 2.4, 50]]) {
    m.noSolid = true;
    m.box(cx, top + 1.0, cz, w, 2.0, d, P.roof);
    m.noSolid = false;
  }
  m.mat = 0;
  m.flag = 0;

  /* ── 이웃 ──
     창밖이 빈 회색 판이면 사무실이 우주에 떠 있는 것으로 보인다.

     Kenney City Kit 이 와 있으면 진짜 도시(`world/city.js`)를 세우고,
     아직 안 왔으면 예전의 상자 스카이라인으로 되돌아간다. 첫 실행에서
     네트워크가 느린 것이 "창밖이 비었다" 로 보이면 안 된다. */
  m.flag = SITE;
  m.mat = MAT.WALL;
  m.noSolid = true;
  if (!buildCity(m)) {
    const rnd = mulberry32(4242);
    for (let i = 0; i < 14; i++) {
      const a = rnd() * 6.2831853;
      const r = 120 + rnd() * 110;
      const bx = 32 + Math.cos(a) * r, bz = 22 + Math.sin(a) * r;
      if (Math.abs(bz - 78) < 30 && Math.abs(bx - 32) < 90) continue;
      const h = 24 + rnd() * 90, w = 18 + rnd() * 26, d = 18 + rnd() * 26;
      m.box(bx, h / 2, bz, w, h, d, rnd() > 0.5 ? '#9aa0a8' : '#a8a094');
    }
  }
  m.noSolid = false;
  m.mat = 0;
  m.flag = 0;
}

/* ---------- where furniture may go ----------
   The bays between the reserved circulation lanes, in world coordinates. The
   placement UI draws these as the buildable area and refuses drops outside
   them, so a player cannot park a desk inside the lift core, in a doorway, or
   halfway through the meeting room glass — none of which the collision test
   against the building's own solids would catch on its own, because a doorway
   is empty space.

   The ground floor loses its south bay: that half is reception and lounge. */
export const PLACE_ZONES = {
  ground: [
    { x0: 3.0, z0: 4.0, x1: 20.5, z1: 16.0 },      // north-west bay
    { x0: 45.5, z0: 17.5, x1: 57.5, z1: 27.0 },    // east bay (폰 부스 앞에서 끝난다)
    { x0: 3.0, z0: 20.5, x1: 20.5, z1: 27.0 },     // west bay
  ],
  upper: [
    { x0: 3.0, z0: 4.0, x1: 20.5, z1: 16.0 },
    // 창가 바 테이블과 스툴이 z 5 에 서 있다. 예전에는 이 베이가 z 4 에서
    // 시작해 스툴을 통째로 삼켰다.
    { x0: 26.0, z0: 7.0, x1: 39.5, z1: 16.0 },
    { x0: 3.0, z0: 20.5, x1: 20.5, z1: 27.0 },
    { x0: 45.5, z0: 17.5, x1: 57.5, z1: 27.0 },
    { x0: 21.0, z0: 32.0, x1: 39.5, z1: 42.0 },
    // 서류함(동쪽)과 비품 선반(남쪽) 앞에서 끝난다.
    { x0: 45.5, z0: 32.0, x1: 59.5, z1: 38.5 },
  ],
};

export function placeZones(floor) {
  return floor === 0 ? PLACE_ZONES.ground : PLACE_ZONES.upper;
}

/* Is this footprint entirely inside one bay? Split footprints are rejected on
   purpose: a desk half in a corridor reads as a mistake either way. */
export function inPlaceZone(floor, x, z, w, d) {
  const hw = w / 2, hd = d / 2;
  return placeZones(floor).some((r) =>
    x - hw >= r.x0 - 0.01 && x + hw <= r.x1 + 0.01 && z - hd >= r.z0 - 0.01 && z + hd <= r.z1 + 0.01);
}

/* ---------- entry point ---------- */
export function buildOffice(floorCount = FLOOR_PLANS.length) {
  const m = new MeshBuilder();
  const out = { desks: [], rooms: [], meetings: [], spots: [], entrance: null };
  const n = Math.max(1, Math.min(FLOOR_PLANS.length, floorCount));
  for (let fi = 0; fi < n; fi++) buildFloor(m, fi, FLOOR_PLANS[fi], out);
  buildSite(m, n);
  return { mesh: m, ...out, floors: n };
}

export { STOREY, CORE, MR, BR };
