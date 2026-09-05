/* 새 UI 배선 검사 — 가방 탭, 룰렛, 홍보 선택, 실시간 판매.

   규칙은 node 로 돌려 볼 수 있다. 여기서 보려는 것은 브라우저에서만 깨지는
   것들이다: 탭 하나가 실제로 열리는가, 룰렛이 떴다가 사라지는가, 결과창을
   닫으면 홍보 선택이 이어서 뜨는가, 출시하면 15초 동안 막대가 서는가,
   그동안 새 게임 착수가 막히는가.

     PLAYWRIGHT=/path/to/playwright/index.mjs PORT=8123 OUT=. node tools/sales.mjs */
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const BASE = process.env.BASE || `http://localhost:${process.env.PORT || 8123}`;
const OUT = process.env.OUT || '.';
const { chromium } = await import(PW);

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({
  viewport: { width: 960, height: 440 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

let pass = 0, fail = 0;
const step = async (label, fn) => {
  try { const r = await fn(); console.log(`  ✓ ${label}${r ? ' — ' + r : ''}`); pass++; }
  catch (e) { console.log(`  ✗ ${label}: ${e.message}`); fail++; }
};

await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('gone'), { timeout: 180000 });
await page.waitForTimeout(700);

// 창업 + 밑천. 자리부터 만든다 — 빈 책상이 없으면 채용이 통째로 막히고,
// 사람이 없으면 개발에 착수할 수 없다.
const setup = await page.evaluate(() => {
  const g = window.__game, v = window.__view, ui = window.__ui;
  if (!g.company.founded) { g.company.founded = true; g.company.name = '검사'; ui.closeModal(); }
  const a = document.getElementById('a2hs'); if (a) a.classList.remove('show');
  g.company.money = 700000; g.company.coins = 60; g.company.stamina = g.company.staminaMax = 40;
  for (let i = 0; i < 4; i++) {
    g.company.placed.push({ uid: 'seat' + i, id: 'desk', floor: 0, x: 6 + i * 6, z: 8, rot: 0 });
  }
  v.rebuildFurniture();
  for (let i = 0; i < 20 && g.staff.length < 3; i++) {
    if (!g.candidates.length) g.rollCandidates();
    const c = g.candidates[0];
    if (!c) break;
    if (!g.hire(c.id).ok) g.candidates.shift();
  }
  g.emit('staff', null);
  return { staff: g.staff.length, desks: g.deskCount() };
});
console.log(`  준비 — 직원 ${setup.staff}명 · 책상 ${setup.desks}개`);
if (setup.staff < 1) { console.log('  ✗ 직원을 못 뽑아 검사를 진행할 수 없다'); process.exit(1); }

console.log('\n── 가구 키트 ──');
await step('키트 가구가 상점에 있다', async () => {
  const n = await page.evaluate(() => window.__view && window.__game
    && Object.keys(window.__game.company).length && document.body ? 1 : 0);
  const has = await page.evaluate(async () => {
    const m = await import('./src/game/furniture.js');
    const k = await import('./src/world/kit.js');
    return { total: m.FURNITURE.filter((f) => f.kit).length, ready: k.kitReady() };
  });
  if (!has.ready) throw new Error('kit.json 이 안 왔다');
  if (has.total < 10) throw new Error('키트 가구가 ' + has.total + '종뿐');
  return `${has.total}종 · 모델 로드됨 (${n})`;
});
await step('키트 가구를 놓으면 삼각형이 늘어난다', async () => {
  const r = await page.evaluate(() => {
    const g = window.__game, v = window.__view;
    const before = v.gPlaced ? v.gPlaced.count : 0;
    g.company.placed.push({ uid: 'kt1', id: 'kitDesk', floor: 0, x: 8, z: 20, rot: 0 });
    g.company.placed.push({ uid: 'kt2', id: 'kitSofa', floor: 0, x: 15, z: 20, rot: 0 });
    v.rebuildFurniture();
    return { before, after: v.gPlaced ? v.gPlaced.count : 0, desks: v.desks.length };
  });
  if (!(r.after > r.before)) throw new Error(`메시가 늘지 않음 ${r.before} → ${r.after}`);
  if (r.desks < 2) throw new Error('키트 책상이 자리를 만들지 않음');
  return `정점 ${r.before} → ${r.after} · 책상 ${r.desks}개`;
});

console.log('\n── 가방 탭 ──');
await step('가방 탭이 따로 있다', async () => {
  await page.click('#tabs .tab[data-tab="bag"]');
  await page.waitForTimeout(150);
  const t = await page.evaluate(() => document.getElementById('panel').textContent);
  if (!t.includes('소모품')) throw new Error('소모품 가방이 없다');
  if (!t.includes('가방')) throw new Error('가구 가방이 없다');
  return '소모품 · 가구 둘 다';
});

console.log('\n── 룰렛 ──');
await step('소재 뽑기가 룰렛으로 돈다', async () => {
  await page.evaluate(() => window.__ui.openTab('shop'));
  await page.waitForTimeout(150);
  const started = await page.evaluate(async () => {
    const ui = window.__ui, g = window.__game;
    const pool = g.lockedContents();
    if (!pool.length) return 'full';
    ui.panelGacha(document.createElement('div'));
    const btns = [...document.querySelectorAll('#panel button')].filter((b) => b.textContent.includes('소재 뽑기'));
    if (!btns.length) return 'nobtn';
    btns[0].click();
    return 'ok';
  });
  if (started === 'nobtn') throw new Error('뽑기 버튼을 못 찾음');
  if (started === 'full') return '소재를 이미 다 모음 (건너뜀)';
  await page.waitForTimeout(400);
  const on = await page.evaluate(() => document.body.classList.contains('rouling'));
  if (!on) throw new Error('룰렛이 뜨지 않음');
  await page.screenshot({ path: OUT + '/s1-roulette.png' });
  await page.waitForFunction(() => !document.body.classList.contains('rouling'), { timeout: 12000 });
  const modal = await page.evaluate(() => document.getElementById('mTitle').textContent);
  await page.evaluate(() => window.__ui.closeModal());
  return `멈춘 뒤 결과창: ${modal}`;
});

console.log('\n── 개발 → 홍보 → 판매 ──');
await step('개발을 시작하면 사무실이 아니라 세트장으로 간다', async () => {
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.makeProposal();
    const pr = g.proposals[0];
    return g.beginDevelopment({
      proposalId: pr.id,
      platformId: g.availablePlatforms()[0].id,
      monetizeId: g.availableMonetize()[0].id,
      teamIds: g.staff.map((s) => s.id),
      seriesOfId: null,
    });
  });
  if (!r.ok) throw new Error(r.why);
  await page.evaluate(() => window.__ui.enterArena());
  await page.waitForTimeout(1200);
  const st = await page.evaluate(() => ({
    arena: document.body.classList.contains('arena'),
    boss: window.__view.boss ? window.__view.boss.x : null,
  }));
  if (!st.arena) throw new Error('아레나에 들어가지 않음');
  if (st.boss !== null && st.boss < 400) throw new Error('보스가 사무실 좌표에 서 있다: ' + st.boss);
  return `아레나 · 보스 x=${st.boss}`;
});

await step('세트장을 나오면 사무실에 보스가 남지 않는다', async () => {
  await page.evaluate(() => window.__ui.exitArena());
  await page.waitForTimeout(400);
  const boss = await page.evaluate(() => (window.__view.boss ? window.__view.boss.x : null));
  if (boss !== null) throw new Error('보스가 남아 있다 x=' + boss);
  return '없음';
});

await step('완성하면 홍보 선택이 스스로 뜬다', async () => {
  const forced = await page.evaluate(() => {
    const g = window.__game;
    // 세 마리를 한 번에 눕힌다. 규칙은 raid.mjs 가 본다. 횟수를 묶어 두는
    // 것이 중요하다 — 조건이 어긋나면 evaluate 안에서 무한 루프가 돌고,
    // 그러면 페이지가 통째로 멈춰 테스트가 죽는 대신 매달린다.
    for (let i = 0; i < 40 && g.project; i++) {
      const p = g.project;
      p.hp = 0;
      if (p.pendingCards) g.pickCard(p.pendingCards.options[0].id);
      else g.devTurn();
    }
    return { project: !!g.project, finished: !!g.finished };
  });
  if (forced.project) throw new Error('40번 굴려도 프로젝트가 안 끝남');
  // 카드 회의가 물려 있으면 결과창은 그것이 끝난 뒤에 뜬다.
  await page.waitForFunction(() => document.getElementById('mTag').textContent === '개발 완료'
    && document.getElementById('modal').classList.contains('show'), { timeout: 30000 });
  const title = await page.evaluate(() => document.getElementById('mTitle').textContent);
  if (!title.includes('「')) throw new Error('개발 완료 창이 없다: ' + title);
  await page.click('#mOk');
  await page.waitForTimeout(300);
  const tag = await page.evaluate(() => document.getElementById('mTag').textContent);
  if (tag !== '홍보') throw new Error('홍보 선택이 이어지지 않음: ' + tag);
  await page.screenshot({ path: OUT + '/s2-marketing.png' });
  return '결과창 → 홍보';
});

await step('홍보를 고르면 출시 확인이 뜨고, 출시하면 판매가 시작된다', async () => {
  await page.evaluate(() => document.querySelectorAll('#mOpts .choice')[0].click());
  await page.waitForTimeout(250);
  const tag = await page.evaluate(() => document.getElementById('mTag').textContent);
  if (tag !== '출시') throw new Error('출시 확인이 없음: ' + tag);
  await page.evaluate(() => document.querySelectorAll('#mOpts .choice')[0].click());
  await page.waitForTimeout(700);
  const on = await page.evaluate(() => document.body.classList.contains('selling'));
  if (!on) throw new Error('판매 화면이 뜨지 않음');
  return '판매 시작';
});

await step('판매 중에는 새 게임을 만들 수 없다', async () => {
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.makeProposal();
    const pr = g.proposals[0];
    return g.beginDevelopment({
      proposalId: pr.id, platformId: g.availablePlatforms()[0].id,
      monetizeId: g.availableMonetize()[0].id,
      teamIds: g.staff.map((s) => s.id), seriesOfId: null,
    });
  });
  if (r.ok) throw new Error('착수가 막히지 않았다');
  const wk = await page.evaluate(() => window.__game.nextWeek());
  if (wk && wk.ok !== false) throw new Error('주 넘기기가 막히지 않았다');
  return r.why;
});

await step('막대가 서고 자금이 실시간으로 오른다', async () => {
  const snap = () => page.evaluate(() => ({
    t: window.__game.sales ? window.__game.sales.t : -1,
    done: window.__game.sales ? window.__game.sales.done : -1,
    money: window.__game.company.money,
    bars: [...document.querySelectorAll('#srBars i')].filter((b) => parseFloat(b.style.height) > 0).length,
  }));
  const a = await snap();
  // 먼저 rAF 가 실제로 판매 시계를 돌리는지 본다. 스위프트셰이더에서는
  // 프레임이 초당 두세 장이라 15초가 그대로 흐르지 않으므로, 확인만 하고
  // 나머지 주차는 손으로 민다.
  await page.waitForTimeout(3000);
  const b = await snap();
  if (!(b.t > a.t)) throw new Error('판매 시계가 돌지 않는다');
  await page.evaluate(() => { for (let i = 0; i < 60; i++) window.__game.salesTick(0.5); });
  await page.waitForTimeout(300);
  const c = await page.evaluate(() => ({
    money: window.__game.company.money,
    bars: [...document.querySelectorAll('#srBars i')].filter((x) => parseFloat(x.style.height) > 0).length,
    poly: document.getElementById('srPoly').getAttribute('points'),
    total: window.__game.sales ? window.__game.sales.total : 0,
    capped: window.__game.company.money >= window.__game.info().cashCap,
  }));
  if (c.bars < 5) throw new Error('막대가 ' + c.bars + '개뿐');
  if (c.total <= 0) throw new Error('매출이 0');
  // 자금 상한에 붙어 있으면 오를 자리가 없다. 그때는 매출만 본다.
  if (c.money <= a.money && !c.capped) throw new Error('자금이 오르지 않음');
  if (!c.poly || c.poly.split(' ').length < 5) throw new Error('꺾은선이 안 그려짐');
  await page.screenshot({ path: OUT + '/s3-sales.png' });
  return `막대 ${c.bars}개 · 누적 ₩${c.total.toLocaleString()} · 자금 +${(c.money - a.money).toLocaleString()}`;
});

await step('다 팔면 정산이 뜨고, 확인하면 다시 만들 수 있다', async () => {
  await page.waitForFunction(() => document.body.classList.contains('settled'), { timeout: 30000 });
  await page.screenshot({ path: OUT + '/s4-settled.png' });
  await page.click('#srOk');
  await page.waitForTimeout(400);
  const st = await page.evaluate(() => ({
    selling: document.body.classList.contains('selling'),
    tag: document.getElementById('mTag').textContent,
    can: !window.__game.selling(),
  }));
  if (st.selling) throw new Error('판매 화면이 안 닫힘');
  if (!st.can) throw new Error('아직 판매 중');
  return `정산 확인 → ${st.tag} 요약`;
});

console.log(`\n${pass} 통과 · ${fail} 실패`);
if (errs.length) { console.log('--- 오류 ---'); for (const e of errs.slice(0, 8)) console.log(e); }
await browser.close();
process.exit(fail || errs.length ? 1 : 0);
