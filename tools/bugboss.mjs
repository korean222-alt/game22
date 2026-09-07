/* 마지막 공정(버그 보스)의 규칙을 headless 로 확인한다.

   세 가지가 계약이다.
     · 크다      — 전체 작업량의 18% (예전 8%)
     · 안 때린다  — 반격 이벤트가 한 번도 안 나온다
     · 잡으면 0  — 끝까지 잡으면 완성작의 버그가 정확히 0개

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

proj.done = false;
P.finishProject(proj, byId, rnd, { staffById: byId });
check('그래서 완성작의 버그가 0개다', proj.bugs === 0, `버그 ${proj.bugs}개`);

console.log(`\n${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
