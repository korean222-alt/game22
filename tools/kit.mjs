/* Kenney 팩 → 이 게임의 지오메트리 포맷.

   외부 모델을 들여오는 길은 두 갈래였다. 몬스터처럼 `SkinnedPass` 로
   따로 그리거나, 삼각형만 뽑아서 사무실과 같은 메시에 섞거나. 후자를 골랐다.
   그래야 벽 자르기·AO 베이크·머티리얼 셰이더가 전부 공짜로 따라오고,
   새로 그리는 경로가 하나도 늘지 않는다.

   팩마다 색이 오는 길이 둘이다.

     Furniture Kit  머티리얼 이름마다 Kd(확산색)가 붙어 있다. 그대로 정점
                    색으로 옮기면 절차적 가구와 톤이 어긋나지 않는다.
     City / Car Kit 머티리얼이 `colormap.png` 한 장뿐이고 색은 UV 가 가리키는
                    아틀라스 칸에 있다. 그래서 여기서 **PNG 를 읽어 삼각형마다
                    한 색으로 구워 넣는다.** 결과 json 에는 여전히 색과
                    머티리얼 id 만 남고, 게임은 텍스처를 한 장도 싣지 않는다 —
                    프로시저럴 파이프라인이 이 프로젝트의 정체성이라는 규칙을
                    깨지 않으면서 외부 팩을 쓰는 유일한 방법이다.

   쓰는 법:
     node tools/kit.mjs furniture "<팩>/Models/OBJ format" assets/furniture/kit.json
     node tools/kit.mjs city      "<팩>/Models/OBJ format" assets/city/kit.json
     node tools/kit.mjs car       "<팩>/Models/OBJ format" assets/city/cars.json
   (첫 인자를 빼면 furniture 로 친다 — 옛 명령이 그대로 돈다.)
*/

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inflateSync } from 'node:zlib';

/* 팩마다 다르다 — KITS 표에 있다. 가구 팩의 6.4 는 Kenney 의 1 유닛(2m)을
   이 게임의 1 유닛(약 31cm)으로 옮기는 값이고, 책상 상판이 정확히
   DESK_Y(2.42) 에 오는 배율이라 눈으로 맞출 것이 없다. */

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
const WANT_FURNITURE = [
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

/* ---------- 도시 ----------
   창밖에 보이는 것들이다. 팩의 `building-*` 은 한 채에 2,200~10,500 삼각형
   이라 창밖 스카이라인에 쓰기에는 지나치게 비싸다 — 같은 팩이 그 용도로
   `low-detail-building-*`(124~756) 을 따로 싣고 오므로 그쪽을 기본으로
   쓰고, 길 건너 랜드마크 두 채만 제대로 된 모델을 쓴다.

   합쳐서 삼각형 1만 2천 남짓. 사무실 한 층보다 싸다. */
const WANT_CITY = [
  'low-detail-building-a', 'low-detail-building-b', 'low-detail-building-c',
  'low-detail-building-d', 'low-detail-building-e', 'low-detail-building-f',
  'low-detail-building-g', 'low-detail-building-i', 'low-detail-building-j',
  'low-detail-building-k', 'low-detail-building-l', 'low-detail-building-m',
  'low-detail-building-n',
  'low-detail-building-wide-a', 'low-detail-building-wide-b',
  // 길 건너 두 채. 여기만 창에서 가까워 실루엣이 아니라 건물로 보인다.
  'building-c', 'building-skyscraper-a',
];

/* ---------- 자동차 ----------
   길에 세워 두는 것들. 한 대에 2,000 삼각형이라 네 종이면 충분하고,
   같은 모델을 색만 바꿔 여러 번 놓는다. */
/* 넷이던 것을 아홉으로 늘렸다. 같은 모델을 색만 바꿔 여섯 대 세우면 여섯
   대가 아니라 한 대가 여섯 번 보인다 — 창밖의 길은 그걸 정확히 들킨다.
   경찰차·구급차·배달 트럭이 섞이면 그때부터 '차들' 이 아니라 '도시' 다.
   한 대에 2,000 삼각형이라 아홉이면 1만 8천, 사무실 한 층보다 싸다. */
const WANT_CAR = [
  'sedan', 'taxi', 'van', 'truck',
  'police', 'ambulance', 'suv', 'delivery', 'hatchback-sports',
];

/* 팩마다 배율·기본 머티리얼·색이 오는 길이 다르다. */
const KITS = {
  furniture: { scale: 6.4, want: WANT_FURNITURE, defMat: MAT.DEF, atlas: false },
  /* Kenney City Kit 의 low-detail 건물은 폭 0.5 · 높이 2 쯤이다. 40 배면
     20 × 80 유닛 — 우리 사옥(폭 68 · 한 층 12)의 이웃으로 알맞다. */
  city: { scale: 40, want: WANT_CITY, defMat: MAT.WALL, atlas: true },
  /* 세단이 1.5 × 2.55 유닛이다. 4 배면 6 × 10 — 게임의 1 유닛이 31cm 이므로
     실제 승용차 크기다. */
  car: { scale: 4, want: WANT_CAR, defMat: MAT.METAL, atlas: true },
};

/* ---------- PNG ----------
   colormap.png 을 읽기 위한 최소 디코더. 8비트 · 비인터레이스 · RGB/RGBA 만
   본다 — Kenney 의 아틀라스가 전부 그 형식이고, 그 밖을 지원하려고 의존성을
   들이는 것은 이 프로젝트의 규칙(npm install 없이 돈다)에 어긋난다. */
function readPng(path) {
  const buf = readFileSync(path);
  let p = 8, w = 0, h = 0, depth = 0, type = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const tag = buf.toString('ascii', p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + len);
    if (tag === 'IHDR') {
      w = body.readUInt32BE(0); h = body.readUInt32BE(4);
      depth = body[8]; type = body[9];
      if (body[12] !== 0) throw new Error('인터레이스 PNG 는 못 읽는다');
    } else if (tag === 'IDAT') idat.push(body);
    else if (tag === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8 || (type !== 2 && type !== 6)) {
    throw new Error(`지원하지 않는 PNG (depth ${depth} type ${type})`);
  }
  const ch = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(w * h * ch);
  const stride = w * ch;
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, y * stride + stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}

const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/* 색을 몇 단으로 뭉갠다.

   Kenney 아틀라스의 칸은 단색이 아니라 아주 얕은 그라데이션이라, 그대로
   쓰면 택시 한 대가 **120개 파트**로 쪼개진다 (같은 노랑의 1/255 차이들).
   눈으로는 구분되지 않는 차이가 파일 크기와 드로우 준비 비용이 되는 것은
   손해라서, 채널을 12 단위로 뭉쳐 같은 색으로 만든다. */
const QUANT = 12;
const quant = (v) => Math.min(255, Math.round(v / QUANT) * QUANT);

/* UV 한 점의 색. OBJ 의 V 는 아래에서 위로 센다. */
function sample(png, u, v) {
  const x = Math.min(png.w - 1, Math.max(0, Math.floor(u * png.w)));
  const y = Math.min(png.h - 1, Math.max(0, Math.floor((1 - v) * png.h)));
  const i = (y * png.w + x) * png.ch;
  return '#' + hex2(quant(png.data[i])) + hex2(quant(png.data[i + 1]))
    + hex2(quant(png.data[i + 2]));
}

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
   면은 부채꼴로 삼각화한다. Kenney 의 면은 전부 볼록이라 이걸로 충분하다.

   `atlas` 팩(City / Car)에서는 머티리얼이 colormap 하나뿐이므로 머티리얼
   이름으로 나눌 수가 없다. 대신 **삼각형마다** 세 꼭짓점 UV 의 한가운데를
   찍어 색을 구하고, 같은 색끼리 묶는다. Kenney 아틀라스는 단색 칸의 격자라
   한가운데 한 점이면 충분하고, 결과는 모델당 색 열몇 가지다. */
function parseObj(dir, name, kit) {
  const src = readFileSync(join(dir, name + '.obj'), 'utf8');
  let mtl = new Map();
  try { mtl = parseMtl(join(dir, name + '.mtl')); } catch { /* 색이 없으면 회색 */ }
  const png = kit.atlas ? atlasFor(dir) : null;

  const verts = [];
  const uvs = [];
  const groups = new Map();       // key: 머티리얼 이름 또는 '#rrggbb'
  let cur = '_defaultMat';

  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('v ')) {
      const a = line.slice(2).trim().split(/\s+/).map(Number);
      verts.push(a[0], a[1], a[2]);
    } else if (line.startsWith('vt ')) {
      const a = line.slice(3).trim().split(/\s+/).map(Number);
      uvs.push(a[0], a[1] === undefined ? 0 : a[1]);
    } else if (line.startsWith('usemtl ')) {
      cur = line.slice(7).trim();
    } else if (line.startsWith('f ')) {
      const toks = line.slice(2).trim().split(/\s+/);
      const idx = toks.map((tok) => {
        const n = parseInt(tok.split('/')[0], 10);
        return n > 0 ? n - 1 : verts.length / 3 + n;
      });
      const uv = toks.map((tok) => {
        const parts2 = tok.split('/');
        const n = parts2.length > 1 && parts2[1] ? parseInt(parts2[1], 10) : NaN;
        if (!Number.isFinite(n)) return -1;
        return n > 0 ? n - 1 : uvs.length / 2 + n;
      });
      for (let i = 1; i + 1 < idx.length; i++) {
        let key = cur;
        if (png) {
          const t = [0, i, i + 1];
          let u = 0, v = 0, hits = 0;
          for (const k of t) {
            if (uv[k] < 0) continue;
            u += uvs[uv[k] * 2]; v += uvs[uv[k] * 2 + 1]; hits++;
          }
          key = hits ? sample(png, u / hits, v / hits) : '#9a9a9d';
        }
        let g = groups.get(key);
        if (!g) { g = []; groups.set(key, g); }
        g.push(idx[0], idx[i], idx[i + 1]);
      }
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
    v[i] = r2((verts[i] - cx) * kit.scale);
    v[i + 1] = r2((verts[i + 1] - y0) * kit.scale);
    v[i + 2] = r2((verts[i + 2] - cz) * kit.scale);
  }

  const parts = [];
  for (const [key, idx] of groups) {
    if (!idx.length) continue;
    // 아틀라스 팩에서는 키가 이미 색이다. Kd 팩에서는 머티리얼 이름이고,
    // 그 이름이 색과 머티리얼 id 를 동시에 정한다.
    const isColor = key.charAt(0) === '#';
    parts.push({
      c: isColor ? key : (mtl.get(key) || '#9a9a9d'),
      m: isColor
        ? kit.defMat
        : (MAT_BY_NAME[key] === undefined ? kit.defMat : MAT_BY_NAME[key]),
      i: idx,
    });
  }

  return {
    b: [r2((x0 - cx) * kit.scale), 0, r2((z0 - cz) * kit.scale),
      r2((x1 - cx) * kit.scale), r2((y1 - y0) * kit.scale), r2((z1 - cz) * kit.scale)],
    v, parts,
  };
}

/* colormap 은 팩당 한 장이다. 모델마다 다시 읽으면 100번 디코딩한다. */
const _atlas = new Map();
function atlasFor(dir) {
  if (_atlas.has(dir)) return _atlas.get(dir);
  let png = null;
  try { png = readPng(join(dir, 'Textures', 'colormap.png')); }
  catch (e) { console.warn('colormap 을 못 읽었다:', e.message); }
  _atlas.set(dir, png);
  return png;
}

/* 첫 인자가 팩 이름이면 그 설정으로, 경로처럼 생겼으면 옛 명령(가구)으로. */
const arg1 = process.argv[2];
const named = arg1 && KITS[arg1];
const kitName = named ? arg1 : 'furniture';
const kit = KITS[kitName];
const src = named ? process.argv[3] : arg1;
const out = (named ? process.argv[4] : process.argv[3])
  || (kitName === 'furniture' ? 'assets/furniture/kit.json' : `assets/city/${kitName}.json`);
if (!src) {
  console.error('사용법: node tools/kit.mjs [furniture|city|car] "<pack>/Models/OBJ format" [out.json]');
  process.exit(1);
}

const models = {};
let tris = 0, verts = 0;
for (const name of kit.want) {
  try {
    const m = parseObj(src, name, kit);
    models[name] = m;
    verts += m.v.length / 3;
    for (const p of m.parts) tris += p.i.length / 3;
  } catch (e) {
    console.warn('건너뜀', name, e.message);
  }
}

mkdirSync(dirname(out), { recursive: true });
const json = JSON.stringify({ scale: kit.scale, models });
writeFileSync(out, json);
console.log(`[${kitName}] ${Object.keys(models).length}종 · 정점 ${verts} · 삼각형 ${tris} · ${(json.length / 1024).toFixed(1)}KB → ${out}`);
