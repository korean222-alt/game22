/* Release, users and revenue.

   A released game is not a lump sum, it is a title under 운영 (management) that
   pays out weekly and bleeds users at a rate its retention stat decides. Three
   can run at once, per the original — deciding which one to shut down to make
   room is a real choice once you have three earners. */

import { PLATFORMS, MONETIZE, STATS, rankInfo, RANK_UP_FANS } from './data.js';

export function releaseGame(project, company, rnd) {
  const platform = PLATFORMS.find((p) => p.id === project.platformId);
  const money = MONETIZE.find((m) => m.id === project.monetizeId);
  const q = project.quality;

  // Launch users: craze and social pull people in, the platform's reach
  // multiplies it, and the company's existing fanbase is the floor.
  const pull = q.craze * 1.3 + q.social * 1.1 + q.impact * 0.8;
  const bugPenalty = Math.max(0.35, 1 - project.bugs * 0.014);
  // Capped: an unbounded fanbase multiplier feeds itself — more users means
  // more fans means more users — and the curve leaves the chart by year two.
  const fanBoost = Math.min(6, 1 + Math.log2(1 + company.fans / 3000) * 0.55);
  const sequelBoost = 1 + (project.seriesN - 1) * 0.28;
  const hofBoost = project.hallOfFame ? 1.35 : 1;

  const users = Math.max(400, Math.round(
    pull * 95 * platform.fans * money.users * bugPenalty * fanBoost * sequelBoost * hofBoost
    * (0.85 + rnd() * 0.3)
  ));

  // Retention decides how slowly users leave; usability softens the bug drag.
  const decay = Math.min(0.988, money.decay + Math.min(0.050, q.retention / 2000));

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
  };

  // Fans the launch wins the company, which raises the floor on every future
  // release and is what actually drives rank.
  const fansGained = Math.round(users * 0.25 * (project.hallOfFame ? 1.5 : 1));
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

export function coinsFromRelease(rel) {
  // Coins are the premium currency; a strong launch pays a handful.
  return Math.max(1, Math.round(rel.criticTotal / 4 + (rel.hallOfFame ? 6 : 0)));
}

/* Weekly running cost: salaries plus a per-floor overhead. */
export function weeklyCosts(company, staff) {
  const salaries = staff.reduce((a, s) => a + s.salary, 0);
  const overhead = company.floors * 2400;
  return Math.round(salaries * 0.20 + overhead);
}

export function checkRankUp(company) {
  const need = RANK_UP_FANS(company.rank);
  if (company.fans < need) return null;
  company.rank += 1;
  const info = rankInfo(company.rank);
  company.staminaMax = info.staminaMax;
  const unlockedFloor = info.floors > company.floors;
  if (unlockedFloor) company.floors = info.floors;
  return { rank: company.rank, info, unlockedFloor };
}

export function cashCap(company) { return rankInfo(company.rank).cashCap; }

export function scoreSummary(q) {
  return STATS.reduce((a, s) => a + q[s], 0);
}
