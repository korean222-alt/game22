/* Proposals and the development battle.

   This is what distinguishes 소셜게임 스토리 from its predecessor: a game is not
   a progress bar, it is a fight. The idea has HP, your assigned staff take
   turns hitting it, each hit costs stamina, and the damage each staffer deals
   also decides which of the five quality axes the finished game is strong in.
   Two idea cards are offered mid-fight — game content at 66% HP, development
   method at 33% — and their compatibility with the genre is the largest single
   factor in the result.

   Everything here is pure: no DOM, no WebGL. The 3D layer subscribes to the
   event list a turn returns and plays animations from it. */

import {
  GENRES, CONTENTS, METHODS, PLATFORMS, MONETIZE, STATS,
  comboScore, TITLE_WORDS_A, TITLE_WORDS_B, researchEffect, TRAITS,
  bossFor, BOSS_MOVES, BOSS_STAGES, WEAK_TURNS, WEAK_MULT, HP, RAID,
  devStamina, EXHAUST, strainOf,
} from './data.js';
import { JOBS, JOB_ABILITY } from './data.js';
import {
  power, basePower, ability, motivationMult, traitMult, traitAdd, hasTrait, traitsOf,
  gearAxis, drainHp, hpRatio, syncHp, upSpeedMult, upCritAdd,
} from './staff.js';

let _pid = 1;
export function seedProjectIds(n) { _pid = Math.max(_pid, n); }

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];

/* ---------- the two curves the whole difficulty rests on ----------
   `x` — the raw contribution one staffer makes in one turn — spans roughly
   10 at founding to 450+ for a mature studio, and it compounds: levels,
   promotions, motivation, combo and method multipliers all multiply. Two
   saturating curves turn that into numbers that read like the original's.

   QSCALE maps x into the familiar 1-999 quality band: x=25 -> 44, x=100 ->
   163, x=200 -> 300, x=400 -> 508. CBASE/CSPAN/CSCALE map the average of
   those five onto the four 1-10 critics: a debut lands near 10/40, ~200
   average buys a respectable 23, ~320 gets 28, and the 32 that earns the
   hall of fame needs ~450 — reachable once the core team has promoted twice,
   which is several years of gifts away. */
const QCAP = 999;
const QSCALE = 560;
/* ---------- 평론 곡선 ----------
   한 겹짜리 포화 곡선으로는 두 요구를 동시에 못 맞춘다. 좁게 잡으면(150)
   데뷔작은 살아나지만 성숙한 스튜디오가 2년차에 38/40 을 찍고, 넓게
   잡으면(330) 후반은 맞는데 데뷔작이 몇 년이고 4/40 이다. 창업 멤버 없이
   빈 사무실에서 시작하게 되면서 이 폭이 실제로 문제가 됐다.

   그래서 **두 겹**으로 쌓는다. 빠른 항(S1=45)이 초반 몇십 점에서 훅 오르고,
   느린 항(S2=430)이 남은 평생을 담당한다.

     평균 품질    5 → 12/40   (데뷔작, 버그를 다 잡았을 때)
                 30 → 16/40
                100 → 23/40
                250 → 29/40
                400 → 32/40   (명예의 전당 문턱 — 보통 6년차)
                561 → 35/40   (10년차 상위권)

   바닥(CBASE)이 2.6 인 이유는 버그 페널티가 최대 2.2 이기 때문이다. 여기서
   더 낮추면 데뷔작이 디버그를 다 해도 1점씩 4점에 붙박인다. */
const CBASE = 2.6;
const CFAST = 2.4, CFAST_S = 45;
const CSLOW = 5.0, CSLOW_S = 430;

export function randomTitle(rnd) {
  return pick(rnd, TITLE_WORDS_A) + ' ' + pick(rnd, TITLE_WORDS_B);
}

/* One staffer's per-turn contribution on one axis, mapped onto the 1-999 band.
   Exported because the development panel draws the same projection mid-fight:
   a bar during development and the same bar on the results screen have to mean
   the same thing, and they only do if there is one curve. */
export function qualityCurve(x) {
  return Math.max(1, Math.min(QCAP, Math.round(QCAP * (1 - Math.exp(-x / QSCALE)))));
}

/* What the five axes would score if the project finished on this turn.

   Exported under both names: two branches independently found the same broken
   graph and fixed it, and `projectedQuality` is what the other one's UI calls. */
/* 분모는 **개별 타격 횟수**다. 예전에는 turn × 인원이었고, 그것은 전원이
   한 턴에 정확히 한 번씩 친다는 가정 위에 서 있었다. 자동 전투에서는 빠른
   사람이 더 자주 치므로 그 가정이 깨진다 — 실제로 몇 번 쳤는지를 세면
   같은 곡선이 그대로 성립한다. */
export function strikeCount(project) {
  if (project.strikes) return Math.max(1, project.strikes);
  return Math.max(1, (project.turn || 1) * Math.max(1, project.team.length));
}

/* ---------- 완성도 ----------
   팀이 전원 쓰러진 채로 마감한 단계는 **못 만든 부분**을 남긴다. `unfinished`
   는 전체 체력 중 끝내 못 깎은 비율이고, 그 비율만큼 다섯 축이 통째로 깎인다.

   왜 축의 평균이 아니라 결과값에 곱하는가: 품질은 '한 타격당 평균'이라
   일찍 끝낸다고 평균이 떨어지지 않는다. 즉 페널티가 없으면 탈진 마감이
   **지름길**이 된다 — 밥을 사줄 이유가 사라지는 정확히 그 자리다. */
export function completion(project) {
  const un = Math.max(0, Math.min(1, project ? (project.unfinished || 0) : 0));
  return Math.max(EXHAUST.minQuality, 1 - un * EXHAUST.qualityLoss);
}

export function projectQuality(project) {
  const n = strikeCount(project);
  const comp = completion(project);
  const out = {};
  for (const st of STATS) {
    out[st] = Math.max(1, Math.round(qualityCurve(project.raw[st] / n) * comp));
  }
  return out;
}

/* ---------- proposals ----------
   Grade is a 1-5 star roll weighted by the whole company's planning power, so
   hiring planners and putting them on the planning floor visibly pays off. */
export function generateProposal(rnd, author, totalPlanPower, rank, research) {
  const genre = pick(rnd, GENRES);
  // A soft curve: doubling planning power moves the grade by about one star.
  const scale = Math.log2(1 + totalPlanPower / 26);
  const res = researchEffect(research);
  const roll = scale * (0.55 + rnd() * 0.9) + rank * 0.045 + res.grade;
  const grade = Math.max(1, Math.min(5, Math.round(1 + roll)));
  return {
    id: 'pr' + (_pid++),
    genreId: genre.id,
    grade,
    authorId: author ? author.id : null,
    authorName: author ? author.name : '사장',
    title: randomTitle(rnd),
    createdRank: rank,
  };
}

/* ---------- starting a project ---------- */

/* The idea's hit points. Exported because the setup screen previews which
   monster you are about to face, and that has to be the same number the fight
   actually uses — a preview computed from its own copy of this formula is a
   preview that lies the moment either is touched. */
/* ---------- 아이디어의 체력 ----------
   예전에는 플랫폼과 장르만 보고 절대값을 뽑았다. 창업 직후 직원이 없는
   시작으로 바꾸자 그 식이 무너졌다 — 레벨 1 세 명이 한 턴에 20 씩 때리는데
   데뷔작의 HP 가 8,000 이면 296턴이다. 실제로 그랬다.

   그래서 기준을 바꿨다. HP 는 **몇 번 때리면 끝나는가** 로 정한다. 팀이
   강해지면 HP 도 같이 커지므로 게임 하나에 드는 시간은 늘 비슷하고, 강한
   팀이 사는 것은 속도가 아니라 **품질**이다 — 원작이 그랬던 것처럼.

   야심(플랫폼·등급·시리즈·장르)은 라운드 수를 늘린다: 피처폰 데뷔가 20
   라운드, 콘솔 대작이 50 라운드 언저리. 그 이상은 자동 전투라 해도 지루하다. */
export function raidRounds({ genreId, platformId, grade, seriesN = 1 }) {
  const genre = GENRES.find((g) => g.id === genreId);
  const platform = PLATFORMS.find((p) => p.id === platformId);
  if (!genre || !platform) return RAID.rounds;
  const platMult = Math.pow(platform.hp / 0.62, 0.34);
  const genreMult = Math.pow(genre.hp, 0.55);
  const gradeMult = 0.9 + grade * 0.1;
  const seriesMult = 1 + (seriesN - 1) * 0.12;
  const r = RAID.rounds * platMult * genreMult * gradeMult * seriesMult;
  return Math.round(Math.max(RAID.minRounds, Math.min(RAID.maxRounds, r)));
}

/* 팀 전체가 한 라운드에 넣는 데미지의 기대값. 크리티컬과 방식/조합 배율의
   평균을 대충 얹은 값이다 — 정확할 필요는 없고, 자릿수만 맞으면 된다. */
export function expectedRoundDamage(team) {
  let sum = 0;
  for (const s of team) sum += basePower(s);
  // 크리티컬(약 12% × 2.2배)과 중반부터 붙는 조합/방식 배율의 평균.
  return Math.max(1, sum * 1.14 * 1.12);
}

/* 세 마리분의 총 체력과 그 배분. */
export function raidPlan({ genreId, platformId, grade, seriesN = 1, team }) {
  const rounds = raidRounds({ genreId, platformId, grade, seriesN });
  const total = Math.max(60, Math.round(expectedRoundDamage(team) * rounds));
  const stages = BOSS_STAGES.map((st, i) => ({
    index: i,
    ko: st.ko,
    species: st.species,
    dmg: st.dmg,
    atk: st.atk,
    card: st.card,
    hpMax: Math.max(20, Math.round(total * st.share)),
  }));
  return { rounds, total, stages };
}

/* 예전 이름. 설정 화면의 "예상 규모" 와 저장 파일 호환을 위해 남긴다. */
export function ideaHp({ genreId, platformId, grade, seriesN = 1, rank = 1, team = null }) {
  if (team && team.length) {
    return raidPlan({ genreId, platformId, grade, seriesN, team }).total;
  }
  const genre = GENRES.find((g) => g.id === genreId);
  const platform = PLATFORMS.find((p) => p.id === platformId);
  if (!genre || !platform) return 0;
  // 팀을 모르면 라운드 수 × 표준 한 명분으로 어림한다.
  return Math.round(raidRounds({ genreId, platformId, grade, seriesN }) * 26 * Math.max(1, rank * 0.5 + 1.5));
}

/* ---------- 야심의 절대 크기 ----------
   보스의 체력은 이제 팀의 세기를 따라간다. 그래서 체력을 "이 게임이 얼마나
   큰 물건인가" 의 척도로 쓸 수 없다 — 약한 팀이 만든 콘솔 게임이 강한 팀이
   만든 피처폰 게임보다 작은 물건이 되어 버린다. 시장 규모·경험치·버그 수는
   팀과 무관한 이 값을 본다. (예전 ideaHp 의 식 그대로다.) */
export function projectScale({ genreId, platformId, grade, seriesN = 1, rank = 1 }) {
  const genre = GENRES.find((g) => g.id === genreId);
  const platform = PLATFORMS.find((p) => p.id === platformId);
  if (!genre || !platform) return 1000;
  const seriesMult = 1 + (seriesN - 1) * 0.55;
  const gradeMult = 0.75 + grade * 0.25;
  const rankScale = 1 + (Math.max(1, rank) - 1) * 0.11;
  return Math.round(8600 * genre.hp * platform.hp * seriesMult * gradeMult * rankScale);
}

/* 개발 착수에 드는 스태미나. 배틀은 공짜다 — 스태미나는 여기서만 나간다. */
export function devStaminaCost({ platformId, grade, seriesN = 1, monetizeId = null }) {
  const platform = PLATFORMS.find((p) => p.id === platformId);
  const money = monetizeId ? MONETIZE.find((m) => m.id === monetizeId) : null;
  return devStamina(platform, grade || 1, seriesN, money);
}

/* 개발비. 플랫폼 값에 야심(등급·시리즈)과 수익 모델의 배율이 곱해진다.
   설정 화면의 미리보기와 착수가 같은 함수를 봐야 숫자가 어긋나지 않는다. */
export function devCostOf({ platformId, grade, seriesN = 1, monetizeId = null }) {
  const platform = PLATFORMS.find((p) => p.id === platformId);
  if (!platform) return 0;
  const money = monetizeId ? MONETIZE.find((m) => m.id === monetizeId) : null;
  const seriesMult = 1 + (seriesN - 1) * 0.55;
  const gradeMult = 0.75 + (grade || 1) * 0.25;
  return Math.round(platform.cost * gradeMult * seriesMult * (money ? money.cost || 1 : 1));
}

export function startProject({ proposal, platformId, monetizeId, team, rank, seriesOf }) {
  const genre = GENRES.find((g) => g.id === proposal.genreId);
  const platform = PLATFORMS.find((p) => p.id === platformId);
  const seriesN = seriesOf ? seriesOf.seriesN + 1 : 1;

  const seriesMult = 1 + (seriesN - 1) * 0.55;
  const gradeMult = 0.75 + proposal.grade * 0.25;
  const plan = raidPlan({
    genreId: proposal.genreId, platformId, grade: proposal.grade, seriesN, team,
  });

  const boss = bossFor(genre.id);
  const stages = plan.stages.map((st) => ({ ...st, hp: st.hpMax, ko: st.ko }));
  // 1번 보스의 이름은 장르가 준다. 2번은 내용 카드를 고를 때, 3번은 방식
  // 카드를 고를 때 이름이 붙는다 — 아직 정하지 않은 것을 미리 보여줄 수는 없다.
  stages[0].name = boss.ko;
  stages[1].name = '???';
  stages[2].name = '마감 데몬';

  return {
    id: 'gp' + (_pid++),
    title: proposal.title,
    proposal,
    genreId: genre.id,
    // 개발은 보스전이다. 세 마리를 차례로 잡는다.
    boss: { id: genre.id, ko: boss.ko, shape: boss.shape, col: boss.col, accent: boss.accent },
    stages,
    stage: 0,
    phase: 0,                    // = stage. 예전 UI/연출이 읽는 이름.
    weak: 0,                     // 스테이지가 넘어간 직후 약점이 드러난 타격 수
    bugExtra: 0,                 // 보스의 반격이 남긴 버그
    critBonus: 0,                // 네잎클로버 같은 도구가 얹는 번뜩임 확률
    lastGain: null,              // 직전 라운드에 오른 품질 (진행 패널의 +표시)
    lastDamage: 0,
    attacks: 0,
    platformId, monetizeId,
    seriesN, seriesRoot: seriesOf ? (seriesOf.seriesRoot || seriesOf.id) : null,
    team: team.map((s) => s.id),
    // hp/hpMax 는 **지금 상대하는 보스**의 것이다. 전체 진행은 clearedHp 로 센다.
    hpMax: stages[0].hpMax, hp: stages[0].hpMax,
    totalHp: plan.total, clearedHp: 0, rounds: plan.rounds,
    scale: projectScale({
      genreId: genre.id, platformId, grade: proposal.grade, seriesN, rank,
    }),
    turn: 0,
    strikes: 0,                  // 개별 타격 횟수 — 품질의 분모
    atb: {},                     // staffId -> 0..1 게이지
    down: {},                    // staffId -> 남은 기절 시간(초)
    bossAtb: 0,
    elapsed: 0,                  // 전투 경과 시간(초)
    staminaSpent: 0,
    contentId: null,
    methodId: null,
    pendingCards: null,          // {kind:'content'|'method', options:[...]}
    raw: { craze: 0, usability: 0, impact: 0, social: 0, retention: 0 },
    crits: 0,
    log: [],
    done: false,
    devCost: devCostOf({ platformId, grade: proposal.grade, seriesN, monetizeId }),
    devStamina: devStaminaCost({ platformId, grade: proposal.grade, seriesN, monetizeId }),
    // 이 프로젝트가 사람에게 매기는 부담. 타격의 체력 소모와 보스의 반격이
    // 둘 다 이 값을 곱해서 본다 — ★1 데뷔작에서는 거의 아무도 쓰러지지 않고,
    // ★5 대작에서는 밥을 사지 않으면 못 끝낸다.
    strain: strainOf(proposal.grade, platform),
    // 탈진으로 못 만들고 넘긴 비율. 완성도가 이 값을 본다.
    unfinished: 0,
    forfeits: 0,
    rushBugs: 0,
    startedRank: rank,
  };
}

/* 저장 파일이 예전 판(스테이지가 없던 시절)이면 여기서 한 마리짜리
   스테이지로 감싸 준다. 세이브를 깨지 않는 값이 가장 싸다. */
export function ensureStages(project) {
  if (!project || project.stages) return project;
  project.stages = [{
    index: 0, ko: '아이디어', species: 'orc', dmg: 1, atk: 4.6, card: null,
    name: project.boss ? project.boss.ko : '아이디어',
    hpMax: project.hpMax, hp: project.hp,
  }];
  project.stage = 0;
  project.totalHp = project.hpMax;
  if (!project.scale) project.scale = project.hpMax;
  project.clearedHp = 0;
  project.strikes = Math.max(1, (project.turn || 1) * Math.max(1, project.team.length));
  project.atb = {}; project.down = {}; project.bossAtb = 0; project.elapsed = 0;
  return project;
}

/* 이 프로젝트의 부담 배율. 예전 저장 파일에는 없는 값이라 기획서 등급에서
   다시 뽑는다 — 없으면 1 로 두는 쪽이 쉽지만, 그러면 옛 세이브만 유독
   사람이 잘 죽는다. */
export function projectStrain(project) {
  if (project && typeof project.strain === 'number') return project.strain;
  const grade = project && project.proposal ? project.proposal.grade : 1;
  const platform = project ? PLATFORMS.find((p) => p.id === project.platformId) : null;
  const v = strainOf(grade, platform);
  if (project) project.strain = v;
  return v;
}

/* ---------- 탈진 마감 ----------
   팀이 전원 쓰러지면 이 단계는 여기서 끝난다. 남은 체력은 못 만든 것으로
   기록되고(그만큼 완성도가 깎이고 버그가 붙는다), 다음 보스가 선다.

   예전에는 "다음 주로 넘기기" 로 체력을 공짜로 채워 같은 보스를 계속 팰 수
   있었다. 시간이 무한하면 밥은 살 이유가 없는 물건이 된다 — 이 함수가 그
   무한을 끊는다. */
export function forfeitStage(project, rnd, ctx = {}) {
  ensureStages(project);
  if (project.done || project.pendingCards) return [];
  const st = currentStage(project);
  const left = Math.max(0, Math.min(1, project.hp / Math.max(1, project.hpMax)));
  const share = (st.hpMax || 0) / Math.max(1, project.totalHp || project.hpMax || 1);
  project.unfinished = Math.min(1, (project.unfinished || 0) + left * share);
  project.forfeits = (project.forfeits || 0) + 1;
  st.forfeited = true;
  // 급하게 덮은 자리는 버그로 남는다. 반격이 남기는 bugExtra 와 따로 세는
  // 이유는 그쪽에 상한(HP.bugCap)이 걸려 있기 때문이다 — 같은 칸에 넣으면
  // 다음 반격 한 번에 탈진 마감의 대가가 도로 지워진다.
  project.rushBugs = (project.rushBugs || 0) + Math.round(left * share * EXHAUST.bugs * 3);
  project.hp = 0;
  st.hp = 0;
  const events = [{
    kind: 'forfeit', stage: project.stage || 0,
    name: st.name || st.ko, left: Math.round(left * 100),
  }];
  for (const ev of stageCleared(project, rnd, ctx)) events.push(ev);
  return events;
}

export function currentStage(project) {
  ensureStages(project);
  return project.stages[Math.min(project.stage || 0, project.stages.length - 1)];
}

/* 전체 진행률 0..1 — 세 마리를 합쳐 하나의 막대로 볼 때 쓴다. */
export function raidProgress(project) {
  ensureStages(project);
  const total = project.totalHp || project.hpMax || 1;
  return Math.max(0, Math.min(1, ((project.clearedHp || 0) + (project.hpMax - project.hp)) / total));
}

/* 예전에는 한 턴이 스태미나를 먹었다. 이제 배틀은 공짜다 — 스태미나는
   개발에 착수하는 순간 한 번 나가고, 싸움은 직원들의 체력으로 한다.
   0 을 돌려주는 함수로 남겨 둔 이유는 저장 파일과 옛 호출부 때문이다. */
export function turnCost() { return 0; }

/* ---------- 배틀의 상태 ----------
   한 사람이 지금 칠 수 있는가. 체력이 0 이면 쓰러진 것으로 보고 잠깐 쉰다 —
   완전히 빠지는 게 아니라 몇 초 뒤 다시 일어선다. 팀 전체가 동시에 쓰러지면
   그 주에는 더 못 싸우고, 주간 회복이 이들을 일으킨다. */
export function canFight(s) {
  if (!s) return false;
  syncHp(s);
  return s.hp > 0;
}

export function teamDown(project, staffById) {
  const pool = project.team.map((id) => staffById.get(id)).filter(Boolean);
  if (!pool.length) return true;
  return pool.every((s) => !canFight(s));
}

/* 한 사람의 공격 주기. 지치면 느려진다 — 밥을 사주면 눈에 띄게 빨라지는
   자리이고, 그래서 상점이 배틀 중에 의미를 갖는다. */
export function strikePeriod(s) {
  const r = hpRatio(s);
  const slow = 1 + (RAID.slowest - 1) * (1 - Math.min(1, r / HP.tired));
  const speed = (1 + (traitAdd(s, 'speed') || 0)) * upSpeedMult(s);
  return RAID.strikeSec * Math.max(1, slow) / Math.max(0.5, speed);
}

/* ---------- 한 사람의 한 방 ----------
   예전 battleTurn 안에 있던 팀 루프의 몸통이다. 자동 전투에서는 각자
   자기 게이지로 치므로, 한 사람분을 따로 부를 수 있어야 한다. */
export function staffStrike(project, s, rnd, ctx = {}) {
  const genre = GENRES.find((g) => g.id === project.genreId);
  const content = project.contentId ? CONTENTS.find((c) => c.id === project.contentId) : null;
  const method = project.methodId ? METHODS.find((m) => m.id === project.methodId) : null;
  const stage = currentStage(project);

  const combo = content ? comboScore(project.genreId, project.contentId) : 1.0;
  const res = researchEffect(ctx.research);
  const phaseMult = 1 / (stage.dmg || 1);
  const weakMult = (project.weak || 0) > 0 ? WEAK_MULT : 1;
  const dmgMult = (method ? method.dmg : 1) * (0.85 + combo * 0.15) * res.dmg * phaseMult * weakMult;
  const qMult = (method ? method.quality : 1) * combo;
  const variance = method && method.variance ? method.variance : 0.15;

  const job = JOBS[s.job];
  const base = power(s);
  const teamMood = ctx.teamMood || 0;

  const critChance = 0.06 + Math.min(0.30, (s.motivation + teamMood * 2) * 0.006)
    + traitAdd(s, 'crit') + upCritAdd(s) + (project.critBonus || 0);
  const crit = rnd() < critChance;
  const roll = 1 - variance + rnd() * variance * 2;
  const fan = hasTrait(s, 'genreFan') && s.favGenre === project.genreId
    ? (TRAITS.genreFan.genreBonus || 1) : 1;
  let dmg = base * dmgMult * roll * traitMult(s, 'dmg') * fan;
  if (crit) { dmg *= 2.2; project.crits += 1; }
  dmg = Math.max(1, Math.round(dmg));

  const gains = {};
  let gained = null;
  for (const [stat, w] of Object.entries(job.contrib)) {
    const bias = (genre.bias[stat] || 1) * (content ? (content.bias[stat] || 1) : 1)
      * (method && method.focus ? (method.focus[stat] || 1) : 1);
    const add = base * w * qMult * bias * roll * (crit ? 1.8 : 1)
      * traitMult(s, 'quality') * fan * gearAxis(s, stat);
    project.raw[stat] += add;
    gains[stat] = (gains[stat] || 0) + add;
    if (!gained || add > gained.amount) gained = { stat, amount: add };
  }

  // 개발은 사람을 갈아 넣는다. 한 방마다 체력이 빠지고, 빠지면 느려진다.
  // 얼마나 갈리는지는 프로젝트의 야심이 정한다 (strain).
  const spent = drainHp(s, Math.max(1, s.hpMax * HP.turnCost * projectStrain(project)));

  project.strikes = (project.strikes || 0) + 1;
  if (project.weak > 0) project.weak -= 1;
  applyDamage(project, dmg);
  project.lastGain = gains;
  project.lastDamage = dmg;

  return {
    kind: crit ? 'crit' : 'hit',
    staffId: s.id, name: s.name, job: job.ko,
    damage: dmg, stat: gained ? gained.stat : null,
    hpSpent: spent, hp: s.hp, hpMax: s.hpMax,
    bossHp: project.hp, bossHpMax: project.hpMax,
  };
}

function applyDamage(project, dmg) {
  project.hp = Math.max(0, project.hp - dmg);
  const st = currentStage(project);
  if (st) st.hp = project.hp;
}

/* ---------- 스테이지 넘김 ----------
   보스가 죽으면 카드가 나온다. 카드를 고르면 다음 놈이 나온다. 예전에는
   보스를 잡아도 아무 일이 없거나 프로젝트가 통째로 리셋됐다 — 죽음과
   다음 스테이지 사이에 아무 상태도 없었기 때문이다. 이제 pendingCards 가
   그 사이를 지키고, advanceStage 가 명시적으로 다음 놈을 세운다. */
export function stageCleared(project, rnd, ctx = {}) {
  ensureStages(project);
  const st = currentStage(project);
  const events = [{
    kind: 'stageClear', stage: project.stage || 0, ko: st.ko,
    name: st.name || st.ko, last: (project.stage || 0) >= project.stages.length - 1,
  }];
  project.clearedHp = (project.clearedHp || 0) + st.hpMax;

  if (st.card === 'content' && !project.contentId) {
    project.pendingCards = { kind: 'content', options: rollContentCards(rnd, project.genreId, ctx.contents) };
    events.push({ kind: 'card', cardKind: 'content' });
  } else if (st.card === 'method' && !project.methodId) {
    project.pendingCards = { kind: 'method', options: rollMethodCards(rnd) };
    events.push({ kind: 'card', cardKind: 'method' });
  } else if ((project.stage || 0) < project.stages.length - 1) {
    advanceStage(project);
    for (const ev of reviveTeam(project, ctx.staffById)) events.push(ev);
    events.push({ kind: 'stageStart', stage: project.stage, name: currentStage(project).name });
  } else {
    events.push({ kind: 'complete' });
  }
  return events;
}

/* 다음 보스를 세운다. 카드가 이름을 정해 주므로 카드를 고른 뒤에 부른다. */
export function advanceStage(project) {
  ensureStages(project);
  if ((project.stage || 0) >= project.stages.length - 1) return false;
  project.stage = (project.stage || 0) + 1;
  project.phase = project.stage;
  const st = currentStage(project);
  st.name = stageName(project, project.stage);
  project.hpMax = st.hpMax;
  project.hp = st.hpMax;
  st.hp = st.hpMax;
  project.weak = WEAK_TURNS;   // 새 보스가 나온 직후에는 잠깐 빈틈이 있다
  project.bossAtb = 0;
  return true;
}

/* ---------- 보스와 보스 사이 ----------
   쓰러진 채로 다음 보스 앞에 서게 두면, 한 마리를 놓친 순간 남은 두 마리는
   볼 것도 없이 탈진 마감이 된다. 그래서 무대가 바뀔 때 쓰러진 사람은
   **피 한 칸**으로 일어선다. 회복이 아니라 재개다 — 밥을 안 사면 곧 또 눕는다.

   반환값은 일어선 사람들의 이벤트다. 아레나 로그가 이걸 읽는다. */
export function reviveTeam(project, staffById) {
  const out = [];
  if (!staffById) return out;
  for (const id of project.team) {
    const s = staffById.get(id);
    if (!s) continue;
    syncHp(s);
    const want = Math.max(1, Math.round(s.hpMax * EXHAUST.reviveHp));
    if (s.hp < want) {
      s.hp = want;
      out.push({ kind: 'revive', staffId: s.id, name: s.name, hp: s.hp, hpMax: s.hpMax, stage: true });
    }
    if (project.down) project.down[s.id] = 0;
    if (project.atb) project.atb[s.id] = 0;
  }
  project.exhausted = false;
  project.exhaustT = 0;
  return out;
}

/* 스테이지 이름. 2번 보스는 고른 조합이, 3번은 마감이 이름을 준다. */
export function stageName(project, i) {
  if (i === 0) return bossFor(project.genreId).ko;
  if (i === 1) {
    const c = project.contentId ? CONTENTS.find((x) => x.id === project.contentId) : null;
    const g = GENRES.find((x) => x.id === project.genreId);
    if (!c) return '조합 보스';
    return `${c.ko} ${g ? g.ko : ''} 융합체`.trim();
  }
  const m = project.methodId ? METHODS.find((x) => x.id === project.methodId) : null;
  return m ? `마감 데몬 · ${m.ko}` : '마감 데몬';
}

/* ---------- 실시간 자동 전투 ----------
   dt 를 받아서 게이지를 돌린다. 순수 함수다 — DOM 도 시계도 모른다. 그래서
   tools 의 시뮬레이터가 브라우저 없이 같은 전투를 돌릴 수 있다.

   반환: { events, dead } — dead 면 이번 tick 에 보스가 죽었다. */
export function battleTick(project, staffById, rnd, ctx = {}, dt = 0.016) {
  ensureStages(project);
  const out = { events: [], dead: false, idle: false };
  if (project.done || project.pendingCards || project.hp <= 0) { out.idle = true; return out; }

  const step = Math.min(0.25, Math.max(0, dt));
  project.elapsed = (project.elapsed || 0) + step;

  let teamMood = 0;
  const pool = [];
  for (const id of project.team) {
    const s = staffById.get(id);
    if (!s) continue;
    syncHp(s);
    teamMood += traitAdd(s, 'teamMood');
    pool.push(s);
  }
  if (!pool.length) { out.idle = true; return out; }
  const c2 = { ...ctx, teamMood };

  // ---- 직원들의 게이지 ----
  let anyUp = false;
  for (const s of pool) {
    const downLeft = project.down[s.id] || 0;
    if (downLeft > 0) {
      project.down[s.id] = Math.max(0, downLeft - step);
      if (project.down[s.id] === 0 && s.hp > 0) {
        out.events.push({ kind: 'revive', staffId: s.id, name: s.name });
      }
      continue;
    }
    if (s.hp <= 0) {
      // 쓰러졌다. 체력이 조금이라도 차면 다시 일어선다.
      project.down[s.id] = RAID.downSec;
      out.events.push({ kind: 'down', staffId: s.id, name: s.name });
      continue;
    }
    anyUp = true;
    const period = strikePeriod(s);
    project.atb[s.id] = (project.atb[s.id] || 0) + step / period;
    while ((project.atb[s.id] || 0) >= 1 && project.hp > 0) {
      project.atb[s.id] -= 1;
      out.events.push(staffStrike(project, s, rnd, c2));
      // 한 사람이 한 번 칠 때마다 라운드 카운터도 조금씩 돈다.
      project.turn = Math.max(1, Math.round(project.strikes / Math.max(1, pool.length)));
      if (project.hp <= 0) break;
    }
  }
  if (!anyUp) out.idle = true;

  // ---- 보스의 게이지 ----
  if (project.hp > 0) {
    const st = currentStage(project);
    project.bossAtb = (project.bossAtb || 0) + step / (st.atk || 4.6);
    if (project.bossAtb >= 1) {
      project.bossAtb -= 1;
      const move = BOSS_MOVES[Math.floor(rnd() * BOSS_MOVES.length)];
      out.events.push(bossAttack(project, staffById, rnd, move));
    }
  }

  // ---- 죽음 ----
  if (project.hp <= 0) {
    out.dead = true;
    project.log.push({ turn: project.turn, damage: project.lastDamage, hp: 0 });
    for (const ev of stageCleared(project, rnd, { ...ctx, staffById })) out.events.push(ev);
  }
  return out;
}

/* ---------- 한 라운드 ----------
   팀 전원이 한 번씩 친다. 자동 전투가 표준이 된 뒤로 UI 는 이걸 부르지
   않지만, 밸런스 시뮬레이터와 "빨리 감기" 는 이 단위로 돈다. */
export function battleTurn(project, staffById, rnd, ctx = {}) {
  ensureStages(project);
  if (project.done) return { events: [], finished: true };
  if (project.pendingCards) return { events: [], blocked: 'card' };

  let teamMood = 0;
  const pool = [];
  for (const id of project.team) {
    const s = staffById.get(id);
    if (!s) continue;
    syncHp(s);
    teamMood += traitAdd(s, 'teamMood');
    pool.push(s);
  }
  const c2 = { ...ctx, teamMood };

  const events = [];
  let total = 0;
  for (const s of pool) {
    if (project.hp <= 0) break;
    if (s.hp <= 0) continue;
    const ev = staffStrike(project, s, rnd, c2);
    total += ev.damage;
    events.push(ev);
  }
  project.turn = Math.max(1, Math.round(project.strikes / Math.max(1, pool.length)));
  project.lastDamage = total;
  project.log.push({ turn: project.turn, damage: total, hp: project.hp });

  if (project.hp > 0 && project.turn % HP.attackEvery === 0) {
    const move = BOSS_MOVES[Math.floor(rnd() * BOSS_MOVES.length)];
    events.push(bossAttack(project, staffById, rnd, move));
  }
  if (project.hp <= 0) for (const ev of stageCleared(project, rnd, { ...ctx, staffById })) events.push(ev);

  return {
    events, total,
    finished: project.hp <= 0 && !project.pendingCards
      && (project.stage || 0) >= project.stages.length - 1,
  };
}

/* ---------- 보스의 반격 ----------
   대상은 팀 안에서 무작위로 고른다. 체력이 많이 남은 사람부터 맞게 하면
   피해가 고르게 퍼져 아무도 위험해지지 않고, 낮은 사람부터 맞게 하면
   한 명이 계속 쓰러진다. 무작위가 두 결과 사이에서 가장 읽기 쉽다. */
export function bossAttack(project, staffById, rnd, move) {
  const pool = project.team.map((id) => staffById.get(id)).filter(Boolean);
  const hits = [];
  // 'all' 은 전원. 한 명만 노리는 기술과 전체기가 섞여 나온다.
  const all = move.targets === 'all';
  const n = all ? pool.length : Math.min(pool.length, move.targets || 1);
  const strain = projectStrain(project);
  const picked = new Set();
  for (let i = 0; i < n && picked.size < pool.length; i++) {
    let s = null, guard = 0;
    do { s = pool[Math.floor(rnd() * pool.length)]; } while (picked.has(s.id) && guard++ < 12);
    if (picked.has(s.id)) continue;
    picked.add(s.id);
    syncHp(s);
    const dealt = drainHp(s, s.hpMax * move.hp * strain * (0.85 + rnd() * 0.3));
    hits.push({ staffId: s.id, name: s.name, damage: dealt, hp: s.hp, hpMax: s.hpMax });
  }
  // 상한이 없으면 긴 프로젝트일수록 버그가 선형으로 쌓여, 디버그가 선택이
  // 아니라 노가다가 된다 — 예전에 버그 개수를 HP 에 선형으로 뒀다가 정확히
  // 그렇게 됐다. 반격이 남기는 버그는 여기서 멈춘다.
  project.bugExtra = Math.min(HP.bugCap, (project.bugExtra || 0) + (move.bugs || 0));
  project.attacks = (project.attacks || 0) + 1;
  return {
    kind: 'boss', move: move.id, ko: move.ko, line: move.line,
    all, bugs: move.bugs || 0, hits,
  };
}

/* ---------- 진행 중인 품질 미리보기 ----------
   개발 화면 옆에 띄우는 숫자. 완성 시와 **같은 곡선**을 쓰는 것이 중요하다.
   보고 있던 수치와 결과가 다르면 그 패널은 장식이 되고, 같으면 "이번 턴에
   무엇이 올랐나"가 실제 판단 재료가 된다. */
export function previewQuality(project) {
  // 결과 화면과 **같은 함수**를 쓴다. 따로 계산하던 시절에는 탈진 마감의
  // 완성도 페널티가 개발 중 패널에만 안 보였다.
  return projectQuality(project);
}

/* 완성 시 붙을 버그 수의 추정. 완성 계산과 같은 식을 쓰되 주사위만 뺀다. */
export function previewBugs(project, staffById, ctx = {}) {
  const quality = previewQuality(project);
  return Math.max(0, Math.round(bugCount(project, quality, staffById, ctx)));
}

/* '재미' 한 줄 요약. 다섯 축의 평균이되 화제성과 임팩트에 무게를 더 준다 —
   플레이어가 한 숫자만 본다면 그게 가장 결과와 맞물린다. */
export function funScore(quality) {
  const w = { craze: 1.25, usability: 0.9, impact: 1.2, social: 0.85, retention: 0.8 };
  let sum = 0, tw = 0;
  for (const st of STATS) { sum += (quality[st] || 0) * w[st]; tw += w[st]; }
  return Math.round(sum / tw);
}

/* Bugs, without the die roll. finishProject adds the roll; the preview does not. */
function bugCount(project, quality, staffById, ctx = {}) {
  const method = METHODS.find((m) => m.id === project.methodId) || METHODS[2];
  const res = researchEffect(ctx.research);
  // 8 + 12·log2 였다. 체력 시스템이 들어오면서 팀이 지친 채로 만든 게임의
  // 조작성이 조금 낮아졌고, 거기에 반격이 남기는 버그(bugExtra)까지 얹히니
  // 데뷔작이 60개를 넘겼다 — 디버그가 선택이 아니라 노가다가 되는 지점이다.
  // 기본 곡선을 그만큼 낮춰서 합계를 원래 자리로 되돌린다.
  const scale = 7 + 10 * Math.log2(1 + (project.scale || project.totalHp || project.hpMax) / 4500);
  let bugs = scale * (1.5 - Math.min(1.2, quality.usability / 70));
  if (project.methodId && method.bugCut) bugs *= 1 - method.bugCut;
  bugs *= res.bugs;
  if (staffById) {
    // 특성은 곱으로 쌓인다. 다섯 명이 전부 올빼미면 1.4^5 = 5.4배가 되어
    // 데뷔작에 200개가 붙는다 — 특성이 성격이 아니라 사고가 되는 지점이다.
    // 팀 전체의 배율을 한 번 묶어서 [0.35, 2.2] 로 가둔다. 베테랑 한 명이
    // 확실히 체감되고, 올빼미가 모여도 감당할 수 있는 폭이다.
    let tm = 1;
    for (const id of project.team) {
      const st = staffById.get(id);
      if (!st) continue;
      for (const t of traitsOf(st)) {
        if (t.bugs) tm *= t.bugs;
        if (t.bugCut) tm *= 1 - t.bugCut;
      }
    }
    bugs *= Math.max(0.35, Math.min(2.2, tm));
  }
  return bugs + (project.bugExtra || 0) + (project.rushBugs || 0);
}

/* 뽑아서 가진 소재만 카드로 나온다. `owned` 가 없으면 (헤드리스 밸런스
   시뮬레이션처럼) 전부 가진 것으로 친다. 셋을 못 채울 만큼 적게 가지고
   있으면 나머지를 전체에서 채운다 — 카드가 두 장뿐인 화면은 어떤 이유로도
   보여선 안 된다. */
function contentPool(owned) {
  if (!owned || !owned.length) return CONTENTS;
  const set = new Set(owned);
  const have = CONTENTS.filter((c) => set.has(c.id));
  if (have.length >= 3) return have;
  const fill = CONTENTS.filter((c) => !set.has(c.id));
  return have.concat(fill.slice(0, 3 - have.length));
}

function rollContentCards(rnd, genreId, owned) {
  // Always offer one genuinely strong pairing, so the choice is "spot the good
  // one" rather than "pick between three mediocre ones". Drawing from the top
  // four made the strong option miss three times in four for genres with a
  // single standout partner.
  const pool = contentPool(owned);
  const scored = pool.map((c) => ({ c, s: comboScore(genreId, c.id) }));
  scored.sort((a, b) => b.s - a.s);
  const great = scored.slice(0, 2)[Math.floor(rnd() * Math.min(2, scored.length))].c;
  const rest = pool.filter((c) => c.id !== great.id);
  const out = [great];
  while (out.length < 3 && rest.length) {
    out.push(rest.splice(Math.floor(rnd() * rest.length), 1)[0]);
  }
  // Shuffle so the good one is not always first.
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.map((c) => ({ id: c.id, ko: c.ko, combo: comboScore(genreId, c.id) }));
}

function rollMethodCards(rnd) {
  const pool = [...METHODS];
  const out = [];
  while (out.length < 3 && pool.length) {
    out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  }
  return out.map((m) => ({ id: m.id, ko: m.ko, desc: m.desc }));
}

export function chooseCard(project, optionId, staffById) {
  ensureStages(project);
  if (!project.pendingCards) return { ok: false };
  const kind = project.pendingCards.kind;
  if (kind === 'content') project.contentId = optionId;
  else project.methodId = optionId;
  project.pendingCards = null;

  // 카드는 죽은 보스와 다음 보스 사이에 선다. 고르고 나면 다음 놈이 나온다.
  // 이 두 줄이 없던 것이 "보스를 잡아도 아무 일도 안 일어난다" 의 정체였다.
  const last = (project.stage || 0) >= project.stages.length - 1;
  let started = null;
  let revived = [];
  if (project.hp <= 0 && !last) {
    advanceStage(project);
    revived = reviveTeam(project, staffById);
    started = { stage: project.stage, name: currentStage(project).name };
  }
  const complete = project.hp <= 0 && last;
  return { ok: true, kind, complete, started, revived };
}

/* The in-development panel has to read from the SAME curve the result screen
   does. It used to apply an invented scale of its own, so the bars climbed on
   one ruler and landed on another — and because the result screen then divided
   a 999-band number by 4 to get a percentage, a debut game's 9 points rendered
   as an empty bar. One curve, one meaning, everywhere. */
export const projectedQuality = projectQuality;

/* ---------- finishing ---------- */
export function finishProject(project, staffById, rnd, ctx = {}) {
  const genre = GENRES.find((g) => g.id === project.genreId);
  const method = METHODS.find((m) => m.id === project.methodId) || METHODS[2];
  const combo = comboScore(project.genreId, project.contentId);

  // Quality is the average contribution per staffer per turn.
  //
  // Normalising by HP would make a bigger platform produce a worse game, which
  // is backwards. Normalising by turns alone is worse still: it makes quality
  // scale linearly with headcount for free, so the only strategy is to throw
  // everyone at every project. Dividing by team size too means extra staff buy
  // SPEED — fewer turns, less stamina — while quality tracks how good your
  // people actually are, and which disciplines you staffed. A team with no
  // networker will never score on 소셜 no matter how many bodies it has.
  // Staff ability compounds — levels, promotions, motivation, combo and method
  // multipliers all stack — so the underlying number spans four orders of
  // magnitude over a career. A saturating curve pulls that into a 1-999 band
  // that reads the way the original's stats do: fast gains early, real effort
  // for the last stretch, and no single lever that runs away with the game.
  const n = strikeCount(project);
  const quality = projectQuality(project);
  project.rawPerSlot = STATS.reduce((a, st) => a + project.raw[st] / n, 0) / STATS.length;

  const avg = STATS.reduce((a, s) => a + quality[s], 0) / STATS.length;

  // Bugs scale with size and fall with usability and a polishing method.
  //
  // Logarithmic in HP, not linear: HP spans two orders of magnitude over a
  // career (platform ladder x company rank), and a linear count handed a
  // mid-game project 160 bugs — twenty debug actions, which is not a decision,
  // it is a chore. On this curve the count stays in the twenties throughout,
  // and it is USABILITY that moves it: a polished game ships nearly clean
  // however big it is, a sloppy one does not.
  // 베테랑 cuts bugs; 올빼미 adds them; 보스의 반격이 남긴 것(bugExtra)이
  // 여기에 더해진다. 계산은 previewBugs 와 같은 함수를 쓰므로, 개발 중에
  // 보고 있던 예상 개수와 완성 결과가 어긋나지 않는다.
  let bugs = bugCount(project, quality, staffById, ctx);
  bugs = Math.max(0, Math.round(bugs) + Math.floor(rnd() * 3) - 1);

  // Four critics, 1-10 each, the way the series has always scored a release.
  // The curve is saturating rather than linear: early games land around 3, and
  // the 8s that add up to a hall-of-fame 32 stay something to work toward.
  //
  // The score is stored as a BASE plus a bug penalty applied on top, because
  // debugging has to visibly move it. A bug count that only shrinks a number
  // nobody scores on makes 디버그 feel like tidying; taking two points off the
  // review and handing them back as you fix things makes it a decision about
  // whether this game is worth another week of stamina.
  project.criticBase = [];
  for (let i = 0; i < 4; i++) {
    const taste = STATS[i % STATS.length];
    const v = avg * 0.6 + quality[taste] * 0.4;
    const curved = CBASE
      + CFAST * (1 - Math.exp(-v / CFAST_S))
      + CSLOW * (1 - Math.exp(-v / CSLOW_S));
    project.criticBase.push(curved + (rnd() - 0.45) * 1.5);
  }

  project.done = true;
  project.quality = quality;
  project.completion = completion(project);
  project.bugs = bugs;
  project.bugsAtBuild = bugs;
  project.combo = combo;
  scoreCritics(project);
  const critics = project.critics;
  const criticTotal = project.criticTotal;
  project.genreKo = genre.ko;
  project.contentKo = (CONTENTS.find((c) => c.id === project.contentId) || {}).ko || '-';
  project.methodKo = method.ko;

  // Whoever proposed it gets the motivation point the original grants.
  const author = project.proposal.authorId ? staffById.get(project.proposal.authorId) : null;
  return { quality, bugs, critics, criticTotal, author };
}

/* Turn the stored base scores plus the CURRENT bug count into the four review
   scores. Called at completion and again after every debug pass.

   The penalty is capped so a buggy build is never unshippable, and it is per
   critic rather than on the total, so the 40-point scale still reads the way
   the series' does. */
export function scoreCritics(project) {
  const base = project.criticBase;
  if (!base) return project.criticTotal || 0;
  const pen = Math.min(2.2, (project.bugs || 0) * 0.11);
  project.critics = base.map((b) => Math.max(1, Math.min(10, Math.round(b - pen))));
  project.criticTotal = project.critics.reduce((a, b) => a + b, 0);
  project.hallOfFame = project.criticTotal >= 32;
  return project.criticTotal;
}

/* Spend stamina to remove bugs before release. Returns how many bugs went and
   how many review points that bought back.

   Each pass clears a FRACTION of what is left as well as a flat amount from the
   team's programmers. The flat term alone made debugging a chore exactly when
   it hurt most: a rookie team ships a game with sixty bugs because its
   usability is low, and at six bugs a pass that is ten stamina of button
   pressing — not a decision, a tax on being new. The fraction keeps a cleanup
   at roughly the same handful of passes whatever the count, while the flat term
   still means a team with real programmers finishes sooner. */
const DEBUG_FRACTION = 0.3;

export function debug(project, staffById, rnd) {
  if (!project.done || project.bugs <= 0) return { fixed: 0, gained: 0 };
  const before = project.criticTotal;
  let flat = 0;
  for (const id of project.team) {
    const s = staffById.get(id);
    if (!s) continue;
    if (JOB_ABILITY[s.job] === 'prog') flat += 2 + Math.floor(ability(s, 'prog') / 12);
    else flat += 1;
  }
  let fixed = Math.max(flat, Math.round(project.bugs * DEBUG_FRACTION));
  fixed = Math.max(1, Math.round(fixed * (0.7 + rnd() * 0.6)));
  fixed = Math.min(project.bugs, fixed);
  project.bugs -= fixed;
  scoreCritics(project);
  return { fixed, gained: project.criticTotal - before, wasHof: project.hallOfFame };
}

export { motivationMult };
