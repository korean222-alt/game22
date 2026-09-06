/* 주간 이벤트와 세일즈 태스크.

   The analysis doc makes two points this module answers. First, that a week
   which is only "정산 + 스태미나 회복" has no texture: the studio should be
   surprised by the world now and then, and some of those surprises should be a
   decision rather than a number. Second, that the player needs a reason to
   care about *this* week beyond the project bar — a visible checklist of
   things the company has not done yet, each paying out once.

   Everything here is pure: an event's `apply` mutates the Game it is handed and
   returns a line of text, and nothing reaches for the DOM. The UI renders
   whatever `pending` holds. */

import { GENRES, CONTENTS } from './data.js';
import { addMotivation } from './staff.js';

const pickOne = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
const won = (n) => '₩' + Math.round(n).toLocaleString('ko-KR');

/* ---------- 주간 이벤트 ----------
   `when` gates an event on the company's situation, so a server outage cannot
   fire at a studio with nothing live and a burnout cannot hit an empty roster.
   `choices` is what turns an event into a decision; an event with none simply
   happens and reports itself. */
export const EVENTS = [
  {
    id: 'viral',
    ko: '바이럴',
    icon: '📈',
    text: '한 스트리머가 「{game}」을(를) 방송에서 다뤘습니다. 신규 유입이 몰리고 있어요.',
    when: (g) => g.managed().length > 0,
    pick: (g, rnd) => pickOne(rnd, g.managed()),
    vars: (g, rnd, t) => ({ game: t ? t.title : '' }),
    apply: (g, rnd, t) => {
      const r = t || g.managed()[0];
      if (!r) return '';
      const add = Math.max(120, Math.round(r.users * (0.25 + rnd() * 0.35)));
      r.users += add;
      r.peakUsers = Math.max(r.peakUsers, r.users);
      const fans = Math.round(add * 0.08);
      g.company.fans += fans;
      return `「${r.title}」 유저 +${add.toLocaleString('ko-KR')}명 · 팬 +${fans.toLocaleString('ko-KR')}명`;
    },
  },
  {
    id: 'outage',
    ko: '서버 장애',
    icon: '🔥',
    text: '새벽에 「{game}」 서버가 내려갔습니다. 지금 대응하지 않으면 유저가 빠집니다.',
    when: (g) => g.managed().length > 0,
    pick: (g, rnd) => pickOne(rnd, g.managed()),
    vars: (g, rnd, t) => ({ game: t ? t.title : '' }),
    choices: [
      {
        ko: '긴급 점검 (₩80,000)',
        desc: '돈으로 막는다. 유저는 거의 남는다.',
        can: (g) => g.company.money >= 80000,
        apply: (g) => {
          g.spend(80000);
          return '밤샘 대응으로 이탈을 막았다.';
        },
      },
      {
        ko: '아침에 처리',
        desc: '돈은 아끼지만 유저와 팬이 빠진다.',
        apply: (g, rnd, t) => {
          const r = t || g.managed()[0];
          if (!r) return '';
          const d = Math.round(r.users * (0.18 + rnd() * 0.18));
          r.users = Math.max(0, r.users - d);
          const fans = Math.round(d * 0.05);
          g.company.fans = Math.max(0, g.company.fans - fans);
          return `「${r.title}」 유저 -${d.toLocaleString('ko-KR')}명 · 팬 -${fans.toLocaleString('ko-KR')}명`;
        },
      },
    ],
  },
  {
    id: 'rival',
    ko: '경쟁사 신작',
    icon: '⚔️',
    text: '경쟁사가 대형 신작을 냈습니다. 이번 주 시장 관심이 그쪽으로 쏠립니다.',
    when: (g) => g.managed().length > 0,
    apply: (g, rnd) => {
      let lost = 0;
      for (const r of g.managed()) {
        const d = Math.round(r.users * (0.08 + rnd() * 0.10));
        r.users = Math.max(0, r.users - d);
        lost += d;
      }
      return `운영작 유저 -${lost.toLocaleString('ko-KR')}명. 다음 작품으로 되받아치자.`;
    },
  },
  {
    id: 'investor',
    ko: '투자 제안',
    icon: '💼',
    text: '한 투자사가 지분 없이 선급금을 제안했습니다. 대신 일정이 빡빡해집니다.',
    choices: [
      {
        ko: '받는다',
        desc: '자금이 들어오지만 팀의 의욕이 떨어진다.',
        apply: (g) => {
          const amt = 60000 + g.company.rank * 30000;
          g.earn(amt);
          for (const s of g.staff) addMotivation(s, -1, g.company.rank);
          return `${won(amt)} 입금 · 팀 의욕 -1`;
        },
      },
      {
        ko: '거절한다',
        desc: '우리 페이스로 간다. 팀이 좋아한다.',
        apply: (g) => {
          for (const s of g.staff) addMotivation(s, 1, g.company.rank);
          return '팀 의욕 +1';
        },
      },
    ],
  },
  {
    id: 'burnout',
    ko: '번아웃',
    icon: '😵',
    text: '{name} 씨가 지쳐 보입니다. 요즘 계속 야근이었죠.',
    when: (g) => g.staff.length > 0,
    pick: (g, rnd) => pickOne(rnd, g.staff),
    vars: (g, rnd, t) => ({ name: t ? t.name : '' }),
    choices: [
      {
        ko: '휴가를 보낸다 (스태미나 -2)',
        desc: '이번 주 개발은 늦어지지만 의욕이 크게 오른다.',
        can: (g) => g.company.stamina >= 2,
        apply: (g, rnd, target) => {
          g.company.stamina -= 2;
          if (target) addMotivation(target, 4, g.company.rank);
          return `${target ? target.name : '팀원'} 의욕 +4`;
        },
      },
      {
        ko: '이번 주만 버텨달라',
        desc: '일정은 지키지만 의욕이 더 떨어진다.',
        apply: (g, rnd, target) => {
          if (target) addMotivation(target, -3, g.company.rank);
          return `${target ? target.name : '팀원'} 의욕 -3`;
        },
      },
    ],
  },
  {
    id: 'conference',
    ko: '업계 컨퍼런스',
    icon: '🎤',
    text: '개발자 컨퍼런스가 열립니다. 참가비는 있지만 배울 것이 많습니다.',
    choices: [
      {
        ko: '참가한다 (₩45,000 · 스태미나 -2)',
        desc: '연구 포인트와 의욕이 오른다.',
        can: (g) => g.company.money >= 45000 && g.company.stamina >= 2,
        apply: (g) => {
          g.spend(45000);
          g.company.stamina -= 2;
          const rp = 18 + g.company.rank * 4;
          g.company.researchPts += rp;
          for (const s of g.staff) addMotivation(s, 1, g.company.rank);
          return `연구 +${rp} · 팀 의욕 +1`;
        },
      },
      { ko: '이번엔 넘긴다', desc: '자금과 시간을 아낀다.', apply: () => '올해는 넘어간다.' },
    ],
  },
  {
    id: 'headhunt',
    ko: '헤드헌터',
    icon: '📇',
    text: '헤드헌터가 좋은 사람들을 소개해 주겠다고 합니다.',
    choices: [
      {
        ko: '소개비를 낸다 (₩30,000)',
        desc: '이번 지원자 명단이 크게 좋아진다.',
        can: (g) => g.company.money >= 30000,
        apply: (g) => {
          g.spend(30000);
          g.rollCandidates(1.45);
          return '직원 탭에 새 지원자가 들어왔다.';
        },
      },
      {
        ko: '됐습니다',
        desc: '지원자는 그대로 둔다.',
        apply: () => '명단은 그대로다.',
      },
    ],
  },
  {
    id: 'grant',
    ko: '콘텐츠 진흥금',
    icon: '🏛️',
    text: '지역 진흥원의 소규모 개발사 지원금에 선정되었습니다.',
    apply: (g) => {
      const amt = 40000 + g.company.rank * 18000;
      g.earn(amt);
      return `${won(amt)} 입금`;
    },
  },
  {
    id: 'fanart',
    ko: '팬 아트',
    icon: '🎨',
    text: '커뮤니티에 우리 게임 팬 아트가 올라와 화제가 됐습니다.',
    when: (g) => g.company.shipped > 0,
    apply: (g, rnd) => {
      const fans = Math.round(200 + g.company.fans * (0.02 + rnd() * 0.03));
      g.company.fans += fans;
      for (const s of g.staff) addMotivation(s, 1, g.company.rank);
      return `팬 +${fans.toLocaleString('ko-KR')}명 · 팀 의욕 +1`;
    },
  },
  {
    id: 'leak',
    ko: '시장 조사 유출',
    icon: '🔮',
    text: '다음 분기에 뜰 장르를 미리 들었습니다. {hint} 쪽이라는군요.',
    vars: (g, rnd) => ({ hint: pickOne(rnd, GENRES).ko + ' / ' + pickOne(rnd, CONTENTS).ko }),
    apply: (g) => {
      g.company.researchPts += 12;
      return '연구 +12. 소문은 소문일 뿐이지만.';
    },
  },
  {
    id: 'awards',
    ko: '인디 어워드',
    icon: '🏆',
    text: '우리 회사가 올해의 신인 스튜디오 후보에 올랐습니다.',
    when: (g) => g.company.shipped >= 3,
    apply: (g) => {
      g.company.coins += 3;
      const fans = Math.round(400 + g.company.fans * 0.03);
      g.company.fans += fans;
      return `코인 +3 · 팬 +${fans.toLocaleString('ko-KR')}명`;
    },
  },
  {
    id: 'stray',
    ko: '문 앞의 상자',
    icon: '📦',
    text: '아침에 나와 보니 사무실 문 앞에 상자가 하나 놓여 있습니다. 안에서 뭔가 움직입니다.',
    choices: [
      {
        ko: '열어 본다',
        desc: '도우미 한 명이 합류할지도 모른다.',
        apply: (g) => {
          const r = g.grantHelper(1, '');
          return `${r.def.icon} ${r.def.ko} ${r.isNew ? '합류!' : `레벨 ${r.level}`}`;
        },
      },
      {
        ko: '경비실에 맡긴다',
        desc: '남의 물건일지도 모른다. 대신 인사는 잘 받는다.',
        apply: (g) => {
          for (const s of g.staff) addMotivation(s, 1, g.company.rank);
          return '팀 의욕 +1';
        },
      },
    ],
  },
  {
    id: 'devroom',
    ko: '개발실의 인기척',
    icon: '👀',
    text: '아무도 없는 개발실에서 자꾸 소리가 납니다. 누가 밤새 일을 도와주고 간 것 같기도 하고.',
    when: (g) => g.company.shipped > 0,
    apply: (g) => {
      const r = g.grantHelper(1.15, '');
      return `${r.def.icon} ${r.def.ko} ${r.isNew ? '합류!' : `레벨 ${r.level}`} — ${r.def.skill.desc}`;
    },
  },
  {
    id: 'aircon',
    ko: '에어컨 고장',
    icon: '🥵',
    text: '한여름에 사무실 에어컨이 멈췄습니다.',
    choices: [
      {
        ko: '바로 고친다 (₩25,000)',
        desc: '아무 일도 없었던 것처럼.',
        can: (g) => g.company.money >= 25000,
        apply: (g) => { g.spend(25000); return '쾌적한 사무실이 돌아왔다.'; },
      },
      {
        ko: '선풍기로 버틴다',
        desc: '팀 의욕이 떨어진다.',
        apply: (g) => {
          for (const s of g.staff) addMotivation(s, -2, g.company.rank);
          return '팀 의욕 -2';
        },
      },
    ],
  },
];

/* Which events could fire right now, and one of them. Kept separate from the
   week tick so the balance harness can ask the same question.

   `pick` runs FIRST and its result is handed to both `vars` and `apply`. An
   event that names one person in its text and then hits a different one reads
   as a bug even though the numbers are fine, so there is exactly one subject
   and everything downstream is given it. */
export function rollEvent(game, rnd) {
  const pool = EVENTS.filter((e) => !e.when || e.when(game));
  if (!pool.length) return null;
  const def = pool[Math.floor(rnd() * pool.length)];
  const target = def.pick ? def.pick(game, rnd) : null;
  const vars = def.vars ? def.vars(game, rnd, target) : {};
  const text = String(def.text || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : ''));
  return { id: def.id, ko: def.ko, icon: def.icon, text, def, target };
}

/* ---------- 세일즈 태스크 ----------
   The doc's `Sales Tasks`: a standing list of things the company has not done
   yet, each paying out once. It exists to give a week a goal that is not "make
   the bar go down" — and to teach the systems by rewarding the first use of
   each one. */
export const TASKS = [
  { id: 'ship1', ko: '첫 게임을 출시한다', done: (g) => g.company.shipped >= 1, reward: { coins: 3 } },
  { id: 'ship5', ko: '게임 5작품 출시', done: (g) => g.company.shipped >= 5, reward: { money: 120000 } },
  { id: 'ship15', ko: '게임 15작품 출시', done: (g) => g.company.shipped >= 15, reward: { coins: 12 } },
  { id: 'hire1', ko: '직원을 한 명 채용한다', done: (g) => g.staff.length > 5, reward: { money: 40000 } },
  { id: 'team8', ko: '직원 8명을 모은다', done: (g) => g.staff.length >= 8, reward: { research: 30 } },
  { id: 'crit24', ko: '평론가 24점 이상 받기', done: (g) => g.history.some((h) => h.criticTotal >= 24), reward: { research: 25 } },
  { id: 'crit32', ko: '명예의 전당 (32점)', done: (g) => g.releases.some((r) => r.hallOfFame), reward: { coins: 8 } },
  { id: 'clean', ko: '버그 0개로 출시', done: (g) => g.releases.some((r) => r.bugs === 0), reward: { research: 40 } },
  { id: 'combo10', ko: '조합 10개 발견', done: (g) => Object.keys(g.company.discovered || {}).length >= 10, reward: { research: 45 } },
  { id: 'combo30', ko: '조합 30개 발견', done: (g) => Object.keys(g.company.discovered || {}).length >= 30, reward: { coins: 10 } },
  { id: 'great', ko: '환상의 조합으로 출시', done: (g) => g.releases.some((r) => (r.combo || 0) >= 1.55), reward: { coins: 5 } },
  { id: 'trend', ko: '유행을 탄 게임 출시', done: (g) => g.releases.some((r) => r.trendHit), reward: { money: 200000 } },
  { id: 'sequel', ko: '속편을 만든다', done: (g) => g.releases.some((r) => r.seriesN > 1), reward: { research: 50 } },
  { id: 'live3', ko: '3작품 동시 운영', done: (g) => g.managed().length >= 3, reward: { coins: 6 } },
  { id: 'floor2', ko: '2층에 입주한다', done: (g) => g.company.floors >= 2, reward: { research: 35 } },
  { id: 'floor5', ko: '5층까지 확장한다', done: (g) => g.company.floors >= 5, reward: { coins: 20 } },
  { id: 'rank5', ko: '회사 랭크 5 달성', done: (g) => g.company.rank >= 5, reward: { coins: 5 } },
  { id: 'rank10', ko: '회사 랭크 10 달성', done: (g) => g.company.rank >= 10, reward: { coins: 15 } },
  { id: 'promo', ko: '직원을 한 번 전직시킨다', done: (g) => g.staff.some((s) => (s.job || '').endsWith('2') || ['director', 'techlead', 'cdirector', 'audioprod', 'architect'].includes(s.job)), reward: { research: 30 } },
  { id: 'marketing', ko: '유료 홍보로 출시한다', done: (g) => g.releases.some((r) => r.marketingId && r.marketingId !== 'none'), reward: { money: 90000 } },
  { id: 'earn10m', ko: '누적 매출 1,000만 원', done: (g) => g.company.totalEarned >= 10000000, reward: { coins: 10 } },
  { id: 'fans100k', ko: '팬 100,000명', done: (g) => g.company.fans >= 100000, reward: { coins: 12 } },
];

export function rewardText(r) {
  const bits = [];
  if (r.money) bits.push(won(r.money));
  if (r.coins) bits.push(`코인 +${r.coins}`);
  if (r.research) bits.push(`연구 +${r.research}`);
  if (r.fans) bits.push(`팬 +${r.fans.toLocaleString('ko-KR')}`);
  return bits.join(' · ');
}

export function grantReward(game, r) {
  if (r.money) game.earn(r.money);
  if (r.coins) game.company.coins += r.coins;
  if (r.research) game.company.researchPts += r.research;
  if (r.fans) game.company.fans += r.fans;
}
