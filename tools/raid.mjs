/* 보스 아레나 검사 — 자동 전투가 실제로 세 마리를 잡고 프로젝트를 끝내는가.

   여기서 보려는 것은 규칙이 아니라 **배선**이다: 규칙은 node 로 돌릴 수 있고
   이미 돌려봤다. 브라우저에서만 깨지는 것은 rAF 루프가 devTick 을 부르는가,
   스테이지가 넘어갈 때 3D 보스가 바뀌는가, 카드 팝업이 전투를 막았다가
   풀어주는가, 화면이 정말 바뀌는가다. */
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const BASE = process.env.BASE || `http://localhost:${process.env.PORT || 8123}`;
const OUT = process.env.OUT || '.';
const { chromium } = await import(PW);

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({
  viewport: { width: 896, height: 414 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n')));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

let pass = 0, fail = 0;
const step = async (label, fn) => {
  try { const r = await fn(); console.log(`  ✓ ${label}${r ? ' — ' + r : ''}`); pass++; }
  catch (e) { console.log(`  ✗ ${label}: ${e.message}`); fail++; }
};
const state = () => page.evaluate(() => {
  const g = window.__game, v = window.__view, u = window.__ui;
  const p = g.project;
  return {
    project: p ? p.title : null,
    stage: p ? p.stage : null, stages: p ? p.stages.length : 0,
    hp: p ? p.hp : null, hpMax: p ? p.hpMax : null,
    strikes: p ? p.strikes : 0, turn: p ? p.turn : 0,
    cards: p ? !!p.pendingCards : false,
    stamina: g.company.stamina,
    arena: document.body.classList.contains('arena'),
    rest: document.body.classList.contains('rest'),
    boss: v.boss ? v.boss.def.id : null,
    bossName: document.getElementById('aBossName').textContent,
    pips: document.getElementById('aPips').children.length,
    party: document.getElementById('aParty').children.length,
    modal: document.getElementById('modal').classList.contains('show'),
    modalTitle: document.getElementById('mTitle').textContent,
    finished: g.finished ? g.finished.title : null,
    salesVisible: document.body.classList.contains('has-sales'),
    hpBarW: document.getElementById('aBossHp').style.width,
  };
});
const wait = async (fn, ms = 30000, what = '조건') => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await state();
    if (fn(s)) return s;
    if (errs.length) throw new Error(errs[0]);
    await page.waitForTimeout(150);
  }
  throw new Error(`시간 초과: ${what}`);
};
const pickFirstChoice = () => page.evaluate(() => {
  const m = document.getElementById('modal');
  if (!m.classList.contains('show')) return null;
  const o = m.querySelector('#mOpts .choice');
  if (o) { o.click(); return 'choice'; }
  document.getElementById('mOk').click();
  return 'ok';
});

await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('gone'), { timeout: 180000 });
await page.waitForTimeout(600);

/* 창업 모달(이름 입력 → 지원금)이 아직 떠 있으면 먼저 치운다. 이걸 안 하면
   뒤의 카드 검사가 창업 팝업을 카드로 오인한다. */
for (let i = 0; i < 6; i++) {
  const open = await page.evaluate(() => document.getElementById('modal').classList.contains('show'));
  if (!open) break;
  await pickFirstChoice();
  await page.waitForTimeout(250);
}

console.log('\n── 1. 개발 착수 ──');
await step('회사를 세우고 팀을 꾸린다', async () => {
  const r = await page.evaluate(() => {
    const g = window.__game;
    if (!g.company.founded) g.found('테스트 스튜디오');
    g.company.money = 3_000_000;
    g.company.stamina = g.company.staminaMax;
    const free = g.freeDesks; g.freeDesks = () => 99;
    for (let i = 0; i < 3; i++) { g.rollCandidates(1); g.hire(g.candidates[0].id); }
    g.freeDesks = free;
    return { staff: g.staff.length, stam: g.company.stamina };
  });
  if (r.staff < 3) throw new Error('채용 실패: ' + r.staff);
  return `${r.staff}명 · 스태미나 ${r.stam}`;
});

await step('착수에 스태미나가 든다 — 전투에는 들지 않는다', async () => {
  const r = await page.evaluate(() => {
    const g = window.__game;
    const before = g.company.stamina;
    g.makeProposal();
    const afterProposal = g.company.stamina;
    const pr = g.proposals[0];
    const res = g.beginDevelopment({
      proposalId: pr.id, platformId: g.availablePlatforms()[0].id,
      monetizeId: g.availableMonetize()[0].id, teamIds: g.staff.map((s) => s.id),
    });
    return {
      ok: res.ok, why: res.why, before, afterProposal, after: g.company.stamina,
      need: g.project ? g.project.devStamina : null,
      stages: g.project ? g.project.stages.map((s) => s.hpMax) : null,
      total: g.project ? g.project.totalHp : null,
    };
  });
  if (!r.ok) throw new Error(r.why);
  if (r.after !== r.afterProposal - r.need) throw new Error(`스태미나 차감이 안 맞음 ${r.afterProposal}→${r.after}, 필요 ${r.need}`);
  if (r.stages.length !== 3) throw new Error('보스가 3마리가 아님: ' + r.stages.length);
  return `착수 -${r.need} · 스테이지 HP ${r.stages.join('/')} (합 ${r.total})`;
});

console.log('\n── 2. 아레나 ──');
await step('아레나에 들어가면 경영 UI 가 비켜선다', async () => {
  await page.evaluate(() => window.__ui.enterArena());
  await page.waitForTimeout(300);
  const s = await state();
  if (!s.arena) throw new Error('body.arena 가 안 붙음');
  if (s.pips !== 3) throw new Error('스테이지 표시가 3개가 아님: ' + s.pips);
  if (s.party !== 3) throw new Error('파티 카드가 3장이 아님: ' + s.party);
  const hidden = await page.evaluate(() => {
    const vis = (id) => {
      const e = document.getElementById(id);
      return e ? getComputedStyle(e).display !== 'none' : false;
    };
    return { side: vis('side'), battle: vis('battle'), arena: vis('arena') };
  });
  if (hidden.side || hidden.battle) throw new Error('패널이 안 숨음: ' + JSON.stringify(hidden));
  if (!hidden.arena) throw new Error('아레나가 안 보임');
  return `보스 ${s.bossName} · 파티 ${s.party}명`;
});

await step('버튼을 누르지 않아도 직원들이 알아서 때린다', async () => {
  const a = await state();
  const b = await wait((s) => s.strikes > a.strikes + 4, 20000, '타격 누적');
  if (b.stamina !== a.stamina) throw new Error(`전투가 스태미나를 먹었다 ${a.stamina}→${b.stamina}`);
  return `${b.strikes}타 · HP ${b.hp}/${b.hpMax} · 스태미나 그대로 ${b.stamina}`;
});

console.log('\n── 3. 3연전 ──');
await step('1번 보스를 잡으면 내용 카드가 뜬다', async () => {
  await page.evaluate(() => { window.__ui.speed = 4; });
  const s = await wait((x) => x.cards || x.stage > 0, 90000, '1번 보스 격파');
  if (!s.cards) throw new Error('카드가 안 뜸');
  return `${s.modalTitle || '카드 대기'}`;
});

await step('내용을 고르면 합성 팝업이 뜨고 2번 보스가 선다', async () => {
  const a = await state();
  await wait((s) => s.modal, 15000, '카드 모달');
  await pickFirstChoice();
  await page.waitForTimeout(400);
  const fusion = await page.evaluate(() => ({
    tag: document.getElementById('mTag').textContent,
    title: document.getElementById('mTitle').textContent,
    fuse: !!document.querySelector('.fuse'),
  }));
  if (fusion.tag !== '합성' || !fusion.fuse) throw new Error('합성 팝업이 안 뜸: ' + JSON.stringify(fusion));
  await pickFirstChoice();
  const s = await wait((x) => x.stage === 1 && !x.cards && x.bossName !== a.bossName, 15000, '2번 보스');
  if (!/융합체/.test(s.bossName)) throw new Error('2번 보스 이름이 조합에서 안 나옴: ' + s.bossName);
  return `${fusion.title} → ${s.bossName}`;
});

await step('2번 보스는 다른 몸으로 나온다', async () => {
  const s = await wait((x) => x.boss && x.boss !== 'cat', 30000, '보스 모델 교체');
  return `${s.boss}`;
});

await step('끝까지 자동으로 굴러 완성된다', async () => {
  for (let i = 0; i < 1400; i++) {
    const s = await state();
    if (s.finished) return `「${s.finished}」`;
    if (s.rest) {
      await page.evaluate(() => {
        const g = window.__game;
        for (const st of g.staff) st.hp = st.hpMax;   // 밥을 먹였다고 치자
      });
    }
    if (s.modal) await pickFirstChoice();
    if (errs.length) throw new Error(errs[0]);
    await page.waitForTimeout(120);
  }
  throw new Error('완성되지 않음: ' + JSON.stringify(await state()));
});

console.log('\n── 4. 출시와 판매 현황 ──');
await step('출시하면 판매 패널이 뜬다', async () => {
  const r = await page.evaluate(() => {
    const g = window.__game;
    while (g.finished && g.finished.bugs > 3 && g.company.stamina > 0) {
      if (!g.debugProject().ok) break;
    }
    const res = g.release();
    window.__ui.renderAll();
    return { ok: res.ok, why: res.why, releases: g.releases.length };
  });
  if (!r.ok) throw new Error(r.why);
  await page.evaluate(() => { window.__ui.exitArena(); });
  await page.waitForTimeout(200);
  await page.evaluate(() => { window.__game.nextWeek(); window.__ui.renderAll(); });
  await page.waitForTimeout(300);
  const s = await state();
  if (!s.salesVisible) throw new Error('판매 패널이 안 뜸');
  const sales = await page.evaluate(() => ({
    vis: getComputedStyle(document.getElementById('sales')).display,
    cards: document.getElementById('sgList').children.length,
    spark: document.querySelectorAll('#sales .spark i').length,
    week: document.getElementById('sgWeek').textContent,
  }));
  if (sales.vis === 'none') throw new Error('#sales 가 display:none');
  if (!sales.cards) throw new Error('판매 카드가 없음');
  return `${sales.cards}개 · 막대 ${sales.spark} · ${sales.week}`;
});

await page.screenshot({ path: `${OUT}/raid.png` });
if (errs.length) { console.log('\n--- 콘솔 오류 ---'); for (const e of errs.slice(0, 6)) console.log(e); }
console.log(`\n${pass} 통과 · ${fail} 실패${errs.length ? ` · 오류 ${errs.length}건` : ''}`);
await browser.close();
process.exit(fail || errs.length ? 1 : 0);
