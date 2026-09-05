/* Kenney Furniture Kit — 삼각형으로 들여온 가구.

   `assets/furniture/kit.json` 은 tools/kit.mjs 가 OBJ 팩에서 뽑아낸 것이다.
   텍스처가 없고 정점 색과 머티리얼 id 만 들고 있어서, 그대로 MeshBuilder 에
   부으면 사무실의 절차적 가구와 같은 셰이더·같은 AO·같은 벽 자르기를 탄다.
   그리는 경로가 하나도 늘지 않는 것이 이 방식을 고른 이유다.

   좌표 약속
     모델은 X·Z 한가운데가 원점, 바닥이 y=0 이다. ry 는 props 와 같은 뜻 —
     로컬 +Z 가 월드 (sin ry, cos ry) 를 본다. 원본 팩의 가구는 등받이가
     +Z 쪽에 있으므로 ry=0 이면 북(-Z)을 본다. 게임의 책상 약속과 같다. */

let KIT = null;
let loading = null;

export function kitReady() { return !!KIT; }

/* 한 번만 받는다. 실패해도 던지지 않는다 — 키트 가구가 안 보일 뿐,
   절차적 가구로 만든 사무실은 그대로 돈다. */
export function loadKit(url = './assets/furniture/kit.json') {
  if (KIT) return Promise.resolve(KIT);
  if (loading) return loading;
  loading = fetch(url)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
    .then((j) => { KIT = j; return j; })
    .catch((e) => { console.warn('furniture kit load failed', e); return null; });
  return loading;
}

export function kitHas(id) { return !!(KIT && KIT.models[id]); }

/* 모델의 바운딩 박스 (배율 적용 전). 카탈로그의 w/d 를 눈으로 맞추지 않고
   모델에서 읽어오고 싶을 때 쓴다. */
export function kitBounds(id) {
  const m = KIT && KIT.models[id];
  return m ? m.b : null;
}

/* 모델 하나를 MeshBuilder 에 붓는다.

   opts.s     배율 (기본 1)
   opts.y     바닥에서 띄울 높이 (책상 위의 모니터 같은 것)
   opts.solid false 면 충돌·AO 상자를 만들지 않는다 (러그, 소품)
   opts.swap  원본 색 → 새 색/머티리얼. '#rrggbb' 하나면 모델 전체를 그 색으로,
              { '#원본': '#새색' } 또는 { '#원본': { c, m } } 면 그 파트만.
              모니터 화면(팩에서는 그냥 어두운 금속이다)을 이 게임의 SCREEN
              머티리얼로 바꾸는 데 쓴다. */
export function kitPut(m, id, x, z, ry = 0, opts = {}) {
  const mod = KIT && KIT.models[id];
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

  for (const part of mod.parts) {
    let col = part.c, mat = part.m || 0;
    if (typeof opts.swap === 'string') col = opts.swap;
    else if (opts.swap && opts.swap[part.c]) {
      const sw = opts.swap[part.c];
      if (typeof sw === 'string') col = sw;
      else { col = sw.c || col; if (sw.m !== undefined) mat = sw.m; }
    }
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
