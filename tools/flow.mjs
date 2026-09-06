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
/* 탭이 두 줄로 갈라졌다: 위 줄(#tabs)에 회사·직원·개발·사무실, 오른쪽
   세로 레일(#tabside)에 상점·가방·도감·운영·편지·행사. 위 줄만 보던 이
   하네스는 가방 탭에서 null 을 집어 3절 전체가 무너졌다. */
const openTab = (name) => page.evaluate((n) => {
  document.body.classList.remove('panel-hidden');
  const t = document.querySelector(`.tabbtn[data-tab="${n}"]`);
  if (!t) throw new Error('탭이 없다: ' + n);
  t.click();
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
    bag: g.bag.length, placed: g.company.placed.length,
    desks: g.deskCount(), freeDesks: g.freeDesks(),
    founded: g.company.founded, rescues: g.company.rescues,
    placing: !!v.place, boss: v.boss ? v.boss.def.id : null,
    tut: g.tutorialStep() ? g.tutorialStep().id : null,
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

console.log('\n── 1. 부팅 · 창업 ──');
await step('부팅 완료, 에러 없음', async () => {
  if (errs.length) throw new Error(errs[0]);
  const s = await state();
  if (s.agents !== 0) throw new Error(`빈 사무실이어야 하는데 직원 ${s.agents}명`);
  if (s.desks !== 0) throw new Error(`빈 사무실이어야 하는데 책상 ${s.desks}개`);
  return `삼각형 ${Math.round(s.tris).toLocaleString()}개 · 직원 0명 · 책상 0개`;
});
await step('회사 이름 팝업 → 지원금', async () => {
  const asked = await page.evaluate(() => {
    const m = document.getElementById('modal');
    return m.classList.contains('show') ? document.getElementById('mTitle').textContent : null;
  });
  if (!asked) throw new Error('창업 팝업이 뜨지 않음');
  await page.fill('#coInput', '플로우 스튜디오');
  await page.click('#mOk');
  // 이름을 적으면 창립 영상이 돈다. 영상이 끝나야 지원금 팝업이 뜬다.
  await page.waitForFunction(() => !document.body.classList.contains('cine'), { timeout: 30000 });
  await page.waitForTimeout(400);
  const grant = await page.evaluate(() => document.getElementById('mTitle').textContent);
  if (!grant.includes('플로우 스튜디오')) throw new Error('설립 팝업에 회사 이름이 없음: ' + grant);
  await closeModal(); await page.waitForTimeout(400);
  const s = await state();
  if (!s.founded) throw new Error('창업 처리가 되지 않음');
  // 숫자를 여기에 박아 두면 밸런스를 고칠 때마다 하네스가 거짓말을 한다.
  // 검사하려는 것은 "창업 지원금이 실제로 들어왔는가" 이므로 data.js 에
  // 적힌 값을 그때그때 읽어서 맞춘다.
  const want = await page.evaluate(async () =>
    (await import('/src/game/data.js')).STARTUP_GRANT);
  if (s.money !== want) throw new Error(`지원금이 ₩${s.money.toLocaleString()} (기대 ₩${want.toLocaleString()})`);
  return `「플로우 스튜디오」 · 지원금 ₩${s.money.toLocaleString()}`;
});
/* 창업이 끝나면 '홈 화면에 추가' 안내가 화면 전체를 덮는다. 실제 플레이어는
   여기서 닫기를 누르고, 이 하네스도 그래야 한다 — 안 닫으면 그 뒤의 터치
   검사가 전부 이 카드에 맞고 튕겨 나간다. */
await step('설치 안내를 닫는다', async () => {
  const shown = await page.evaluate(() => document.getElementById('a2hs').classList.contains('show'));
  if (!shown) return '안 뜸 (건너뜀)';
  await page.click('#a2close');
  await page.waitForTimeout(250);
  const still = await page.evaluate(() => document.getElementById('a2hs').classList.contains('show'));
  if (still) throw new Error('닫기를 눌러도 안 닫힘');
  return '닫기';
});
/* 안내는 저절로 뜨지 않는다. 오른쪽 레일의 ❓ 안내를 눌러야 열린다. */
await step('안내는 저절로 뜨지 않는다', async () => {
  const stray = await page.evaluate(() => !!document.getElementById('tut'));
  if (stray) throw new Error('옛 튜토리얼 배너가 아직 있음');
  const open = await page.evaluate(() => document.querySelector('#panel .gstep'));
  if (open) throw new Error('안내가 저절로 떠 있음');
  return '화면이 깨끗함';
});
await step('❓ 안내를 누르면 지금 할 일이 뜬다', async () => {
  const s = await state();
  if (s.tut !== 'desk') throw new Error('첫 단계가 desk 가 아님: ' + s.tut);
  await openTab('guide'); await page.waitForTimeout(250);
  const r = await page.evaluate(() => {
    const now = document.querySelector('#panel .gstep.now');
    return { n: document.querySelectorAll('#panel .gstep').length, now: now ? now.textContent.trim().slice(0, 12) : null };
  });
  if (!r.now) throw new Error('지금 할 일이 표시되지 않음');
  if (r.n < 5) throw new Error(`안내 단계가 ${r.n}개뿐`);
  const skip = await page.evaluate(() => [...document.querySelectorAll('#panel button')].some((b) => b.textContent.includes('건너뛰기')));
  if (skip) throw new Error('건너뛰기 버튼이 남아 있음');
  return `${r.n}단계 · 지금: ${r.now}`;
});

console.log('\n── 2. 회사 탭 (계약 · 연구 · 저장) ──');
await openTab('company'); await page.waitForTimeout(250);
/* 계약은 받는 순간 그 기간만큼 시간이 흐르고 납품까지 끝난다. '다음 주로'
   버튼이 없어졌으므로, 개발할 돈이 없는 회사가 달력을 미는 길이 여기다. */
await step('계약 수주 = 그 자리에서 납품 · 달력이 흐른다', async () => {
  const b = await page.evaluate(() => ({
    money: window.__game.company.money,
    w: window.__game.dateLabel(),
  }));
  await tap('QA 대행'); await page.waitForTimeout(400);
  const a = await page.evaluate(() => ({
    money: window.__game.company.money,
    w: window.__game.dateLabel(),
    contract: !!window.__game.company.contract,
  }));
  if (a.contract) throw new Error('납품되지 않음');
  if (a.w === b.w) throw new Error('달력이 그대로: ' + a.w);
  if (a.money <= b.money) throw new Error('입금되지 않음');
  return `${b.w} → ${a.w} · ₩${(a.money - b.money).toLocaleString()} 입금`;
});
await step("'다음 주로' 버튼은 없다", async () => {
  const found = await page.evaluate(() =>
    [...document.querySelectorAll('#panel button')].some((b) => b.textContent.includes('다음 주로')));
  if (found) throw new Error('버튼이 아직 있음');
  return '달력은 일한 결과로만 흐른다';
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
  const has = await page.evaluate(() => !!localStorage.getItem('socialdev3d.save.v2'));
  if (!has) throw new Error('저장되지 않음');
  return 'localStorage 기록됨';
});

console.log('\n── 3. 가구점 · 배치 모드 ──');
await openTab('office'); await page.waitForTimeout(250);
await step('책상 구입 → 가방', async () => {
  const before = (await state()).money;
  await tap('구입'); await page.waitForTimeout(300);
  const s = await state();
  if (s.bag !== 1) throw new Error(`가방에 ${s.bag}개`);
  if (s.money >= before) throw new Error('돈이 빠지지 않음');
  return `가방 1개 · ₩${(before - s.money).toLocaleString()} 지출`;
});
await step('배치 모드가 열리고 구역이 그려진다', async () => {
  // 산 가구는 사무실 탭이 아니라 🎒 가방 탭에 쌓인다. 배치 버튼도 거기 있다.
  await openTab('bag'); await page.waitForTimeout(250);
  await tap('배치'); await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({
    placing: !!window.__view.place,
    zones: !!window.__view.gZones,
    ghost: !!window.__view.gGhost,
    bar: document.getElementById('placebar').classList.contains('show'),
    body: document.body.classList.contains('placing'),
  }));
  if (!r.placing) throw new Error('배치 모드가 켜지지 않음');
  if (!r.zones) throw new Error('배치 구역 오버레이가 없음');
  if (!r.ghost) throw new Error('고스트가 그려지지 않음');
  if (!r.bar || !r.body) throw new Error('배치 툴바가 뜨지 않음');
  return '구역 · 고스트 · 툴바';
});
await step('구역 밖은 거부, 구역 안은 허용', async () => {
  const bad = await page.evaluate(() => {
    window.__view.movePlace(33, 22);           // inside the lift core
    return { valid: window.__view.place.valid, why: window.__view.place.why };
  });
  if (bad.valid) throw new Error('코어 한가운데인데 배치 가능하다고 나옴');
  const good = await page.evaluate(() => {
    window.__view.movePlace(10, 9);            // north-west bay
    return window.__view.place.valid;
  });
  if (!good) throw new Error('정상 구역인데 배치 불가');
  return `거부 사유: ${bad.why}`;
});
await step('회전 후 배치 → 책상·보행 격자 갱신', async () => {
  await page.evaluate(() => window.__view.rotatePlace());
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#placebar button')].find((x) => x.textContent.includes('놓기'));
    if (b.disabled) throw new Error('배치 버튼이 비활성');
    b.click();
  });
  await page.waitForTimeout(600);
  const s = await state();
  if (s.placed !== 1) throw new Error(`배치된 가구 ${s.placed}개`);
  if (s.bag !== 0) throw new Error('가방에서 빠지지 않음');
  if (s.desks !== 1) throw new Error(`책상 슬롯 ${s.desks}개`);
  if (s.placing) throw new Error('배치 모드가 안 꺼짐');
  const solid = await page.evaluate(() => !!window.__view.gPlaced);
  if (!solid) throw new Error('가구 메시가 만들어지지 않음');
  return `책상 1개 · 빈자리 ${s.freeDesks}`;
});
await step('가구를 회수하면 자리도 사라진다', async () => {
  await openTab('office'); await page.waitForTimeout(250);
  await tap('회수'); await page.waitForTimeout(500);
  let s = await state();
  if (s.desks !== 0 || s.bag !== 1) throw new Error(`회수 후 책상 ${s.desks} 가방 ${s.bag}`);
  // put it straight back so the rest of the run has somewhere to sit
  await page.evaluate(() => {
    const v = window.__view, g = window.__game;
    v.startPlacing(g.bag[0].uid);
    v.movePlace(10, 9);
    v.commitPlace();
  });
  await page.waitForTimeout(400);
  s = await state();
  if (s.desks !== 1) throw new Error('되돌려 놓지 못함');
  return '회수 → 재배치';
});
await step('책상을 여러 개 늘린다', async () => {
  await page.evaluate(() => {
    const g = window.__game, v = window.__view;
    g.company.money = 5_000_000;
    const spots = [[10, 15], [16, 9], [16, 15], [10, 24], [16, 24]];
    for (const [x, z] of spots) {
      g.buyFurniture('desk');
      const uid = g.bag[g.bag.length - 1].uid;
      g.placeFurniture(uid, 0, x, z, 0, v.placeChecks());
    }
    g.buyFurniture('coffee');
    const uid = g.bag[g.bag.length - 1].uid;
    g.placeFurniture(uid, 0, 5, 22, 0, v.placeChecks());
    v.rebuildFurniture();
  });
  await page.waitForTimeout(500);
  const s = await state();
  if (s.desks < 4) throw new Error(`책상이 ${s.desks}개밖에 안 놓임`);
  const cm = await page.evaluate(() => window.__game.comfort().score);
  if (!(cm > 0)) throw new Error('쾌적도가 0');
  return `책상 ${s.desks}개 · 쾌적도 ${cm}`;
});

/* ── 배치 조작 ──
   제보: "배치 모드에서 책상을 움직이려는데 화면이 움직인다." 원인은 손가락
   수로 역할을 나눈 것이었다 — 가로로 든 폰에서 손바닥이 화면에 닿으면
   접점이 둘이 되고, 그 순간 가구 드래그가 카메라 팬으로 바뀐다. 이제
   배치 중에는 캔버스가 카메라를 아예 건드리지 않고, 카메라는 조이스틱이
   맡는다. 아래 세 검사가 그 계약이다. */
console.log('\n── 3-b. 배치 조작 (드래그 · 십자 · 조이스틱) ──');
const camState = () => page.evaluate(() => ({
  az: +window.__cam.az.toFixed(4), el: +window.__cam.el.toFixed(4),
  gx: +window.__cam.gx.toFixed(2), gz: +window.__cam.gz.toFixed(2),
  d: +window.__cam.goalDist.toFixed(2),
}));
const cdp = await ctx.newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
/* CDP 의 터치 상태는 세션에 남는다. 한 제스처가 끝날 때마다 반드시 비워
   두지 않으면 다음 touchStart 가 "이미 눌린 손가락" 위에서 시작해, 이벤트가
   통째로 안 오거나 엉뚱한 포인터로 온다 — 검사 실패의 절반이 그 탓이었다. */
const gesture = async (frames) => {
  try {
    for (const f of frames) { await touch(f.t, f.p); await page.waitForTimeout(f.w || 25); }
  } finally {
    await touch('touchEnd', []);
    await page.waitForTimeout(150);
  }
};

await step('배치 모드를 다시 연다', async () => {
  await page.evaluate(() => {
    const g = window.__game, v = window.__view;
    g.company.money = 5_000_000;
    g.buyFurniture('plant');
    v.startPlacing(g.bag[g.bag.length - 1].uid);
    window.__ui.togglePanel(true);
    window.__ui.renderPlaceBar();
  });
  await page.waitForTimeout(300);
  if (!(await state()).placing) throw new Error('배치 모드가 안 켜짐');
  return '화분 배치 중';
});
await step('두 손가락으로 끌어도 카메라가 움직이지 않는다', async () => {
  const c0 = await camState();
  const frames = [{ t: 'touchStart', p: [{ x: 300, y: 200, id: 1 }, { x: 520, y: 260, id: 2 }] }];
  for (let i = 1; i <= 8; i++) {
    frames.push({ t: 'touchMove', p: [{ x: 300 - i * 7, y: 200, id: 1 }, { x: 520 + i * 7, y: 260 + i * 5, id: 2 }] });
  }
  await gesture(frames);
  const c1 = await camState();
  if (JSON.stringify(c0) !== JSON.stringify(c1)) {
    throw new Error(`카메라가 움직임: ${JSON.stringify(c0)} → ${JSON.stringify(c1)}`);
  }
  return `az/el/거리 그대로 (${c1.az}/${c1.el}/${c1.d})`;
});
await step('한 손가락 드래그는 가구를 옮긴다', async () => {
  const p0 = await page.evaluate(() => ({ x: window.__view.place.x, z: window.__view.place.z }));
  const frames = [{ t: 'touchStart', p: [{ x: 360, y: 210, id: 3 }] }];
  for (let i = 1; i <= 8; i++) frames.push({ t: 'touchMove', p: [{ x: 360 + i * 9, y: 210 + i * 4, id: 3 }] });
  await gesture(frames);
  const p1 = await page.evaluate(() => ({ x: window.__view.place.x, z: window.__view.place.z }));
  if (p0.x === p1.x && p0.z === p1.z) throw new Error('가구가 그대로');
  return `(${p0.x}, ${p0.z}) → (${p1.x}, ${p1.z})`;
});
await step('십자 버튼이 반 칸씩 옮긴다', async () => {
  const p0 = await page.evaluate(() => ({ x: window.__view.place.x, z: window.__view.place.z }));
  const n = await page.evaluate(() => document.querySelectorAll('#placebar .pnudge .nb').length);
  if (n !== 4) throw new Error(`십자 버튼이 ${n}개`);
  await page.evaluate(() => document.querySelectorAll('#placebar .pnudge .nb')[0].click());
  await page.waitForTimeout(120);
  const p1 = await page.evaluate(() => ({ x: window.__view.place.x, z: window.__view.place.z }));
  const d = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  if (Math.abs(d - 0.5) > 1e-6) throw new Error(`반 칸이 아니라 ${d} 만큼 움직임`);
  return `(${p0.x}, ${p0.z}) → (${p1.x}, ${p1.z})`;
});
await step('조이스틱은 배치 중에도 카메라를 돌린다', async () => {
  const c0 = await camState();
  const r = await page.evaluate(() => {
    const b = document.getElementById('camStick').getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, shown: b.width > 0 };
  });
  if (!r.shown) throw new Error('조이스틱이 화면에 없음');
  // 소프트웨어 GL 은 초당 몇 프레임밖에 안 돈다. 조이스틱은 프레임마다
  // 적분되므로, 짧게 기다리면 프레임이 한 장도 안 지나갈 수 있다.
  await gesture([
    { t: 'touchStart', p: [{ x: r.x, y: r.y, id: 7 }] },
    { t: 'touchMove', p: [{ x: r.x + r.w * 0.42, y: r.y, id: 7 }], w: 2500 },
  ]);
  const c1 = await camState();
  if (c0.az === c1.az) throw new Error('방위각이 그대로');
  return `az ${c0.az} → ${c1.az}`;
});
await step('배치를 마치고 나온다', async () => {
  await page.evaluate(() => { window.__view.stopPlacing(); window.__ui.renderPlaceBar(); });
  await page.waitForTimeout(200);
  if ((await state()).placing) throw new Error('배치 모드가 안 꺼짐');
  return '취소';
});

console.log('\n── 4. 직원 탭 (채용 · 성장) ──');
await openTab('staff'); await page.waitForTimeout(250);
await step('빈 책상이 없으면 채용이 막힌다', async () => {
  const blocked = await page.evaluate(() => {
    const g = window.__game;
    const saved = g.desks;
    g.desks = [];
    const r = g.hire(g.candidates[0].id);
    g.desks = saved;
    return r;
  });
  if (blocked.ok) throw new Error('책상 없이 채용됨');
  return blocked.why;
});
await step('신입 할인가로 채용', async () => {
  const before = (await state()).staff;
  const rookie = await page.evaluate(() => window.__game.candidates[0].rookie);
  if (!rookie) throw new Error('랭크 1인데 신입 할인이 없음');
  await tap('채용 ₩'); await page.waitForTimeout(600);
  const s = await state();
  if (s.staff !== before + 1) throw new Error('인원이 늘지 않음');
  const seated = await page.evaluate(() =>
    window.__view.crew.all().filter((a) => a.home).length);
  if (seated !== s.staff) throw new Error(`${s.staff - seated}명이 자리를 못 찾음`);
  return `${before} → ${s.staff}명 · 전원 착석`;
});
await step('팀을 채운다', async () => {
  await page.evaluate(() => {
    const g = window.__game;
    g.company.money = 5_000_000;
    for (let i = 0; i < 12 && g.freeDesks() > 0; i++) {
      if (!g.candidates.length) g.rollCandidates();
      const c = g.candidates[0];
      if (!c) break;
      if (!g.hire(c.id).ok) g.rollCandidates();
    }
  });
  await page.waitForTimeout(600);
  const s = await state();
  if (s.staff < 4) throw new Error(`직원 ${s.staff}명`);
  return `${s.staff}명 · 빈자리 ${s.freeDesks}`;
});
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

console.log('\n── 5. 개발 탭 (기획 → 회의 → 개발) ──');
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

console.log('\n── 6. 개발 전투 · 보스 몬스터 ──');
await page.evaluate(() => { window.__view.meetingScenes = false; });
/* 보스는 **아레나 안에만** 선다. 사무실 복도에 몬스터가 서 있던 시절의
   하네스는 여기서 그냥 기다렸고, 그래서 6절이 통째로 실패했다. */
await page.evaluate(() => {
  window.__game.company.devIntroSeen = true;
  window.__ui.enterArena();
});
await page.waitForTimeout(600);
await step('아이디어 몬스터가 소환된다', async () => {
  for (let i = 0; i < 40; i++) {
    if ((await state()).boss) break;
    await page.waitForTimeout(500);
  }
  const r = await page.evaluate(() => {
    const b = window.__view.boss;
    if (!b) return null;
    return {
      id: b.def.id, ko: b.def.ko,
      joints: b.model.jointCount, prims: b.model.prims.length,
      clips: [...b.model.clips.keys()],
      scale: +b.scale.toFixed(2),
      floor: b.floor,
    };
  });
  if (!r) throw new Error('보스가 소환되지 않음 (glb 로드 실패?)');
  if (!r.prims) throw new Error('메시가 비어 있음');
  if (!r.clips.includes('Idle')) throw new Error('Idle 클립이 없음: ' + r.clips);
  return `${r.ko} · 조인트 ${r.joints} · 클립 ${r.clips.length} · ×${r.scale}`;
});
await step('보스 HP 바가 화면에 뜬다', async () => {
  await page.waitForTimeout(600);
  const vis = await page.evaluate(() => {
    const e = document.querySelector('.bosstag');
    return e ? { shown: e.style.display !== 'none', txt: e.textContent.trim().slice(0, 20) } : null;
  });
  if (!vis) throw new Error('.bosstag 요소가 없음');
  return vis.shown ? `표시: ${vis.txt}` : '요소는 있으나 화면 밖 (카메라 각도)';
});
/* 살아 있는 보스만 움직인다 — 죽은 놈은 마지막 포즈에서 멈춘다. 그래서 이
   검사는 때리기 **전**에 한다. 자동 전투로 HP 를 낮춘 뒤로 데뷔작 1번 보스는
   한 라운드에 죽을 수도 있다. */
await step('스켈레톤이 매 프레임 갱신된다', async () => {
  const a = await page.evaluate(() => Array.from(window.__view.boss.inst.skel.jointData.slice(0, 32)));
  if (a.some((v) => !Number.isFinite(v))) throw new Error('조인트 행렬에 NaN');
  // 소프트웨어 GL 은 초당 한두 프레임이다. 한 번만 재고 끝내면 그 사이에
  // 프레임이 한 장도 안 지나가서, 멀쩡한 애니메이션을 멈췄다고 부른다.
  let moved = false, b = a;
  for (let i = 0; i < 12 && !moved; i++) {
    await page.waitForTimeout(500);
    b = await page.evaluate(() => Array.from(window.__view.boss.inst.skel.jointData.slice(0, 32)));
    moved = a.some((v, k) => Math.abs(v - b[k]) > 1e-5);
  }
  if (!moved) throw new Error('애니메이션이 멈춰 있음');
  return '조인트 행렬 갱신 확인';
});
/* 아레나의 타격 연출은 이제 두 박자다: 직원이 자기 도구를 던지고
   (`.afx`), 그것이 **닿는 순간** 보스가 흔들리고 점수가 튄다 (`.afxp`).
   그래서 흔들림은 devTurn() 직후가 아니라 300ms 쯤 뒤에 온다 — 한 번만
   재고 실패라고 부르면 안 된다. */
await step('타격하면 몬스터가 반응한다', async () => {
  const before = await page.evaluate(() => window.__view.boss.inst.clip.name);
  // 자동 전투가 된 뒤로 한 턴은 스태미나를 먹지 않는다. 데미지 숫자도
  // 라운드 합계 하나가 아니라 사람마다 하나씩 뜬다.
  await page.evaluate(() => window.__game.devTurn());
  let shots = 0;
  for (let i = 0; i < 12 && !shots; i++) {
    shots = await page.evaluate(() => document.querySelectorAll('#aFx .afx').length);
    if (!shots) await page.waitForTimeout(120);
  }
  let hit = null;
  for (let i = 0; i < 20; i++) {
    hit = await page.evaluate(() => ({
      clip: window.__view.boss ? window.__view.boss.inst.clip.name : null,
      flash: window.__view.boss ? window.__view.boss.flash : 0,
      pops: document.querySelectorAll('#aFx .afxp').length,
    }));
    if (!hit.clip || (hit.flash > 0 && hit.pops)) break;
    await page.waitForTimeout(200);
  }
  if (!hit.clip) throw new Error('보스가 사라짐');
  if (!shots) throw new Error('직원이 던지는 연출이 없음');
  if (hit.flash <= 0) throw new Error('피격 플래시가 없음');
  if (!hit.pops) throw new Error('맞은 자리에 점수가 안 뜸');
  return `${before} → ${hit.clip} · 투척 ${shots} · 점수 팝업 ${hit.pops}`;
});
let cards = 0;
await step('HP를 0까지 (카드 2장 선택)', async () => {
  for (let i = 0; i < 900; i++) {
    const s = await state();
    // 프로젝트가 끝났으면 여기서 멈춘다. 그 뒤에 뜨는 결과창·홍보·출시
    // 확인까지 눌러 버리면 다음 단계가 볼 완성작이 남지 않는다.
    if (!s.project) break;
    if (s.modal) { const t = await closeModal(); await page.waitForTimeout(150); if (t) cards++; continue; }
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
  // 완성되면 결과창 → 홍보 → 출시 확인이 저절로 이어진다. 아래 단계들이
  // 개발 탭에서 같은 일을 손으로 하므로, 여기서는 그 체인을 그냥 닫는다.
  await page.evaluate(() => window.__ui.closeModal());
  await page.waitForTimeout(200);
  return `「${s.finished}」 완성 · 카드 ${cards}회`;
});

console.log('\n── 7. 출시 준비 (디버그 · 홍보 · 출시) ──');
// The finished-game panel lives on the 개발 tab: it is the last step of making
// a game, not the first step of running one.
await openTab('dev'); await page.waitForTimeout(300);
await step('디버그로 버그 제거', async () => {
  const b0 = await page.evaluate(() => window.__game.finished.bugs);
  let passes = 0;
  for (let i = 0; i < 40; i++) {
    const r = await page.evaluate(() => {
      if (window.__game.company.stamina < 2) window.__game.nextWeek();
      return window.__game.debugProject().ok;
    });
    if (!r) break;
    passes++;
    if ((await page.evaluate(() => window.__game.finished.bugs)) <= 0) break;
  }
  const b1 = await page.evaluate(() => window.__game.finished.bugs);
  if (b1 > 0) throw new Error(`버그 ${b1}개 남음`);
  // The count itself is allowed to be ugly for a rookie team — that is the
  // point of usability as a stat. What must not happen is clearing it turning
  // into twenty button presses.
  if (passes > 8) throw new Error(`디버그를 ${passes}번이나 눌러야 함 — 작업이 아니라 노가다`);
  return `버그 ${b0} → 0 (디버그 ${passes}회)`;
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

console.log('\n── 8. 사무실 탭 (층 구매 → 3D 반영) ──');
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
  if (s.floors !== before + 1) throw new Error(`층수 그대로 (${s.floors})`);
  if (s.viewFloors < s.floors) throw new Error(`3D는 ${s.viewFloors}층만 세워짐`);
  // A new floor arrives empty; the furniture already downstairs must survive
  // the rebuild, which is what re-running buildPlaced on every build protects.
  if (s.desks < 4) throw new Error(`증축 후 책상이 ${s.desks}개로 줄어듦`);
  return `${before} → ${s.floors}층 · 삼각형 ${Math.round(tris0).toLocaleString()} → ${Math.round(s.tris).toLocaleString()}개 · 책상 ${s.desks}개 유지`;
});
await step('새 층에도 배치할 수 있다', async () => {
  const ok = await page.evaluate(() => {
    const g = window.__game, v = window.__view;
    g.company.money = 5_000_000;
    v.setFloor(1);
    g.buyFurniture('desk');
    const uid = g.bag[g.bag.length - 1].uid;
    const r = g.placeFurniture(uid, 1, 10, 9, 0, v.placeChecks());
    v.rebuildFurniture();
    return r;
  });
  await page.waitForTimeout(500);
  if (!ok.ok) throw new Error('2층 배치 실패: ' + ok.why);
  const floors = await page.evaluate(() =>
    [...new Set(window.__view.desks.map((d) => d.floor))].sort().join(','));
  if (!floors.includes('1')) throw new Error('2층에 책상 슬롯이 생기지 않음');
  return `책상이 있는 층: ${floors}`;
});
await step('새 층 보기 + 직원 재배치', async () => {
  await openTab('office'); await page.waitForTimeout(250);
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#panel .floorcard.owned button')];
    cards[cards.length - 1].click();
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => { window.__view.rebuildFurniture(); });
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

console.log('\n── 9. 저장/불러오기 왕복 ──');
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
/* 소재 '스포츠'(sports2) 는 장르 '스포츠' 와 이름이 겹쳐서 '축구'(soccer) 로
   바뀌었다. 옛 세이브 안에는 그 id 가 프로젝트·도감·조합 기록 세 군데에
   박혀 있으므로, 불러올 때 전부 옮겨져야 한다. */
await step('이름이 바뀐 소재(sports2 → soccer)를 옛 세이브에서 옮긴다', async () => {
  await page.evaluate(() => {
    const key = 'socialdev3d.save.v2';
    const d = JSON.parse(localStorage.getItem(key));
    d.company.dex.contents = { ...d.company.dex.contents, sports2: true };
    d.company.discovered = { ...d.company.discovered, 'sports|sports2': 1.6 };
    d.company.recentCombos = ['sports|sports2'];
    d.company.trends = { genreId: 'sports', genreKo: '스포츠', contentId: 'sports2', contentKo: '스포츠', setAt: '1-1' };
    delete d.company.contentsOwned;      // 뽑기가 없던 시절의 세이브
    if (d.releases && d.releases[0]) d.releases[0].contentId = 'sports2';
    localStorage.setItem(key, JSON.stringify(d));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('gone'), { timeout: 180000 });
  await page.waitForTimeout(1200);
  await closeModal(); await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const c = window.__game.company;
    return {
      dex: Object.keys(c.dex.contents),
      disc: Object.keys(c.discovered),
      recent: c.recentCombos,
      owned: c.contentsOwned,
      trendKo: c.trends.contentKo,
      rel: (window.__game.releases[0] || {}).contentId,
    };
  });
  if (r.dex.includes('sports2')) throw new Error('도감에 옛 id 가 남음');
  if (!r.dex.includes('soccer')) throw new Error('도감이 새 id 로 안 옮겨짐');
  if (r.disc.includes('sports|sports2')) throw new Error('조합 기록에 옛 id 가 남음');
  if (!r.disc.includes('sports|soccer')) throw new Error('조합 기록이 안 옮겨짐');
  if (r.recent[0] !== 'sports|soccer') throw new Error('재탕 판정 기록이 안 옮겨짐: ' + r.recent[0]);
  if (r.rel && r.rel !== 'soccer') throw new Error('출시작의 소재가 안 옮겨짐: ' + r.rel);
  if (r.trendKo !== '축구') throw new Error('유행 표시가 안 바뀜: ' + r.trendKo);
  // 이미 써 본 소재는 잠기지 않는다 — 아무 잘못 없는 회사가 자기 대표작을
  // 못 만들게 되는 것이 이 이관의 유일한 실패 방식이다.
  if (!r.owned.includes('soccer')) throw new Error('써 본 소재가 잠김');
  return `도감·조합·유행 모두 축구로 · 보유 소재 ${r.owned.length}종`;
});

console.log('\n── 10. 렌더러 ──');
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
