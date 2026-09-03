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
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

const t0 = Date.now();
await page.goto(BASE + '/index.html', { waitUntil: 'load' });

let lastStep = '';
for (let i = 0; i < 120; i++) {
  const st = await page.evaluate(() => ({
    step: document.getElementById('bootStep')?.textContent,
    gone: document.getElementById('boot')?.classList.contains('gone') ?? true,
  })).catch(() => ({ step: '?', gone: false }));
  if (st.step !== lastStep) {
    console.log(`+${((Date.now() - t0) / 1000).toFixed(1)}s  ${st.step}`);
    lastStep = st.step;
  }
  if (st.gone) { console.log(`+${((Date.now() - t0) / 1000).toFixed(1)}s  BOOTED`); break; }
  if (errs.length) break;
  await page.waitForTimeout(1000);
}

if (errs.length) { console.log('--- errors ---'); for (const e of errs) console.log(e); }
else {
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => {
    const v = window.__view, g = window.__game;
    return v ? {
      agents: v.crew.agents.size,
      navs: v.crew.navs.length,
      meetings: v.crew.meetings.length,
      spots: v.crew.spots.length,
      desks: v.desks.length,
      tris: v.gSolid.count / 3,
      staffPlaced: v.crew.all().filter((a) => a.home).length,
      floors: g.company.floors,
      research: g.company.researchPts,
      trends: g.company.trends && g.company.trends.genreKo,
    } : null;
  });
  console.log('state:', JSON.stringify(info));
  await page.screenshot({ path: `${OUT}/probe.png` });
}
await browser.close();
