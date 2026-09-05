/* Kenney Furniture Kit → 이 게임의 지오메트리 포맷.

   가구를 GLB 로 들여오는 길은 두 갈래였다. 몬스터처럼 `SkinnedPass` 로
   따로 그리거나, 삼각형만 뽑아서 사무실과 같은 메시에 섞거나. 후자를 골랐다.
   그래야 벽 자르기·AO 베이크·머티리얼 셰이더가 전부 공짜로 따라오고,
   새로 그리는 경로가 하나도 늘지 않는다.

   Kenney 팩의 OBJ 는 텍스처가 없다. 머티리얼 이름마다 Kd(확산색)가 붙어
   있을 뿐이라, 그대로 정점 색으로 옮기면 절차적 가구와 톤이 어긋나지 않는다.
   PNG 를 한 장도 들여오지 않는 것이 이 방식의 가장 큰 이득이다.

   쓰는 법:
     node tools/kit.mjs "<압축 푼 곳>/Models/OBJ format" assets/furniture/kit.json
*/

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/* Kenney 의 1 유닛은 2m, 이 게임의 1 유닛은 약 31cm. 책상 상판이 정확히
   DESK_Y(2.42) 에 오는 배율이라 눈으로 맞출 것이 없다. */
const SCALE = 6.4;

/* 머티리얼 이름 → 이 게임의 머티리얼 id (core/color.js 의 MAT). */
const MAT = {
  DEF: 0, CARPET: 1, WOOD: 2, WALL: 3, METAL: 4, FABRIC: 5, SCREEN: 6,
  CEIL: 7, SKIN: 8, TILE: 9, GLOSS: 10, BOARD: 11, PAPER: 12, LEAF: 13,
  HAIR: 14, CLOTH: 15, EMIT: 16,
};
const MAT_BY_NAME = {
  wood: MAT.WOOD, woodDark: MAT.WOOD,
  metal: MAT.METAL, metalDark: MAT.METAL, metalLight: MAT.METAL, metalMedium: MAT.METAL,
  carpet: MAT.FABRIC, carpetBlue: MAT.FABRIC, carpetDarker: MAT.FABRIC,
  carpetWhite: MAT.FABRIC, fur: MAT.CLOTH,
  plant: MAT.LEAF,
  glass: MAT.GLOSS,
  lamp: MAT.EMIT,
  _defaultMat: MAT.DEF,
};

/* 들여올 모델. 140종을 전부 넣을 이유가 없다 — 사무실에 놓을 만한 것만
   고르고, 나머지는 팩에 남겨 둔다. 파일 크기가 그대로 첫 로딩 시간이다. */
const WANT = [
  // 업무
  'desk', 'deskCorner', 'chairDesk', 'chair', 'chairModernCushion',
  'computerScreen', 'computerKeyboard', 'computerMouse', 'laptop',
  // 수납
  'bookcaseOpen', 'bookcaseOpenLow', 'bookcaseClosedDoors', 'books',
  'cardboardBoxClosed', 'cardboardBoxOpen', 'sideTableDrawers',
  // 휴게
  'loungeSofa', 'loungeSofaCorner', 'loungeChairRelax', 'loungeDesignSofa',
  'tableCoffeeGlass', 'tableRound', 'stoolBar', 'pillowBlue', 'bear',
  'kitchenFridge', 'kitchenCabinet', 'kitchenSink', 'kitchenCoffeeMachine',
  'kitchenBar', 'kitchenMicrowave',
  'pottedPlant', 'plantSmall1', 'plantSmall2', 'plantSmall3',
  'rugRound', 'rugRectangle',
  'lampRoundFloor', 'lampSquareTable',
  // 분위기
  'cabinetTelevision', 'televisionModern', 'speaker', 'radio',
  'coatRackStanding', 'trashcan', 'ceilingFan',
];

function parseMtl(path) {
  const out = new Map();
  let cur = null;
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('newmtl ')) cur = line.slice(7).trim();
    else if (cur && line.startsWith('Kd ')) {
      const [r, g, b] = line.slice(3).trim().split(/\s+/).map(Number);
      const hex = '#' + [r, g, b]
        .map((v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0'))
        .join('');
      out.set(cur, hex);
    }
  }
  return out;
}

/* OBJ 하나 → { b, v, parts }.
   면은 부채꼴로 삼각화한다. Kenney 의 면은 전부 볼록이라 이걸로 충분하다. */
function parseObj(dir, name) {
  const src = readFileSync(join(dir, name + '.obj'), 'utf8');
  let mtl = new Map();
  try { mtl = parseMtl(join(dir, name + '.mtl')); } catch { /* 색이 없으면 회색 */ }

  const verts = [];
  const groups = new Map();       // key: `${mat}|${hex}` → 인덱스 배열
  let cur = '_defaultMat';

  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('v ')) {
      const a = line.slice(2).trim().split(/\s+/).map(Number);
      verts.push(a[0], a[1], a[2]);
    } else if (line.startsWith('usemtl ')) {
      cur = line.slice(7).trim();
    } else if (line.startsWith('f ')) {
      const idx = line.slice(2).trim().split(/\s+/).map((tok) => {
        const n = parseInt(tok.split('/')[0], 10);
        return n > 0 ? n - 1 : verts.length / 3 + n;
      });
      const key = cur;
      let g = groups.get(key);
      if (!g) { g = []; groups.set(key, g); }
      for (let i = 1; i + 1 < idx.length; i++) g.push(idx[0], idx[i], idx[i + 1]);
    }
  }

  // 스케일 + 원점 정리: X·Z 는 바운딩 박스 한가운데로, Y 는 바닥이 0.
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < verts.length; i += 3) {
    x0 = Math.min(x0, verts[i]); x1 = Math.max(x1, verts[i]);
    y0 = Math.min(y0, verts[i + 1]); y1 = Math.max(y1, verts[i + 1]);
    z0 = Math.min(z0, verts[i + 2]); z1 = Math.max(z1, verts[i + 2]);
  }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const v = new Array(verts.length);
  const r2 = (n) => Math.round(n * 100) / 100;
  for (let i = 0; i < verts.length; i += 3) {
    v[i] = r2((verts[i] - cx) * SCALE);
    v[i + 1] = r2((verts[i + 1] - y0) * SCALE);
    v[i + 2] = r2((verts[i + 2] - cz) * SCALE);
  }

  const parts = [];
  for (const [mname, idx] of groups) {
    if (!idx.length) continue;
    parts.push({
      c: mtl.get(mname) || '#9a9a9d',
      m: MAT_BY_NAME[mname] === undefined ? MAT.DEF : MAT_BY_NAME[mname],
      i: idx,
    });
  }

  return {
    b: [r2((x0 - cx) * SCALE), 0, r2((z0 - cz) * SCALE),
      r2((x1 - cx) * SCALE), r2((y1 - y0) * SCALE), r2((z1 - cz) * SCALE)],
    v, parts,
  };
}

const src = process.argv[2];
const out = process.argv[3] || 'assets/furniture/kit.json';
if (!src) {
  console.error('사용법: node tools/kit.mjs "<pack>/Models/OBJ format" [out.json]');
  process.exit(1);
}

const models = {};
let tris = 0, verts = 0;
for (const name of WANT) {
  try {
    const m = parseObj(src, name);
    models[name] = m;
    verts += m.v.length / 3;
    for (const p of m.parts) tris += p.i.length / 3;
  } catch (e) {
    console.warn('건너뜀', name, e.message);
  }
}

mkdirSync(dirname(out), { recursive: true });
const json = JSON.stringify({ scale: SCALE, models });
writeFileSync(out, json);
console.log(`${Object.keys(models).length}종 · 정점 ${verts} · 삼각형 ${tris} · ${(json.length / 1024).toFixed(1)}KB → ${out}`);
