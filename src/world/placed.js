/* Turning the player's furniture list into geometry.

   `buildPlaced` walks the saved list and calls the same prop functions the
   office generator uses, into a MeshBuilder of its own. That separation is the
   point: the building is uploaded once at boot and never touched, while this
   mesh is thrown away and rebuilt every time something is moved — a few hundred
   triangles, cheap enough to do on every drag frame of the placement ghost.

   It also emits the desk slots the staff system assigns people to. Desks are no
   longer generated with the floor; a desk exists because the player bought one
   and put it down, which is what makes hiring cost furniture as well as salary.

   This is the one place `world/` reaches into `game/`. It reads the furniture
   catalogue — which piece is a workstation, how big it is — and nothing else.
   `game/furniture.js` is pure data with no imports of its own, so this adds no
   cycle and cannot drag DOM or WebGL into the simulation; the alternative,
   threading the catalogue through every caller including the headless sims,
   costs more than the boundary is worth here. */

import { MeshBuilder } from '../core/meshbuilder.js';
import { MAT } from '../core/color.js';
import { P } from './palette.js';
import { FURNITURE_BY_ID } from '../game/furniture.js';
import { kitPut } from './kit.js';
import { FLOOR_PLANS } from './office.js';
import {
  workstation, standDesk, cubeWall, shelfUnit, fileCab, supplyShelf, lockers,
  plantBasket, plantTall, couch, tableRound, coffeeMaker, waterCooler, vending,
  rug, whiteboard, pinBoard, serverRack, copier, phoneBooth, counterRun,
  STOREY,
} from './props.js';

/* Each entry draws one piece at the origin-relative position it was placed at.
   `ry` is the piece's own rotation; a workstation's occupant faces the desk, so
   the seat is derived from it rather than stored. */
const DRAW = {
  desk: (m, x, z, ry, i) => workstation(m, x, z, ry, i % 4, false),
  deskDual: (m, x, z, ry, i) => workstation(m, x, z, ry, i % 4, true),
  standDesk: (m, x, z, ry, i) => standDesk(m, x, z, ry, i),
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
  // Quarter turns swap the rug's two dimensions; nothing else about it changes.
  rug: (m, x, z, ry) => {
    const turned = Math.abs(Math.sin(ry)) > 0.5;
    rug(m, x, z, turned ? 6 : 8, turned ? 8 : 6, P.rug);
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

  /* ---- 수입 가구 ----
     한 조각이 아니라 세트로 놓는다. 책상만 덜렁 놓으면 그 위에 아무것도 없고
     앉을 것도 없어서, 산 사람 눈에는 미완성으로 보인다.

     로컬 좌표는 props 와 같은 뜻이다: R(lx, lz) 의 +Z 가 가구의 앞쪽,
     즉 사람이 앉는 쪽이다. 모니터는 -Z(안쪽), 의자는 +Z(바깥쪽). */
  kitDesk: (m, x, z, ry, i) => {
    const R = at(x, z, ry);
    kitPut(m, 'desk', x, z, ry + Math.PI);
    const scr = R(0, -0.7); kitPut(m, 'computerScreen', scr[0], scr[1], ry, SCREEN_ON_DESK);
    const kb = R(0, 0.5); kitPut(m, 'computerKeyboard', kb[0], kb[1], ry, { y: DESK_TOP, solid: false });
    const ms = R(1.3, 0.5); kitPut(m, 'computerMouse', ms[0], ms[1], ry, { y: DESK_TOP, solid: false });
    // 의자의 등받이는 모델 +Z 다. ry 그대로 놓아야 등을 책상 반대쪽으로 두고
    // 앉는다 — +PI 를 주면 책상을 등지고 앉는다.
    const ch = R(0, 2.4); kitPut(m, 'chairDesk', ch[0], ch[1], ry, chairSwap(i));
  },
  /* 코너 책상은 팩 모델이 6.24 × 6.24 로, 가장 얕은 배치 구역(깊이 6.5)에
     의자까지 얹으면 들어갈 자리가 없었다. CORNER 배율로 줄여서 발자국
     5.8 × 5.8 안에 상판과 의자가 모두 들어오게 맞춘다 — 카탈로그의 w/d 와
     화면에 그려지는 크기는 같아야 한다. */
  kitDeskCorner: (m, x, z, ry, i) => {
    const R = at(x, z, ry);
    const s = CORNER;
    kitPut(m, 'deskCorner', x, z, ry + Math.PI, { s });
    const a = R(-1.1, -0.8), b = R(1.2, -0.8);
    kitPut(m, 'computerScreen', a[0], a[1], ry + 0.2, { ...SCREEN_ON_DESK, s, y: DESK_TOP * s });
    kitPut(m, 'computerScreen', b[0], b[1], ry - 0.2, { ...SCREEN_ON_DESK, s, y: DESK_TOP * s });
    const kb = R(0, 0.35);
    kitPut(m, 'computerKeyboard', kb[0], kb[1], ry, { y: DESK_TOP * s, solid: false, s });
    const ch = R(0.2, 1.9); kitPut(m, 'chairDesk', ch[0], ch[1], ry, { ...chairSwap(i), s });
  },
  kitBookcase: (m, x, z, ry) => {
    kitPut(m, 'bookcaseOpen', x, z, ry);
    const R = at(x, z, ry);
    const p = R(0, -0.1); kitPut(m, 'books', p[0], p[1], ry, { y: 3.6, solid: false });
  },
  kitCabinet: (m, x, z, ry) => kitPut(m, 'bookcaseClosedDoors', x, z, ry),
  kitSideTable: (m, x, z, ry) => {
    kitPut(m, 'sideTableDrawers', x, z, ry);
    const R = at(x, z, ry);
    for (let i = 0; i < 3; i++) {
      const p = R(-1.0 + i, -0.1);
      kitPut(m, `plantSmall${i + 1}`, p[0], p[1], ry, { y: 2.5, solid: false });
    }
  },

  kitSofa: (m, x, z, ry) => {
    kitPut(m, 'loungeSofa', x, z, ry, SOFA_SWAP);
    const R = at(x, z, ry);
    const p = R(-1.9, -0.4); kitPut(m, 'pillowBlue', p[0], p[1], ry + 0.4, { y: 1.2, solid: false });
  },
  kitSofaCorner: (m, x, z, ry) => kitPut(m, 'loungeSofaCorner', x, z, ry, SOFA_SWAP),
  kitRelax: (m, x, z, ry) => kitPut(m, 'loungeChairRelax', x, z, ry),
  kitCoffeeTable: (m, x, z, ry) => {
    kitPut(m, 'tableCoffeeGlass', x, z, ry);
    const R = at(x, z, ry);
    const p = R(1.0, 0); kitPut(m, 'books', p[0], p[1], ry + 0.6, { y: 1.5, solid: false });
  },
  kitFridge: (m, x, z, ry) => kitPut(m, 'kitchenFridge', x, z, ry),
  kitPantry: (m, x, z, ry) => {
    const R = at(x, z, ry);
    const a = R(-2.8, 0), b = R(0, 0), c = R(2.8, 0);
    kitPut(m, 'kitchenCabinet', a[0], a[1], ry);
    kitPut(m, 'kitchenSink', b[0], b[1], ry);
    kitPut(m, 'kitchenCabinet', c[0], c[1], ry);
    const cm = R(-2.8, -0.2); kitPut(m, 'kitchenCoffeeMachine', cm[0], cm[1], ry, { y: 2.95, solid: false });
    const mw = R(2.8, -0.2); kitPut(m, 'kitchenMicrowave', mw[0], mw[1], ry, { y: 2.95, solid: false });
  },
  kitBar: (m, x, z, ry) => {
    kitPut(m, 'kitchenBar', x, z, ry);
    const R = at(x, z, ry);
    const a = R(0, 1.8), b = R(0, -1.8);
    kitPut(m, 'stoolBar', a[0], a[1], ry);
    kitPut(m, 'stoolBar', b[0], b[1], ry);
  },
  kitPlant: (m, x, z, ry) => kitPut(m, 'pottedPlant', x, z, ry),
  kitRugRound: (m, x, z, ry) => kitPut(m, 'rugRound', x, z, ry, { solid: false }),
  kitLamp: (m, x, z, ry) => kitPut(m, 'lampRoundFloor', x, z, ry),
  kitBear: (m, x, z, ry) => kitPut(m, 'bear', x, z, ry),

  kitTv: (m, x, z, ry) => {
    kitPut(m, 'cabinetTelevision', x, z, ry);
    kitPut(m, 'televisionModern', x, z, ry, { y: 2.05, solid: false, swap: SCREEN_SWAP });
  },
  kitSpeaker: (m, x, z, ry) => kitPut(m, 'speaker', x, z, ry),
  kitCoatRack: (m, x, z, ry) => kitPut(m, 'coatRackStanding', x, z, ry),
  kitTrash: (m, x, z, ry) => kitPut(m, 'trashcan', x, z, ry),
};

/* 팩의 모니터·TV 화면은 그냥 어두운 금속(#4e6363)이다. 이 게임에는 화면을
   위한 머티리얼이 따로 있으므로 그 파트만 갈아끼운다 — 안 그러면 큰 TV 가
   검은 판때기로 보인다. */
const SCREEN_SWAP = { '#4e6363': { c: P.screenDk, m: MAT.SCREEN } };
const DESK_TOP = 2.45;
const SCREEN_ON_DESK = { y: DESK_TOP, solid: false, swap: SCREEN_SWAP };
/* L자 코너 책상의 배율. 팩 모델 6.24 를 발자국 5.8 안에 넣는 값이고,
   의자가 앞으로 튀어나오는 만큼을 감안해 조금 더 줄였다. */
const CORNER = 0.82;

/* 팩의 의자는 전부 같은 빨강이다. 사무실에 여섯 개를 놓으면 그것만 보이므로,
   놓인 순서대로 사무실 의자 색을 돌려 쓴다. */
const KIT_RED = '#f15e57';        // 팩의 carpet
const KIT_RED_DK = '#9b4c49';     // 팩의 carpetDarker
const CHAIR_COLS = [P.chair, P.chairB, P.chairG, P.chairR];
function chairSwap(i) {
  const c = CHAIR_COLS[(i || 0) % CHAIR_COLS.length];
  return { swap: { [KIT_RED]: c, [KIT_RED_DK]: c } };
}
/* 큰 소파 두 개까지 팩의 빨강이면 휴게실이 통째로 붉어진다. 사무실 팔레트의
   소파 색으로 갈아입힌다 — 안락의자는 하나뿐이라 원래 색을 남겨 악센트로 쓴다. */
const SOFA_SWAP = { swap: { [KIT_RED]: P.couch, [KIT_RED_DK]: '#3d4f5d' } };

/* 로컬 → 월드. props 의 회전 약속과 같은 식이라, 세트로 놓는 부품들이
   가구 본체와 같은 방향을 본다. */
function at(x, z, ry) {
  const c = Math.cos(ry), s = Math.sin(ry);
  return (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
}

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
      //
      // 서서 쓰는 가구(stand)에는 그 의자가 없다. 자리는 상판 바로 앞이고
      // 배정된 직원은 앉지 않고 선다 — 의자 없는 자리에 앉히면 허공에
      // 앉아 있게 된다. 그것이 스탠딩 책상 버그의 절반이었다.
      // `seatAway` 는 의자가 상판에서 얼마나 떨어져 있는가다. 대부분은
      // 2.6 이지만 L자 코너 책상처럼 줄여 놓은 가구는 의자도 앞으로 와
      // 있어서, 기본값을 쓰면 앉은 사람이 의자 뒤에 서 있게 된다.
      const away = def.seatAway ?? (def.stand ? 2.0 : 2.6);
      desks.push({
        id: it.uid,
        floor: it.floor, role: plan.role,
        x: it.x, z: it.z, ry,
        seatX: it.x + away * Math.sin(ry),
        seatZ: it.z + away * Math.cos(ry),
        yaw: ry + Math.PI,
        y: base,
        kind: it.id,
        stand: !!def.stand,
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

/* ══════════════════════ 발자국 재기 ══════════════════════

   "책상 중에 몇 개가 면적은 좁은데 설치할 땐 넓게 되어서 안 되는 경우가
   있다" — 그 말이 정확했다.

   카탈로그(game/furniture.js)의 `w`·`d` 는 손으로 적은 값이고, 화면에 그려지는
   것은 아래 DRAW 의 함수들이다. 둘이 어긋난 자리가 여럿 있었다:

     파티션    0.34 두께의 칸막이인데 3.2 × 3.8 의 덩어리로 적혀 있었다
     책장      모델은 1.6 폭 × 7.0 길이인데 카탈로그는 7.2 × 1.6 — 축이 바뀜
     화이트보드 모델은 1.0 × 5.4 인데 카탈로그는 6.0 × 1.0 — 축이 바뀜
     사물함·비품 선반 같은 이유로 뒤집혀 있었다
     스탠딩 책상 의자가 없는데 의자 자리(4.4)까지 잡고 있었다

   축이 뒤집힌 것이 특히 나빴다. 벽에 붙이려고 회전시키면 화면의 가구는
   벽과 나란한데 판정은 벽을 파고들어, 어느 각도로도 안 들어가는 자리가
   생긴다.

   그래서 값을 하나하나 고쳐 적는 대신 **모델에서 직접 잰다**. 부팅할 때
   각 가구를 한 번씩 원점에 그려 보고, 정점의 최소·최대로 발자국을 얻어
   카탈로그에 써넣는다. 이러면 카탈로그와 화면이 어긋날 수 있는 여지 자체가
   사라진다 — 모델을 고치면 발자국도 같이 따라온다.

   모델이 원점에 대칭이 아닌 것도 있다(책상은 의자가 한쪽으로 나와 있다).
   그래서 크기만이 아니라 **중심의 어긋남**(ox·oz)도 같이 적어 둔다.
   game/furniture.js 의 footprint() 가 회전에 맞춰 그 어긋남을 돌린다. */

/* 한 가구의 실제 크기와 중심. 그릴 수 없으면(키트 모델이 아직 안 왔거나
   그리는 함수가 없으면) null 이다 — 그 경우 카탈로그 값을 그대로 둔다. */
export function measureFootprint(id) {
  const draw = DRAW[id];
  if (!draw) return null;
  const m = new MeshBuilder();
  m.noSolid = true;
  try { draw(m, 0, 0, 0, 0); } catch (e) { return null; }
  const p = m.p;
  if (!p.length) return null;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], z = p[i + 2];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  if (!Number.isFinite(x0) || !Number.isFinite(z0)) return null;
  return { w: x1 - x0, d: z1 - z0, ox: (x0 + x1) / 2, oz: (z0 + z1) / 2 };
}

/* 카탈로그의 발자국을 모델에서 잰 값으로 맞춘다. 부팅에서 한 번, 키트가
   도착한 뒤에 부른다 (키트 가구는 그 전에는 아무것도 안 그린다).

   규칙이 둘이다.

   1) **축이 뒤집혀 있으면 바로잡는다.** 화이트보드는 모델이 1.0 × 5.4 인데
      카탈로그에는 6.0 × 1.0 으로 적혀 있었다. 벽에 붙이려고 회전시키면
      화면의 가구는 벽과 나란한데 판정은 벽을 파고들어, 어느 각도로도 안
      들어가는 자리가 생긴다. 잰 값과 적힌 값을 그대로 대 봤을 때와
      뒤집어 대 봤을 때 중 더 잘 맞는 쪽을 고른다.

   2) **줄이기만 한다.** 잰 값이 적힌 값보다 크면 적힌 값을 그대로 둔다.
      고친 것은 "면적은 좁은데 설치할 땐 넓게 잡히는" 가구이지, 지금까지
      놓이던 자리에 이제 안 들어가는 가구를 만드는 일이 아니다. 책상은
      의자까지 재면 5.0 깊이인데 카탈로그는 4.6 이다 — 그 0.4 는 사람이
      의자를 빼고 앉는 자리이지 가구가 늘 차지하는 자리가 아니다.

   중심의 어긋남(ox·oz)도 같은 규칙을 받는다: 줄어든 만큼만 움직인다.
   그래야 어느 방향으로도 예전보다 더 넓은 자리를 요구하지 않는다. */
export function calibrateFootprints() {
  let n = 0;
  for (const def of FURNITURE_BY_ID.values()) {
    const f = measureFootprint(def.id);
    if (!f) continue;
    // 정점 하나까지 자리를 요구하면 나란히 붙여 놓은 두 가구가 겹친다고
    // 나온다. 눈으로는 닿아 있는 것이 맞는 배치다.
    const mw = Math.max(1.2, f.w - 0.24), md = Math.max(1.2, f.d - 0.24);
    let dw = def.w, dd = def.d, ox = f.ox, oz = f.oz;
    // 1) 축이 뒤집혀 적혀 있나.
    const asIs = Math.abs(mw - dw) + Math.abs(md - dd);
    const swapped = Math.abs(mw - dd) + Math.abs(md - dw);
    if (swapped < asIs) { const t = dw; dw = dd; dd = t; }
    // 2) 줄이기만.
    const w = Math.min(dw, mw), d = Math.min(dd, md);
    const okX = Math.max(0, (dw - w) / 2), okZ = Math.max(0, (dd - d) / 2);
    def.w = Math.round(w * 10) / 10;
    def.d = Math.round(d * 10) / 10;
    def.ox = Math.round(Math.max(-okX, Math.min(okX, ox)) * 10) / 10;
    def.oz = Math.round(Math.max(-okZ, Math.min(okZ, oz)) * 10) / 10;
    n++;
  }
  return n;
}
