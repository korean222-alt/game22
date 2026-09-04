/* 보스전 · 상점 · 가방 · 장비 · 체력 · 도감 · 1인칭 검사.

   flow.mjs 가 "한 바퀴가 도는가" 를 보는 반면 이쪽은 이번에 들어온 시스템만
   본다. 특히 조이스틱은 **방향까지** 검사한다 — 스틱이 도는지가 아니라
   미는 쪽으로 실제로 가는지가 문제였기 때문이다. */
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

/* 포인터 이벤트를 직접 쏜다. Playwright 의 마우스는 좌표가 하나뿐이라
   "왼쪽 아래에서 시작한 손가락" 을 만들 수 없다. */
const pointer = (type, id, x, y) => page.evaluate(([t, i, px, py]) => {
  const c = document.getElementById('gl');
  c.dispatchEvent(new PointerEvent(t, {
    pointerId: i, clientX: px, clientY: py, bubbles: true, cancelable: true, pointerType: 'touch',
  }));
}, [type, id, x, y]);

await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('gone'), { timeout: 180000 });
await page.waitForTimeout(700);

console.log('\n── 1. 상점과 가방 ──');
await step('물건을 사면 가방에 들어간다', async () => {
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.company.money = 3_000_000;
    g.company.rank = 8;
    g.buyItem('ramen', 3); g.buyItem('energy', 2); g.buyItem('piano', 1); g.buyItem('cake', 2);
    return { bag: g.company.bag, dex: Object.keys(g.company.dex.items).length };
  });
  if ((r.bag.ramen || 0) !== 3 || (r.bag.piano || 0) !== 1) throw new Error('가방 수량이 안 맞음: ' + JSON.stringify(r.bag));
  if (r.dex < 4) throw new Error('아이템 도감에 안 남음');
  return `라면 ${r.bag.ramen} · 피아노 ${r.bag.piano} · 도감 ${r.dex}종`;
});

await step('음료는 스태미나를 그 자리에서 채운다', async () => {
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.company.stamina = 1;
    const before = g.company.stamina;
    const res = g.useItem('energy');
    return { ok: res.ok, before, after: g.company.stamina, left: g.company.bag.energy };
  });
  if (!r.ok || r.after <= r.before) throw new Error('스태미나가 안 올랐다');
  if (r.left !== 1) throw new Error('가방에서 안 빠짐');
  return `${r.before} → ${r.after} · 남은 ${r.left}개`;
});

await step('장비를 채우면 능력치와 품질 축이 같이 오른다', async () => {
  const r = await page.evaluate(() => {
    const g = window.__game;
    const st = g.staff.find((s) => s.job === 'sound') || g.staff[0];
    const mod = window.__staffMod;
    const before = mod.abilities(st).sound;
    const axisBefore = mod.gearAxis(st, 'craze');
    const res = g.equipItem(st.id, 'piano');
    return {
      ok: res.ok, name: st.name,
      before, after: mod.abilities(st).sound,
      axisBefore, axisAfter: mod.gearAxis(st, 'craze'),
      bag: g.company.bag.piano || 0,
    };
  });
  if (!r.ok) throw new Error('장착 실패');
  if (r.after <= r.before) throw new Error(`사운드가 안 올랐다 ${r.before} → ${r.after}`);
  if (r.axisAfter <= r.axisBefore) throw new Error('화제성 배율이 안 올랐다');
  if (r.bag !== 0) throw new Error('가방에서 안 빠짐');
  return `${r.name} 사운드 ${r.before} → ${r.after} · 화제성 ×${r.axisAfter.toFixed(2)}`;
});

console.log('\n── 2. 보스전 ──');
await step('개발을 시작하면 3D 보스가 뜬다', async () => {
  await page.evaluate(() => {
    const g = window.__game, v = window.__view;
    v.meetingScenes = false;                 // 연출은 flow.mjs 가 이미 본다
    g.company.money = 9_000_000;
    g.makeProposal();
    const pr = g.proposals[0];
    g.beginDevelopment({
      proposalId: pr.id, platformId: 'feature', monetizeId: 'paid',
      teamIds: g.staff.map((s) => s.id), seriesOfId: null,
    });
    window.__ui.renderBattle();
  });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({
    boss: window.__view.boss ? window.__view.boss.def.ko : null,
    tris: window.__view.boss ? window.__view.boss.count / 3 : 0,
    label: document.getElementById('bBoss').textContent,
    inBattle: document.body.classList.contains('in-battle'),
  }));
  if (!r.boss) throw new Error('보스가 안 생겼다');
  if (!r.inBattle) throw new Error('배틀 UI 가 안 떴다');
  return `${r.boss} · 삼각형 ${r.tris}개 · 라벨 "${r.label}"`;
});

await step('진행 패널이 완성 값과 같은 숫자를 보여준다', async () => {
  await page.evaluate(() => { window.__game.company.stamina = 40; });
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => { if (!window.__game.project.pendingCards) window.__game.devTurn(); });
    await page.waitForTimeout(60);
  }
  const r = await page.evaluate(() => {
    const g = window.__game;
    const pg = g.devProgress();
    return {
      fun: pg.fun, bugs: pg.bugs,
      shownFun: document.getElementById('pgFun').textContent,
      shownBugs: document.getElementById('pgBugs').textContent,
      visible: getComputedStyle(document.getElementById('prog')).display !== 'none',
      stats: document.querySelectorAll('#pgStats .pgs').length,
      team: document.querySelectorAll('#pgTeam .pgm').length,
    };
  });
  if (!r.visible) throw new Error('진행 패널이 안 보인다');
  if (r.stats !== 5) throw new Error(`품질 항목이 ${r.stats}개`);
  if (!r.team) throw new Error('팀 체력이 안 보인다');
  if (String(r.fun) !== r.shownFun.replace(/,/g, '')) throw new Error(`재미 값 불일치 ${r.fun} vs ${r.shownFun}`);
  return `재미 ${r.shownFun} · 예상 버그 ${r.shownBugs} · 팀 ${r.team}명`;
});

await step('보스가 반격하고 팀의 체력이 준다', async () => {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    g.company.stamina = 60;
    const hp0 = g.staff.filter((s) => g.project.team.includes(s.id)).reduce((a, s) => a + s.hp, 0);
    let attacks = 0, phases = 0;
    for (let i = 0; i < 14 && g.project; i++) {
      if (g.project.pendingCards) { g.pickCard(g.project.pendingCards.options[0].id); continue; }
      const res = g.devTurn();
      if (!res.ok) break;
      for (const ev of res.events || []) {
        if (ev.kind === 'boss') attacks++;
        if (ev.kind === 'phase') phases++;
      }
    }
    const team = g.project ? g.project.team : [];
    const hp1 = g.staff.filter((s) => team.includes(s.id)).reduce((a, s) => a + s.hp, 0);
    return { attacks, phases, hp0, hp1, bugExtra: g.project ? g.project.bugExtra : null };
  });
  if (!r.attacks) throw new Error('반격이 한 번도 없었다');
  if (r.hp1 >= r.hp0) throw new Error(`체력이 안 줄었다 ${r.hp0} → ${r.hp1}`);
  return `반격 ${r.attacks}회 · 페이즈 ${r.phases}회 · 팀 체력 ${r.hp0} → ${r.hp1} · 반격 버그 ${r.bugExtra}`;
});

await step('도우미 트레이로 그 자리에서 회복시킨다', async () => {
  const r = await page.evaluate(() => {
    const g = window.__game;
    window.__ui.renderTray();
    const before = g.neediest();
    const hp0 = before ? before.hp : 0;
    const tray = [...document.querySelectorAll('#tray .tray-i')];
    const food = tray.find((t) => t.title.includes('컵라면') || t.title.includes('케이크'));
    if (!food) return { why: '트레이에 음식이 없다', n: tray.length };
    food.click();
    return { name: before ? before.name : '-', hp0, hp1: before ? before.hp : 0, n: tray.length };
  });
  if (r.why) throw new Error(`${r.why} (칸 ${r.n}개)`);
  if (r.hp1 <= r.hp0) throw new Error(`회복이 안 됐다 ${r.hp0} → ${r.hp1}`);
  return `${r.name} ${r.hp0} → ${r.hp1} · 트레이 ${r.n}칸`;
});

await step('집중 개발: 타이밍이 데미지 배율이 된다', async () => {
  await page.evaluate(() => { window.__game.company.stamina = 40; window.__ui.renderBattle(); });
  await page.click('#bFocusBtn');
  await page.waitForTimeout(220);
  const running = await page.evaluate(() => ({
    on: document.getElementById('bFocus').classList.contains('on'),
    label: document.getElementById('bTurn').textContent,
    pos: window.__ui.focus ? window.__ui.focus.pos : null,
  }));
  if (!running.on) throw new Error('타이밍 바가 안 떴다');
  if (running.label !== '지금!') throw new Error('버튼이 안 바뀜: ' + running.label);
  // 구간 한복판에서 멈춘다 → 최대 배율이 나와야 한다
  const hit = await page.evaluate(() => {
    const f = window.__ui.focus;
    f.pos = f.at + f.width / 2;
    const hp0 = window.__game.project ? window.__game.project.hp : 0;
    window.__ui.stopFocus();
    return { hp0, hp1: window.__game.project ? window.__game.project.hp : 0 };
  });
  await page.waitForTimeout(120);
  const off = await page.evaluate(() => document.getElementById('bFocus').classList.contains('on'));
  if (off) throw new Error('타이밍 바가 안 닫혔다');
  if (hit.hp1 >= hit.hp0) throw new Error('데미지가 안 들어갔다');
  return `HP ${hit.hp0} → ${hit.hp1}`;
});

console.log('\n── 3. 도감 ──');
await step('도감이 잡은 아이디어와 산 물건을 센다', async () => {
  await openTab('dex');
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => ({
    pct: document.querySelector('#panel .dexhead .big').textContent,
    cells: document.querySelectorAll('#panel .dexc').length,
    got: document.querySelectorAll('#panel .dexc.got').length,
    prog: window.__game.dexProgress(),
  }));
  if (!r.cells) throw new Error('도감 칸이 없다');
  if (!r.got) throw new Error('수집한 항목이 하나도 표시되지 않는다');
  return `${r.pct} · 칸 ${r.cells}개 중 ${r.got}개 수집`;
});

console.log('\n── 4. 1인칭과 조이스틱 ──');
await step('1인칭으로 들어간다', async () => {
  await page.evaluate(() => { window.__view.enterWalk(); window.__ui.renderShell(); });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({
    mode: window.__cam.mode,
    walking: document.body.classList.contains('walking'),
    y: window.__cam.wy,
    floor: window.__view.floor,
  }));
  if (r.mode !== 'walk') throw new Error('카메라가 안 바뀜');
  if (!r.walking) throw new Error('body.walking 이 없다');
  if (Math.abs(r.y - (r.floor * 13 + 5.2)) > 0.01) throw new Error('눈높이가 층과 안 맞음: ' + r.y);
  return `층 ${r.floor + 1}F · 눈높이 ${r.y}`;
});

await step('스틱을 앞으로 밀면 보고 있는 쪽으로 간다', async () => {
  // 빈 복도를 찾아 세운다. 좌표를 손으로 박으면 가구 안에서 시작해
  // "안 움직인다" 가 되는데, 그건 조이스틱 문제가 아니다.
  const before = await page.evaluate(() => {
    const c = window.__cam, v = window.__view;
    const nav = v.crew.navFor(v.floor);
    const clearRun = (x, z) => {
      for (let d = 0; d <= 6; d += 1) if (!nav.circleClear(x, z + d, 1.3)) return false;
      return true;
    };
    let spot = null;
    for (let x = 3; x < 62 && !spot; x += 1) {
      for (let z = 3; z < 36; z += 1) if (clearRun(x, z)) { spot = [x, z]; break; }
    }
    if (!spot) return { none: true };
    c.wx = spot[0]; c.wz = spot[1]; c.wyaw = 0;      // forward = (0, +1)
    return { x: c.wx, z: c.wz };
  });
  if (before.none) throw new Error('빈 복도를 못 찾음');

  await pointer('pointerdown', 77, 120, 340);
  await pointer('pointermove', 77, 120, 250);      // 위로 = 전진
  await page.waitForTimeout(700);
  const mid = await page.evaluate(() => {
    const st = window.__view.stick;
    return { x: window.__cam.wx, z: window.__cam.wz, vx: st.vx, vy: st.vy };
  });
  await pointer('pointerup', 77, 120, 250);
  const after = await page.evaluate(() => ({
    vx: window.__view.stick.vx, vy: window.__view.stick.vy,
    shown: getComputedStyle(window.__view.stick.el).display,
  }));
  if (mid.vy >= 0) throw new Error('스틱 벡터가 위쪽이 아니다: ' + mid.vy);
  const dz = mid.z - before.z, dx = mid.x - before.x;
  if (dz <= 0.5) throw new Error(`앞(+Z)으로 안 갔다: dx=${dx.toFixed(2)} dz=${dz.toFixed(2)}`);
  if (Math.abs(dx) > Math.abs(dz) * 0.35) throw new Error(`옆으로 샌다: dx=${dx.toFixed(2)} dz=${dz.toFixed(2)}`);
  if (after.vx !== 0 || after.vy !== 0) throw new Error('손을 떼도 벡터가 남아 있다');
  if (after.shown !== 'none') throw new Error('손을 떼도 스틱이 보인다');
  return `(${before.x},${before.z}) 에서 dx=${dx.toFixed(2)} dz=${dz.toFixed(2)} (전진)`;
});

await step('스틱을 옆으로 밀면 화면 오른쪽으로 간다', async () => {
  // yaw 0 (+Z 를 봄) 에서 화면 오른쪽은 월드 -X 다. m4look 의 기저가 그렇게
  // 잡히기 때문이고, 이 부호를 뒤집으면 스틱이 손과 반대로 논다.
  const r = await page.evaluate(() => {
    const c = window.__cam, v = window.__view;
    c.wyaw = 0;
    const [dx, dz] = c.walkVector(1, 0);
    // 실제 이동까지 확인한다 (막힌 칸이면 벡터만 본다)
    const nav = v.crew.navFor(v.floor);
    return { dx, dz, canMove: nav.circleClear(c.wx + dx, c.wz + dz, 1.25) };
  });
  if (r.dx >= -0.9) throw new Error(`오른쪽이 -X 가 아니다: dx=${r.dx.toFixed(2)}`);
  if (Math.abs(r.dz) > 0.01) throw new Error('옆으로 미는데 앞뒤로 간다');
  return `dx=${r.dx.toFixed(2)} dz=${r.dz.toFixed(2)}`;
});

await step('시점을 돌리면 전진 방향도 같이 돈다', async () => {
  const r = await page.evaluate(async () => {
    const c = window.__cam;
    c.wx = 33; c.wz = 30; c.wyaw = 0;
    c.look(-400, 0);                    // 왼쪽으로 끌면 시선이 왼쪽으로
    const yaw = c.wyaw;
    const f = c.forward();
    const v = c.walkVector(0, -1);      // 스틱 앞으로
    return { yaw, f, v };
  });
  // 앞으로 민 벡터는 언제나 forward 와 같은 방향이어야 한다.
  const dot = r.v[0] * r.f[0] + r.v[1] * r.f[1];
  if (dot < 0.999) throw new Error(`전진 벡터가 시선과 다르다 (dot=${dot.toFixed(3)})`);
  return `yaw ${r.yaw.toFixed(2)} · forward(${r.f.map((x) => x.toFixed(2)).join(',')})`;
});

await step('벽을 뚫고 나가지 않는다', async () => {
  const r = await page.evaluate(async () => {
    const c = window.__cam, v = window.__view;
    // 서쪽 벽(x=0)을 향해 한참 밀어붙인다.
    c.wx = 6; c.wz = 10; c.wyaw = -Math.PI / 2;      // forward = (-1, 0), 서쪽 벽으로
    v.stick.vx = 0; v.stick.vy = -1;
    v.stick.pointer = 999;                            // 키보드 입력이 덮어쓰지 못하게
    for (let i = 0; i < 120; i++) v.updateWalk(1 / 60);
    const x = c.wx;
    v.stick.pointer = null; v.stick.vx = 0; v.stick.vy = 0;
    const nav = v.crew.navFor(v.floor);
    return { x, clear: nav.circleClear(c.wx, c.wz, 1.25) };
  });
  if (r.x < 0.5) throw new Error(`벽을 통과했다 (x=${r.x.toFixed(2)})`);
  if (!r.clear) throw new Error('가구 안에 박혔다');
  return `x=${r.x.toFixed(2)} 에서 멈춤`;
});

await page.screenshot({ path: `${OUT}/battle-walk.png` });

await step('1인칭에서 나오면 원래 시점으로 돌아온다', async () => {
  await page.evaluate(() => { window.__view.exitWalk(); window.__ui.renderShell(); });
  await page.waitForTimeout(350);
  const r = await page.evaluate(() => ({
    mode: window.__cam.mode,
    walking: document.body.classList.contains('walking'),
  }));
  if (r.mode !== 'orbit' || r.walking) throw new Error('궤도 시점으로 안 돌아옴');
  return '궤도 시점';
});

console.log('\n── 5. 체력과 회복 ──');
await step('주간 휴식이 체력을 되돌린다', async () => {
  const r = await page.evaluate(() => {
    const g = window.__game;
    for (const s of g.staff) s.hp = 1;
    const before = g.staff.reduce((a, s) => a + s.hp, 0);
    g.nextWeek();
    return { before, after: g.staff.reduce((a, s) => a + s.hp, 0) };
  });
  if (r.after <= r.before) throw new Error('회복이 안 된다');
  return `${r.before} → ${r.after}`;
});

await step('야근은 스태미나를 사고 체력을 판다', async () => {
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.company.money = 5_000_000;
    g.company.stamina = 1;
    g.company.overtimeUsed = false;
    const hp0 = g.staff.reduce((a, s) => a + s.hp, 0);
    const res = g.overtime();
    return {
      ok: res.ok, why: res.why, stam: g.company.stamina,
      hp0, hp1: g.staff.reduce((a, s) => a + s.hp, 0),
      again: g.overtime().ok,
    };
  });
  if (!r.ok) throw new Error(r.why || '야근 실패');
  if (r.stam <= 1) throw new Error('스태미나가 안 올랐다');
  if (r.hp1 >= r.hp0) throw new Error('체력이 안 깎였다');
  if (r.again) throw new Error('주 2회 야근이 된다');
  return `스태미나 ${r.stam} · 체력 ${r.hp0} → ${r.hp1}`;
});

await step('탈진해도 데미지가 0이 되지는 않는다', async () => {
  const r = await page.evaluate(() => {
    const mod = window.__staffMod;
    const s = window.__game.staff[0];
    s.hp = 0;
    return { p: mod.power(s), base: mod.basePower(s) };
  });
  if (r.p <= 0) throw new Error('힘이 0이 됐다 — 영구히 막히는 상태');
  if (r.p >= r.base) throw new Error('탈진 페널티가 없다');
  return `힘 ${r.p.toFixed(1)} (최대 ${r.base.toFixed(1)})`;
});

console.log('\n── 6. 밝기 ──');
await step('밝기 설정이 실제 노출을 바꾸고 저장된다', async () => {
  const r = await page.evaluate(() => {
    const v = window.__view, R = window.__renderer;
    v.setBrightness('dim');
    const dim = { e: R.exposure, a: R.ambient, f: R.fill };
    v.setBrightness('max');
    const max = { e: R.exposure, a: R.ambient, f: R.fill };
    const saved = JSON.parse(localStorage.getItem('socialdev3d.prefs.v1') || '{}');
    v.setBrightness('bright');
    return { dim, max, saved: saved.brightness };
  });
  if (r.max.e <= r.dim.e || r.max.f <= r.dim.f) throw new Error('밝기가 안 바뀐다');
  if (r.saved !== 'max') throw new Error('설정이 저장되지 않았다: ' + r.saved);
  return `노출 ${r.dim.e} → ${r.max.e} · 천장광 ${r.dim.f} → ${r.max.f}`;
});

await page.screenshot({ path: `${OUT}/battle-final.png` });
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
if (errs.length) { console.log('콘솔/페이지 오류:'); for (const e of errs.slice(0, 8)) console.log('  ' + e); }
else console.log('콘솔 오류 없음');
await browser.close();
process.exit(fail || errs.length ? 1 : 0);
