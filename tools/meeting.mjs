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
  viewport: { width: 900, height: 420 }, deviceScaleFactor: 2,
  isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('gone'), { timeout: 120000 });
await page.waitForTimeout(800);

const step = async (label, fn) => {
  try { const r = await fn(); console.log(`✓ ${label}${r ? ' — ' + r : ''}`); return true; }
  catch (e) { console.log(`✗ ${label}: ${e.message}`); return false; }
};

/* ---- staff the studio ----
   The office now opens empty: no desks, no people, and a naming popup on top.
   This scene needs a team, so get through the opening and furnish a floor
   before any of the meeting choreography can be tested at all. */
await step('창업 · 책상 · 채용', async () => {
  const r = await page.evaluate(async () => {
    const g = window.__game, v = window.__view, ui = window.__ui;
    if (!g.company.founded) g.found('회의 스튜디오');
    ui.closeModal();
    g.company.money = 5_000_000;
    const spots = [[10, 9], [17, 9], [10, 15], [17, 15], [10, 24]];
    for (const [x, z] of spots) {
      g.buyFurniture('desk');
      const uid = g.bag[g.bag.length - 1].uid;
      g.placeFurniture(uid, 0, x, z, 0, v.placeChecks());
    }
    v.rebuildFurniture();
    for (let i = 0; i < 5 && g.freeDesks() > 0; i++) {
      if (!g.candidates.length) g.rollCandidates();
      if (!g.hire(g.candidates[0].id).ok) g.rollCandidates();
    }
    v.syncAgents();
    return { staff: g.staff.length, desks: g.deskCount(), agents: v.crew.agents.size };
  });
  await page.waitForTimeout(500);
  if (r.agents < 3) throw new Error(`에이전트 ${r.agents}명`);
  return `책상 ${r.desks} · 직원 ${r.staff} · 에이전트 ${r.agents}`;
});

/* ---- pathing sanity: can an agent reach the meeting room at all? ---- */
await step('경로 탐색', async () => {
  const r = await page.evaluate(() => {
    const v = window.__view;
    const nav = v.crew.navFor(0);
    const mtg = v.crew.meetingOn(0);
    const a = v.crew.all()[0];
    const p = nav.path(a.x, a.z, mtg.seats[0].x, mtg.seats[0].z);
    return { from: [Math.round(a.x), Math.round(a.z)], to: [Math.round(mtg.seats[0].x), Math.round(mtg.seats[0].z)], len: p ? p.length : null };
  });
  if (!r.len) throw new Error(`no route ${r.from} -> ${r.to}`);
  return `${r.from} → ${r.to}, ${r.len} corners`;
});

/* ---- start a project and watch the kickoff meeting ----
   The panel scrolls, so buttons below the fold fail Playwright's viewport
   check. Clicking through the DOM sidesteps that without weakening the test. */
const tapPanel = (text) => page.evaluate((t) => {
  const list = [...document.querySelectorAll('#panel button, #panel .item.click')];
  const b = list.find((x) => x.textContent.includes(t));
  if (!b) throw new Error('no control matching: ' + t);
  b.scrollIntoView({ block: 'center' });
  b.click();
}, text);

// Make sure the panel is open rather than toggling blindly: whether it starts
// collapsed depends on the viewport width.
await page.evaluate(() => document.body.classList.remove('panel-hidden'));
await page.waitForTimeout(350);
await page.evaluate(() => document.querySelector('#tabs .tab[data-tab="dev"]').click());
await page.waitForTimeout(300);
await tapPanel('기획서 뽑기'); await page.waitForTimeout(350);
await page.evaluate(() => document.querySelector('#panel .item.click').click());
await page.waitForTimeout(350);
await tapPanel('개발 시작');
await page.waitForTimeout(700);

await step('회의 시작', async () => {
  const on = await page.evaluate(() => document.body.classList.contains('meeting'));
  if (!on) throw new Error('meeting class never applied');
  return 'body.meeting on';
});

// let them walk over
let seated = 0, walked = false, spoke = 0;
for (let i = 0; i < 40; i++) {
  const st = await page.evaluate(() => {
    const v = window.__view;
    const team = v.game.project ? v.game.project.team : [];
    const ag = team.map((id) => v.crew.get(id)).filter(Boolean);
    return {
      walking: ag.filter((a) => a.state === 'walk').length,
      meeting: ag.filter((a) => a.state === 'meet').length,
      talking: ag.filter((a) => a.bubble).length,
      bubbles: ag.filter((a) => a.bubble).map((a) => `${a.name}: ${a.bubble.text}`),
      body: document.body.classList.contains('meeting'),
      camDist: Math.round(window.__cam.goalDist),
    };
  });
  if (st.walking) walked = true;
  seated = Math.max(seated, st.meeting);
  if (st.talking) { spoke = Math.max(spoke, st.talking); if (st.bubbles.length) console.log('   💬 ' + st.bubbles[0]); }
  if (i === 6) await page.screenshot({ path: `${OUT}/meet-walk.png` });
  if (st.meeting > 0 && st.talking > 0) await page.screenshot({ path: `${OUT}/meet-talk.png` });
  if (!st.body) break;
  await page.waitForTimeout(500);
}
await step('회의실 착석', async () => {
  if (!walked) throw new Error('nobody ever walked');
  if (!seated) throw new Error('nobody reached a chair');
  return `${seated}명 착석, 걸어감 ✓`;
});
await step('회의 대사', async () => {
  if (!spoke) throw new Error('no speech bubbles');
  return `말풍선 ${spoke}개 동시 표시`;
});

await page.waitForTimeout(2500);
await step('회의 종료 후 복귀', async () => {
  const st = await page.evaluate(() => {
    const v = window.__view;
    const ag = v.crew.all();
    return {
      body: document.body.classList.contains('meeting'),
      atDesk: ag.filter((a) => a.state === 'sit' || a.state === 'walk').length,
      total: ag.length,
    };
  });
  if (st.body) throw new Error('still in meeting');
  return `${st.atDesk}/${st.total} 복귀 중/완료`;
});

console.log(errs.length ? 'ERRORS:\n  ' + errs.slice(0, 5).join('\n  ') : 'no console errors');
await ctx.close();
await browser.close();
