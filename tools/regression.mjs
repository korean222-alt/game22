/* 버그 회귀 검사. 실행: node tools/regression.mjs
   실제 저장 데이터 대신 메모리 저장소를 쓴다. DOM/GPU 대역 검사는
   콜백과 데이터 경로만 검증하며 실제 브라우저 렌더링 검사를 대신하지 않는다. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Game } from '../src/game/state.js';
import { STATS, PLATFORMS, MONETIZE, SHOP, MARKETING, RAID } from '../src/game/data.js';
import { TASKS, EVENTS, restoreEvent } from '../src/game/events.js';
import { finishProject, advanceStage, battleTurn, battleTick, canUrge } from '../src/game/project.js';
import { mulberry32 } from '../src/core/math.js';
import { buildPlaced } from '../src/world/placed.js';
import { splitGlass } from '../src/core/meshbuilder.js';
import { loadGLB, Skeleton } from '../src/core/gltf.js';
import { loadKit } from '../src/world/kit.js';
import { UI } from '../src/ui/hud.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const tests = [];
async function test(name, fn) {
  await fn();
  tests.push(name);
  console.log('통과:', name);
}
function fresh(seed = 12345) {
  const g = new Game(seed);
  g.found('회귀 검사');
  return g;
}
function hireOne(g) {
  g.assignDesks([{ id: 'test-seat', floor: 0, role: 'plan' }]);
  assert(g.hire(g.candidates[0].id).ok);
  return g.staff[0];
}
function project(g) {
  const s = g.staff[0] || hireOne(g);
  const pr = g.makeProposal().proposal;
  pr.grade = 1;
  const r = g.beginDevelopment({ proposalId: pr.id, platformId: PLATFORMS[0].id,
    monetizeId: MONETIZE[0].id, teamIds: [s.id] });
  assert(r.ok, r.why);
  return r.project;
}
function finished(g) {
  const p = project(g);
  p.contentId = g.ownedContents()[0]; p.methodId = 'quality'; p.strikes = 20;
  for (const k of STATS) p.raw[k] = 120 * p.strikes;
  finishProject(p, g.staffById(), g.rnd, g.ctx());
  g.project = null; g.finished = p;
  return p;
}
function reload(g) {
  assert(g.save());
  const loaded = Game.load(); assert(loaded);
  return loaded;
}
function answerAll(g) {
  for (let i = 0; g.pendingEvent && i < 100; i++) {
    assert(g.answerEvent(g.pendingEvent.options.length - 1).ok);
  }
  assert.equal(g.pendingEvent, null);
}
function setEvent(g, id, targetId, targetKind) {
  const def = EVENTS.find((e) => e.id === id);
  g.pendingEvent = restoreEvent({ id, text: '저장된 사건 본문', targetId, targetKind,
    options: def.choices.map((_, i) => i) }, g);
  assert(g.pendingEvent);
  return g.pendingEvent;
}

class ElementDouble {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.style = {};
    this.dataset = {}; this.className = ''; this.innerHTML = '';
    const classes = new Set();
    this.classList = {
      add: (...xs) => xs.forEach((x) => classes.add(x)),
      remove: (...xs) => xs.forEach((x) => classes.delete(x)),
      contains: (x) => classes.has(x),
      toggle: (x, on) => { if (on) classes.add(x); else classes.delete(x); },
    };
  }
  appendChild(x) { this.children.push(x); return x; }
  append(...xs) { this.children.push(...xs); }
  setAttribute() {}
  querySelector(sel) { return this[sel] ||= new ElementDouble(sel); }
}
const ids = new Map(), listeners = new Map();
globalThis.window = { addEventListener: (name, fn) => listeners.set(name, fn) };
globalThis.document = {
  createElement: (tag) => new ElementDouble(tag), querySelector: () => null,
  body: new ElementDouble('body'),
  getElementById: (id) => {
    if (!ids.has(id)) ids.set(id, new ElementDouble());
    return ids.get(id);
  },
};
globalThis.location = { reload() {} };
function panel(g) {
  const ui = Object.create(UI.prototype);
  Object.assign(ui, { g, view: { fp: { on: false } }, panelDevTools() {}, renderPanel() {}, toast() {} });
  const box = new ElementDouble(); ui.panelCompany(box);
  return { ui, button: (name) => box.children.find((e) => e.tagName === 'BUTTON' && e.innerHTML === name) };
}
const main = await fs.readFile(path.join(root, 'src/main.js'), 'utf8');
function method(name, context) {
  const at = main.indexOf(`  ${name}(`); assert(at >= 0);
  const end = main.indexOf('\n  }', at) + 4;
  return vm.runInNewContext(`({${main.slice(at, end)}}).${name}`, context);
}

// 별도 프로세스에서 모듈 ID 카운터를 초기화하고 시계에 영향받지 않음을 검사.
if (process.argv.includes('--reload-id')) {
  let raw = ''; for await (const chunk of process.stdin) raw += chunk;
  localStorage.setItem(Game.SAVE_KEY, raw);
  Date.now = () => 1800000000030;
  const g = Game.load(); assert(g);
  console.log(g.makeProposal().proposal.id);
  process.exit(0);
}

await test('B01 초기화 성공·실패 및 종료 시 재저장 방지', () => {
  const g = fresh(); const { ui, button } = panel(g);
  let reloads = 0; location.reload = () => { reloads++; };
  ui.confirm = (_a, _b, yes, also) => { if (also) also(); yes(); };
  button('처음부터 다시').onclick();
  assert.equal(reloads, 1); assert.equal(Game.hasSave(), false);
  const pagehide = main.match(/window\.addEventListener\('pagehide', ([^\n]+)\);/)[1];
  vm.runInNewContext(`(${pagehide})()`, { Game, game: g });
  assert.equal(Game.hasSave(), false);
  g.save(); const remove = localStorage.removeItem;
  try {
    localStorage.removeItem = () => { throw Error('차단'); };
    button('처음부터 다시').onclick(); assert.equal(reloads, 1);
  } finally { localStorage.removeItem = remove; }
});

await test('B02 판매 중·완료 후 복원, 난수 연속성, 중복 입금 방지', () => {
  const g = fresh(); finished(g); assert(g.release().ok);
  g.salesTick(3.1); assert.equal(g.sales.done, 2);
  assert.equal(g.closeSalesRun(), null);
  const loaded = reload(g);
  assert.deepEqual(loaded.sales, g.sales);
  assert.equal(loaded.rnd.getState(), g.rnd.getState());
  g.salesTick(18); loaded.salesTick(18);
  assert.deepEqual(loaded.releases, g.releases);
  assert.equal(loaded.company.money, g.company.money);
  const ended = reload(loaded), paid = ended.releases[0].earned;
  ended.salesTick(999); assert.equal(ended.releases[0].earned, paid);
  ended.nextWeek(); assert.equal(ended.releases[0].earned, paid);
  const ui = Object.create(UI.prototype); ui.g = ended;
  for (const fn of ['renderHUD', 'renderFloors', 'renderPanel', 'renderBadges',
    'renderBattle', 'renderProgress', 'renderSales', 'renderShell']) ui[fn] = () => {};
  ui.renderAll();
  assert(document.body.classList.contains('selling'));
  assert(document.body.classList.contains('settled'));
  ended.closeSalesRun(); const money = ended.company.money;
  assert.equal(ended.closeSalesRun(), null); assert.equal(ended.company.money, money);
});

await test('B02 이전 v2 판매 기록의 남은 주차 복구', () => {
  const g = fresh(); finished(g); g.release(); g.salesTick(3);
  const d = JSON.parse(g.serialize()); d.v = 2; delete d.sales; delete d.rngState;
  localStorage.setItem(Game.SAVE_KEY, JSON.stringify(d));
  const old = Game.load(); assert(old.sales); assert.equal(old.sales.done, 2);
  const paid = old.releases[0].earned;
  assert.equal(old.sales.total, paid); old.salesTick(18);
  assert.equal(old.releases[0].weeks, 12); assert(old.releases[0].earned > paid);
});

await test('B03 사건 선택지·대상·대기 주차 복원 및 1회 응답', () => {
  const g = fresh(); const staff = hireOne(g);
  setEvent(g, 'burnout', staff.id, 'staff'); g.company.weeksDue = 2;
  const loaded = reload(g), ev = loaded.pendingEvent;
  assert.equal(ev.text, '저장된 사건 본문');
  assert.equal(ev.target, loaded.staff[0]); assert.equal(loaded.company.weeksDue, 2);
  assert.equal(typeof ev.options[0].apply, 'function');
  loaded.company.money = 0;
  assert.equal(loaded.answerEvent(0).ok, false); assert.equal(loaded.pendingEvent, ev);
  assert(loaded.answerEvent(1).ok); answerAll(loaded);
  assert.equal(loaded.company.weeksDue, 0);
  assert.equal(loaded.answerEvent(1).ok, false);
  const investor = fresh(); setEvent(investor, 'investor');
  const restored = reload(investor); const money = restored.company.money;
  restored.answerEvent(0); assert(restored.company.money > money);
  const after = restored.company.money; restored.answerEvent(0);
  assert.equal(restored.company.money, after);
  const relGame = fresh(); finished(relGame); relGame.release();
  setEvent(relGame, 'outage', relGame.releases[0].id, 'release');
  const r = reload(relGame); assert.equal(r.pendingEvent.target, r.releases[0]);
});

await test('B03 시작 화면이 저장된 사건을 다시 표시하고 구형 대기 주차를 해소', () => {
  const g = fresh(); setEvent(g, 'investor');
  const ui = Object.create(UI.prototype); ui.g = reload(g);
  const queue = []; ui._pop = (fn) => queue.push(fn); ui.renderAll = () => {};
  let shown = 0; ui._eventFlow = () => { shown++; };
  ui.openingFlow(); queue.forEach((fn) => fn()); assert.equal(shown, 1);
  ui.g.pendingEvent = null; ui.g.company.weeksDue = 2;
  ui.openingFlow(); answerAll(ui.g); assert.equal(ui.g.company.weeksDue, 0);
});

await test('B04 채용 1명 보상 및 기존 저장의 누락 보상은 한 번만 지급', () => {
  const g = fresh(); hireOne(g); assert(g.company.tasksDone.hire1);
  const money = g.company.money; g.checkTasks(); assert.equal(g.company.money, money);
  delete g.company.tasksDone.hire1;
  const loaded = reload(g); const before = loaded.company.money;
  loaded.checkTasks(); assert.equal(loaded.company.money, before + 40000);
  loaded.checkTasks(); assert.equal(loaded.company.money, before + 40000);
});

await test('B05 수동·자동 전투 동일한 시계, 버프 만료, 시간 0 재촉 쿨다운', () => {
  const g = fresh(); const p = project(g);
  p.combo = 3; p.comboT = 0.2; p.critBuff = 0.5; p.critBuffT = 0.2;
  p.urgeAt = { [g.staff[0].id]: 0 }; p.elapsed = 0;
  assert.equal(canUrge(p, g.staff[0]), false);
  const copy = structuredClone(p), staff = structuredClone(g.staff);
  const other = new Map(staff.map((s) => [s.id, s]));
  const rnd = mulberry32(7), rnd2 = mulberry32(7);
  battleTurn(p, g.staffById(), rnd, g.ctx());
  for (let left = RAID.strikeSec; left > 1e-9;) {
    const dt = Math.min(0.25, left); battleTick(copy, other, rnd2, g.ctx(), dt); left -= dt;
  }
  assert.deepEqual(p, copy); assert.deepEqual(g.staff, staff);
  assert(p.elapsed > 0); assert.equal(p.combo, 0); assert.equal(p.critBuffT, 0);
  const debug = fresh(); const boss = project(debug);
  boss.contentId = debug.ownedContents()[0]; boss.methodId = 'quality';
  advanceStage(boss); advanceStage(boss); advanceStage(boss);
  boss.hp = boss.hpMax = 1e9; boss.stages[boss.stage].limit = 0.5;
  boss.paused = true;
  const result = debug.devTurn();
  assert(result.events.some((e) => e.kind === 'bugTimeout'));
  assert(boss.bugClock >= 0.5); assert(debug.finished);
});

await test('B06 배치 유리 업로드·블렌드 패스·재배치 자원 해제', () => {
  const placed = [{ uid: 'booth', id: 'phoneBooth', floor: 0, x: 20, z: 25, rot: 0 }];
  const removed = [], drawn = [];
  const context = { buildPlaced, splitGlass, upload: (mesh) => ({ mesh }),
    disposeMesh: (mesh) => { if (mesh) removed.push(mesh); },
    renderer: { drawMesh: (_l, mesh) => { if (mesh) drawn.push(mesh); } } };
  const view = { game: { company: { placed }, assignDesks() {} },
    officeSolids: [], floorCount: 0, crew: { setWorld() {} }, syncAgents() {} };
  const rebuild = method('rebuildFurniture', context);
  rebuild.call(view); assert(view.gPlacedGlass.mesh.count() > 0);
  method('draw', context).call(view, {}, 'glass'); assert(drawn.includes(view.gPlacedGlass));
  const glass = view.gPlacedGlass, solid = view.gPlaced;
  view.game.company.placed = []; rebuild.call(view);
  assert(removed.includes(glass) && removed.includes(solid));
  assert.equal(view.gPlacedGlass, null); assert.equal(view.gPlaced, null);
});

await test('B07 정상 판매 종료 흐름으로 3작품 출시 태스크 달성', () => {
  const g = fresh(); hireOne(g);
  for (let i = 0; i < 3; i++) {
    g.company.money = 500000; g.company.stamina = g.info().staminaMax;
    finished(g); assert(g.release().ok); g.salesTick(20); g.closeSalesRun(); answerAll(g);
    assert.equal(g.managed().length, 0);
  }
  assert(TASKS.find((t) => t.id === 'live3').done(g)); assert(g.company.tasksDone.live3);
  const coins = g.company.coins; g.checkTasks(); assert.equal(g.company.coins, coins);
});

await test('B08 정상 정산에서 차트·팬레터 추첨 1회, 복원 후 중복 없음', () => {
  const g = fresh(); finished(g); g.release(); g.rnd = () => 0.5; g.salesTick(20);
  const loaded = reload(g); loaded.rnd = () => 0;
  const id = loaded.sales.id;
  let draws = 0; const roll = loaded._rollFanMail.bind(loaded);
  loaded._rollFanMail = (live) => { if (live?.some((r) => r.id === id)) draws++; return roll(live); };
  loaded.closeSalesRun(); assert.equal(draws, 1);
  assert.equal(loaded.company.chartWeeksNo1, 1); assert.equal(loaded.company.fanMailSent[id], 1);
  loaded.closeSalesRun(); assert.equal(draws, 1);
  const again = reload(loaded); again.closeSalesRun();
  assert.equal(again.company.chartWeeksNo1, 1); assert.equal(again.company.fanMailSent[id], 1);
});

await test('B09 저장 실패 안내와 WebGL 복구 시 실패한 자동 새로고침 차단', () => {
  const g = fresh(); const { ui, button } = panel(g); let said = '';
  ui.toast = (s) => { said = s; }; g.save = () => false;
  button('저장하기').onclick(); assert(said.includes('저장하지 못했습니다'));
  const at = main.indexOf("  canvas.addEventListener('webglcontextlost'");
  const end = main.indexOf('  }, false);', at) + '  }, false);'.length;
  for (const saved of [false, true]) {
    let handler, scheduled = 0;
    vm.runInNewContext(main.slice(at, end), { lostShown: false, game: { save: () => saved },
      canvas: { addEventListener: (_type, fn) => { handler = fn; } }, document, location,
      setTimeout: () => { scheduled++; } });
    handler({ preventDefault() {} }); assert.equal(scheduled, saved ? 1 : 0);
    const box = document.body.children.at(-1);
    assert(box.innerHTML.includes(saved ? '저장됐습니다' : '저장에 실패'));
  }
});

await test('B10 숫자 1~7 탭 이동 및 입력창·모달 단축키 보호', () => {
  const ui = Object.create(UI.prototype); ui.view = { fp: { on: false } };
  const tabs = []; ui.openTab = (tab) => tabs.push(tab); ui._wireKeys();
  const press = (key, target = { tagName: 'BODY' }) => listeners.get('keydown')({ key, target, preventDefault() {} });
  for (const key of '1234567') press(key);
  assert.deepEqual(tabs, ['company', 'staff', 'dev', 'shop', 'dex', 'live', 'office']);
  press('4', { tagName: 'TEXTAREA' }); assert.equal(tabs.length, 7);
  document.getElementById('modal').classList.add('show');
  press('4'); assert.equal(tabs.length, 7);
  let turns = 0; ui.g = { project: {}, devTurn: () => { turns++; } }; ui.doTurn();
  assert.equal(turns, 0); document.getElementById('modal').classList.remove('show');
});

await test('B11 의욕 최대일 때 개인·전체 장난감 미소비, 효과가 있을 때만 소비', () => {
  const g = fresh(); const s = hireOne(g); s.hp = s.hpMax;
  for (const toy of SHOP.filter((t) => t.kind === 'toy' && t.mot)) {
    s.motivation = g.info().motivationCap; g.company.bag[toy.id] = 1;
    assert.equal(g.useItem(toy.id, s.id).ok, false); assert.equal(g.bagCount(toy.id), 1);
    s.motivation = 0; assert(g.useItem(toy.id, s.id).ok); assert.equal(g.bagCount(toy.id), 0);
  }
});

await test('B12 시계가 같아도 기획서·프로젝트·속편 ID 중복 없음', () => {
  const g = fresh(); for (let i = 0; i < 30; i++) g.makeProposal();
  const d = JSON.parse(g.serialize()); d.v = 2; delete d.nextProjectId;
  d.releases = [{ id: 'gp700', seriesRoot: 'gp900', users: 100, launchUsers: 100, quality: {} }];
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--reload-id'],
    { input: JSON.stringify(d), encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr); assert.equal(child.stdout.trim(), 'pr901');
});

await test('B13 출시 실패 시 기존 서비스·자금·완성작 원상 유지', () => {
  const g = fresh(); const p = finished(g);
  g.releases = Array.from({ length: g.info().managedCap }, (_, i) =>
    ({ id: 'legacy' + i, title: '기존작', managing: true, earned: 100, quality: p.quality }));
  g.company.marketingId = MARKETING.find((m) => m.cost > 0).id; g.company.money = 0;
  const before = structuredClone(g.releases);
  assert.equal(g.release().ok, false); assert.deepEqual(g.releases, before);
  assert.equal(g.finished, p); assert.equal(g.company.money, 0);
});

await test('전체 JS/MJS 문법·로컬 import, JSON·manifest·서비스워커 경로', async () => {
  async function walk(dir) {
    const out = [];
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...await walk(p)); else out.push(p);
    }
    return out;
  }
  const files = await walk(root); let imports = 0, code = 0, json = 0;
  for (const file of files) {
    if (/\.(js|mjs)$/.test(file)) {
      execFileSync(process.execPath, ['--check', file]); code++;
      const text = await fs.readFile(file, 'utf8');
      for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*)['"](\.[^'"]+)['"]/g)) {
        await fs.access(path.resolve(path.dirname(file), match[1])); imports++;
      }
    } else if (/\.(json|webmanifest)$/.test(file)) { JSON.parse(await fs.readFile(file, 'utf8')); json++; }
  }
  const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  const htmlIds = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(htmlIds).size, htmlIds.length);
  const sw = await fs.readFile(path.join(root, 'sw.js'), 'utf8');
  const assets = vm.runInNewContext(sw.match(/const ASSETS\s*=\s*(\[[\s\S]*?\]);/)[1]);
  for (const asset of assets) await fs.access(path.resolve(root, asset));
  console.log(JSON.stringify({ code, imports, json, htmlIds: htmlIds.length, precache: assets.length }));
});

await test('모든 GLB 파싱·애니메이션 포즈 유한값', async () => {
  globalThis.fetch = async (url) => {
    const data = await fs.readFile(path.join(root, String(url).replace(/^\.\//, '')));
    return { ok: true, json: async () => JSON.parse(data.toString()),
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
  };
  await Promise.all(['furniture', 'city', 'car'].map(loadKit));
  const files = execFileSync('git', ['ls-files', '*.glb'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  let clips = 0, poses = 0;
  for (const file of files) {
    const data = await loadGLB(file);
    for (const p of data.prims) {
      assert(p.pos.every(Number.isFinite) && p.nrm.every(Number.isFinite));
      assert(p.weights.every(Number.isFinite)); assert(p.idx.every((i) => i < p.count));
    }
    const skeleton = new Skeleton(data);
    for (const clip of data.animations) {
      clips++;
      for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
        skeleton.sample(clip, clip.duration * fraction);
        assert(skeleton.solve().every(Number.isFinite)); poses++;
      }
    }
  }
  console.log(JSON.stringify({ models: files.length, clips, poses }));
});

await test('20개 시드에서 자동 전투 → 출시 → 저장 복원 → 정산 완주', () => {
  let totalFrames = 0;
  for (let seed = 1; seed <= 20; seed++) {
    let g = fresh(seed); project(g); let frames = 0;
    while (g.project && frames++ < 12000) {
      if (g.project.pendingCards) g.pickCard(g.project.pendingCards.options[0].id);
      else g.devTick(0.1);
      for (const s of g.staff) assert(Number.isFinite(s.hp) && s.hp >= 0 && s.hp <= s.hpMax);
    }
    totalFrames += frames; assert(g.finished, '미완료 시드 ' + seed);
    assert(STATS.every((k) => Number.isFinite(g.finished.quality[k])));
    assert(Number.isInteger(g.finished.bugs) && g.finished.bugs >= 0);
    answerAll(g); assert(g.release().ok);
    g.salesTick(3); g = reload(g); g.salesTick(20);
    assert(g.sales.ended); assert(Number.isFinite(g.sales.total));
    g.closeSalesRun(); assert.equal(g.sales, null); answerAll(g);
  }
  console.log(JSON.stringify({ seeds: 20, totalFrames }));
});

console.log(`총 ${tests.length}개 검사 그룹 통과. 실제 WebGL·모바일 화면 검사는 별도입니다.`);
