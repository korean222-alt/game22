/* 마지막 공정(버그 보스)의 규칙을 headless 로 확인한다.

   다섯 가지가 계약이다.
     · 크다        — 전체 작업량의 한 뭉치
     · 안 때린다    — 반격 이벤트가 한 번도 안 나온다
     · 대신 시계    — 제한시간이 걸리고, 다 되면 잡은 만큼만 인정된다
     · 버그가 크기  — 앞에서 버그를 많이 만들었을수록 몸집이 크다
     · 잡으면 0    — 끝까지 잡으면 완성작의 버그가 정확히 0개

   DOM 도 WebGL 도 안 쓴다. game/ 은 순수 모듈이라 여기서 그대로 돈다. */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const P = await import(new URL('../src/game/project.js', import.meta.url));
const S = await import(new URL('../src/game/staff.js', import.meta.url));
const { mulberry32 } = await import(new URL('../src/core/math.js', import.meta.url));

let pass = 0, fail = 0;
const check = (label, ok, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${note ? ' — ' + note : ''}`);
  ok ? pass++ : fail++;
};

const rnd = mulberry32(Number(process.argv[2] || 7));
const team = S.rollCandidates(rnd, 3, 5);
for (const s of team) { s.hpMax = 100; s.hp = 100; S.syncHp(s); }
const byId = new Map(team.map((s) => [s.id, s]));

const proj = P.startProject({
  proposal: { genreId: 'rpg', grade: 2, title: '시험작', power: 40 },
  platformId: 'phone', monetizeId: 'free', team, rank: 3, rnd,
});
proj.contentId = 'cat';
proj.methodId = 'normal';

/* 끝까지 잡는 경우를 본다 — 체력은 매 틱 채워 준다. 탈진 마감이 섞이면
   "다 잡았을 때" 를 못 본다. */
let bugAttacks = 0, guard = 0;
while (!proj.done && guard++ < 400000) {
  if (proj.pendingCards) { P.chooseCard(proj, 0, rnd, { staffById: byId }); continue; }
  const out = P.battleTick(proj, byId, rnd, { staffById: byId }, 0.05);
  const onBug = !!P.currentStage(proj).bug;
  for (const e of out.events) {
    if (e.kind === 'boss' && onBug) bugAttacks++;
    if (e.kind === 'complete') proj.done = true;
  }
  for (const s of team) s.hp = s.hpMax;
}

const st = proj.stages.find((x) => x.bug);
const share = st.hpMax / proj.totalHp;
check('버그 보스는 마지막 공정의 큰 몫이다', share > 0.13,
  `전체 작업량의 ${Math.round(share * 100)}%`);
check('버그 보스는 반격하지 않는다', bugAttacks === 0, `반격 ${bugAttacks}회`);
check('끝까지 잡으면 debugRatio 가 1', P.debugRatio(proj) >= 1, String(P.debugRatio(proj)));

check('때리지 않는 대신 제한시간이 걸린다', st.limit > 0, `${st.limit}초`);

proj.done = false;
P.finishProject(proj, byId, rnd, { staffById: byId });
check('그래서 완성작의 버그가 0개다', proj.bugs === 0, `버그 ${proj.bugs}개`);

/* ---- 몸집은 앞에서 만든 버그가 정한다 ----
   같은 프로젝트를 두 번 세우되, 한쪽은 반격을 하나도 안 맞은 셈 치고
   다른 쪽은 잔뜩 맞은 셈 친다. 뒤쪽이 더 커야 한다. */
function bugStageHp(carried) {
  const r2 = mulberry32(41);
  const t2 = S.rollCandidates(r2, 3, 5);
  for (const s of t2) { s.hpMax = 100; s.hp = 100; S.syncHp(s); }
  const p2 = P.startProject({
    proposal: { genreId: 'rpg', grade: 2, title: '시험작', power: 40 },
    platformId: 'phone', monetizeId: 'free', team: t2, rank: 3, rnd: r2,
  });
  P.ensureStages(p2);
  p2.bugExtra = carried;
  p2.clearedHp = 1000;
  p2.elapsed = 60;
  p2.stage = p2.stages.length - 2;
  P.advanceStage(p2);
  return P.currentStage(p2);
}
const clean = bugStageHp(0);
const messy = bugStageHp(20);
check('버그가 많을수록 버그 보스가 크다', messy.hpMax > clean.hpMax * 1.5,
  `깨끗 ${clean.hpMax} → 엉망 ${messy.hpMax}`);
check('제한시간도 몸집을 따라 늘어난다', messy.limit >= clean.limit,
  `${clean.limit}초 → ${messy.limit}초`);

/* ---- 시간이 다 되면 잡은 만큼만 ----
   아무도 안 때리게 두고 시계만 돌린다. 시간이 끝나는 순간 마감되어야 한다. */
const r3 = mulberry32(9);
const t3 = S.rollCandidates(r3, 3, 5);
for (const s of t3) { s.hpMax = 100; s.hp = 100; S.syncHp(s); }
const by3 = new Map(t3.map((s) => [s.id, s]));
const p3 = P.startProject({
  proposal: { genreId: 'rpg', grade: 2, title: '시험작', power: 40 },
  platformId: 'phone', monetizeId: 'free', team: t3, rank: 3, rnd: r3,
});
P.ensureStages(p3);
p3.clearedHp = 1000; p3.elapsed = 60;
p3.stage = p3.stages.length - 2;
P.advanceStage(p3);
const limit = P.currentStage(p3).limit;
// 아무도 못 때리게 전원 눕혀 둔다 — 순수하게 시계만 도는 상황.
for (const s of t3) { s.hp = 0; }
let timedOut = false, g3 = 0;
while (!timedOut && g3++ < 200000) {
  const out = P.battleTick(p3, by3, r3, { staffById: by3 }, 0.1);
  for (const e of out.events) if (e.kind === 'bugTimeout') timedOut = true;
  if (p3.done || p3.hp <= 0) break;
}
check('시간이 다 되면 그 자리에서 마감된다', timedOut,
  `제한 ${limit}초 · 경과 ${Math.round(p3.bugClock || 0)}초`);
check('그때 남은 시간은 0 이다', P.bugTimeLeft(p3) === null || P.bugTimeLeft(p3) === 0);

console.log(`\n${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
