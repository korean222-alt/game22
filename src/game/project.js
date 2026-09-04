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
} from './data.js';
import { JOBS, JOB_ABILITY } from './data.js';
import { power, ability, motivationMult, traitMult, traitAdd, hasTrait, traitsOf } from './staff.js';

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

/* One staffer's per-turn contribution on one axis, mapped onto the 1-999 band.
   Exported because the development panel draws the same projection mid-fight:
   a bar during development and the same bar on the results screen have to mean
   the same thing, and they only do if there is one curve. */
export function qualityCurve(x) {
  return Math.max(1, Math.min(QCAP, Math.round(QCAP * (1 - Math.exp(-x / QSCALE)))));
}

/* What the five axes would score if the project finished on this turn. */
export function projectQuality(project) {
  const turns = Math.max(1, project.turn);
  const size = Math.max(1, project.team.length);
  const out = {};
  for (const st of STATS) out[st] = qualityCurve(project.raw[st] / (turns * size));
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
export function ideaHp({ genreId, platformId, grade, seriesN = 1, rank = 1 }) {
  const genre = GENRES.find((g) => g.id === genreId);
  const platform = PLATFORMS.find((p) => p.id === platformId);
  if (!genre || !platform) return 0;
  // Sequels are worth more but cost more to make, exactly as the original
  // scales HP, damage and stamina with series length.
  const seriesMult = 1 + (seriesN - 1) * 0.55;
  const gradeMult = 0.75 + grade * 0.25;
  // Big enough that a project spans several weeks of stamina rather than one
  // sitting: a release should be an event, not a weekly chore. Rank is in the
  // product because a studio's damage per turn compounds far faster than the
  // platform ladder raises HP — without it, a mature company finishes a game
  // every week and the calendar stops meaning anything.
  const rankScale = 1 + (Math.max(1, rank) - 1) * 0.11;
  return Math.round(8600 * genre.hp * platform.hp * seriesMult * gradeMult * rankScale);
}

export function startProject({ proposal, platformId, monetizeId, team, rank, seriesOf }) {
  const genre = GENRES.find((g) => g.id === proposal.genreId);
  const platform = PLATFORMS.find((p) => p.id === platformId);
  const money = MONETIZE.find((m) => m.id === monetizeId);
  const seriesN = seriesOf ? seriesOf.seriesN + 1 : 1;

  const seriesMult = 1 + (seriesN - 1) * 0.55;
  const gradeMult = 0.75 + proposal.grade * 0.25;
  const hp = ideaHp({
    genreId: proposal.genreId, platformId, grade: proposal.grade, seriesN, rank,
  });

  return {
    id: 'gp' + (_pid++),
    title: proposal.title,
    proposal,
    genreId: genre.id,
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
  const dmgMult = (method ? method.dmg : 1) * (0.85 + combo * 0.15) * res.dmg;
  const qMult = (method ? method.quality : 1) * combo;
  const variance = method && method.variance ? method.variance : 0.15;
  // A 분위기 메이커 on the team holds everyone else's motivation up.
  let teamMood = 0;
  for (const id of project.team) {
    const s = staffById.get(id);
    if (s) teamMood += traitAdd(s, 'teamMood');
  }

  project.turn += 1;
  const events = [];
  let total = 0;

  for (const id of project.team) {
    const s = staffById.get(id);
    if (!s) continue;
    const job = JOBS[s.job];
    const base = power(s);

    // Motivation buys crit chance as well as raw power, so a motivated team
    // does not merely work faster, it produces better games.
    const critChance = 0.06 + Math.min(0.30, (s.motivation + teamMood * 2) * 0.006)
      + traitAdd(s, 'crit');
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
      const add = base * w * qMult * bias * roll * (crit ? 1.8 : 1)
        * traitMult(s, 'quality') * fan;
      project.raw[stat] += add;
      if (!gained || add > gained.amount) gained = { stat, amount: add };
    }

    events.push({
      kind: crit ? 'crit' : 'hit',
      staffId: s.id, name: s.name, job: job.ko,
      damage: dmg, stat: gained ? gained.stat : null,
    });
  }

  project.hp = Math.max(0, project.hp - total);
  project.staminaSpent += turnCost(project);
  project.log.push({ turn: project.turn, damage: total, hp: project.hp });

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
  const quality = projectQuality(project);
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
  const res = researchEffect(ctx.research);
  const scale = 8 + 12 * Math.log2(1 + project.hpMax / 4500);
  let bugs = scale * (1.5 - Math.min(1.2, quality.usability / 70));
  if (method.bugCut) bugs *= 1 - method.bugCut;
  bugs *= res.bugs;
  // 베테랑 cuts bugs; 올빼미 adds them. Reading the traits directly keeps the
  // two conventions straight: `bugs` is a multiplier, `bugCut` is a fraction
  // removed, and folding both through one helper would silently confuse them.
  for (const id of project.team) {
    const st = staffById.get(id);
    if (!st) continue;
    for (const t of traitsOf(st)) {
      if (t.bugs) bugs *= t.bugs;
      if (t.bugCut) bugs *= 1 - t.bugCut;
    }
  }
  bugs = Math.max(0, Math.round(bugs) + Math.floor(rnd() * 3) - 1);

  // Four critics, 1-10 each, the way the series has always scored a release.
  // The curve is saturating rather than linear: early games land around 3, and
  // the 8s that add up to a hall-of-fame 32 stay something to work toward.
  const critics = [];
  for (let i = 0; i < 4; i++) {
    const taste = STATS[i % STATS.length];
    const v = avg * 0.6 + quality[taste] * 0.4;
    const curved = CBASE + CSPAN * (1 - Math.exp(-v / CSCALE));
    const score = Math.max(1, Math.min(10, Math.round(curved + (rnd() - 0.45) * 1.5)));
    critics.push(score);
  }
  const criticTotal = critics.reduce((a, b) => a + b, 0);

  project.done = true;
  project.quality = quality;
  project.bugs = bugs;
  project.critics = critics;
  project.criticTotal = criticTotal;
  project.combo = combo;
  project.hallOfFame = criticTotal >= 32;
  project.genreKo = genre.ko;
  project.contentKo = (CONTENTS.find((c) => c.id === project.contentId) || {}).ko || '-';
  project.methodKo = method.ko;

  // Whoever proposed it gets the motivation point the original grants.
  const author = project.proposal.authorId ? staffById.get(project.proposal.authorId) : null;
  return { quality, bugs, critics, criticTotal, author };
}

/* Spend stamina to remove bugs before release.

   Each pass clears a FRACTION of what is left as well as a flat amount from the
   team's programmers. The flat term alone made debugging a chore exactly when
   it hurt most: a rookie team ships a game with sixty bugs because its
   usability is low, and at six bugs a pass that is ten stamina of button
   pressing — not a decision, a tax on being new. The fraction keeps a cleanup
   at roughly the same handful of passes whatever the count, while the flat term
   still means a team with real programmers finishes sooner. */
const DEBUG_FRACTION = 0.3;

export function debug(project, staffById, rnd) {
  if (!project.done || project.bugs <= 0) return { fixed: 0 };
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
  return { fixed };
}

export { motivationMult };
