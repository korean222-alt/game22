/* Release, users and revenue.

   A released game is not a lump sum, it is a title under 운영 (management) that
   pays out weekly and bleeds users at a rate its retention stat decides. Three
   can run at once, per the original — deciding which one to shut down to make
   room is a real choice once you have three earners. */

import {
  PLATFORMS, MONETIZE, STATS, rankInfo, RANK_UP_FANS, MARKETING,
  researchEffect, TREND_BONUS, TREND_PENALTY, FLOOR_UPKEEP, floorCost,
  SALE_EVENTS,
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

  // 재탕. The doc lists "이거 전에 본 것 같은데" as one of the original's release
  // events, and it is the one that stops a discovered combo from being the
  // answer forever: shipping the same genre × content you just shipped reads as
  // a rerun and the market treats it as one.
  const key = `${project.genreId}|${project.contentId}`;
  const recent = ctx.recent || [];
  const repeats = recent.filter((k) => k === key).length;
  const rehashMult = repeats >= 2 ? 0.55 : repeats === 1 ? 0.76 : 1;

  const users = Math.max(400, Math.round(
    pull * 26 * platform.fans * money.users * bugPenalty * fanBoost * sequelBoost * hofBoost
    * res.users * mk.users * trendMult * starMult * rehashMult
    * (0.85 + rnd() * 0.3)
  ));

  // Retention decides how slowly users leave; usability softens the bug drag.
  const decay = Math.min(0.990, money.decay + Math.min(0.050, q.retention / 2000) + res.decay);

  /* ---------- 판매 곡선의 모양 ----------
     예전에는 출시 주가 최고점이었고 그 뒤로는 내려가기만 했다. 실제로 팔리는
     물건은 그렇게 움직이지 않는다 — 처음에는 아는 사람만 사고, 입소문이
     돌면서 몇 주에 걸쳐 올라가고, 정점을 찍은 다음에 식는다. 그래프가
     그 모양이어야 "지금이 정점인가" 가 볼 만한 질문이 된다.

     그래서 출시 유저는 **정점이 아니라 출발점**이다. launch 는 그 출발점,
     peakWeek 는 정점이 서는 주차(화제성이 높을수록 빨리 뜨고, 지속성이
     높을수록 천천히 뜬다), growth 는 상승기의 주당 배율이다. 총 매출이
     예전과 비슷하게 남도록 출발점을 낮춰서 시작한다. */
  const peakWeek = Math.max(2, Math.min(7, Math.round(2.4 + q.retention / 260 - q.craze / 520)));
  const growth = 1.34 + Math.min(0.5, q.craze / 900) + Math.min(0.25, q.social / 1200);
  const startUsers = Math.max(200, Math.round(users * 0.42));

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
    users: startUsers,
    launchUsers: users,       // 홍보가 끌어온 첫 주의 유저
    peakUsers: startUsers,
    peakWeek,
    growth,
    decay,
    arpu,
    weeks: 0,
    earned: 0,
    // 주차별 매출·유저 기록. 판매 팝업의 그래프가 이걸 읽는다 — 한 게임이
    // 며칠(주) 동안 얼마나 팔리고 어떻게 식어가는지가 눈에 보여야 한다.
    history: [],
    managing: true,
    marketingId: mk.id,
    combo: project.combo,
    trendHit: trendMult > 1.1,
    repeats,
  };

  /* Why the launch went the way it did, in the player's language.

     The doc is explicit that the original names its release events rather than
     hiding them in a multiplier, and that this is what turns a flop into
     information: a line saying 버그가 너무 많다 is something you can act on next
     time, a silent ×0.6 is not. */
  rel.notes = [];
  const note = (ko, cls) => rel.notes.push({ ko, cls });
  if (trendMult > 1.4) note('시장의 유행을 정면으로 탔다', 'great');
  else if (trendMult > 1.1) note('유행과 조금 맞았다', 'good');
  else if (trendMult < 0.95) note('지금 시장이 원하는 장르가 아니다', 'bad');
  if (project.combo >= 1.55) note('장르와 소재가 환상적으로 맞았다', 'great');
  else if (project.combo >= 1.25) note('장르와 소재의 궁합이 좋다', 'good');
  else if (project.combo < 0.82) note('장르와 소재가 서로 겉돈다', 'bad');
  if (repeats >= 2) note('또 같은 조합? 재탕이라는 말이 나온다', 'bad');
  else if (repeats === 1) note('직전 작품과 비슷하다는 평이 있다', 'bad');
  if (project.bugs >= 14) note('버그가 너무 많아 평이 나쁘다', 'bad');
  else if (project.bugs === 0) note('버그 하나 없는 깔끔한 빌드', 'great');
  if (project.hallOfFame) note('명예의 전당 등재작', 'great');
  if (mk.id !== 'none') note(`${mk.ko} 효과로 초기 유입이 늘었다`, 'good');
  if (project.seriesN > 1) note(`시리즈 ${project.seriesN}편, 팬들이 기다렸다`, 'good');

  // Fans the launch wins the company, which raises the floor on every future
  // release and is what actually drives rank.
  const fansGained = Math.round(users * 0.11 * (project.hallOfFame ? 1.5 : 1) * mk.fans * starMult);
  return { release: rel, fansGained };
}

/* 이번 주의 유저 배율. 정점 전에는 입소문으로 올라가고, 지나면 식는다.
   상승기의 배율은 정점에 가까워질수록 1 로 수렴하므로 곡선이 뾰족하지 않고
   봉우리 모양이 된다. */
export function weekMult(rel) {
  const peak = rel.peakWeek || 0;
  if (rel.weeks < peak) {
    const t = rel.weeks / Math.max(1, peak);          // 0 → 1
    return 1 + ((rel.growth || 1.4) - 1) * (1 - t * t);
  }
  /* 정점을 지나면 식는 속도가 **점점 빨라진다**. 잔존율만 곱하면 지속성이
     높은 게임은 6개월이 지나도 같은 자리에 붙어 있어서, 그래프에 끝이
     없다 — 서비스 종료를 고를 이유도, 다음 게임을 낼 이유도 사라진다. */
  const past = rel.weeks - peak;
  return Math.max(0.62, rel.decay - Math.min(0.16, past * 0.007));
}

/* 이번 주에 사건이 붙는가. 정점을 지나기 전에는 좋은 쪽이, 지난 뒤에는
   나쁜 쪽이 조금 더 잘 걸린다 — 게임이 식어가는 이유가 하나쯤은 보여야 한다.
   맨 첫 주에는 걸지 않는다. 출시하자마자 "경쟁작 출시" 가 뜨면 홍보를 고른
   선택이 무엇을 샀는지 읽을 수가 없다. */
export function rollSaleEvent(rel, rnd) {
  if (rel.weeks <= 1) return null;
  const past = rel.weeks > (rel.peakWeek || 0);
  for (const ev of SALE_EVENTS) {
    const good = ev.cls !== 'bad';
    const p = ev.p * (past ? (good ? 0.7 : 1.25) : (good ? 1.2 : 0.7));
    if (rnd() < p) {
      const [lo, hi] = ev.mult;
      const amount = lo + rnd() * (hi - lo);
      return {
        id: ev.id, ko: ev.ko, emoji: ev.emoji, cls: ev.cls,
        pct: Math.round(amount * 100),
        mult: 1 + amount,
        users: 1 + amount * (ev.users || 0),
      };
    }
  }
  return null;
}

/* One week of a managed title. Called by the sim tick.

   돌려주는 것은 숫자 하나가 아니라 이번 주의 기록이다 — 판매 팝업이 사건을
   띄우려면 무엇이 일어났는지를 알아야 하고, 매출만 돌려주면 알 길이 없다.
   `+income` 으로 쓰던 옛 호출부를 위해 valueOf 를 달아 두지 않고, 호출부
   두 곳을 모두 고쳤다. */
export function tickRelease(rel, rnd) {
  if (!rel.managing) return { income: 0, event: null, users: rel.users };
  rel.weeks += 1;
  const ev = rollSaleEvent(rel, rnd);
  const income = Math.max(0, Math.round(rel.users * rel.arpu * 0.7 * (ev ? ev.mult : 1)));
  rel.earned += income;
  rel.lastIncome = income;
  rel.lastEvent = ev;
  if (!rel.history) rel.history = [];
  rel.history.push({ w: rel.weeks, income, users: rel.users, event: ev });
  if (rel.history.length > 26) rel.history.shift();
  // 다음 주의 유저. 봉우리 곡선에 사건의 흔적과 약간의 잡음을 얹는다.
  const mult = weekMult(rel) * (ev ? ev.users : 1);
  rel.users = Math.max(0, Math.round(rel.users * mult * (0.97 + rnd() * 0.06)));
  rel.peakUsers = Math.max(rel.peakUsers || 0, rel.users);
  // 정점을 지나고, 유저가 거의 남지 않았을 때만 접는다. 상승기에 60명을
  // 밑돈다고 접으면 작은 게임은 첫 주에 서비스가 끝난다.
  if (rel.users < 60 && rel.weeks > (rel.peakWeek || 0)) rel.managing = false;
  return { income, event: ev, users: rel.users };
}

/* Research earned by finishing a project. Bigger, better-reviewed games teach
   the company more, which is what makes research a reward for ambition. */
export function researchFromProject(project) {
  const size = Math.log2(1 + (project.scale || project.hpMax) / 1200);
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
