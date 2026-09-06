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

console.log('\n── 4. 출시와 판매 현황 ──');
await step('출시하면 판매 패널이 뜬다', async () => {
  const r = await page.evaluate(() => {
    const g = window.__game;
    const res = g.release();
    window.__ui.renderAll();
    return { ok: res.ok, why: res.why, releases: g.releases.length };
  });
  if (!r.ok) throw new Error(r.why);
  await page.evaluate(() => { window.__ui.exitArena(); });
  await page.waitForTimeout(200);
  // 실시간 판매가 도는 동안 그 게임은 판매 현황 목록에서 빠져 있다 — 같은
  // 숫자가 레일에 두 번 서지 않게. 정산을 확인한 뒤부터 목록에 올라온다.
  await page.evaluate(() => {
    const g = window.__game;
    if (g.sales) g.closeSalesRun();
    g.nextWeek();
    window.__ui.closeModal();
    window.__ui.renderAll();
  });
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
