/* Feature test for the systems flow.mjs does not reach: the install guide,
   hiring and departure choreography, proposal clearing, debug scoring, the
   quality bars, hidden combos, weekly events, sales tasks and first person.

   Same conventions as the other browser harnesses: Playwright is resolved from
   wherever it happens to be installed and the server is assumed to be running.
     PLAYWRIGHT=/path/to/playwright/index.mjs  PORT=8123  OUT=.  node tools/features.mjs */
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const BASE = process.env.BASE || `http://localhost:${process.env.PORT || 8123}`;
const OUT = process.env.OUT || '.';
const { chromium } = await import(PW);
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({
  viewport: { width: 960, height: 440 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
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
await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('gone'), { timeout: 180000 });
await page.waitForTimeout(900);

console.log('\n── 홈 화면 추가 안내 ──');
await step('첫 방문에 안내가 뜬다', async () => {
  const shown = await page.evaluate(() => document.getElementById('a2hs').classList.contains('show'));
  if (!shown) throw new Error('안내가 뜨지 않음');
  const txt = await page.evaluate(() => document.getElementById('a2hs').textContent);
  if (!txt.includes('홈 화면에 추가')) throw new Error('설명 없음');
  return 'iOS 탭 기본 선택';
});
await page.screenshot({ path: OUT + '/01-a2hs.png' });
await step('갤럭시 탭 전환', async () => {
  await page.click('.a2tab[data-os="and"]');
  const hidden = await page.evaluate(() => document.getElementById('a2ios').hidden);
  if (!hidden) throw new Error('iOS 단계가 그대로');
  return '안드로이드 안내 표시';
});
await step('다시 보지 않기 → 저장 후 닫힘', async () => {
  await page.click('#a2never');
  const shown = await page.evaluate(() => document.getElementById('a2hs').classList.contains('show'));
  const saved = await page.evaluate(() => !!localStorage.getItem('socialdev3d.a2hs.dismissed'));
  if (shown) throw new Error('닫히지 않음');
  if (!saved) throw new Error('기억되지 않음');
  return 'localStorage 기록';
});

console.log('\n── 채용 · 퇴사 ──');
await step('랭크 1에서 바로 채용된다', async () => {
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.company.money = 3_000_000;
    const before = g.staff.length;
    const cap = g.info().staffCap;
    const res = g.hire(g.candidates[0].id);
    return { before, after: g.staff.length, cap, why: res.why || '' };
  });
  if (r.after !== r.before + 1) throw new Error('채용 실패: ' + r.why);
  return `정원 ${r.cap} · ${r.before} → ${r.after}명`;
});
await step('신입이 정문에서 걸어 들어온다', async () => {
  const r = await page.evaluate(() => {
    const g = window.__game, v = window.__view;
    const s = g.staff[g.staff.length - 1];
    const a = v.crew.get(s.id);
    return { has: !!a, x: a && a.x, z: a && a.z, ent: v.entrance, state: a && a.state, bubble: a && a.bubble && a.bubble.text };
  });
  if (!r.has) throw new Error('3D 에이전트가 생기지 않음');
  const d = Math.hypot(r.x - r.ent.x, r.z - r.ent.z);
  if (d > 4) throw new Error(`정문에서 ${d.toFixed(1)} 떨어진 곳에 생성됨`);
  return `정문 근처 · "${r.bubble}"`;
});
await step('걸어서 자리에 앉는다', async () => {
  let r = null;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(1000);
    r = await page.evaluate(() => {
      const g = window.__game, v = window.__view;
      const s = g.staff[g.staff.length - 1];
      const a = v.crew.get(s.id), d = v.deskOf(s);
      return { state: a.state, dist: d ? Math.hypot(a.x - d.seatX, a.z - d.seatZ) : -1 };
    });
    if (r.state === 'sit' && r.dist < 2.5) break;
  }
  if (r.dist > 2.5) throw new Error(`자리에서 ${r.dist.toFixed(1)} 떨어짐 (state=${r.state})`);
  return `착석 (${r.state})`;
});
await step('퇴사자는 자리에 남지 않는다', async () => {
  const id = await page.evaluate(() => {
    const g = window.__game;
    const s = g.staff[g.staff.length - 1];
    g.fire(s.id);
    return s.id;
  });
  const mid = await page.evaluate((i) => {
    const a = window.__view.crew.get(i);
    return { alive: !!a, bubble: a && a.bubble && a.bubble.text, leaving: window.__view.leaving.has(i) };
  }, id);
  if (!mid.alive) throw new Error('즉시 사라짐 (걸어나가는 연출 없음)');
  if (!mid.leaving) throw new Error('leaving 목록에 없음');
  let gone = null;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(1000);
    gone = await page.evaluate((n) => ({
      agent: !!window.__view.crew.get(n),
      tag: !!window.__view.tags.get(n),
    }), id);
    if (!gone.agent) break;
  }
  if (gone.agent) throw new Error('아직도 사무실에 남아 있음');
  if (gone.tag) throw new Error('이름표가 남아 있음');
  return `"${mid.bubble}" → 정문으로 퇴장 후 제거`;
});

console.log('\n── 기획서 · 조합 · 그래프 ──');
await step('게임 완성 시 남은 기획서가 사라진다', async () => {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    g.company.money = 9_000_000; g.company.stamina = 60;
    window.__view.meetingScenes = false;
    for (let i = 0; i < 4; i++) g.makeProposal();
    const before = g.proposals.length;
    const pr = g.proposals[0];
    g.beginDevelopment({ proposalId: pr.id, platformId: 'feature', monetizeId: 'paid',
      teamIds: g.staff.slice(0, 4).map((s) => s.id), seriesOfId: null });
    const mid = g.proposals.length;
    for (let i = 0; i < 400 && g.project; i++) {
      if (g.project.pendingCards) { g.pickCard(g.project.pendingCards.options[0].id); continue; }
      if (g.company.stamina < 2) g.company.stamina = 60;
      g.devTurn();
    }
    return { before, mid, after: g.proposals.length, finished: !!g.finished };
  });
  if (!r.finished) throw new Error('완성되지 않음');
  if (r.after !== 0) throw new Error(`완성 후에도 기획서 ${r.after}건 남음`);
  return `${r.before}건 → 착수 후 ${r.mid}건 → 완성 후 ${r.after}건`;
});
await step('디버그가 평론가 점수를 올린다', async () => {
  const r = await page.evaluate(() => {
    const g = window.__game;
    const p = g.finished;
    const before = p.criticTotal, bugs = p.bugs;
    g.company.stamina = 40;
    let guard = 0;
    while (g.finished.bugs > 0 && guard++ < 60) g.debugProject();
    return { before, after: g.finished.criticTotal, bugs, left: g.finished.bugs };
  });
  if (r.bugs > 0 && r.after <= r.before) throw new Error(`점수가 그대로 (${r.before} → ${r.after})`);
  return `버그 ${r.bugs} → ${r.left} · 평론가 ${r.before} → ${r.after}점`;
});
await step('품질 그래프가 실제로 채워진다', async () => {
  await page.evaluate(() => { document.body.classList.remove('panel-hidden');
    document.querySelector('#tabs .tab[data-tab="dev"]').click(); });
  await page.waitForTimeout(300);
  const w = await page.evaluate(() => [...document.querySelectorAll('#panel .sb .fill')]
    .map((e) => parseFloat(e.style.width)));
  if (!w.length) throw new Error('막대가 없음');
  if (w.some((x) => x < 3)) throw new Error('빈 막대 존재: ' + JSON.stringify(w));
  return '너비 ' + w.map((x) => x.toFixed(0) + '%').join(' · ');
});
await page.screenshot({ path: OUT + '/02-finished.png' });
await step('출시 결과에 한 줄 평이 붙는다', async () => {
  const notes = await page.evaluate(() => {
    const g = window.__game;
    g.release();
    const r = g.releases[0];
    window.__ui.showRelease(r);
    return (r.notes || []).map((n) => n.cls + ':' + n.ko);
  });
  await page.waitForTimeout(300);
  if (!notes.length) throw new Error('release.notes 가 비어 있음');
  const t = await page.evaluate(() => document.getElementById('mBody').innerHTML);
  if (!t.includes('verd')) throw new Error('평가 문구 없음');
  const n = (t.match(/class="verd/g) || []).length;
  return `${n}줄`;
});
await page.screenshot({ path: OUT + '/03-release.png' });
await step('처음 보는 조합은 궁합을 숨긴다', async () => {
  const r = await page.evaluate(() => {
    const ui = window.__ui, g = window.__game;
    g.company.discovered = {};
    const known = ui.knownCombo('rpg', 'fantasy');
    g.company.discovered['rpg|fantasy'] = { score: 1.6, critic: 20, title: 'x' };
    return { before: known, after: ui.knownCombo('rpg', 'fantasy') };
  });
  if (r.before || !r.after) throw new Error('발견 판정이 동작하지 않음');
  return '미발견 ??? → 발견 후 표시';
});

console.log('\n── 주간 이벤트 · 태스크 ──');
await step('선택지가 있는 이벤트가 주를 막는다', async () => {
  const r = await page.evaluate(() => {
    const g = window.__game;
    let ev = null;
    for (let i = 0; i < 200 && !ev; i++) { g.rollWeeklyEvent(); ev = g.pendingEvent; }
    if (!ev) return { none: true };
    const wk = g.company.week;
    const blocked = g.nextWeek();
    const same = g.company.week === wk;
    g.answerEvent(0);
    return { ko: ev.ko, opts: ev.options.length, blocked: !!blocked.blocked, same, cleared: !g.pendingEvent };
  });
  if (r.none) throw new Error('선택지 이벤트가 뽑히지 않음');
  if (!r.blocked || !r.same) throw new Error('미응답 상태에서 주가 넘어감');
  if (!r.cleared) throw new Error('응답 후에도 남아 있음');
  return `${r.ko} · 선택지 ${r.opts}개`;
});
await step('세일즈 태스크가 보상까지 지급된다', async () => {
  const r = await page.evaluate(() => {
    const g = window.__game;
    const coins = g.company.coins;
    g.company.tasksDone = {};
    g.checkTasks();
    const done = Object.keys(g.company.tasksDone).length;
    return { done, coins, after: g.company.coins };
  });
  if (!r.done) throw new Error('달성 처리 안 됨');
  if (r.after <= r.coins) throw new Error('보상 미지급');
  return `${r.done}건 달성 · 코인 ${r.coins} → ${r.after}`;
});

console.log('\n── 1인칭 시점 ──');
await step('1인칭 진입', async () => {
  await page.evaluate(() => { document.getElementById('modal').classList.remove('show'); });
  await page.click('#fpBtn');
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => {
    const v = window.__view, c = window.__cam;
    return { on: v.fp.on, body: document.body.classList.contains('fp'), fp: !!c.fp,
      x: v.fp.x, z: v.fp.z, floor: v.fp.floor, ui: getComputedStyle(document.getElementById('fpui')).display };
  });
  if (!r.on || !r.fp) throw new Error('진입 실패');
  if (r.ui === 'none') throw new Error('조작 UI가 숨겨져 있음');
  return `(${r.x.toFixed(1)}, ${r.z.toFixed(1)}) ${r.floor + 1}F`;
});
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + '/04-fp.png' });
await step('걸어서 이동하고 벽을 통과하지 않는다', async () => {
  const r = await page.evaluate(async () => {
    const v = window.__view;
    // Face west, down the open lobby: due north from the doors is the
    // reception desk, and not walking through it is the point.
    v.fp.yaw = -Math.PI / 2;
    const start = [v.fp.x, v.fp.z];
    v.fp.setStick(0, -1);                       // push forward
    await new Promise((r2) => setTimeout(r2, 3000));
    const mid = [v.fp.x, v.fp.z];
    v.fp.setStick(0, 0);
    const nav = v.crew.navFor(v.fp.floor);
    return { moved: Math.hypot(mid[0] - start[0], mid[1] - start[1]), clear: nav.circleClear(mid[0], mid[1], 0.9) };
  });
  if (r.moved < 1) throw new Error('움직이지 않음 (' + r.moved.toFixed(2) + ')');
  if (!r.clear) throw new Error('벽/가구 안에 들어감');
  return `${r.moved.toFixed(1)} 유닛 이동 · 충돌 정상`;
});
await step('직원을 격려하면 의욕이 오른다', async () => {
  const r = await page.evaluate(() => {
    const v = window.__view, g = window.__game;
    const a = v.crew.all().find((x) => x.floor === v.fp.floor);
    if (!a) return { none: true };
    // stand next to them, looking their way
    v.fp.x = a.x - 2.2; v.fp.z = a.z; v.fp.yaw = Math.PI / 2;
    v.fp.focus = v.fp.findFocus();
    const s = g.staff.find((x) => x.id === a.id);
    const before = s.motivation;
    const line = v.fp.interact();
    const again = v.fp.interact();
    return { name: a.name, focus: v.fp.focus && v.fp.focus.kind, before, after: s.motivation, line, again };
  });
  if (r.none) throw new Error('같은 층에 직원이 없음');
  if (r.focus !== 'staff') throw new Error('직원을 인식하지 못함: ' + r.focus);
  // 일벌레 only takes 0.4 of a point, so assert a real gain, not exactly +1.
  if (!(r.after > r.before)) throw new Error(`의욕 ${r.before} → ${r.after}`);
  if (String(r.after).length > 5) throw new Error('부동소수 노이즈: ' + r.after);
  if (!/이미/.test(r.again || '')) throw new Error('주 1회 제한이 없음');
  return `${r.name} 의욕 ${r.before} → ${r.after} · 재사용 차단`;
});
await page.screenshot({ path: OUT + '/05-fp-interact.png' });
await step('1인칭에서 빠져나오면 원래 카메라로', async () => {
  await page.click('#fpExit');
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => ({
    on: window.__view.fp.on, fp: !!window.__cam.fp,
    body: document.body.classList.contains('fp'),
  }));
  if (r.on || r.fp || r.body) throw new Error('복귀 실패');
  return '오빗 카메라 복귀';
});
await page.screenshot({ path: OUT + '/06-back.png' });

console.log('\n── 렌더 ──');
await step('프레임이 계속 돈다 · 콘솔 오류 없음', async () => {
  const a = await page.evaluate(() => window.__view.frames);
  await page.waitForTimeout(2000);
  const b = await page.evaluate(() => window.__view.frames);
  if (b <= a) throw new Error('정지');
  if (errs.length) throw new Error(errs.slice(0, 3).join(' | '));
  return `${b - a} 프레임 / 2초`;
});

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
if (errs.length) console.log('오류:\n' + errs.slice(0, 8).join('\n'));
await browser.close();
process.exit(fail ? 1 : 0);
