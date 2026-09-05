/* Kenney Furniture Kit — 삼각형으로 들여온 가구.

   `assets/furniture/kit.json` 은 tools/kit.mjs 가 OBJ 팩에서 뽑아낸 것이다.
   텍스처가 없고 정점 색과 머티리얼 id 만 들고 있어서, 그대로 MeshBuilder 에
   부으면 사무실의 절차적 가구와 같은 셰이더·같은 AO·같은 벽 자르기를 탄다.
   그리는 경로가 하나도 늘지 않는 것이 이 방식을 고른 이유다.

   좌표 약속
     모델은 X·Z 한가운데가 원점, 바닥이 y=0 이다. ry 는 props 와 같은 뜻 —
     로컬 +Z 가 월드 (sin ry, cos ry) 를 본다. 원본 팩의 가구는 등받이가
     +Z 쪽에 있으므로 ry=0 이면 북(-Z)을 본다. 게임의 책상 약속과 같다. */

/* 팩이 셋이 됐다: 가구(Furniture Kit) · 도시(City Kit) · 자동차(Car Kit).
   모델 id 가 서로 겹치지 않으므로 한 표에 합쳐 두고, "어느 팩이 왔는가" 만
   따로 센다 — 가구점은 가구 팩이 없으면 키트 가구를 통째로 빼야 하는데,
   도시 팩만 와 있는 상태를 "왔다" 로 읽으면 돈만 나가고 바닥에 아무것도
   안 서는 물건을 팔게 된다. */
let MODELS = null;
const packs = new Map();          // 팩 이름 → 로딩 Promise
const ready = new Set();          // 실제로 도착한 팩 이름

export const KIT_URLS = {
  furniture: './assets/furniture/kit.json',
  city: './assets/city/kit.json',
  car: './assets/city/cars.json',
};

export function kitReady(pack = 'furniture') { return ready.has(pack); }

/* 한 번만 받는다. 실패해도 던지지 않는다 — 그 팩의 물건이 안 보일 뿐,
   절차적 지오메트리로 만든 사무실은 그대로 돈다. */
export function loadKit(pack = 'furniture') {
  const url = KIT_URLS[pack] || pack;
  if (packs.has(url)) return packs.get(url);
  const pr = fetch(url)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
    .then((j) => {
      MODELS = MODELS || {};
      Object.assign(MODELS, j.models);
      if (KIT_URLS[pack]) ready.add(pack);
      return j;
    })
    .catch((e) => { console.warn(`kit load failed (${pack})`, e); return null; });
  packs.set(url, pr);
  return pr;
}

export function kitHas(id) { return !!(MODELS && MODELS[id]); }

/* '#rrggbb' × 배수. 색을 하나하나 다시 적지 않고 팩 전체의 톤만 내리려는
   자리이므로, 정확한 색 공간 변환이 아니라 단순 곱이면 충분하다. */
function scaleHex(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v * f)))
    .toString(16).padStart(2, '0');
  return '#' + ch((n >> 16) & 255) + ch((n >> 8) & 255) + ch(n & 255);
}

/* 모델의 바운딩 박스 (배율 적용 전). 카탈로그의 w/d 를 눈으로 맞추지 않고
   모델에서 읽어오고 싶을 때 쓴다. */
export function kitBounds(id) {
  const m = MODELS && MODELS[id];
  return m ? m.b : null;
}

/* 모델 하나를 MeshBuilder 에 붓는다.

   opts.s     배율 (기본 1)
   opts.y     바닥에서 띄울 높이 (책상 위의 모니터 같은 것)
   opts.solid false 면 충돌·AO 상자를 만들지 않는다 (러그, 소품)
   opts.swap  원본 색 → 새 색/머티리얼. '#rrggbb' 하나면 모델 전체를 그 색으로,
              { '#원본': '#새색' } 또는 { '#원본': { c, m } } 면 그 파트만.
              모니터 화면(팩에서는 그냥 어두운 금속이다)을 이 게임의 SCREEN
              머티리얼로 바꾸는 데 쓴다.
   opts.tint  모든 파트의 색에 곱하는 값. City Kit 의 건물은 아주 밝은
              라벤더 회색이라 이 게임의 밝은 조명 아래에서는 흰 덩어리로
              날아간다. 이웃마다 다른 값을 주면 스카이라인에 명암이 생기고,
              그게 도시로 읽히게 만든다.
   opts.mat   모든 파트의 머티리얼을 이것으로 강제한다. */
export function kitPut(m, id, x, z, ry = 0, opts = {}) {
  const mod = MODELS && MODELS[id];
  if (!mod) return false;
  const s = opts.s === undefined ? 1 : opts.s;
  const y0 = opts.y || 0;
  const c = Math.cos(ry), sn = Math.sin(ry);
  const v = mod.v;
  const prevMat = m.mat;

  // 로컬 → 월드. props 의 boxY 와 같은 회전이라 가구끼리 방향이 어긋나지 않는다.
  const px = new Float32Array(v.length / 3);
  const py = new Float32Array(v.length / 3);
  const pz = new Float32Array(v.length / 3);
  for (let i = 0, k = 0; i < v.length; i += 3, k++) {
    const lx = v[i] * s, lz = v[i + 2] * s;
    px[k] = x + lx * c + lz * sn;
    py[k] = y0 + v[i + 1] * s;
    pz[k] = z - lx * sn + lz * c;
  }

  const tint = opts.tint === undefined ? 1 : opts.tint;
  for (const part of mod.parts) {
    let col = part.c, mat = part.m || 0;
    if (typeof opts.swap === 'string') col = opts.swap;
    else if (opts.swap && opts.swap[part.c]) {
      const sw = opts.swap[part.c];
      if (typeof sw === 'string') col = sw;
      else { col = sw.c || col; if (sw.m !== undefined) mat = sw.m; }
    }
    if (tint !== 1) col = scaleHex(col, tint);
    if (opts.mat !== undefined) mat = opts.mat;
    m.mat = mat;
    const idx = part.i;
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i], b = idx[i + 1], d = idx[i + 2];
      m.tri(px[a], py[a], pz[a], px[b], py[b], pz[b], px[d], py[d], pz[d], col);
    }
  }
  m.mat = prevMat;

  if (opts.solid !== false) {
    // 회전한 바운딩 박스의 축 정렬 외접 상자. 걷기 격자와 AO 는 이것만 본다.
    const b = mod.b;
    const hw = ((b[3] - b[0]) / 2) * s, hd = ((b[5] - b[2]) / 2) * s;
    const ex = Math.abs(hw * c) + Math.abs(hd * sn);
    const ez = Math.abs(hw * sn) + Math.abs(hd * c);
    m.solid(x - ex, y0, z - ez, x + ex, y0 + b[4] * s, z + ez);
  }
  return true;
}
