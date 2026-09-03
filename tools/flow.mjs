/* End-to-end flow test on a real mobile-landscape viewport.
   Drives the actual DOM controls so a broken render path fails loudly, and
   uses the game object only to set up situations (money, rank) that would
   otherwise take an hour of play to reach. */
/* Playwright is resolved from wherever it happens to be installed: this repo
   has no node_modules, and the harness is a dev tool, not a dependency.
   Set PLAYWRIGHT=/path/to/playwright/index.mjs to override, and PORT/BASE to
   point at a server other than the default. */
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const BASE = process.env.BASE || `http://localhost:${process.env.PORT || 8123}`;
const OUT = process.env.OUT || '.';
const { chromium } = await import(PW);

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({
  viewport: { width: 896, height: 414 }, deviceScaleFactor: 2,
  isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
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
const openTab = (name) => page.evaluate((n) => {
  document.body.classList.remove('panel-hidden');
  document.querySelector(`#tabs .tab[data-tab="${n}"]`).click();
}, name);
/* Buttons first: a staff row contains the text of every button inside it, so
   searching in document order would hit the row and toggle the panel shut. */
const tap = (text) => page.evaluate((t) => {
  const hit = (sel) => [...document.querySelectorAll(sel)]
    .find((x) => !x.disabled && x.textContent.includes(t));
  const b = hit('#panel button') || hit('#panel .item.click') || hit('#panel .toggle');
  if (!b) throw new Error('no enabled control matching: ' + t);
  b.scrollIntoView({ block: 'center' });
  b.click();
}, text);
const state = () => page.evaluate(() => {
  const g = window.__game, v = window.__view;
  return {
    money: g.company.money, rank: g.company.rank, floors: g.company.floors,
    stamina: g.company.stamina, staff: g.staff.length, shipped: g.company.shipped,
    proposals: g.proposals.length, project: g.project ? g.project.title : null,
    hp: g.project ? g.project.hp : null, cards: g.project ? !!g.project.pendingCards : false,
    finished: g.finished ? g.finished.title : null, releases: g.releases.length,
    research: g.company.researchPts, contract: !!g.company.contract,
    modal: document.getElementById('modal').classList.contains('show'),
    meeting: document.body.classList.contains('meeting'),
    viewFloors: v.floorCount, tris: v.gSolid.count / 3, agents: v.crew.agents.size,
  };
});
/* The modal is either a choice list (idea cards, confirms) or a plain OK box. */
const closeModal = (pickText) => page.evaluate((t) => {
  const m = document.getElementById('modal');
  if (!m.classList.contains('show')) return null;
  const opts = [...m.querySelectorAll('#mOpts .choice')];
  const label = document.getElementById('mTitle').textContent;
  if (opts.length) {
    const pick = t ? opts.find((o) => o.textContent.includes(t)) : opts[0];
    (pick || opts[0]).click();
  } else document.getElementById('mOk').click();
  return label;
}, pickText);

await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('gone'), { timeout: 180000 });
await page.waitForTimeout(900);

console.log('\n── 1. 부팅 ──');
await step('부팅 완료, 에러 없음', async () => {
  if (errs.length) throw new Error(errs[0]);
  const s = await state();
  return `삼각형 ${Math.round(s.tris).toLocaleString()}개 · 직원 ${s.agents}명`;
});

console.log('\n── 2. 회사 탭 (계약 · 연구 · 저장) ──');
await openTab('company'); await page.waitForTimeout(250);
await step('계약 수주', async () => {
  await tap('QA 대행'); await page.waitForTimeout(200);
  const s = await state();
  if (!s.contract) throw new Error('계약이 걸리지 않음');
  return '계약 진행 중';
});
await step('계약 납품 (주간 진행)', async () => {
  const before = (await state()).money;
  await tap('다음 주로'); await page.waitForTimeout(300);
  const s = await state();
  if (s.contract) throw new Error('1주 뒤에도 미납품');
  if (s.money <= before) throw new Error('입금되지 않음');
  return `₩${(s.money - before).toLocaleString()} 입금 · 연구 ${s.research}P`;
});
await step('연구 구매', async () => {
  await page.evaluate(() => { window.__game.company.researchPts = 500; window.__ui.renderPanel(); });
  await tap('40P'); await page.waitForTimeout(200);
  const lvl = await page.evaluate(() => window.__game.researchLevel('genre'));
  if (lvl !== 1) throw new Error('연구 단계가 오르지 않음');
  return '장르 연구 Lv.1';
});
await step('저장하기', async () => {
  await tap('저장하기'); await page.waitForTimeout(200);
  const has = await page.evaluate(() => !!localStorage.getItem('socialdev3d.save.v1'));
  if (!has) throw new Error('저장되지 않음');
  return 'localStorage 기록됨';
});

console.log('\n── 3. 직원 탭 (성장 · 채용) ──');
await openTab('staff'); await page.waitForTimeout(250);
await step('직원 카드를 누르면 상세가 열린다', async () => {
  await page.evaluate(() => document.querySelector('#panel .item.click').click());
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({
    sel: window.__ui.selectedStaff,
    txt: document.getElementById('panel').textContent,
  }));
  if (!r.sel) throw new Error('selectedStaff 가 설정되지 않음');
  if (!r.txt.includes('경험치')) throw new Error('경험치 표시 없음');
  if (!r.txt.includes('아이템 지급')) throw new Error('아이템 목록 없음');
  return '선택 · 경험치 · 아이템 · 전직 노출';
});
await step('아이템 지급 → 레벨업', async () => {
  await page.evaluate(() => { window.__game.company.money = 5_000_000; window.__ui.renderPanel(); });
  const sel = () => page.evaluate(() => {
    const s = window.__game.staff.find((x) => x.id === window.__ui.selectedStaff);
    return s ? s.level : -1;
  });
  const before = await sel();
  await tap('기술 서적'); await page.waitForTimeout(300);
  const after = await sel();
  if (after <= before) throw new Error(`레벨 그대로 (${before})`);
  return `Lv.${before} → Lv.${after}`;
});
await step('채용 (정원이 찼으면 랭크를 올려서)', async () => {
  const before = (await state()).staff;
  await page.evaluate(() => {
    const g = window.__game;
    g.company.rank = 4; g.company.maxFloors = 1; g.company.money = 5_000_000;
    window.__ui.renderPanel();
  });
  await tap('채용 ₩'); await page.waitForTimeout(500);
  const s = await state();
  if (s.staff !== before + 1) throw new Error('인원이 늘지 않음');
  return `${before} → ${s.staff}명 (정원 ${await page.evaluate(() => window.__game.info().staffCap)})`;
});

console.log('\n── 4. 개발 탭 (기획 → 회의 → 개발) ──');
await openTab('dev'); await page.waitForTimeout(250);
await step('기획서 뽑기', async () => {
  await tap('기획서 뽑기'); await page.waitForTimeout(300);
  if (!(await state()).proposals) throw new Error('기획서가 생기지 않음');
  return '기획서 1건';
});
await step('개발 착수 + 회의 연출', async () => {
  await page.evaluate(() => document.querySelector('#panel .item.click').click());
  await page.waitForTimeout(250);
  await tap('개발 시작');
  await page.waitForTimeout(900);
  const s = await state();
  if (!s.project) throw new Error('프로젝트가 시작되지 않음');
  if (!s.meeting) throw new Error('회의 연출이 시작되지 않음');
  return `「${s.project}」 · 회의 중`;
});
await step('회의 종료 후 개발 가능', async () => {
  for (let i = 0; i < 40; i++) {
    if (!(await state()).meeting) break;
    await page.waitForTimeout(500);
  }
  if ((await state()).meeting) throw new Error('회의가 끝나지 않음');
  return '카메라 복귀';
});

console.log('\n── 5. 개발 전투 · 아이디어 카드 ──');
await page.evaluate(() => { window.__view.meetingScenes = false; });
let cards = 0;
await step('HP를 0까지 (카드 2장 선택)', async () => {
  for (let i = 0; i < 900; i++) {
    const s = await state();
    if (s.modal) { const t = await closeModal(); await page.waitForTimeout(150); if (t) cards++; continue; }
    if (!s.project) break;
    const ok = await page.evaluate(() => {
      const g = window.__game;
      if (g.company.stamina < 2) { g.nextWeek(); return true; }
      return g.devTurn().ok;
    });
    if (!ok) await page.evaluate(() => window.__game.nextWeek());
    if (i % 12 === 0) await page.waitForTimeout(60);
  }
  const s = await state();
  if (!s.finished) throw new Error('완성되지 않음');
  if (cards < 2) throw new Error(`카드 모달이 ${cards}회만 열림`);
  return `「${s.finished}」 완성 · 카드 ${cards}회`;
});

console.log('\n── 6. 출시 준비 (디버그 · 홍보 · 출시) ──');
// The finished-game panel lives on the 개발 tab: it is the last step of making
// a game, not the first step of running one.
await openTab('dev'); await page.waitForTimeout(300);
await step('디버그로 버그 제거', async () => {
  const b0 = await page.evaluate(() => window.__game.finished.bugs);
  if (b0 > 60) throw new Error(`버그가 ${b0}개나 나옴 — 디버그가 작업이 아니라 노가다가 된다`);
  for (let i = 0; i < 40; i++) {
    const r = await page.evaluate(() => {
      if (window.__game.company.stamina < 2) window.__game.nextWeek();
      return window.__game.debugProject().ok;
    });
    if (!r) break;
    if ((await page.evaluate(() => window.__game.finished.bugs)) <= 0) break;
  }
  const b1 = await page.evaluate(() => window.__game.finished.bugs);
  if (b1 > 0) throw new Error(`버그 ${b1}개 남음`);
  return `버그 ${b0} → 0`;
});
await step('홍보 선택', async () => {
  await page.evaluate(() => { window.__game.company.money = 5_000_000; window.__ui.renderPanel(); });
  await tap('SNS 바이럴'); await page.waitForTimeout(250);
  const mk = await page.evaluate(() => window.__game.company.marketingId);
  if (mk !== 'sns') throw new Error('홍보가 선택되지 않음: ' + mk);
  return 'SNS 바이럴';
});
await step('출시', async () => {
  await tap('출시하기'); await page.waitForTimeout(700);
  await closeModal(); await page.waitForTimeout(400);
  await closeModal(); await page.waitForTimeout(300);
  const s = await state();
  if (!s.releases) throw new Error('출시 목록이 비어 있음');
  if (s.finished) throw new Error('완성작이 남아 있음');
  const r = await page.evaluate(() => {
    const x = window.__game.releases[0];
    return { t: x.title, u: x.users, c: x.criticTotal };
  });
  return `「${r.t}」 ${r.c}/40점 · 초기 유저 ${r.u.toLocaleString()}명`;
});

console.log('\n── 7. 사무실 탭 (층 구매 → 3D 반영) ──');
await openTab('office'); await page.waitForTimeout(300);
await step('층 구매 (랭크/자금 충족 시)', async () => {
  await page.evaluate(() => {
    const g = window.__game;
    g.company.rank = 9; g.company.maxFloors = 3; g.company.money = 40_000_000;
    g.company.staminaMax = 20; g.company.stamina = 20;
    window.__ui.renderPanel();
  });
  const before = (await state()).floors;
  const tris0 = (await state()).tris;
  await tap('층 입주 · ₩'); await page.waitForTimeout(400);
  const asked = await closeModal('예');
  if (!asked) throw new Error('확인 창이 뜨지 않음');
  // The rebuild bakes AO and a walk grid per storey; under software GL that is
  // slow, so poll for the new geometry rather than guessing a delay.
  for (let i = 0; i < 60; i++) {
    if ((await state()).tris > tris0) break;
    await page.waitForTimeout(1000);
  }
  const s = await state();
  if (s.tris <= tris0) throw new Error(`지오메트리가 그대로 (${Math.round(tris0)} 삼각형) — 층이 실제로 지어지지 않음`);
  const deskFloors = await page.evaluate(() => [...new Set(window.__view.desks.map((d) => d.floor))].sort());
  if (!deskFloors.includes(1)) throw new Error('2층에 책상이 없음');
  if (s.floors !== before + 1) throw new Error(`층수 그대로 (${s.floors})`);
  if (s.viewFloors < s.floors) throw new Error(`3D는 ${s.viewFloors}층만 세워짐`);
  return `${before} → ${s.floors}층 · 삼각형 ${Math.round(tris0).toLocaleString()} → ${Math.round(s.tris).toLocaleString()}개 · 책상 층 ${deskFloors.join(',')}`;
});
await step('새 층 보기 + 직원 재배치', async () => {
  await openTab('office'); await page.waitForTimeout(250);
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#panel .floorcard.owned button')];
    cards[cards.length - 1].click();
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => { window.__game.assignDesks(window.__view.desks); });
  await page.waitForTimeout(600);
  const placed = await page.evaluate(() => {
    const v = window.__view, g = window.__game;
    const byFloor = {};
    for (const s of g.staff) {
      const d = g.desks.find((x) => x.id === s.deskId);
      if (d) byFloor[d.floor] = (byFloor[d.floor] || 0) + 1;
    }
    return { f: v.floor, on: v.crew.all().filter((a) => a.home).length,
      all: v.crew.all().length, byFloor: JSON.stringify(byFloor) };
  });
  if (placed.on !== placed.all) throw new Error(`${placed.all - placed.on}명이 자리를 못 찾음`);
  return `${placed.f + 1}F 표시 · 착석 ${placed.on}/${placed.all} · 층별 ${placed.byFloor}`;
});

console.log('\n── 8. 저장/불러오기 왕복 ──');
await step('저장 후 새로고침 → 회사 복원', async () => {
  const before = await state();
  await page.evaluate(() => window.__game.save());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('gone'), { timeout: 180000 });
  await page.waitForTimeout(1200);
  await closeModal(); await page.waitForTimeout(400);
  const after = await state();
  if (after.shipped !== before.shipped) throw new Error(`출시작 ${before.shipped} → ${after.shipped}`);
  if (after.floors !== before.floors) throw new Error(`층수 ${before.floors} → ${after.floors}`);
  if (after.staff !== before.staff) throw new Error(`직원 ${before.staff} → ${after.staff}`);
  return `직원 ${after.staff} · ${after.floors}층 · 출시 ${after.shipped}작 복원`;
});

console.log('\n── 9. 렌더러 ──');
await step('프레임이 계속 돈다', async () => {
  const a = await page.evaluate(() => window.__view.frames || 0);
  await page.waitForTimeout(2500);
  const b = await page.evaluate(() => window.__view.frames || 0);
  if (b <= a) throw new Error('프레임 카운터가 멈춤');
  return `${b - a} 프레임 / 2.5초`;
});
await page.screenshot({ path: `${OUT}/flow-final.png` });

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
if (errs.length) { console.log('콘솔 오류:'); for (const e of [...new Set(errs)].slice(0, 8)) console.log('  ' + e); }
else console.log('콘솔 오류 없음');
await ctx.close(); await browser.close();
process.exit(fail ? 1 : 0);
