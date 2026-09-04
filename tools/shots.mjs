#!/usr/bin/env node
/* Screenshots of the things that are hard to assert on.

   A skinned monster can pass every numeric check — finite joints, the right
   clip playing, a mesh on the GPU — and still be inside out, ten times too
   big, or textured with someone's elbow. So this drives the game to each state
   worth looking at and writes a PNG. It is for human eyes, not for CI.

     node tools/shots.mjs            # writes shot-*.png next to the repo
     OUT=/tmp node tools/shots.mjs */

const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const BASE = process.env.BASE || `http://localhost:${process.env.PORT || 8123}`;
const OUT = process.env.OUT || '.';
const { chromium } = await import(PW);

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({
  viewport: { width: 960, height: 460 }, deviceScaleFactor: 2,
  isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR: ' + e.message));

await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('gone'), { timeout: 180000 });
await page.waitForTimeout(1200);

// Software GL renders at a few frames a second here, so every "settle" has to
// wait on the frame counter rather than on wall-clock time.
const frames = (n) => page.waitForFunction(
  (target) => (window.__view.frames || 0) > target,
  n, { timeout: 120000 },
).catch(() => {});
const settle = async (n = 6) => {
  const at = await page.evaluate(() => window.__view.frames || 0);
  await frames(at + n);
};
const shot = async (name) => {
  await settle(8);
  await page.screenshot({ path: `${OUT}/shot-${name}.png` });
  console.log(`  ${OUT}/shot-${name}.png`);
};

console.log('창업 화면');
await shot('01-founding');

await page.evaluate(() => {
  const g = window.__game, ui = window.__ui;
  if (!g.company.founded) g.found('스튜디오 스냅샷');
  ui.closeModal();
  g.company.money = 20_000_000;
  ui.renderAll();
});

console.log('빈 사무실');
await page.evaluate(() => { document.body.classList.add('panel-hidden'); });
await shot('02-empty-office');

console.log('배치 모드');
await page.evaluate(() => {
  const g = window.__game, v = window.__view, ui = window.__ui;
  g.buyFurniture('desk');
  v.startPlacing(g.bag[0].uid);
  v.movePlace(10, 9);
  ui.renderPlaceBar();
});
await shot('03-placing');

console.log('가구를 놓은 사무실');
await page.evaluate(() => {
  const g = window.__game, v = window.__view;
  v.commitPlace();
  const plan = [
    ['desk', 17, 9], ['desk', 10, 14], ['desk', 17, 14],
    ['deskDual', 48, 21], ['deskDual', 55, 21],
    ['plantTall', 5, 5], ['coffee', 5, 22], ['couch', 14, 24],
    ['shelf', 10, 5], ['whiteboard', 17, 5], ['rug', 12, 20],
  ];
  for (const [id, x, z] of plan) {
    if (!g.buyFurniture(id).ok) continue;
    const uid = g.bag[g.bag.length - 1].uid;
    g.placeFurniture(uid, 0, x, z, 0, v.placeChecks());
  }
  v.rebuildFurniture();
  for (let i = 0; i < 8 && g.freeDesks() > 0; i++) {
    if (!g.candidates.length) g.rollCandidates();
    if (!g.hire(g.candidates[0].id).ok) g.rollCandidates();
  }
  v.syncAgents();
  window.__ui.renderAll();
});
await page.waitForTimeout(600);
await shot('04-furnished');

/* Each monster in turn, framed from the battle camera. Loading is async, so
   each one waits for its own model rather than a fixed delay. */
for (const [id, hp] of [['cat', 10000], ['orc', 40000], ['demon', 150000]]) {
  console.log(`보스: ${id}`);
  await page.evaluate((hpMax) => {
    const g = window.__game, v = window.__view;
    // A fake project just to hang a monster off: the fight itself is covered by
    // the flow test, and this only needs the right species at the right size.
    g.project = {
      id: 'shot' + hpMax, hpMax, hp: hpMax * 0.62, turn: 3,
      title: '스냅샷', genreId: 'rpg', platformId: 'smart', monetizeId: 'paid',
      proposal: { grade: 3 }, seriesN: 1, team: g.staff.map((s) => s.id),
      raw: { craze: 0, usability: 0, impact: 0, social: 0, retention: 0 },
    };
    v.spawnBoss(g.project);
  }, hp);
  await page.waitForFunction((want) => window.__view.boss && window.__view.boss.def.id === want,
    id, { timeout: 120000 });
  await page.evaluate(() => { window.__view.focusBoss(); document.body.classList.add('panel-hidden'); });
  await page.waitForTimeout(900);
  await shot(`05-boss-${id}`);
}

console.log('전투 UI');
await page.evaluate(() => {
  const v = window.__view;
  if (v.boss) v.boss.react(v.rnd);
  window.__ui.renderBattle();
});
await shot('06-battle');

console.log('패널: 사무실 탭');
await page.evaluate(() => {
  window.__view.clearBoss();
  window.__game.project = null;
  document.body.classList.remove('panel-hidden');
  window.__ui.openTab('office');
});
await shot('07-office-panel');

await ctx.close();
await browser.close();
