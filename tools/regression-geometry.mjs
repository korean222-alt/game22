// 형상·재질·길찾기 회귀 검사. 실행: node tools/regression-geometry.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { MeshBuilder, splitGlass } from '../src/core/meshbuilder.js';
import { MAT } from '../src/core/color.js';
import { buildBody, dims } from '../src/char/rig.js';
import { floorField } from '../src/world/props.js';
import { P } from '../src/world/palette.js';
import { loadKit } from '../src/world/kit.js';
import { buildOffice, BUILDING } from '../src/world/office.js';
import { buildCity } from '../src/world/city.js';
import { NavGrid } from '../src/core/bake.js';
import { makeStaff } from '../src/game/staff.js';
import { JOBS } from '../src/game/data.js';
import { mulberry32 } from '../src/core/math.js';

const results = [];
function check(name, fn) {
  fn(); results.push(name); console.log('PASS', name);
}
function meshOK(m, maxBone = 23) {
  const count = m.count();
  assert(count > 0 && count % 3 === 0);
  for (const k of ['p', 'n', 'c', 'm']) assert.equal(m[k].length, count * 3, k);
  for (const k of ['a', 'f', 'b']) assert.equal(m[k].length, count, k);
  for (const k of ['p', 'n', 'c', 'm', 'a', 'f', 'b']) assert(m[k].every(Number.isFinite), k);
  assert(m.f.every(x => Number.isInteger(x) && x >= 0 && x <= 5));
  assert(m.b.every(x => Number.isInteger(x) && x >= 0 && x <= maxBone));
  for (let i = 0; i < m.n.length; i += 3) {
    const len = Math.hypot(...m.n.slice(i, i + 3));
    // Imported kit assets contain documented zero-area triangles. Their zero
    // normals are permitted; shaders now guard them before shadow projection.
    assert(len === 0 || Math.abs(len - 1) < 1e-5, 'unit normal');
  }
  for (const a of [m.solids, m.softs].filter(Boolean)) {
    assert.equal(a.length % 6, 0);
    assert(a.every(Number.isFinite));
    for (let i = 0; i < a.length; i += 6) for (let j = 0; j < 3; j++) assert(a[i+j] <= a[i+j+3]);
  }
}
function outward(m) {
  for (let i = 0; i < m.p.length; i += 9) {
    const p = m.p.slice(i, i + 9);
    const u = p.slice(3, 6).map((x, j) => x-p[j]), v = p.slice(6, 9).map((x, j) => x-p[j]);
    const n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    const center = [0, 1, 2].map(j => (p[j]+p[j+3]+p[j+6])/3);
    assert(n.reduce((s, x, j) => s+x*center[j], 0) > 1e-9, `inward/degenerate triangle ${i/9}`);
  }
}
check('회전 각도 5종의 박스와 원기둥 3종: 모든 면이 바깥쪽', () => {
  for (const ry of [0, 0.17, Math.PI/2, -Math.PI/3, Math.PI]) {
    const m = new MeshBuilder(); m.boxY(0, 0, 0, 2, 3, 4, ry, P.wall); meshOK(m); outward(m);
  }
  for (const seg of [8, 12, 24]) {
    const m = new MeshBuilder(); m.cyl(0, 0, 0, 1, 3, P.steel, seg); meshOK(m); outward(m);
  }
});
check('타원형 팔다리 경사 법선: 위/아래 축과 회전 일치', () => {
  for (const up of [true, false]) {
    const m = new MeshBuilder();
    if (up) m.limbUp(2, 0.6, 0.3, 16, P.sk1, 1.2, 0.8);
    else m.limbT(2, 0.6, 0.3, 16, P.sk1, 1.2, 0.8, 0, 0, 0, 0.4);
    meshOK(m);
    const n = m.n.slice(0, 3);
    if (up) assert(n[1] > 0);
    else assert(n[1] < 0);
  }
});
check('바닥 색상 변화 후에도 모든 카펫 정점의 재질 유지', () => {
  const m = new MeshBuilder(); m.noSolid = true;
  floorField(m, 0, 0, 24, 24, P.carpet, 4, 0);
  meshOK(m); assert.equal(m.mat, 0); assert.equal(m.noSolid, true);
  for (let i = 0; i < m.m.length; i += 3) assert.equal(m.m[i], MAT.CARPET);
});
const rnd = mulberry32(101), jobs = Object.keys(JOBS), bodyCounts = [];
check('캐릭터 32종: 정점 7속성·뼈대·신체 치수 유한값·충돌 제외 검증', () => {
  for (let i = 0; i < 32; i++) {
    const s = makeStaff(rnd, jobs[i % jobs.length]).look;
    if (i % 4 === 0) Object.assign(s, { glasses: true, beard: true, mustache: true, headset: true });
    if (i % 7 === 0) Object.assign(s, { skirt: '#42424a', heels: true, watch: true, cardigan: '#687383' });
    if (i % 5 === 0) Object.assign(s, { jacket: '#42424a', tie: '#7d4e5e' });
    const { mesh: m } = buildBody(s); meshOK(m, 15);
    assert(Object.values(dims(s)).every(Number.isFinite)); assert.equal(m.solids.length, 0); assert.equal(m.softs.length, 0);
    bodyCounts.push(m.count()/3); assert(m.count()/3 < 12000);
  }
});
check('에셋 미로딩 시에도 도시·보도 생성, 충돌과 호출자 상태 보존', () => {
  const m = new MeshBuilder(); m.flag = 4; m.mat = MAT.WALL; m.noSolid = true;
  assert.equal(buildCity(m), true); meshOK(m);
  assert.equal(m.solids.length, 0); assert.equal(m.softs.length, 0);
  assert.equal(m.mat, MAT.WALL); assert.equal(m.flag, 4); assert.equal(m.noSolid, true);
  assert(m.m.some((v,i) => i%3===0 && v===MAT.GLOSS));
});

// Native assets are immutable test inputs; no generated JSON is rewritten.
globalThis.fetch = async url => ({ ok: true, json: async () => JSON.parse(await fs.readFile(new URL('../' + String(url).replace(/^\.\//, ''), import.meta.url), 'utf8')) });
await Promise.all(['city','car','furniture'].map(loadKit));
const officeStats = [];
for (const n of [1,3,5]) {
  const { mesh: m } = buildOffice(n);
  check(`${n}층 사무실: 전체 메쉬·유리 분리·도시 충돌 제외`, () => {
    meshOK(m);
    const { solid, glass } = splitGlass(m); meshOK(solid); meshOK(glass);
    assert.equal(solid.count()+glass.count(), m.count());
    assert(glass.f.every(f => f===2)); assert(solid.f.every(f => f!==2));
    for (let i=0; i<m.solids.length; i+=6) assert(m.solids[i] > -10 && m.solids[i+3] < 75, 'scenery in nav');
  });
  check(`${n}층 사무실: 문 벽 위치·계단 AO 높이·주요 방 접근 경로`, () => {
    for (let f=0; f<n; f++) {
      const y=f*13;
      const nav=new NavGrid(m, y+0.6, y+5.5, 0.5, 2, BUILDING);
      // The same solid wall beside the door must block at EVERY storey.
      assert(!nav.isClearRaw(46,16), `meeting wall missing on ${f+1}F`);
      assert(nav.isClearRaw(50,16), `meeting doorway blocked on ${f+1}F`);
      for (const [x,z] of [[30,22],[51,13],[11,38]]) assert(nav.path(42,25,x,z), `no path to ${x},${z} on ${f+1}F`);
      if(f<4) assert(m.softs.some((v,i) => i%6===1 && v>=y && v<y+1.3 && m.softs[i+3]>y), `stair AO missing on ${f+1}F`);
    }
  });
  officeStats.push({ floors:n, triangles:m.count()/3, collisionBoxes:m.solids.length/6, aoBoxes:m.softs.length/6 });
}
console.log(JSON.stringify({passed:results.length,bodyTriangleRange:[Math.min(...bodyCounts),Math.max(...bodyCounts)],officeStats}));
