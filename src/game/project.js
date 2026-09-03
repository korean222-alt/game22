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
  comboScore, TITLE_WORDS_A, TITLE_WORDS_B,
} from './data.js';
import { JOBS, JOB_ABILITY } from './data.js';
import { power, ability, motivationMult } from './staff.js';

let _pid = 1;
export function seedProjectIds(n) { _pid = Math.max(_pid, n); }

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];

export function randomTitle(rnd) {
  return pick(rnd, TITLE_WORDS_A) + ' ' + pick(rnd, TITLE_WORDS_B);
}

/* ---------- proposals ----------
   Grade is a 1-5 star roll weighted by the whole company's planning power, so
   hiring planners and putting them on the planning floor visibly pays off. */
export function generateProposal(rnd, author, totalPlanPower, rank) {
  const genre = pick(rnd, GENRES);
  // A soft curve: doubling planning power moves the grade by about one star.
  const scale = Math.log2(1 + totalPlanPower / 26);
  const roll = scale * (0.55 + rnd() * 0.9) + rank * 0.045;
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
  // sitting: a release should be an event, not a weekly chore.
  const hp = Math.round(2600 * genre.hp * platform.hp * seriesMult * gradeMult);

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
export function battleTurn(project, staffById, rnd) {
  if (project.done) return { events: [], finished: true };
  if (project.pendingCards) return { events: [], blocked: 'card' };

  const genre = GENRES.find((g) => g.id === project.genreId);
  const content = project.contentId ? CONTENTS.find((c) => c.id === project.contentId) : null;
  const method = project.methodId ? METHODS.find((m) => m.id === project.methodId) : null;

  const combo = content ? comboScore(project.genreId, project.contentId) : 1.0;
  const dmgMult = (method ? method.dmg : 1) * (0.85 + combo * 0.15);
  const qMult = (method ? method.quality : 1) * combo;
  const variance = method && method.variance ? method.variance : 0.15;

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
    const critChance = 0.06 + Math.min(0.30, s.motivation * 0.006);
    const crit = rnd() < critChance;
    const roll = 1 - variance + rnd() * variance * 2;
    let dmg = base * dmgMult * roll;
    if (crit) { dmg *= 2.2; project.crits += 1; }
    dmg = Math.max(1, Math.round(dmg));
    total += dmg;

    // Quality accrues along this job's contribution axes.
    let gained = null;
    for (const [stat, w] of Object.entries(job.contrib)) {
      const bias = (genre.bias[stat] || 1) * (content ? (content.bias[stat] || 1) : 1)
        * (method && method.focus ? (method.focus[stat] || 1) : 1);
      const add = base * w * qMult * bias * roll * (crit ? 1.8 : 1);
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
export function finishProject(project, staffById, rnd) {
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
  const quality = {};
  for (const st of STATS) {
    const x = project.raw[st] / (turns * size);
    quality[st] = Math.max(1, Math.min(999, Math.round(180 * (1 - Math.exp(-x / 40)) + x * 0.35)));
  }

  const avg = STATS.reduce((a, s) => a + quality[s], 0) / STATS.length;

  // Bugs scale with size and fall with usability and a polishing method.
  let bugs = Math.round((project.hpMax / 260) * (1.5 - Math.min(1.2, quality.usability / 70)));
  if (method.bugCut) bugs = Math.round(bugs * (1 - method.bugCut));
  bugs = Math.max(0, bugs + Math.floor(rnd() * 3) - 1);

  // Four critics, 1-10 each, the way the series has always scored a release.
  // The curve is saturating rather than linear: early games land around 3, and
  // the 8s that add up to a hall-of-fame 32 stay something to work toward.
  const critics = [];
  for (let i = 0; i < 4; i++) {
    const taste = STATS[i % STATS.length];
    const v = avg * 0.6 + quality[taste] * 0.4;
    const curved = 2 + 8 * (1 - Math.exp(-v / 260));
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

/* Spend stamina to remove bugs before release. */
export function debug(project, staffById, rnd) {
  if (!project.done || project.bugs <= 0) return { fixed: 0 };
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
  return { fixed };
}

export { motivationMult };
