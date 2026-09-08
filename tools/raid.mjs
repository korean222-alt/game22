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
    set: v.arenaSet ? v.arenaSet.id : null,
    setKo: v.arenaSet ? v.arenaSet.def.ko : null,
    // 무대는 **공정**의 것이고 몬스터는 제비뽑기로 정해진다. 둘이 같은
    // 값이던 시절의 검사(set === boss)는 이제 틀린 검사다.
    stageSet: p && p.stages ? p.stages[p.stage].set : null,
    stageSpecies: p && p.stages ? p.stages[p.stage].species : null,
    allSpecies: p && p.stages ? p.stages.map((x) => x.species).join(',') : null,
    bossX: v.boss ? Math.round(v.boss.x) : null,
    title: document.getElementById('aTitle').textContent,
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

/* 창업 흐름(이름 입력 → 첫 출근 → 창립 영상 → 지원금)이 아직 돌고 있으면
   먼저 치운다. 이걸 안 하면 뒤의 카드 검사가 창업 팝업을 카드로 오인하고,
   1인칭으로 문 앞에 선 채로 아레나 검사가 시작된다. */
for (let i = 0; i < 8; i++) {
  const st = await page.evaluate(() => ({
    modal: document.getElementById('modal').classList.contains('show'),
    intro: document.body.classList.contains('fpintro'),
    cine: document.body.classList.contains('cine'),
  }));
  if (st.intro) {
    // 앞으로 걸어서 문턱을 넘는다.
    await page.keyboard.down('w');
    await page.waitForFunction(() => !document.body.classList.contains('fpintro'), { timeout: 30000 });
    await page.keyboard.up('w');
    continue;
  }
  if (st.cine) {
    await page.waitForFunction(() => !document.body.classList.contains('cine'), { timeout: 30000 });
    continue;
  }
  if (!st.modal) break;
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
  // 마지막 공정에 버그 보스가 한 마리 더 선다 — 넷이 아니면 그 자리가 사라진 것이다.
  if (r.stages.length !== 4) throw new Error('보스가 4마리가 아님: ' + r.stages.length);
  return `착수 -${r.need} · 스테이지 HP ${r.stages.join('/')} (합 ${r.total})`;
});

console.log('\n── 2. 아레나 ──');
await step('아레나에 들어가면 경영 UI 가 비켜선다', async () => {
  // 첫 진입에는 '개발 시작' 안내가 먼저 뜨고 enterArena 가 false 를 돌려준다.
  // 하네스는 그 안내를 이미 본 것으로 치고 바로 들어간다.
  await page.evaluate(() => { window.__game.company.devIntroSeen = true; window.__ui.enterArena(); });
  await page.waitForTimeout(300);
  const s = await state();
  if (!s.arena) throw new Error('body.arena 가 안 붙음');
  if (s.pips !== 4) throw new Error('스테이지 표시가 4개가 아님: ' + s.pips);
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

/* 세트장 — 예전에는 보스가 사무실 복도 교차점에 섰다. 규칙상 안전하지만
   연출로는 "복도 한복판에 오크가 있다" 였다. 이제 몬스터마다 자기 무대가
   있고, 무대는 사무실에서 아주 멀리 떨어진 좌표에 지어진다. */
await step('보스마다 전용 세트장에 선다', async () => {
  const s = await wait((x) => x.set, 30000, '세트장');
  if (s.set !== 'cat') throw new Error('1번 보스의 세트가 아님: ' + s.set);
  if (s.bossX < 400) throw new Error(`보스가 아직 사무실 안이다 (x=${s.bossX})`);
  if (!s.title.includes(s.setKo)) throw new Error('머리말에 무대 이름이 없음: ' + s.title);
  const drawn = await page.evaluate(() => !!window.__view.gArena);
  if (!drawn) throw new Error('세트장 메시가 GPU 에 안 올라감');
  return `${s.setKo} (x=${s.bossX})`;
});

await step('버튼을 누르지 않아도 직원들이 알아서 때린다', async () => {
  // 모달이 떠 있으면 전투는 멈춘다(읽는 동안 체력이 깎이면 읽는 것이 벌칙이
  // 되므로). 창업 흐름의 잔여 팝업이 남아 있으면 이 검사는 영원히 못 센다.
  await pickFirstChoice();
  await page.waitForTimeout(200);
  const a = await state();
  const b = await wait((s) => s.strikes > a.strikes + 4, 45000, '타격 누적');
  if (b.stamina !== a.stamina) throw new Error(`전투가 스태미나를 먹었다 ${a.stamina}→${b.stamina}`);
  return `${b.strikes}타 · HP ${b.hp}/${b.hpMax} · 스태미나 그대로 ${b.stamina}`;
});

console.log('\n── 3. 4연전 ──');
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

/* 보스의 몸은 착수할 때 칸마다 제비뽑기로 정해지고, 무대는 **공정**이
   정한다. 예전에는 둘이 같은 값이라 `set === boss` 로 검사했는데, 이제
   1번 칸에 병아리가 서도 무대는 브레인스토밍 광장이다. */
await step('2번 보스는 다른 몸으로 나온다 — 무대는 공정을 따른다', async () => {
  const s = await wait((x) => x.boss && x.stage === 1 && x.boss === x.stageSpecies, 30000, '보스 모델 교체');
  const t = await wait((x) => x.set === x.stageSet, 15000, '세트장 교체');
  if (t.stageSet !== 'orc') throw new Error('2번 공정의 무대가 난제의 작업장이 아님: ' + t.stageSet);
  return `${s.boss} · ${t.setKo}`;
});

/* 제비뽑기. 네 칸의 종족이 각자 자기 후보 안에서 나와야 한다 — 데뷔작에
   마감 데몬이 1번으로 서면 그건 무작위가 아니라 고장이다. */
await step('보스는 칸마다 후보 안에서 뽑힌다', async () => {
  const pools = [['cat', 'chicken', 'bee'], ['orc', 'alien', 'chicken'],
    ['demon', 'alien', 'orc'], ['bug', 'bugBee']];
  const s = await state();
  const got = (s.allSpecies || '').split(',');
  if (got.length !== 4) throw new Error('스테이지가 4칸이 아님: ' + s.allSpecies);
  got.forEach((sp, i) => {
    if (!pools[i].includes(sp)) throw new Error(`${i + 1}번 칸에 후보 밖의 종족: ${sp}`);
  });
  return got.join(' → ');
});

/* 네 칸이 **서로 다른 몸**을 입는가.

   'bug' 와 'cat' 은 이름이 다르지만 같은 cat.glb 를 쓴다. 칸마다 따로
   뽑던 시절에는 1번에 냥이가 서고 4번에 버그가 서면 화면에 똑같은 놈이
   두 번 나왔고, 그것이 "다 잡았는데 갑자기 첫 번째 보스가 나온다" 였다. */
await step('네 칸이 서로 다른 몸으로 선다', async () => {
  const r = await page.evaluate(async () => {
    const m = await import('./src/game/monsters.js');
    const p = window.__game.project;
    const files = p.stages.map((s) => m.MONSTER_BY_ID.get(s.species).file);
    return { files, uniq: new Set(files).size };
  });
  if (r.uniq !== 4) throw new Error('같은 몸이 두 번 섰다: ' + r.files.join(', '));
  return r.files.map((f) => f.split('/').pop()).join(' → ');
});

await step('아레나에서 나오면 사무실로 돌아온다', async () => {
  await page.evaluate(() => window.__ui.exitArena());
  await page.waitForTimeout(600);
  const s = await state();
  if (s.arena) throw new Error('아레나가 안 꺼짐');
  if (s.set) throw new Error('세트장이 안 치워짐');
  if (s.bossX > 200) throw new Error(`보스가 아직 무대에 있다 (x=${s.bossX})`);
  const gone = await page.evaluate(() => !window.__view.gArena);
  if (!gone) throw new Error('세트장 메시가 안 버려짐');
  // 첫 진입에는 '개발 시작' 안내가 먼저 뜨고 enterArena 가 false 를 돌려준다.
  // 하네스는 그 안내를 이미 본 것으로 치고 바로 들어간다.
  await page.evaluate(() => { window.__game.company.devIntroSeen = true; window.__ui.enterArena(); });
  await page.waitForTimeout(600);
  return `보스 x=${s.bossX} 로 복귀 후 다시 입장`;
});

/* 마지막 공정에서만 시계가 돈다. 버그 보스는 때리지 않는 대신 시간이
   있으므로, 그 화면에 남은 시간이 안 적혀 있으면 압박이 화면에 없다. */
let sawClock = null;
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
    if (!sawClock) {
      const c = await page.evaluate(() => {
        const el = document.getElementById('aClock');
        const g = window.__game;
        const st = g.project && g.project.stages
          ? g.project.stages[g.project.stage || 0] : null;
        return el && !el.hidden && st && st.bug ? { tx: el.textContent, limit: st.limit } : null;
      });
      if (c) sawClock = c;
    }
    if (s.modal) await pickFirstChoice();
    if (errs.length) throw new Error(errs[0]);
    await page.waitForTimeout(120);
  }
  throw new Error('완성되지 않음: ' + JSON.stringify(await state()));
});

await step('버그 보스 앞에서만 시계가 돈다', async () => {
  if (!sawClock) throw new Error('마지막 공정에 시계가 안 떴다');
  const off = await page.evaluate(() => {
    const el = document.getElementById('aClock');
    return !el || el.hidden;
  });
  if (!off) throw new Error('완성된 뒤에도 시계가 남아 있다');
  return `${sawClock.tx} · 제한 ${sawClock.limit}초`;
});

/* 마지막 보스를 잡고 나서 아무도 다시 서지 않아야 한다.

   "다 잡았는데 갑자기 첫 번째 보스가 뜬다" 가 이 자리였다. 화면의 보스는
   언제나 **지금 공정의 놈**이거나 아무도 아니다 — 그 불변식을 매 프레임
   강제하도록 고쳤고, 여기서 그 결과를 본다. */
await step('완성 뒤에는 보스가 다시 서지 않는다', async () => {
  /* 여기서 모달을 눌러 치우지 않는다. 완성 팝업의 '확인' 은 홍보로 이어지고
     홍보는 출시로 이어지므로, 치우는 순간 다음 절의 출시 검사가 이미 끝난
     게임을 다시 내려 하게 된다. 보스가 섰는지는 모달과 무관하다. */
  for (let i = 0; i < 24; i++) {
    const s = await state();
    if (s.boss) throw new Error(`완성 뒤에 보스가 섰다: ${s.boss} (arena=${s.arena})`);
    if (errs.length) throw new Error(errs[0]);
    await page.waitForTimeout(150);
  }
  return '3.6초 동안 아무도 안 섬';
});

console.log('\n── 4. 출시와 한 주 판매 ──');
/* 출시작은 한 주만 판다.

   예전에는 유저가 빠질 때까지 — 잘 만든 게임이면 반년 넘게 — 운영 칸을
   붙들었고, 세 칸이 차면 새 게임을 못 냈다. 그 상태에서 개발 탭은 이미
   출시 화면에 가 있어서 내릴 방법이 화면에 없었다. 그래서 여기서 보는 것은
   "판매 패널이 뜬다" 가 아니라 **칸이 다시 비워지는가** 다. */
await step('출시하면 실시간 판매가 돈다', async () => {
  const r = await page.evaluate(() => {
    const g = window.__game;
    const res = g.release();
    window.__ui.renderAll();
    return { ok: res.ok, why: res.why, releases: g.releases.length, selling: g.selling(), live: g.managed().length };
  });
  if (!r.ok) throw new Error(r.why);
  if (!r.selling) throw new Error('실시간 판매가 안 돈다');
  await page.evaluate(() => { window.__ui.exitArena(); });
  await page.waitForTimeout(200);
  return `출시작 ${r.releases}편 · 판매 중 ${r.live}작품`;
});

await step('정산을 확인하면 그 게임의 판매가 끝난다', async () => {
  const r = await page.evaluate(() => {
    const g = window.__game;
    // 화면의 '정산 확인' 버튼은 12주가 다 팔린 뒤에만 열린다. 남은 주차를
    // 마저 흘려서 같은 조건을 만든 뒤에 확인한다 — 중간에 접으면 아직
    // 받지 않은 매출이 사라지므로 게임 쪽이 막는다.
    if (g.sales) { g.salesTick(g.sales.secs); g.closeSalesRun(); }
    window.__ui.closeModal();
    window.__ui.renderAll();
    return { live: g.managed().length, past: g.releases.filter((x) => !x.managing).length };
  });
  if (r.live !== 0) throw new Error(`아직 ${r.live}작품이 운영 중이다`);
  if (r.past < 1) throw new Error('서비스 종료 목록이 비어 있다');
  return `운영 ${r.live} · 종료 ${r.past}`;
});

/* 사용자가 막힌 그 자리다: 게임을 다 만들고 출시를 눌렀는데 "3개가 찼으니
   하나를 내리세요" 만 뜨고, 내리는 버튼은 다른 탭에 있었다. 이제는 칸이
   차 있어도 가장 오래된 것을 접고 그대로 출시한다. */
await step('운영 칸이 차 있어도 출시가 막히지 않는다', async () => {
  const r = await page.evaluate(() => {
    const g = window.__game;
    const cap = g.info().managedCap;
    // 칸을 억지로 채운다 (옛 세이브가 이 상태로 온다).
    const base = g.releases[0];
    for (let i = 0; i < cap; i++) {
      g.releases.unshift({ ...base, id: 'fake' + i, title: '옛 작품 ' + i, managing: true, history: [] });
    }
    const before = g.managed().length;
    // 출시할 게임 한 편을 세워 둔다.
    g.finished = { ...base, id: 'newone', title: '새 작품', devCost: 1000,
      quality: base.quality, critics: base.critics, criticTotal: base.criticTotal,
      genreId: 'shoot', contentId: 'sf', genreKo: '슈팅', contentKo: 'SF',
      platformId: base.platformId, monetizeId: base.monetizeId, bugs: 0,
      seriesN: 1, hallOfFame: false, combo: 1, proposal: { grade: 2 }, hpMax: 500, team: [] };
    const res = g.release();
    return { ok: res.ok, why: res.why, before, after: g.managed().length, cap };
  });
  if (!r.ok) throw new Error(r.why || '출시가 막혔다');
  if (r.after > r.cap) throw new Error(`운영 칸이 ${r.after}작품으로 넘쳤다`);
  return `칸 ${r.before}/${r.cap} 이 차 있어도 출시됨 → ${r.after}작품`;
});

/* ── 무대가 바뀌면 시점도 그 무대의 것으로 ──
   제보: "버그 보스 잡으려고 딱 넘어갈 때 화면이 벽에 가려져서 1초 동안
   안 보인다." 세트마다 카메라의 방위각이 다르고(그 세트의 지오메트리 사이로
   무대가 보이는 각도로 맞춰 둔 값이다), 공정이 넘어갈 때는 세트만 갈아
   끼우고 카메라는 앞 무대의 각도 그대로 두었다. QA 실은 반지름 26 에
   모니터 벽이 둘러서 있어서, 그 각도로는 카메라가 모니터 한 장 뒤에 선다. */
console.log('\n── 5. 무대와 시점 ──');
await step('공정이 바뀌면 카메라도 그 무대의 시점으로 옮긴다', async () => {
  const r = await page.evaluate(async () => {
    const v = window.__view, cam = window.__cam;
    const A = await import('/src/world/arena.js');
    const was = v.arena;
    v.arena = true;
    v.useArenaSet('demon');
    const demon = { az: +cam.az.toFixed(3), want: +A.arenaSetFor('demon').camera.az.toFixed(3) };
    v.useArenaSet('bug');
    const bug = { az: +cam.az.toFixed(3), want: +A.arenaSetFor('bug').camera.az.toFixed(3) };
    v.arena = was;
    if (!was) { v.clearArenaSet(); v.setFloor(v.floor); }
    return { demon, bug };
  });
  if (Math.abs(r.demon.az - r.demon.want) > 0.01) throw new Error(`마감의 제단: ${r.demon.az} ≠ ${r.demon.want}`);
  if (Math.abs(r.bug.az - r.bug.want) > 0.01) throw new Error(`QA 실: ${r.bug.az} ≠ ${r.bug.want}`);
  return `제단 ${r.demon.az} → QA 실 ${r.bug.az}`;
});

/* ── 게임덱스 부스 ──
   제보: "부스 차릴 때 그냥 차리기 하고 끝이 아니라, 게임 홍보 하고 있는
   그런 모습을 보여줘." 예산을 고르면 화면이 전시장으로 넘어가고, 입구에서
   사람이 걸어 들어와 부스 앞에 모인다. */
console.log('\n── 6. 게임덱스 부스 ──');
await step('부스를 차리면 전시장으로 넘어간다', async () => {
  const r = await page.evaluate(() => {
    const v = window.__view;
    const hall = v.enterExpo('big');
    // 시간을 손으로 감아 사람들을 부스 앞까지 보낸다.
    for (let i = 0; i < 240; i++) v.tickExpo(0.05);
    const near = v.visitors.list.filter((a) => Math.hypot(a.x - hall.booth.x, a.z - hall.booth.z) < 34).length;
    return {
      expo: v.expo, crowd: v.visitors.count, near,
      body: document.body.classList.contains('expo'),
      booth: [Math.round(hall.booth.x), Math.round(hall.booth.z)],
    };
  });
  if (!r.expo) throw new Error('전시장으로 안 넘어감');
  if (r.crowd < 8) throw new Error(`관람객이 ${r.crowd}명`);
  if (!r.near) throw new Error('아무도 부스 앞으로 안 옴');
  return `관람객 ${r.crowd}명 · 부스 앞 ${r.near}명`;
});

await step('나오면 사무실로 되돌아온다', async () => {
  const r = await page.evaluate(() => {
    const v = window.__view;
    v.exitExpo();
    return { expo: v.expo, visitors: v.visitors ? v.visitors.count : -1, hall: !!v.expoHall };
  });
  if (r.expo || r.hall) throw new Error('전시장이 안 닫힘');
  if (r.visitors !== 0) throw new Error(`관람객이 ${r.visitors}명 남았다`);
  return '전시장 정리됨';
});

/* ── 개막 장면 ──
   초대장이 오면 선택지가 사무실 위에 그냥 뜨는 게 아니라, 먼저 전시장으로
   간다: 남의 부스는 다 섰고 우리 칸만 비어 있는 홀에서 사회자가 개막을
   알리고, 그 다음에 "어떤 걸 선택하시겠어요?" 가 뜬다. 그리고 그 장면이
   도는 동안에는 어떤 팝업도 위에 덮이지 않는다 — 랭크업조차. */
await step('초대장이 오면 개막 장면부터 돈다', async () => {
  /* 앞 절이 남긴 창을 먼저 치운다. 팝업이 떠 있는 동안에는 줄이 안 움직이고
     — 그게 규칙이다 — 그러면 초대장도 그 뒤에서 기다린다. */
  for (let i = 0; i < 12; i++) {
    const on = await page.evaluate(() => document.getElementById('modal').classList.contains('show'));
    if (!on) break;
    await page.evaluate(() => window.__ui.closeModal());
    await page.waitForTimeout(250);
  }
  await page.evaluate(() => {
    const g = window.__game;
    g.company.money = 3_000_000;
    g.company.coins = 9;
    // 랭크업 직전까지 팬을 채워 둔다. 부스에 나가면 그 자리에서 오른다.
    g.company.fans = Math.max(0, g.rankNeed ? g.rankNeed() - 1 : 1399);
    g.company.lastExpoKey = null;
    g._openExpo();
  });
  // 개막 장면이 설 때까지 기다린다. 한 줄씩 찍히므로 몇 초가 걸린다.
  for (let i = 0; i < 40; i++) {
    const up = await page.evaluate(() => document.body.classList.contains('expo-ask'));
    if (up) break;
    await page.waitForTimeout(250);
  }
  const r = await page.evaluate(() => ({
    expo: document.body.classList.contains('expo'),
    ask: document.body.classList.contains('expo-ask'),
    modal: document.getElementById('modal').classList.contains('show'),
    line: document.getElementById('xLine').textContent,
    sign: !!(window.__view.expoHall && window.__view.expoHall.def
      && window.__view.expoHall.def.empty),
  }));
  if (!r.expo || !r.ask) throw new Error('전시장 개막 장면이 안 섰다');
  if (r.modal) throw new Error('개막 대사 위에 팝업이 덮였다');
  if (!r.sign) throw new Error('우리 자리가 비어 있지 않다');
  return `빈 자리 · 「${r.line.slice(0, 18)}…」`;
});

await step('개막이 끝나면 선택지가 전시장 위에 뜬다', async () => {
  for (let i = 0; i < 60; i++) {
    const on = await page.evaluate(() => document.getElementById('modal').classList.contains('show'));
    if (on) break;
    await page.waitForTimeout(300);
  }
  const r = await page.evaluate(() => ({
    modal: document.getElementById('modal').classList.contains('show'),
    title: document.getElementById('mTitle').textContent,
    expo: document.body.classList.contains('expo'),
    opts: document.querySelectorAll('#mOpts .choice').length,
    // 팝업이 전시장 자막보다 위에 있어야 둘 다 안 겹친다.
    over: Number(getComputedStyle(document.getElementById('modal')).zIndex)
      > Number(getComputedStyle(document.getElementById('expo')).zIndex),
  }));
  if (!r.modal) throw new Error('선택지가 안 떴다');
  if (!r.expo) throw new Error('선택하는 동안 전시장이 사라졌다');
  if (r.opts !== 3) throw new Error(`선택지가 ${r.opts}개`);
  if (!r.over) throw new Error('팝업이 전시장 자막에 덮인다');
  return `${r.title} · ${r.opts}개`;
});

await step('부스가 서는 동안 랭크업이 위에 안 덮인다', async () => {
  const before = await page.evaluate(() => window.__game.company.rank);
  // 대형 부스. 팬이 크게 늘어 그 자리에서 랭크가 오른다.
  const picked = await page.evaluate(() => {
    const o = document.querySelectorAll('#mOpts .choice');
    if (!o.length) return false;
    o[o.length - 1].click();
    return true;
  });
  if (!picked) throw new Error('선택지가 없다');
  await page.waitForTimeout(1400);
  const r = await page.evaluate(() => ({
    expo: document.body.classList.contains('expo'),
    modal: document.getElementById('modal').classList.contains('show'),
    rank: window.__game.company.rank,
  }));
  if (!r.expo) throw new Error('부스 장면이 안 섰다');
  if (r.modal) throw new Error('부스 장면 위에 팝업이 덮였다');
  // 장면이 끝날 때까지 기다렸다가, 그때 밀린 팝업이 나오는지 본다.
  for (let i = 0; i < 80; i++) {
    const ok = await page.evaluate(() => {
      const b = document.getElementById('xOk');
      return b && !b.hidden;
    });
    if (ok) break;
    await page.waitForTimeout(300);
  }
  await page.evaluate(() => { const b = document.getElementById('xOk'); if (b && !b.hidden) b.click(); });
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => ({
    expo: document.body.classList.contains('expo'),
    modal: document.getElementById('modal').classList.contains('show'),
    rank: window.__game.company.rank,
  }));
  if (after.expo) throw new Error('전시장이 안 닫혔다');
  return `랭크 ${before} → ${after.rank} · 밀린 팝업 ${after.modal ? '뒤에 뜸' : '없음'}`;
});

await page.evaluate(() => window.__ui.closeModal());
await page.waitForTimeout(400);

await page.screenshot({ path: `${OUT}/raid.png` });
if (errs.length) { console.log('\n--- 콘솔 오류 ---'); for (const e of errs.slice(0, 6)) console.log(e); }
console.log(`\n${pass} 통과 · ${fail} 실패${errs.length ? ` · 오류 ${errs.length}건` : ''}`);
await browser.close();
process.exit(fail || errs.length ? 1 : 0);
