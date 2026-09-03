/* Release, users and revenue.

   A released game is not a lump sum, it is a title under 운영 (management) that
   pays out weekly and bleeds users at a rate its retention stat decides. Three
   can run at once, per the original — deciding which one to shut down to make
   room is a real choice once you have three earners. */

import {
  PLATFORMS, MONETIZE, STATS, rankInfo, RANK_UP_FANS, MARKETING,
  researchEffect, TREND_BONUS, TREND_PENALTY, FLOOR_UPKEEP, floorCost,
} from './data.js';
import { traitMult } from './staff.js';

/* `ctx` carries what the company knows and has spent: research levels, the
   quarter's trends, the marketing package bought, and the team (for 스타 개발자). */
export function releaseGame(project, company, rnd, ctx = {}) {
  const platform = PLATFORMS.find((p) => p.id === project.platformId);
  const money = MONETIZE.find((m) => m.id === project.monetizeId);
  const q = project.quality;

  // Launch users: craze and social pull people in, the platform's reach
  // multiplies it, and the company's existing fanbase is the floor.
  const pull = q.craze * 1.3 + q.social * 1.1 + q.impact * 0.8;
  const bugPenalty = Math.max(0.35, 1 - project.bugs * 0.014);
  // Capped: an unbounded fanbase multiplier feeds itself — more users means
  // more fans means more users — and the curve leaves the chart by year two.
  const fanBoost = Math.min(9, 1 + Math.log2(1 + company.fans / 3000) * 0.55);
  const sequelBoost = 1 + (project.seriesN - 1) * 0.28;
  const hofBoost = project.hallOfFame ? 1.35 : 1;

  const res = researchEffect(ctx.research);
  const mk = MARKETING.find((x) => x.id === (ctx.marketingId || 'none')) || MARKETING[0];

  // The quarter's hot genre and hot content. The doc asks for a reason a known
  // good combo is not always the right answer; this is it.
  const trends = ctx.trends || {};
  let trendMult = 1;
  if (trends.genreId) trendMult *= trends.genreId === project.genreId ? TREND_BONUS : TREND_PENALTY;
  if (trends.contentId) trendMult *= trends.contentId === project.contentId ? TREND_BONUS : 1;
  trendMult = Math.max(0.7, Math.min(2.4, trendMult));

  // 스타 개발자 on the team lifts the launch.
  let starMult = 1;
  for (const s of ctx.team || []) starMult *= traitMult(s, 'fans');

  const users = Math.max(400, Math.round(
    pull * 26 * platform.fans * money.users * bugPenalty * fanBoost * sequelBoost * hofBoost
    * res.users * mk.users * trendMult * starMult
    * (0.85 + rnd() * 0.3)
  ));

  // Retention decides how slowly users leave; usability softens the bug drag.
  const decay = Math.min(0.990, money.decay + Math.min(0.050, q.retention / 2000) + res.decay);

  const arpu = money.arpu * (1 + q.social / 260) * platform.share * (0.9 + rnd() * 0.2);

  const rel = {
    id: project.id,
    title: project.title,
    genreKo: project.genreKo,
    contentKo: project.contentKo,
    platformId: project.platformId,
    monetizeId: project.monetizeId,
    quality: q,
    critics: project.critics,
    criticTotal: project.criticTotal,
    hallOfFame: project.hallOfFame,
    seriesN: project.seriesN,
    seriesRoot: project.seriesRoot || project.id,
    bugs: project.bugs,
    users,
    peakUsers: users,
    decay,
    arpu,
    weeks: 0,
    earned: 0,
    managing: true,
    marketingId: mk.id,
    trendHit: trendMult > 1.1,
  };

  // Fans the launch wins the company, which raises the floor on every future
  // release and is what actually drives rank.
  const fansGained = Math.round(users * 0.11 * (project.hallOfFame ? 1.5 : 1) * mk.fans * starMult);
  return { release: rel, fansGained };
}

/* One week of a managed title. Called by the sim tick. */
export function tickRelease(rel, rnd) {
  if (!rel.managing) return 0;
  rel.weeks += 1;
  const income = Math.round(rel.users * rel.arpu * 0.7);
  rel.earned += income;
  // Churn, with a little noise so the curve is not a clean exponential.
  rel.users = Math.max(0, Math.round(rel.users * rel.decay * (0.97 + rnd() * 0.06)));
  if (rel.users < 60) rel.managing = false;   // the title has run its course
  return income;
}

/* Research earned by finishing a project. Bigger, better-reviewed games teach
   the company more, which is what makes research a reward for ambition. */
export function researchFromProject(project) {
  const size = Math.log2(1 + project.hpMax / 1200);
  const grade = 0.6 + project.proposal.grade * 0.2;
  return Math.max(2, Math.round(size * grade * 5));
}

export function coinsFromRelease(rel) {
  // Coins are the premium currency; a strong launch pays a handful.
  return Math.max(1, Math.round(rel.criticTotal / 4 + (rel.hallOfFame ? 6 : 0)));
}

/* Weekly running cost: payroll plus a per-floor overhead.

   The ground floor is rent-free — it is the room you started in — so a garage
   studio's only bill is its people. Every floor you BUY keeps charging you
   whether or not anyone sits on it, which is what makes expansion a decision
   rather than a button. Payroll is the early game's whole pressure: it scales
   with headcount, so a hire is a standing commitment, not a one-off fee. */
export function weeklyCosts(company, staff) {
  const salaries = staff.reduce((a, s) => a + s.salary, 0);
  const overhead = Math.max(0, company.floors - 1) * FLOOR_UPKEEP;
  return Math.round(salaries * 0.60 + overhead);
}

export { floorCost };

export function checkRankUp(company) {
  const need = RANK_UP_FANS(company.rank);
  if (company.fans < need) return null;
  company.rank += 1;
  const info = rankInfo(company.rank);
  company.staminaMax = info.staminaMax;
  // Rank raises the ceiling; the player still has to buy the space.
  const unlockedFloor = info.floors > (company.maxFloors || 1);
  company.maxFloors = info.floors;
  return { rank: company.rank, info, unlockedFloor };
}

export function cashCap(company) { return rankInfo(company.rank).cashCap; }

export function scoreSummary(q) {
  return STATS.reduce((a, s) => a + q[s], 0);
}
