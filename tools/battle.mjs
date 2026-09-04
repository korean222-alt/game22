/* 상점 · 가방 · 장비 · 체력 · 도감 · 1인칭 검사.

   flow.mjs 가 "한 바퀴가 도는가" 를 보고, raid.mjs 가 보스 아레나를 본다.
   이쪽은 그 둘 사이에 낀 시스템들 — 사는 것, 채우는 것, 쉬는 것 — 을 본다.
   1인칭은 **방향까지** 검사한다: 스틱이 도는지가 아니라 미는 쪽으로 실제로
   가는지가 문제였기 때문이다. */
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

/* 사무실은 이제 빈 채로 시작한다. 창업 팝업을 치우고, 책상을 놓고, 사람을
   앉히는 것까지가 이 검사의 출발선이다. */
for (let i = 0; i < 6; i++) {
  const open = await page.evaluate(() => document.getElementById('modal').classList.contains('show'));
  if (!open) break;
  await page.evaluate(() => {
    const m = document.getElementById('modal');
    const o = m.querySelector('#mOpts .choice');
    if (o) o.click(); else document.getElementById('mOk').click();
  });
  await page.waitForTimeout(250);
}
await step('빈 사무실에 책상을 놓고 사람을 앉힌다', async () => {
  const r = await page.evaluate(() => {
    const g = window.__game;
    if (!g.company.founded) g.found('배틀 스튜디오');
    g.company.money = 9_000_000;
    g.company.rank = 8;
    const free = g.freeDesks; g.freeDesks = () => 99;
    for (let i = 0; i < 4; i++) { g.rollCandidates(1); g.hire(g.candidates[0].id); }
    g.freeDesks = free;
    return { staff: g.staff.length, jobs: g.staff.map((s) => s.job) };
  });
  if (r.staff < 4) throw new Error('채용이 안 됨: ' + r.staff);
  // 창업이 끝나면 '홈 화면에 추가' 안내가 뜬다. 화면을 통째로 덮으므로 치운다.
  await page.evaluate(() => {
    const b = document.getElementById('a2never');
    if (b) b.click();
    const a2 = document.getElementById('a2hs');
    if (a2) a2.classList.remove('show');
  });
  await page.waitForTimeout(200);
  return `${r.staff}명 (${r.jobs.join(', ')})`;
});

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
    // 피아노는 사운드 담당의 물건이다. 무작위 채용이라 없을 수 있으므로,
    // 없으면 한 명을 사운드로 바꿔 놓고 잰다.
    let st = g.staff.find((s) => s.job === 'sound');
    if (!st) { st = g.staff[0]; st.job = 'sound'; }
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

console.log('\n── 2. 개발 시작과 진행 패널 ──');
await step('개발을 시작하면 3D 보스가 뜬다', async () => {
  const start = await page.evaluate(() => {
    const g = window.__game, v = window.__view;
    v.meetingScenes = false;                 // 연출은 flow.mjs 가 이미 본다
    g.company.money = 9_000_000;
    g.company.stamina = g.company.staminaMax;
    g.makeProposal();
    const pr = g.proposals[0];
    const r = g.beginDevelopment({
      proposalId: pr.id, platformId: 'feature', monetizeId: 'paid',
      teamIds: g.staff.map((s) => s.id), seriesOfId: null,
    });
    window.__ui.renderBattle();
    return { ok: r.ok, why: r.why };
  });
  if (!start.ok) throw new Error(start.why);
  for (let i = 0; i < 30; i++) {
    if (await page.evaluate(() => !!window.__view.boss)) break;
    await page.waitForTimeout(400);
  }
  const r = await page.evaluate(() => ({
    boss: window.__view.boss ? window.__view.boss.def.ko : null,
    tris: window.__view.boss ? window.__view.boss.model.prims.reduce((a, p) => a + p.count / 3, 0) : 0,
    label: document.getElementById('bBoss').textContent,
    inBattle: document.body.classList.contains('in-battle'),
    stages: window.__game.project.stages.length,
  }));
  if (!r.boss) throw new Error('보스가 안 생겼다');
  if (!r.inBattle) throw new Error('배틀 UI 가 안 떴다');
  if (r.stages !== 3) throw new Error('보스가 3마리가 아니다: ' + r.stages);
  return `${r.boss} · 삼각형 ${r.tris}개 · 라벨 "${r.label}" · ${r.stages}연전`;
});

await step('진행 패널이 완성 값과 같은 숫자를 보여준다', async () => {
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

await step('전투는 스태미나를 한 점도 먹지 않는다', async () => {
  const r = await page.evaluate(() => {
    const g = window.__game;
    const stam0 = g.company.stamina;
    let rounds = 0;
    for (let i = 0; i < 10 && g.project; i++) {
      if (g.project.pendingCards) { g.pickCard(g.project.pendingCards.options[0].id); continue; }
      if (!g.devTurn().ok) break;
      rounds++;
    }
    return { stam0, stam1: g.company.stamina, rounds };
  });
  if (r.stam1 !== r.stam0) throw new Error(`스태미나가 줄었다 ${r.stam0} → ${r.stam1}`);
  return `${r.rounds}라운드 · 스태미나 ${r.stam0} 그대로`;
});

await step('보스가 반격하고 팀의 체력이 준다', async () => {
  const r = await page.evaluate(() => {
    const g = window.__game;
    if (!g.project) return { none: true };
    const team0 = g.project.team.slice();
    const hp0 = g.staff.filter((s) => team0.includes(s.id)).reduce((a, s) => a + s.hp, 0);
    let attacks = 0, cleared = 0;
    // 자동 전투를 실시간으로 굴린다. 보스의 반격은 자기 게이지로 나온다.
    for (let i = 0; i < 900 && g.project; i++) {
      if (g.project.pendingCards) { g.pickCard(g.project.pendingCards.options[0].id); continue; }
      const res = g.devTick(0.1, 4);
      for (const ev of res.events || []) {
        if (ev.kind === 'boss') attacks++;
        if (ev.kind === 'stageClear') cleared++;
      }
      if (attacks >= 3) break;
    }
    const hp1 = g.staff.filter((s) => team0.includes(s.id)).reduce((a, s) => a + s.hp, 0);
    return { attacks, cleared, hp0, hp1, bugExtra: g.project ? g.project.bugExtra : null };
  });
  if (r.none) throw new Error('프로젝트가 없다');
  if (!r.attacks) throw new Error('반격이 한 번도 없었다');
  if (r.hp1 >= r.hp0) throw new Error(`체력이 안 줄었다 ${r.hp0} → ${r.hp1}`);
  return `반격 ${r.attacks}회 · 격파 ${r.cleared}마리 · 팀 체력 ${r.hp0} → ${r.hp1} · 반격 버그 ${r.bugExtra}`;
});

await step('도우미 트레이로 그 자리에서 회복시킨다', async () => {
  const r = await page.evaluate(() => {
    const g = window.__game;
    // 확실히 다친 사람을 하나 만든다 — 자동 전투가 아직 아무도 안 깎았을 수 있다.
    const hurt = g.neediest() || g.staff[0];
    hurt.hp = Math.max(1, Math.round(hurt.hpMax * 0.3));
    window.__ui.renderTray();
    const tray = [...document.querySelectorAll('#tray .tray-i')];
    const food = tray.find((t) => t.title.includes('컵라면') || t.title.includes('케이크'));
    if (!food) return { why: '트레이에 음식이 없다', n: tray.length };
    const target = g.neediest(g.project ? g.project.team : null) || g.neediest();
    const hp0 = target.hp;
    food.click();
    return { name: target.name, hp0, hp1: target.hp, n: tray.length };
  });
  if (r.why) throw new Error(`${r.why} (칸 ${r.n}개)`);
  if (r.hp1 <= r.hp0) throw new Error(`회복이 안 됐다 ${r.hp0} → ${r.hp1}`);
  return `${r.name} ${r.hp0} → ${r.hp1} · 트레이 ${r.n}칸`;
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

console.log('\n── 4. 1인칭 ──');
await step('1인칭으로 들어간다', async () => {
  await page.evaluate(() => { window.__view.fp.enter(); });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({
    on: window.__view.fp.on,
    fpBody: document.body.classList.contains('fp'),
    ui: getComputedStyle(document.getElementById('fpui')).display,
    floor: window.__view.fp.floor,
    x: window.__view.fp.x, z: window.__view.fp.z,
  }));
  if (!r.on) throw new Error('1인칭이 안 켜짐');
  if (!r.fpBody) throw new Error('body.fp 가 없다');
  if (r.ui === 'none') throw new Error('1인칭 조작계가 안 보인다');
  return `${r.floor + 1}F (${r.x.toFixed(1)}, ${r.z.toFixed(1)})`;
});

await step('버튼이 화면에 남아 있다 — 1인칭으로 들어갈 길', async () => {
  await page.evaluate(() => {
    window.__view.fp.exit();
    // 모달이 떠 있으면 화면 전체를 덮는다. 여기서 보려는 것은 버튼의 자리다.
    window.__ui.closeModal();
  });
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const b = document.getElementById('fpBtn');
    const cs = getComputedStyle(b);
    const rect = b.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      display: cs.display, w: Math.round(rect.width), h: Math.round(rect.height),
      onScreen: rect.top >= 0 && rect.bottom <= window.innerHeight
        && rect.left >= 0 && rect.right <= window.innerWidth,
      covered: top && top.id !== 'fpBtn',
      coveredBy: top ? (top.id || top.className) : null,
    };
  });
  if (r.display === 'none') throw new Error('1인칭 버튼이 사라졌다');
  if (!r.onScreen) throw new Error('버튼이 화면 밖에 있다');
  if (r.covered) throw new Error('버튼이 가려졌다: ' + r.coveredBy);
  return `${r.w}×${r.h} · 보임`;
});

await step('스틱을 앞으로 밀면 보고 있는 쪽으로 간다', async () => {
  const before = await page.evaluate(() => {
    const v = window.__view, fp = v.fp;
    fp.enter();
    const nav = v.crew.navFor(fp.floor);
    const clearRun = (x, z) => {
      for (let d = 0; d <= 6; d += 1) if (!nav.circleClear(x, z + d, 1.3)) return false;
      return true;
    };
    let spot = null;
    for (let x = 3; x < 62 && !spot; x += 1) {
      for (let z = 3; z < 36; z += 1) if (clearRun(x, z)) { spot = [x, z]; break; }
    }
    if (!spot) return { none: true };
    fp.x = spot[0]; fp.z = spot[1]; fp.yaw = 0;      // yaw 0 → forward = (0, +1)
    fp.setStick(0, -1);                              // 화면 위로 = 전진
    for (let i = 0; i < 90; i++) fp.update(1 / 60);
    fp.setStick(0, 0);
    return { x0: spot[0], z0: spot[1], x: fp.x, z: fp.z };
  });
  if (before.none) throw new Error('빈 복도를 못 찾음');
  const dz = before.z - before.z0, dx = before.x - before.x0;
  if (dz <= 0.5) throw new Error(`앞(+Z)으로 안 갔다: dx=${dx.toFixed(2)} dz=${dz.toFixed(2)}`);
  if (Math.abs(dx) > Math.abs(dz) * 0.35) throw new Error(`옆으로 샌다: dx=${dx.toFixed(2)} dz=${dz.toFixed(2)}`);
  return `(${before.x0},${before.z0}) 에서 dx=${dx.toFixed(2)} dz=${dz.toFixed(2)} (전진)`;
});

await step('시점을 돌리면 전진 방향도 같이 돈다', async () => {
  const r = await page.evaluate(() => {
    const v = window.__view, fp = v.fp;
    const nav = v.crew.navFor(fp.floor);
    // 사방이 트인 자리를 찾는다. 벽에 붙어 있으면 미끄러져서 방향이 안 나온다.
    const open = (x, z) => {
      for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        for (let d = 1; d <= 4; d++) if (!nav.circleClear(x + dx * d, z + dz * d, 1.3)) return false;
      }
      return true;
    };
    let spot = null;
    for (let x = 5; x < 60 && !spot; x += 1) {
      for (let z = 5; z < 34; z += 1) if (open(x, z)) { spot = [x, z]; break; }
    }
    if (!spot) return { none: true };
    const trial = (yaw) => {
      fp.x = spot[0]; fp.z = spot[1];
      fp.yaw = yaw;
      const x0 = fp.x, z0 = fp.z;
      fp.setStick(0, -1);
      for (let i = 0; i < 20; i++) fp.update(1 / 60);
      fp.setStick(0, 0);
      const dx = fp.x - x0, dz = fp.z - z0;
      const len = Math.hypot(dx, dz) || 1;
      // 기대 방향: (sin yaw, cos yaw)
      return { dot: (dx / len) * Math.sin(yaw) + (dz / len) * Math.cos(yaw), len };
    };
    const a = trial(0), b = trial(Math.PI / 2);
    return { a, b, spot };
  });
  if (r.none) throw new Error('사방이 트인 자리를 못 찾음');
  if (r.a.len < 0.2 || r.b.len < 0.2) throw new Error('둘 중 하나가 벽에 막혔다 — 다시 실행해 보세요');
  if (r.a.dot < 0.9 || r.b.dot < 0.9) throw new Error(`전진 방향이 시선과 다르다 (${r.a.dot.toFixed(2)}, ${r.b.dot.toFixed(2)})`);
  return `yaw 0 · yaw 90° 모두 시선 방향으로 전진`;
});

await step('벽을 뚫고 나가지 않는다', async () => {
  const r = await page.evaluate(() => {
    const v = window.__view, fp = v.fp;
    const nav = v.crew.navFor(fp.floor);
    // 합법적인 자리에서 출발한다 — 벽 안에서 시작하면 "박혔다" 가 당연하다.
    let spot = null;
    for (let x = 4; x < 60 && !spot; x += 1) {
      for (let z = 4; z < 34; z += 1) if (nav.circleClear(x, z, 1.4)) { spot = [x, z]; break; }
    }
    if (!spot) return { none: true };
    fp.x = spot[0]; fp.z = spot[1]; fp.yaw = -Math.PI / 2;   // forward = (-1, 0), 서쪽 벽으로
    fp.setStick(0, -1);
    for (let i = 0; i < 400; i++) fp.update(1 / 60);
    fp.setStick(0, 0);
    // 판정 반경은 firstperson.js 의 RADIUS(0.9) 와 같아야 한다.
    return { from: spot, x: fp.x, clear: nav.circleClear(fp.x, fp.z, 0.9) };
  });
  if (r.none) throw new Error('출발할 빈 자리를 못 찾음');
  if (r.x < 0.5) throw new Error(`벽을 통과했다 (x=${r.x.toFixed(2)})`);
  if (!r.clear) throw new Error('가구 안에 박혔다');
  return `x=${r.from[0]} → ${r.x.toFixed(2)} 에서 멈춤`;
});

await page.screenshot({ path: `${OUT}/battle-walk.png` });

await step('1인칭에서 나오면 원래 시점으로 돌아온다', async () => {
  await page.evaluate(() => { window.__view.fp.exit(); });
  await page.waitForTimeout(350);
  const r = await page.evaluate(() => ({
    on: window.__view.fp.on,
    fpBody: document.body.classList.contains('fp'),
    camFp: !!window.__cam.fp,
  }));
  if (r.on || r.fpBody || r.camFp) throw new Error('궤도 시점으로 안 돌아옴');
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
    for (const s of g.staff) s.hp = s.hpMax;
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
