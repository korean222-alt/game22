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
  bossFor, BOSS_MOVES, BOSS_RAGE, BOSS_PHASES, WEAK_TURNS, WEAK_MULT, HP,
} from './data.js';
import { JOBS, JOB_ABILITY } from './data.js';
import {
  power, ability, motivationMult, traitMult, traitAdd, hasTrait, traitsOf,
  gearAxis, drainHp, hpRatio, syncHp,
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
const CBASE = 2.2;
const CSPAN = 7.8;
const CSCALE = 330;

export function randomTitle(rnd) {
  return pick(rnd, TITLE_WORDS_A) + ' ' + pick(rnd, TITLE_WORDS_B);
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
export function startProject({ proposal, platformId, monetizeId, team, rank, seriesOf }) {
  const genre = GENRES.find((g) => g.id === proposal.genreId);
  const platform = PLATFORMS.find((p) => p.id === platformId);
  const money = MONETIZE.find((m) => m.id === monetizeId);
  const seriesN = seriesOf ? seriesOf.seriesN + 1 : 1;

  // Sequels are worth more but cost more to make, exactly as the original
  // scales HP, damage and stamina with series length.
  const seriesMult = 1 + (seriesN - 1) * 0.55;
  const gradeMult = 0.75 + proposal.grade * 0.25;
  // Big enough that a project spans several weeks of stamina rather than one
  // sitting: a release should be an event, not a weekly chore. Rank is in the
  // product because a studio's damage per turn compounds far faster than the
  // platform ladder raises HP — without it, a mature company finishes a game
  // every week and the calendar stops meaning anything.
  const rankScale = 1 + (Math.max(1, rank) - 1) * 0.11;
  const hp = Math.round(8600 * genre.hp * platform.hp * seriesMult * gradeMult * rankScale);

  const boss = bossFor(genre.id);
  return {
    id: 'gp' + (_pid++),
    title: proposal.title,
    proposal,
    genreId: genre.id,
    // 개발은 보스전이다. 아이디어에 이름과 형태와 페이즈가 붙는다.
    boss: { id: genre.id, ko: boss.ko, shape: boss.shape, col: boss.col, accent: boss.accent },
    phase: 0,
    weak: 0,                     // 페이즈 전환 직후 약점이 드러난 턴 수
    bugExtra: 0,                 // 보스의 반격이 남긴 버그
    critBonus: 0,                // 네잎클로버 같은 도구가 얹는 번뜩임 확률
    lastGain: null,              // 직전 턴에 오른 품질 (진행 패널의 +표시)
    lastDamage: 0,
    attacks: 0,
    platformId, monetizeId,
    seriesN, seriesRoot: seriesOf ? (seriesOf.seriesRoot || seriesOf.id) : null,
    team: team.map((s) => s.id),
    hpMax: hp, hp,
    turn: 0,
    staminaSpent: 0,
    contentId: null,
    methodId: null,
    pendingCards: null,          // {kind:'content'|'method', options:[...]}
    raw: { craze: 0, usability: 0, impact: 0, social: 0, retention: 0 },
    crits: 0,
    log: [],
    done: false,
    devCost: Math.round(platform.cost * gradeMult * seriesMult),
    startedRank: rank,
  };
}

/* Stamina a single turn costs. Longer series are heavier, per the original. */
export function turnCost(project) {
  return 1 + Math.floor((project.seriesN - 1) / 2);
}

/* ---------- one battle turn ---------- */
export function battleTurn(project, staffById, rnd, ctx = {}) {
  if (project.done) return { events: [], finished: true };
  if (project.pendingCards) return { events: [], blocked: 'card' };

  const genre = GENRES.find((g) => g.id === project.genreId);
  const content = project.contentId ? CONTENTS.find((c) => c.id === project.contentId) : null;
  const method = project.methodId ? METHODS.find((m) => m.id === project.methodId) : null;

  const combo = content ? comboScore(project.genreId, project.contentId) : 1.0;
  const res = researchEffect(ctx.research);
  // 페이즈가 오를수록 아이디어는 단단해지고, 페이즈가 막 바뀐 직후에는
  // 잠깐 약점이 드러난다. 집중 개발(ctx.focus)은 타이밍으로 사는 배율이다.
  const phaseMult = 1 / (BOSS_PHASES[project.phase || 0] || BOSS_PHASES[0]).dmg;
  const weakMult = (project.weak || 0) > 0 ? WEAK_MULT : 1;
  const focus = ctx.focus ? Math.max(0.6, Math.min(2.4, ctx.focus)) : 1;
  const dmgMult = (method ? method.dmg : 1) * (0.85 + combo * 0.15) * res.dmg
    * phaseMult * weakMult * focus;
  const qMult = (method ? method.quality : 1) * combo;
  const variance = method && method.variance ? method.variance : 0.15;
  // A 분위기 메이커 on the team holds everyone else's motivation up.
  let teamMood = 0;
  for (const id of project.team) {
    const s = staffById.get(id);
    if (s) teamMood += traitAdd(s, 'teamMood');
  }

  project.turn += 1;
  if (project.weak > 0) project.weak -= 1;
  const events = [];
  const gains = {};
  let total = 0;

  for (const id of project.team) {
    const s = staffById.get(id);
    if (!s) continue;
    const job = JOBS[s.job];
    const base = power(s);

    // Motivation buys crit chance as well as raw power, so a motivated team
    // does not merely work faster, it produces better games.
    const critChance = 0.06 + Math.min(0.30, (s.motivation + teamMood * 2) * 0.006)
      + traitAdd(s, 'crit') + (project.critBonus || 0) + (focus > 1.3 ? 0.10 : 0);
    const crit = rnd() < critChance;
    const roll = 1 - variance + rnd() * variance * 2;
    // 장르 덕후 only fires on the one genre they actually love. The multiplier
    // is read from the trait table rather than repeated here, so the number the
    // roster screen shows is the number the battle uses.
    const fan = hasTrait(s, 'genreFan') && s.favGenre === project.genreId
      ? (TRAITS.genreFan.genreBonus || 1) : 1;
    let dmg = base * dmgMult * roll * traitMult(s, 'dmg') * fan;
    if (crit) { dmg *= 2.2; project.crits += 1; }
    dmg = Math.max(1, Math.round(dmg));
    total += dmg;

    // Quality accrues along this job's contribution axes.
    let gained = null;
    for (const [stat, w] of Object.entries(job.contrib)) {
      const bias = (genre.bias[stat] || 1) * (content ? (content.bias[stat] || 1) : 1)
        * (method && method.focus ? (method.focus[stat] || 1) : 1);
      // 장비가 여기에 들어간다. 사운드 담당이 피아노를 들고 있으면 그 사람이
      // 밀어 올리는 화제성·임팩트가 실제로 더 크게 오른다.
      const add = base * w * qMult * bias * roll * (crit ? 1.8 : 1)
        * traitMult(s, 'quality') * fan * gearAxis(s, stat);
      project.raw[stat] += add;
      gains[stat] = (gains[stat] || 0) + add;
      if (!gained || add > gained.amount) gained = { stat, amount: add };
    }

    // 개발은 사람을 갈아 넣는다. 체력이 빠지면 power() 가 알아서 줄어들고,
    // 그래서 밥을 사주는 일이 실제 전력 관리가 된다.
    const spent = drainHp(s, Math.max(1, s.hpMax * HP.turnCost * (focus > 1 ? 1.35 : 1)));

    events.push({
      kind: crit ? 'crit' : 'hit',
      staffId: s.id, name: s.name, job: job.ko,
      damage: dmg, stat: gained ? gained.stat : null,
      hpSpent: spent, hp: s.hp, hpMax: s.hpMax,
    });
  }

  project.hp = Math.max(0, project.hp - total);
  project.staminaSpent += turnCost(project) + (focus > 1 ? 0 : 0);
  project.lastGain = gains;
  project.lastDamage = total;
  project.log.push({ turn: project.turn, damage: total, hp: project.hp });

  // ---- 페이즈 전환: 아이디어가 형태를 바꾸고 크게 반격한다 ----
  const fracNow = project.hp / project.hpMax;
  let nextPhase = project.phase || 0;
  for (let i = BOSS_PHASES.length - 1; i > 0; i--) {
    if (fracNow <= BOSS_PHASES[i].at) { nextPhase = Math.max(nextPhase, i); break; }
  }
  if (project.hp > 0 && nextPhase > (project.phase || 0)) {
    project.phase = nextPhase;
    project.weak = WEAK_TURNS;
    events.push({
      kind: 'phase', phase: nextPhase, ko: BOSS_PHASES[nextPhase].ko,
      boss: project.boss ? project.boss.ko : '아이디어',
    });
    events.push(bossAttack(project, staffById, rnd, BOSS_RAGE));
  } else if (project.hp > 0 && project.turn % HP.attackEvery === 0) {
    // 네 턴마다 한 번. 개발이 일방적인 두들김이 되지 않게 하는 장치다.
    const move = BOSS_MOVES[Math.floor(rnd() * BOSS_MOVES.length)];
    events.push(bossAttack(project, staffById, rnd, move));
  }

  // Idea cards at the two thirds marks.
  const frac = project.hp / project.hpMax;
  if (!project.contentId && frac <= 0.66 && project.hp > 0) {
    project.pendingCards = { kind: 'content', options: rollContentCards(rnd, project.genreId) };
    events.push({ kind: 'card', cardKind: 'content' });
  } else if (project.contentId && !project.methodId && frac <= 0.33 && project.hp > 0) {
    project.pendingCards = { kind: 'method', options: rollMethodCards(rnd) };
    events.push({ kind: 'card', cardKind: 'method' });
  }

  if (project.hp <= 0) {
    // A project that reached 0 HP before its cards were offered still gets
    // them; otherwise a very strong team would skip the choices entirely.
    if (!project.contentId) {
      project.pendingCards = { kind: 'content', options: rollContentCards(rnd, project.genreId) };
      events.push({ kind: 'card', cardKind: 'content' });
    } else if (!project.methodId) {
      project.pendingCards = { kind: 'method', options: rollMethodCards(rnd) };
      events.push({ kind: 'card', cardKind: 'method' });
    } else {
      events.push({ kind: 'complete' });
    }
  }

  return { events, total, finished: project.hp <= 0 && !project.pendingCards };
}

/* ---------- 보스의 반격 ----------
   대상은 팀 안에서 무작위로 고른다. 체력이 많이 남은 사람부터 맞게 하면
   피해가 고르게 퍼져 아무도 위험해지지 않고, 낮은 사람부터 맞게 하면
   한 명이 계속 쓰러진다. 무작위가 두 결과 사이에서 가장 읽기 쉽다. */
export function bossAttack(project, staffById, rnd, move) {
  const pool = project.team.map((id) => staffById.get(id)).filter(Boolean);
  const hits = [];
  const n = Math.min(pool.length, move.targets || 1);
  const picked = new Set();
  for (let i = 0; i < n && picked.size < pool.length; i++) {
    let s = null, guard = 0;
    do { s = pool[Math.floor(rnd() * pool.length)]; } while (picked.has(s.id) && guard++ < 12);
    if (picked.has(s.id)) continue;
    picked.add(s.id);
    syncHp(s);
    const dealt = drainHp(s, s.hpMax * move.hp * (0.85 + rnd() * 0.3));
    hits.push({ staffId: s.id, name: s.name, damage: dealt, hp: s.hp, hpMax: s.hpMax });
  }
  // 상한이 없으면 긴 프로젝트일수록 버그가 선형으로 쌓여, 디버그가 선택이
  // 아니라 노가다가 된다 — 예전에 버그 개수를 HP 에 선형으로 뒀다가 정확히
  // 그렇게 됐다. 반격이 남기는 버그는 여기서 멈춘다.
  project.bugExtra = Math.min(HP.bugCap, (project.bugExtra || 0) + (move.bugs || 0));
  project.attacks = (project.attacks || 0) + 1;
  return {
    kind: 'boss', move: move.id, ko: move.ko, line: move.line,
    bugs: move.bugs || 0, hits,
  };
}

/* ---------- 진행 중인 품질 미리보기 ----------
   개발 화면 옆에 띄우는 숫자. 완성 시와 **같은 곡선**을 쓰는 것이 중요하다.
   보고 있던 수치와 결과가 다르면 그 패널은 장식이 되고, 같으면 "이번 턴에
   무엇이 올랐나"가 실제 판단 재료가 된다. */
export function previewQuality(project) {
  const turns = Math.max(1, project.turn);
  const size = Math.max(1, project.team.length);
  const q = {};
  for (const st of STATS) {
    const x = project.raw[st] / (turns * size);
    q[st] = Math.max(0, Math.min(999, Math.round(QCAP * (1 - Math.exp(-x / QSCALE)))));
  }
  return q;
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
  const scale = 7 + 10 * Math.log2(1 + project.hpMax / 4500);
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
  return bugs + (project.bugExtra || 0);
}

function rollContentCards(rnd, genreId) {
  // Always offer one genuinely strong pairing, so the choice is "spot the good
  // one" rather than "pick between three mediocre ones". Drawing from the top
  // four made the strong option miss three times in four for genres with a
  // single standout partner.
  const scored = CONTENTS.map((c) => ({ c, s: comboScore(genreId, c.id) }));
  scored.sort((a, b) => b.s - a.s);
  const great = scored.slice(0, 2)[Math.floor(rnd() * Math.min(2, scored.length))].c;
  const rest = CONTENTS.filter((c) => c.id !== great.id);
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

export function chooseCard(project, optionId) {
  if (!project.pendingCards) return { ok: false };
  const kind = project.pendingCards.kind;
  if (kind === 'content') project.contentId = optionId;
  else project.methodId = optionId;
  project.pendingCards = null;
  // Reaching 0 HP with a card still pending left the project unfinished; now
  // that it is answered, it may be complete.
  const complete = project.hp <= 0 && project.contentId && project.methodId;
  return { ok: true, kind, complete };
}

/* The 1-999 quality the project would score if it finished this second.

   The in-development panel has to read from the SAME curve the result screen
   does. It used to apply an invented scale of its own, so the bars climbed on
   one ruler and landed on another — and because the result screen then divided
   a 999-band number by 4 to get a percentage, a debut game's 9 points rendered
   as an empty bar. One curve, one meaning, everywhere. */
export function projectedQuality(project) {
  const turns = Math.max(1, project.turn);
  const size = Math.max(1, project.team.length);
  const q = {};
  for (const st of STATS) {
    const x = project.raw[st] / (turns * size);
    q[st] = Math.max(1, Math.min(999, Math.round(QCAP * (1 - Math.exp(-x / QSCALE)))));
  }
  return q;
}

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
  const turns = Math.max(1, project.turn);
  const size = Math.max(1, project.team.length);
  const quality = projectedQuality(project);
  project.rawPerSlot = STATS.reduce((a, st) => a + project.raw[st] / (turns * size), 0) / STATS.length;

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
    const curved = CBASE + CSPAN * (1 - Math.exp(-v / CSCALE));
    project.criticBase.push(curved + (rnd() - 0.45) * 1.5);
  }

  project.done = true;
  project.quality = quality;
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
  const pen = Math.min(2.6, (project.bugs || 0) * 0.11);
  project.critics = base.map((b) => Math.max(1, Math.min(10, Math.round(b - pen))));
  project.criticTotal = project.critics.reduce((a, b) => a + b, 0);
  project.hallOfFame = project.criticTotal >= 32;
  return project.criticTotal;
}

/* Spend stamina to remove bugs before release. Returns how many bugs went and
   how many review points that bought back. */
export function debug(project, staffById, rnd) {
  if (!project.done || project.bugs <= 0) return { fixed: 0, gained: 0 };
  const before = project.criticTotal;
  let fixed = 0;
  for (const id of project.team) {
    const s = staffById.get(id);
    if (!s) continue;
    if (JOB_ABILITY[s.job] === 'prog') fixed += 2 + Math.floor(ability(s, 'prog') / 12);
    else fixed += 1;
  }
  fixed = Math.max(1, Math.round(fixed * (0.7 + rnd() * 0.6)));
  fixed = Math.min(project.bugs, fixed);
  project.bugs -= fixed;
  scoreCritics(project);
  return { fixed, gained: project.criticTotal - before, wasHof: project.hallOfFame };
}

export { motivationMult };
