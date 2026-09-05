/* 경쟁사와 주간 판매 차트.

   출시하고 나면 볼 것이 없었다. 판매 현황 카드에 우리 게임의 곡선이 하나
   그려지고 그게 끝이라, 잘 팔린 것인지 못 팔린 것인지 알 방법이 회사 자금
   말고는 없었다. 숫자가 크다는 것과 **1위라는 것**은 다른 종류의 사실이다.

   그래서 세상에 다른 회사를 넣는다. 라이벌 스튜디오가 자기 속도로 게임을
   내고, 우리 게임과 같은 차트에서 유저 수로 순위를 다툰다. 차트는 매주
   다시 계산되고, 1위가 바뀌면 그것이 사건이 된다.

   ── 세기 조절
   라이벌의 규모는 **우리 회사의 지금 수준**을 따라간다 (`marketScale`).
   고정 숫자로 두면 1년차에는 넘볼 수 없는 벽이고 5년차에는 아무도 아니다.
   따라가되 앞서지는 않게 하는 것이 요령이라, 기준선은 우리 최고작의
   유저 수이고 라이벌마다 자기 배율(`power`)이 붙는다.

   순수 데이터 모듈이다. Game 을 건드리지 않고, 벽시계도 DOM 도 모른다. */

/* 라이벌 스튜디오. `power` 는 시장 기준선에 대한 배율, `pace` 는 게임 하나를
   만드는 데 걸리는 주 수의 중앙값이다. 셋의 성격이 달라야 차트가 매주 같은
   모양이 되지 않는다:
     빅픽처   느리지만 낼 때마다 크다 (대작 스튜디오)
     톡톡     자주 내고 작다 (양산형)
     미드나잇 중간, 편차가 크다 (한 방이 있는 인디) */
export const RIVALS = [
  { id: 'bigpic', ko: '빅픽처 게임즈', icon: '🏢', power: 1.15, pace: 11, spread: 0.35 },
  { id: 'toktok', ko: '톡톡 스튜디오', icon: '⚡', power: 0.52, pace: 4, spread: 0.30 },
  { id: 'midnight', ko: '미드나잇 랩', icon: '🌙', power: 0.78, pace: 7, spread: 0.75 },
];

/* 라이벌 게임의 제목. 우리 게임 제목과 같은 우물에서 뽑으면 차트에서
   누가 우리 것인지 헷갈리므로 다른 낱말을 쓴다. */
const HEAD = ['네온', '오르카', '피크닉', '슈가', '코스모', '판다', '스파크', '벨벳',
  '라이트닝', '몬순', '체리', '토파즈', '노바', '모카', '아이언', '실버'];
const TAIL = ['러시', '아일랜드', '클럽', '드라이브', '스토리', '워즈', '가든', '리듬',
  '체이서', '킹덤', '퍼즐', '레이스', '탐험대', '컴퍼니', '아레나', '다이버'];

export function rivalTitle(rnd) {
  return HEAD[Math.floor(rnd() * HEAD.length)] + ' ' + TAIL[Math.floor(rnd() * TAIL.length)];
}

/* 시장의 눈금. 우리가 낸 게임 중 가장 잘 된 것의 유저 수를 기준으로 삼되,
   아직 아무것도 안 냈으면 팬 수에서 짐작한다. 이 한 줄이 라이벌 시스템 전체의
   난이도를 정한다 — 여기에 고정 숫자를 쓰면 밸런스가 연차에 묶인다. */
export function marketScale(company, releases) {
  let best = 0;
  for (const r of releases || []) best = Math.max(best, r.peakUsers || r.users || 0);
  const fromFans = 1200 + (company.fans || 0) * 0.6;
  return Math.max(2600, best * 0.92, fromFans);
}

/* 라이벌 하나가 이번 주에 게임을 낼 확률. pace 주에 한 번꼴이다. */
export function rivalReleaseChance(rival) { return 1 / Math.max(2, rival.pace); }

/* 라이벌의 새 게임. 우리 출시작과 같은 모양의 객체를 돌려주므로 차트가
   둘을 구별하지 않고 정렬할 수 있다. */
export function makeRivalRelease(rival, scale, rnd, id) {
  const swing = 1 - rival.spread + rnd() * rival.spread * 2;
  const users = Math.max(300, Math.round(scale * rival.power * swing));
  return {
    id: 'r' + id,
    rival: rival.id,
    rivalKo: rival.ko,
    icon: rival.icon,
    title: rivalTitle(rnd),
    users: Math.round(users * 0.45),
    launchUsers: users,
    peakUsers: Math.round(users * 0.45),
    peakWeek: 2 + Math.floor(rnd() * 4),
    growth: 1.28 + rnd() * 0.3,
    decay: 0.80 + rnd() * 0.14,
    weeks: 0,
    managing: true,
  };
}

/* 라이벌 게임의 한 주. 우리 것과 같은 봉우리 곡선을 아주 단순화한 것이다 —
   매출도 버그도 없으므로 유저 수만 움직이면 된다. */
export function tickRival(rel, rnd) {
  if (!rel.managing) return rel;
  rel.weeks += 1;
  const mult = rel.weeks <= rel.peakWeek ? rel.growth : rel.decay;
  rel.users = Math.max(0, Math.round(rel.users * mult * (0.95 + rnd() * 0.1)));
  rel.peakUsers = Math.max(rel.peakUsers || 0, rel.users);
  if (rel.users < 200 && rel.weeks > rel.peakWeek) rel.managing = false;
  return rel;
}

/* 이번 주의 차트. 우리 운영작과 라이벌 게임을 한 줄에 세워 유저 수로
   정렬한다. `mine` 이 붙은 줄이 우리 것이다. */
export function buildChart(myReleases, rivalReleases, companyName, limit = 8) {
  const rows = [];
  for (const r of myReleases || []) {
    if (!r.managing) continue;
    rows.push({
      id: r.id, title: r.title, users: r.users || 0,
      studio: companyName, icon: '🎮', mine: true,
    });
  }
  for (const r of rivalReleases || []) {
    if (!r.managing) continue;
    rows.push({
      id: r.id, title: r.title, users: r.users || 0,
      studio: r.rivalKo, icon: r.icon, mine: false,
    });
  }
  rows.sort((a, b) => b.users - a.users);
  return rows.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));
}

/* 우리 게임 중 가장 높은 순위. 없으면 0. */
export function myBestRank(chart) {
  for (const row of chart) if (row.mine) return row.rank;
  return 0;
}

/* 1위를 지킨 주에 붙는 팬 보너스. 차트가 숫자로만 존재하면 아무것도
   바꾸지 않는 장식이 되므로, 실제로 값이 있어야 한다. 크지는 않다 —
   1위는 잘 만든 결과이지 잘 만드는 방법이 아니다. */
export const CHART_FAN_BONUS = 0.06;
