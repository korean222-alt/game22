/* 시상식과 게임덱스.

   달력에 정기적으로 서는 두 개의 행사다. 둘 다 같은 이유로 있다: 게임을
   출시하고 나면 그 게임은 판매 곡선이 되어 오른쪽 카드로 밀려나고, 그
   뒤로는 아무 일도 일어나지 않았다. 만든 것에 대해 **바깥이 반응하는
   순간**이 달력 위에 있어야 한다.

     · 시상식 (매달)   지난 한 달에 낸 게임을 축별로 심사한다. 재미상,
                       발상상 같은 부문이 있고 기준을 넘으면 상을 준다.
     · 게임덱스 (두 달) 부스를 내고 팬을 모은다. 예산을 얼마나 쓸지 고르고,
                       방문자 수만큼 팬과 다운로드 버프를 받는다.

   순수 모듈이다. 심사와 계산만 하고 Game 을 건드리지 않는다. */

import { STATS, STAT_KO } from './data.js';
import { funScore } from './project.js';

/* ══════════════════════ 매달 시상식 ══════════════════════

   부문은 게임의 다섯 축에 '재미' 를 더한 여섯 개다. 축을 그대로 부문으로
   쓰는 것이 중요하다 — 개발 중에 보던 막대가 곧 상의 이름이 되므로,
   "이번엔 발상상을 노려 보자" 가 실제로 조작 가능한 목표가 된다. */
export const AWARD_CATS = [
  { id: 'fun', ko: '대상', icon: '👑', of: (q) => funScore(q), desc: '올해의 게임. 모든 축의 평균이 높아야 한다' },
  { id: 'craze', ko: '발상상', icon: '💡', stat: 'craze', desc: '화제성 — 아무도 생각 못 한 것' },
  { id: 'usability', ko: '조작상', icon: '🎮', stat: 'usability', desc: '조작성 — 손에 붙는 게임' },
  { id: 'impact', ko: '연출상', icon: '🎬', stat: 'impact', desc: '임팩트 — 장면이 남는 게임' },
  { id: 'social', ko: '소통상', icon: '🤝', stat: 'social', desc: '소셜 — 사람을 모으는 게임' },
  { id: 'retention', ko: '롱런상', icon: '🌱', stat: 'retention', desc: '지속성 — 오래 남는 게임' },
];

/* 수상 등급. 기준선을 얼마나 넘겼는지로 갈린다. */
export const AWARD_GRADES = [
  { id: 'gold', ko: '금상', at: 1.55, money: 260000, coins: 6, fans: 2600 },
  { id: 'silver', ko: '은상', at: 1.22, money: 130000, coins: 3, fans: 1200 },
  { id: 'bronze', ko: '동상', at: 1.00, money: 55000, coins: 1, fans: 450 },
];

/* 심사 기준선.

   해가 갈수록 올라가되 **한계가 있다**. 처음에는 1.42배씩 곱해 올렸는데,
   그러면 5년차 기준선이 528점이 되어 아무도 못 받는다 — 헤드리스 밸런스
   실행을 보면 게임의 평균 품질은 2년차에 300 근처로 올라간 뒤 그 언저리에
   머문다. 곱셈은 그 곡선을 지나쳐 버리고, 상은 2년쯤 반짝하다 사라진다.

   그래서 포화 곡선이다: 1년차 45(데뷔작 열댓 점으로는 못 받지만 그 해 안에
   손이 닿는다), 2년차 191, 3년차 266, 5년차 323, 한계 345. 실제 품질 곡선을
   조금 앞서가므로 상은 계속 "잘 만든 달" 의 표시로 남는다.

   랭크가 아니라 **연차**로 올리는 이유는, 랭크를 낮게 유지해서 상을
   쓸어담는 길을 막기 위해서다. */
export function awardBar(year, catId) {
  const y = Math.max(1, year);
  const bar = 45 + 300 * (1 - Math.exp(-(y - 1) / 1.5));
  // 대상은 그 달의 얼굴이다. 부문상보다 한 뼘 높다.
  return Math.round(bar * (catId === 'fun' ? 1.12 : 1));
}

/* 상금.

   등급의 기본값에 연차와 랭크를 곱한다. 고정하면 5년차의 금상이 주급도 안
   되는 돈이 되고, 그러면 시상식은 축하 화면일 뿐 판단에 걸리지 않는다.
   팬은 랭크로 곱하지 않는다 — 상으로 랭크를 밀어 올리는 회사가 나오면
   랭크업의 의미가 흐려진다. */
export function awardPrize(grade, year, rank) {
  const yk = 1 + (Math.max(1, year) - 1) * 0.8;
  const rk = 1 + (Math.max(1, rank) - 1) * 0.35;
  return {
    money: Math.round(grade.money * yk * rk),
    coins: grade.coins,
    fans: Math.round(grade.fans * yk),
  };
}

/* 지난 한 달에 나온 게임을 심사한다. 부문마다 최고작 하나만 본다 —
   같은 달에 두 편을 냈다고 상을 두 개 주면, 상은 다작의 보상이 된다. */
export function judge(releases, year, rank = 1) {
  const wins = [];
  for (const cat of AWARD_CATS) {
    let best = null;
    for (const r of releases) {
      const v = cat.of ? cat.of(r.quality) : (r.quality[cat.stat] || 0);
      if (!best || v > best.value) best = { release: r, value: v };
    }
    if (!best) continue;
    const bar = awardBar(year, cat.id);
    const ratio = best.value / bar;
    const grade = AWARD_GRADES.find((g) => ratio >= g.at);
    if (!grade) continue;
    wins.push({
      catId: cat.id, catKo: cat.ko, icon: cat.icon,
      title: best.release.title, releaseId: best.release.id,
      value: Math.round(best.value), bar, grade,
      prize: awardPrize(grade, year, rank),
      statKo: cat.stat ? STAT_KO[cat.stat] : '재미',
    });
  }
  // 큰 상부터. 결과 화면의 첫 줄이 가장 좋은 소식이어야 한다.
  const order = { gold: 0, silver: 1, bronze: 2 };
  wins.sort((a, b) => order[a.grade.id] - order[b.grade.id] || b.value - a.value);
  return wins;
}

export function awardTotals(wins) {
  return wins.reduce((a, w) => ({
    money: a.money + w.prize.money,
    coins: a.coins + w.prize.coins,
    fans: a.fans + w.prize.fans,
  }), { money: 0, coins: 0, fans: 0 });
}

/* 아무 상도 못 받았을 때 무엇이 모자랐는지. 통보로 끝내지 않고 다음 판의
   판단 재료를 남긴다 — 어느 축이 기준선에 가장 가까웠는지가 곧 "조금만 더
   밀면 되는 부문" 이다. */
export function nearMiss(releases, year) {
  let best = null;
  for (const cat of AWARD_CATS) {
    const bar = awardBar(year, cat.id);
    for (const r of releases) {
      const v = cat.of ? cat.of(r.quality) : (r.quality[cat.stat] || 0);
      const ratio = v / bar;
      if (!best || ratio > best.ratio) {
        best = { ratio, catKo: cat.ko, value: Math.round(v), bar, title: r.title };
      }
    }
  }
  return best;
}

/* ══════════════════════ 게임덱스 (두 달마다) ══════════════════════

   게임 전시회다. 부스를 내는 데 얼마를 쓸지 고르고, 방문자 수만큼 팬과
   다운로드 버프를 받는다. 고르는 것이 셋뿐인 이유는 이 행사가 판단이 아니라
   **투자 규모**의 문제이기 때문이다: 지금 돈이 있는가, 지금 팬이 필요한가.

   `cost` 는 자금, `coins` 는 코인. 둘 다 없는 칸이 하나 있어야 자금이 마른
   회사도 행사에 나갈 수 있다 — 나가지 못하면 팬이 안 늘고, 팬이 안 늘면
   자금이 더 마른다. */
export const EXPO_PLANS = [
  {
    id: 'small', ko: '전단지만 돌리기', icon: '📄',
    cost: 0, coins: 0, scale: 0.45,
    desc: '돈은 안 든다. 부스 없이 입구에서 전단지만 돌린다.',
  },
  {
    id: 'mid', ko: '부스 하나 내기', icon: '🏬',
    cost: 50000, coins: 0, scale: 1.0,
    desc: '평범한 부스. 시연대 두 대와 의자 몇 개.',
  },
  {
    id: 'big', ko: '거액 예산을 들여 최대규모 개최', icon: '🎪',
    cost: 0, coins: 3, scale: 2.1,
    desc: '무대와 코스프레 팀까지. 코인 3을 쓴다.',
  },
];

/* 부스 방문자.

   팬이 바닥이어도 사람은 온다(base). 팬은 제곱근으로 들어간다 — 선형이면
   후반에 방문자가 백만 단위로 뛰고, 그때부터 이 행사는 숫자 놀이가 된다.
   최근작의 재미가 곱해지는 것이 이 행사의 유일한 실력 요소다: 보여줄 게임이
   좋아야 부스에 줄이 선다. */
export function expoVisitors(plan, fans, bestFun, rnd) {
  const base = 900 + Math.sqrt(Math.max(0, fans)) * 42;
  const quality = 0.65 + Math.min(1.15, bestFun / 320);
  const noise = 0.88 + rnd() * 0.24;
  return Math.max(120, Math.round(base * plan.scale * quality * noise));
}

/* 방문자가 무엇으로 바뀌는가.

   팬은 방문자의 일부가 남는 것이고, 버프는 그 화제가 다운로드로 흐르는
   기간이다. 버프를 영구가 아니라 몇 주로 두는 것이 핵심이다 — 행사 뒤
   몇 주 안에 게임을 내야 이득이라는 뜻이 되고, 그래서 달력을 보고 개발
   일정을 잡을 이유가 생긴다. */
export function expoResult(plan, visitors, rnd) {
  const fans = Math.round(visitors * (0.16 + rnd() * 0.10));
  const dl = 1 + Math.min(0.85, plan.scale * 0.22 + visitors / 260000);
  const weeks = plan.id === 'big' ? 6 : plan.id === 'mid' ? 4 : 2;
  return { fans, dl: Math.round(dl * 100) / 100, weeks };
}

/* 방문자 수에 붙는 한 줄. 사진 속 "신기록!" 배지가 하는 일이다. */
export function expoNote(visitors, best) {
  if (visitors > best) return { ko: '신기록!', cls: 'great' };
  if (visitors > best * 0.8) return { ko: '역대급 성황', cls: 'good' };
  if (visitors < 1500) return { ko: '한산했다', cls: 'bad' };
  return { ko: '', cls: '' };
}

export { STATS };
