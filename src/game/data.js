/* Static game data: jobs, genres, contents, methods, platforms, ranks.

   Balance numbers live here and nowhere else, so tuning the game never means
   touching simulation code. Nothing in this file imports anything — it is
   plain data plus a few pure lookups. */

/* ---------- the five quality axes (원작 준수) ---------- */
export const STATS = ['craze', 'usability', 'impact', 'social', 'retention'];
export const STAT_KO = {
  craze: '화제성', usability: '조작성', impact: '임팩트',
  social: '소셜', retention: '지속성',
};

/* ---------- jobs ----------
   `contrib` is which quality axes this job pushes during a development battle,
   straight from the original: programmers drive craze + usability, designers
   impact, sound craze + impact, networkers social + retention. Planners feed
   the proposal grade instead of the battle. */
export const JOBS = {
  planner: {
    ko: '기획자', tier: 0, next: 'planner2', cost: 900,
    contrib: {}, proposal: 1.0,
    base: { plan: 14, prog: 4, graph: 5, sound: 4, social: 6 },
  },
  planner2: {
    ko: '시니어 기획자', tier: 1, next: 'director', cost: 900,
    contrib: { impact: 0.35 }, proposal: 1.8,
    base: { plan: 26, prog: 7, graph: 9, sound: 7, social: 11 },
  },
  director: {
    ko: '디렉터', tier: 2, next: null, cost: 900,
    contrib: { impact: 0.6, craze: 0.3 }, proposal: 3.0,
    base: { plan: 44, prog: 13, graph: 16, sound: 13, social: 19 },
  },

  programmer: {
    ko: '프로그래머', tier: 0, next: 'programmer2', cost: 1000,
    contrib: { craze: 0.55, usability: 1.0 }, proposal: 0.25,
    base: { plan: 5, prog: 15, graph: 4, sound: 3, social: 5 },
  },
  programmer2: {
    ko: '시니어 프로그래머', tier: 1, next: 'techlead', cost: 1000,
    contrib: { craze: 0.6, usability: 1.15 }, proposal: 0.3,
    base: { plan: 9, prog: 28, graph: 7, sound: 5, social: 9 },
  },
  techlead: {
    ko: '테크 리드', tier: 2, next: null, cost: 1000,
    contrib: { craze: 0.7, usability: 1.35, retention: 0.3 }, proposal: 0.4,
    base: { plan: 16, prog: 47, graph: 12, sound: 9, social: 15 },
  },

  designer: {
    ko: '디자이너', tier: 0, next: 'designer2', cost: 1000,
    contrib: { impact: 1.2 }, proposal: 0.4,
    base: { plan: 6, prog: 3, graph: 16, sound: 4, social: 6 },
  },
  designer2: {
    ko: '아트 디렉터', tier: 1, next: 'cdirector', cost: 1000,
    contrib: { impact: 1.4, craze: 0.2 }, proposal: 0.5,
    base: { plan: 10, prog: 6, graph: 30, sound: 7, social: 10 },
  },
  cdirector: {
    ko: '크리에이티브 디렉터', tier: 2, next: null, cost: 1000,
    contrib: { impact: 1.65, craze: 0.35 }, proposal: 0.7,
    base: { plan: 18, prog: 10, graph: 50, sound: 12, social: 17 },
  },

  sound: {
    ko: '사운드 엔지니어', tier: 0, next: 'sound2', cost: 950,
    contrib: { craze: 0.6, impact: 0.65 }, proposal: 0.3,
    base: { plan: 5, prog: 4, graph: 6, sound: 16, social: 5 },
  },
  sound2: {
    ko: '사운드 디렉터', tier: 1, next: 'audioprod', cost: 950,
    contrib: { craze: 0.72, impact: 0.78 }, proposal: 0.35,
    base: { plan: 9, prog: 7, graph: 10, sound: 30, social: 9 },
  },
  audioprod: {
    ko: '오디오 프로듀서', tier: 2, next: null, cost: 950,
    contrib: { craze: 0.9, impact: 0.95 }, proposal: 0.5,
    base: { plan: 15, prog: 12, graph: 17, sound: 50, social: 15 },
  },

  networker: {
    ko: '네트워커', tier: 0, next: 'networker2', cost: 1050,
    contrib: { social: 1.05, retention: 1.0 }, proposal: 0.3,
    base: { plan: 6, prog: 8, graph: 3, sound: 3, social: 16 },
  },
  networker2: {
    ko: '서버 엔지니어', tier: 1, next: 'architect', cost: 1050,
    contrib: { social: 1.2, retention: 1.2 }, proposal: 0.35,
    base: { plan: 10, prog: 15, graph: 6, sound: 5, social: 30 },
  },
  architect: {
    ko: '인프라 아키텍트', tier: 2, next: null, cost: 1050,
    contrib: { social: 1.45, retention: 1.5 }, proposal: 0.5,
    base: { plan: 17, prog: 25, graph: 10, sound: 9, social: 50 },
  },
};

export const JOB_ROLE = {
  planner: 'plan', planner2: 'plan', director: 'plan',
  programmer: 'dev', programmer2: 'dev', techlead: 'dev',
  designer: 'art', designer2: 'art', cdirector: 'art',
  sound: 'art', sound2: 'art', audioprod: 'art',
  networker: 'net', networker2: 'net', architect: 'net',
};

/* ---------- 직업의 무기 ----------
   개발 배틀에서 직원이 보스에게 던지는 것. 프로그래머는 노트북을,
   디자이너는 타블렛을, 사운드는 마이크를 던진다.

   순수 연출용 표지만 여기 사는 이유는 직업 정의 옆이 아니면 새 직업을
   추가할 때 반드시 빠뜨리기 때문이다 — 빠뜨리면 기본값(💥)이 나간다. */
export const JOB_WEAPON = {
  planner: '📋', planner2: '📋', director: '🗂️',
  programmer: '💻', programmer2: '💻', techlead: '🖥️',
  designer: '🖊️', designer2: '🎨', cdirector: '🖼️',
  sound: '🎤', sound2: '🎹', audioprod: '🎛️',
  networker: '📡', networker2: '📱', architect: '🗄️',
};
export const weaponFor = (job) => JOB_WEAPON[job] || '💥';

/* Which raw ability drives each job's battle damage. */
export const JOB_ABILITY = {
  planner: 'plan', planner2: 'plan', director: 'plan',
  programmer: 'prog', programmer2: 'prog', techlead: 'prog',
  designer: 'graph', designer2: 'graph', cdirector: 'graph',
  sound: 'sound', sound2: 'sound', audioprod: 'sound',
  networker: 'social', networker2: 'social', architect: 'social',
};

export const STARTING_JOBS = ['planner', 'programmer', 'designer', 'sound', 'networker'];

/* ---------- genres ----------
   `hp` scales the idea's health, `tags` drive combo affinity, and `bias`
   nudges which quality axes a genre naturally favours. */
export const GENRES = [
  { id: 'puzzle', ko: '퍼즐', hp: 0.80, tags: ['casual', 'short'], bias: { usability: 1.25, craze: 1.05 } },
  { id: 'rpg', ko: 'RPG', hp: 1.45, tags: ['story', 'long', 'grind'], bias: { impact: 1.25, retention: 1.20 } },
  { id: 'action', ko: '액션', hp: 1.20, tags: ['fast', 'skill'], bias: { impact: 1.20, usability: 1.10 } },
  { id: 'sim', ko: '시뮬레이션', hp: 1.25, tags: ['long', 'build'], bias: { retention: 1.25, social: 1.05 } },
  { id: 'card', ko: '카드', hp: 1.10, tags: ['collect', 'gacha'], bias: { social: 1.20, retention: 1.15 } },
  { id: 'shoot', ko: '슈팅', hp: 1.05, tags: ['fast', 'skill'], bias: { impact: 1.15, usability: 1.15 } },
  { id: 'racing', ko: '레이싱', hp: 1.15, tags: ['fast', 'skill'], bias: { impact: 1.20, craze: 1.05 } },
  { id: 'rhythm', ko: '리듬', hp: 1.10, tags: ['skill', 'music'], bias: { craze: 1.25, impact: 1.10 } },
  { id: 'board', ko: '보드', hp: 0.85, tags: ['casual', 'social'], bias: { social: 1.25, usability: 1.10 } },
  { id: 'sports', ko: '스포츠', hp: 1.20, tags: ['skill', 'social'], bias: { social: 1.15, impact: 1.10 } },
  { id: 'adv', ko: '어드벤처', hp: 1.30, tags: ['story', 'long'], bias: { impact: 1.30, craze: 1.05 } },
  { id: 'strategy', ko: '전략', hp: 1.40, tags: ['long', 'build', 'social'], bias: { retention: 1.25, social: 1.15 } },
  { id: 'raise', ko: '육성', hp: 1.15, tags: ['collect', 'long'], bias: { retention: 1.30, social: 1.10 } },
  { id: 'idle', ko: '방치형', hp: 0.90, tags: ['casual', 'long'], bias: { retention: 1.35, usability: 1.15 } },
  { id: 'mmo', ko: 'MMO', hp: 1.75, tags: ['long', 'social', 'grind'], bias: { social: 1.40, retention: 1.35 } },
  { id: 'party', ko: '파티게임', hp: 0.95, tags: ['casual', 'social'], bias: { social: 1.35, craze: 1.15 } },
];

/* ---------- game content (the mid-battle idea card) ---------- */
export const CONTENTS = [
  { id: 'fantasy', ko: '판타지', tags: ['story', 'collect'], bias: { impact: 1.15 } },
  { id: 'scifi', ko: 'SF', tags: ['story', 'fast'], bias: { impact: 1.20 } },
  { id: 'animal', ko: '동물', tags: ['casual', 'collect'], bias: { craze: 1.20 } },
  { id: 'cooking', ko: '요리', tags: ['casual', 'build'], bias: { usability: 1.15, social: 1.10 } },
  { id: 'school', ko: '학원', tags: ['story', 'social'], bias: { social: 1.25 } },
  { id: 'zombie', ko: '좀비', tags: ['fast', 'skill'], bias: { impact: 1.25 } },
  { id: 'sengoku', ko: '전국시대', tags: ['long', 'grind'], bias: { retention: 1.20 } },
  { id: 'space', ko: '우주', tags: ['story', 'build'], bias: { impact: 1.15, retention: 1.10 } },
  { id: 'ocean', ko: '바다', tags: ['casual', 'build'], bias: { craze: 1.10, retention: 1.10 } },
  { id: 'idol', ko: '아이돌', tags: ['music', 'collect', 'social'], bias: { craze: 1.30, social: 1.20 } },
  { id: 'mystery', ko: '미스터리', tags: ['story', 'short'], bias: { impact: 1.20, craze: 1.10 } },
  { id: 'magic', ko: '마법', tags: ['story', 'collect'], bias: { impact: 1.15, craze: 1.10 } },
  { id: 'robot', ko: '로봇', tags: ['fast', 'build'], bias: { impact: 1.25, usability: 1.05 } },
  { id: 'farm', ko: '농장', tags: ['casual', 'build', 'long'], bias: { retention: 1.30, social: 1.15 } },
  { id: 'dungeon', ko: '던전', tags: ['grind', 'long', 'skill'], bias: { retention: 1.20, impact: 1.10 } },
  /* 예전 id 는 'sports2', 이름은 '스포츠' 였다. 장르에도 '스포츠' 가 있어서
     스포츠 게임의 소재 카드에 '스포츠' 가 또 떴다 — 화면만 보면 버그다.
     소재는 장르보다 좁아야 뜻이 서므로 종목 하나로 좁혔다. 옛 세이브는
     state.js 의 CONTENT_ALIAS 가 옮겨준다. */
  { id: 'soccer', ko: '축구', tags: ['skill', 'social'], bias: { social: 1.15, usability: 1.10 } },
  { id: 'dino', ko: '공룡', tags: ['story', 'collect', 'build'], bias: { impact: 1.25, craze: 1.15 } },
  { id: 'pirate', ko: '해적', tags: ['story', 'build', 'collect'], bias: { impact: 1.15, retention: 1.10 } },
  { id: 'ninja', ko: '닌자', tags: ['fast', 'skill', 'grind'], bias: { impact: 1.20, usability: 1.10 } },
  { id: 'cafe', ko: '카페', tags: ['casual', 'build', 'social'], bias: { social: 1.20, retention: 1.15 } },
  { id: 'horror', ko: '공포', tags: ['story', 'short', 'skill'], bias: { impact: 1.30, craze: 1.15 } },
];

export const CONTENT_BY_ID = new Map(CONTENTS.map((c) => [c.id, c]));

/* ---------- 소재 뽑기 ----------
   소재는 이제 처음부터 다 열려 있지 않다. 여섯 개로 시작하고 나머지는
   🪙 코인으로 뽑는다.

   코인은 그 전까지 쌓이기만 하고 쓸 데가 없는 화폐였고, 소재는 반대로
   전부 열려 있어서 "무엇을 만들 수 있게 되었나" 가 성장으로 읽히지
   않았다. 둘을 붙이면 한쪽은 쓸 곳이, 다른 한쪽은 뽑을 이유가 생긴다.

   기본 여섯은 장르 전체와 두루 무난한 것들로 골랐다. 어느 장르를 뽑아도
   카드 세 장이 채워지고, 그중 하나는 쓸 만해야 하기 때문이다. */
export const CONTENT_BASE = ['fantasy', 'scifi', 'animal', 'cooking', 'school', 'zombie'];
export const CONTENT_GACHA_COST = 3;      // 🪙 한 번 뽑는 값
export const CONTENT_GACHA_DUP = { research: 10, coins: 1 };   // 다 모았을 때의 위로금

/* ---------- development method (the second idea card) ---------- */
export const METHODS = [
  { id: 'fast', ko: '단기 집중', desc: 'HP를 크게 깎지만 품질은 덜 오른다', dmg: 1.45, quality: 0.80 },
  { id: 'quality', ko: '품질 우선', desc: '느리지만 품질이 크게 오른다', dmg: 0.75, quality: 1.45 },
  { id: 'balance', ko: '밸런스', desc: '무난하게 간다', dmg: 1.0, quality: 1.0 },
  { id: 'experimental', ko: '실험적', desc: '결과가 크게 흔들린다', dmg: 1.1, quality: 1.1, variance: 0.55 },
  { id: 'community', ko: '커뮤니티 주도', desc: '소셜과 지속성이 크게 오른다', dmg: 0.9, quality: 1.05, focus: { social: 1.5, retention: 1.4 } },
  { id: 'polish', ko: '완성도 다듬기', desc: '버그가 크게 줄어든다', dmg: 0.85, quality: 1.15, bugCut: 0.45 },
];

/* Hand-authored standout pairings. Everything else falls back to tag overlap,
   so the table can grow without the combo maths changing. */
export const MASTER_COMBOS = [
  ['rpg', 'fantasy'], ['rpg', 'dungeon'], ['card', 'idol'], ['card', 'fantasy'],
  ['rhythm', 'idol'], ['sim', 'farm'], ['idle', 'farm'], ['mmo', 'fantasy'],
  ['strategy', 'sengoku'], ['action', 'zombie'], ['shoot', 'space'], ['racing', 'robot'],
  ['puzzle', 'animal'], ['adv', 'mystery'], ['raise', 'animal'], ['party', 'school'],
  ['board', 'school'], ['sports', 'soccer'], ['sim', 'cooking'], ['adv', 'space'],
  ['adv', 'dino'], ['raise', 'dino'], ['sim', 'cafe'], ['idle', 'cafe'],
  ['action', 'ninja'], ['strategy', 'pirate'], ['adv', 'pirate'], ['adv', 'horror'],
  ['shoot', 'robot'], ['rpg', 'magic'], ['mmo', 'dungeon'], ['party', 'animal'],
];

/* Pairings that actively fight each other. Tag overlap alone never produces a
   really bad score — every content shares SOMETHING with every genre — so the
   "이건 아니지" half of the discovery game has to be written down too. A puzzle
   game about dungeon crawling, an adventure about a football league: the player
   should be able to feel these are wrong and learn it by shipping one. */
export const BAD_COMBOS = [
  ['puzzle', 'dungeon'], ['puzzle', 'sengoku'], ['puzzle', 'horror'], ['puzzle', 'zombie'],
  ['adv', 'soccer'], ['adv', 'cooking'], ['adv', 'cafe'],
  ['mmo', 'mystery'], ['mmo', 'horror'], ['idle', 'zombie'], ['idle', 'horror'],
  ['rhythm', 'dungeon'], ['rhythm', 'sengoku'], ['rhythm', 'dino'],
  ['board', 'zombie'], ['board', 'horror'], ['racing', 'cooking'], ['racing', 'idol'],
  ['sports', 'magic'], ['sports', 'horror'], ['shoot', 'cafe'], ['shoot', 'farm'],
  ['sim', 'ninja'], ['card', 'cafe'], ['raise', 'zombie'],
];

const MASTER_SET = new Set(MASTER_COMBOS.map(([a, b]) => a + '|' + b));
const BAD_SET = new Set(BAD_COMBOS.map(([a, b]) => a + '|' + b));

/* Compatibility in [0.55, 2.0]. Tag overlap is the floor, a listed masterpiece
   pairing is what actually makes a hit, and a listed clash is what makes a
   flop. The spread has to be wide in BOTH directions or "발견"은 상향 조정일
   뿐, 진짜 선택이 되지 않는다. */
export function comboScore(genreId, contentId) {
  const g = GENRES.find((x) => x.id === genreId);
  const c = CONTENTS.find((x) => x.id === contentId);
  if (!g || !c) return 1;
  const key = genreId + '|' + contentId;
  let s = 0.85;
  const shared = g.tags.filter((t) => c.tags.includes(t)).length;
  s += shared * 0.16;
  if (MASTER_SET.has(key)) s += 0.55;
  if (BAD_SET.has(key)) s -= 0.45;
  return Math.min(2.0, Math.max(0.55, s));
}

export function comboLabel(score) {
  if (score >= 1.55) return { ko: '환상의 조합', cls: 'great' };
  if (score >= 1.25) return { ko: '좋은 조합', cls: 'good' };
  if (score >= 1.0) return { ko: '무난한 조합', cls: 'ok' };
  if (score >= 0.82) return { ko: '아쉬운 조합', cls: 'bad' };
  return { ko: '안 맞는 조합', cls: 'bad' };
}

/* What a content card shows before the company has ever shipped that pairing.
   The doc is explicit that the combo game is a DISCOVERY game: telling the
   player the answer up front removes the only reason to experiment. */
export const UNKNOWN_COMBO = { ko: '미지의 조합', cls: 'ok' };

/* ---------- platforms ---------- */
/* `market` 은 그 플랫폼에 사람이 몇 명이나 있는가다. 규칙에는 쓰이지 않고
   화면에만 뜨지만, 임의의 숫자는 아니다 — `fans`(초기 유입 배율)를 사람
   수로 환산한 값이라 "SNS 가 스마트폰보다 넓다" 는 표시와 실제 유입 계산이
   같은 방향을 가리킨다. `share` 는 그 시장의 구매력(ARPU 배율)이다.
   어느 플랫폼으로 낼지가 고민이 되려면 넓이와 구매력이 따로 보여야 한다. */
export const PLATFORMS = [
  { id: 'feature', ko: '피처폰', rank: 0, fans: 0.80, hp: 0.62, cost: 9000, share: 0.55, market: 6_100_000, note: '누구나 가지고 있지만 지갑은 얇다.' },
  { id: 'smart', ko: '스마트폰', rank: 2, fans: 1.00, hp: 1.60, cost: 42000, share: 1.00, market: 21_000_000, note: '표준. 넓이도 구매력도 무난하다.' },
  { id: 'sns', ko: 'SNS 플랫폼', rank: 5, fans: 1.35, hp: 2.60, cost: 95000, share: 1.25, market: 34_000_000, note: '입소문이 가장 빠르게 퍼진다.' },
  { id: 'tablet', ko: '태블릿', rank: 9, fans: 1.20, hp: 3.20, cost: 160000, share: 1.10, market: 27_000_000, note: '오래 붙잡고 하는 게임에 맞는다.' },
  { id: 'console', ko: '콘솔 크로스', rank: 14, fans: 1.60, hp: 5.00, cost: 340000, share: 1.45, market: 52_000_000, note: '한 명이 쓰는 돈이 크다. 개발비도 크다.' },
  { id: 'own', ko: '자체 플랫폼', rank: 20, fans: 2.10, hp: 7.50, cost: 720000, share: 2.00, market: 96_000_000, note: '수수료가 없다. 회사가 곧 시장이다.' },
];

/* ---------- 시장 도달 ----------
   출시한 게임이 몇 명에게 가 닿는가. 이 세 숫자가 이 게임의 수지타산을
   통째로 정한다.

   예전에는 도달이 품질에 **정비례**했고, 그 위에 팬 배율(최대 9배)과
   ARPU 의 소셜 보정(최대 2.5배)이 다시 품질을 따라 곱해졌다. 결과적으로
   매출이 품질의 세제곱처럼 움직여서, 데뷔작은 개발비의 13% 를 벌고
   3년차는 개발비의 100배를 벌었다. 개발비가 고정인데 매출만 그렇게
   벌어지면 초반은 아무리 잘해도 적자고 후반은 아무렇게나 해도 흑자다 —
   어느 쪽도 선택이 되지 않는다.

     base  아무리 못 만들어도 이만큼은 팔린다. 데뷔작이 개발비를 넘길 수
           있게 하는 바닥이고, 후반에는 무시할 만한 크기가 된다.
     k·p   품질이 끌어오는 몫. p 가 1보다 작아서 품질이 두 배면 도달은
           1.5배쯤 는다 — 잘 만들수록 이득이지만 자릿수가 바뀌지는 않는다.

   품질 10 → 5,000명 / 120 → 11,000명 / 560 → 23,000명. 다섯 배 폭이다.
   나머지 차이는 플랫폼·수익모델·팬이 만든다. */
export const REACH = { base: 3400, k: 190, p: 0.62 };

/* 팬이 끌어오는 배율. 팬은 출시할 때마다 늘기만 하므로 상한이 없으면
   스스로를 먹고 자란다 — 유저가 팬을 낳고 팬이 유저를 낳는다. */
export const FAN_PULL = { cap: 4.0, per: 0.34, scale: 5000 };

/* ARPU 의 소셜 보정. 소셜이 높으면 한 사람이 더 쓴다. 예전 값(260)은
   후반에 2.5배까지 붙어서 품질의 제곱 효과를 만들던 두 번째 자리였다. */
export const ARPU_SOCIAL = 700;

/* ---------- monetisation ----------
   `cost`/`stam` 은 개발비와 착수 스태미나의 배율이다. 부분유료는 상점·과금
   서버·운영 도구를 같이 만들어야 하고, 장기운영은 거기에 몇 년치 콘텐츠
   계획까지 얹힌다 — 매출 상한이 높은 만큼 만드는 값도 비싸야, 어느 모델로
   낼지가 실제로 고민이 된다. 예전에는 셋이 같은 값이라 부분유료가 언제나
   정답이었다. */
export const MONETIZE = [
  {
    id: 'paid', ko: '유료', rank: 0,
    desc: '출시 직후 수익이 크다. 유저 수는 적다.',
    users: 0.72, arpu: 4.2, decay: 0.892,
    cost: 1.00, stam: 0,
  },
  {
    id: 'f2p', ko: '부분유료', rank: 4,
    desc: '유저가 많이 모이고 매출 상한이 높다. 개발비가 더 든다.',
    users: 1.60, arpu: 1.30, decay: 0.940,
    cost: 1.70, stam: 2,
  },
  {
    id: 'f2p_long', ko: '부분유료 (장기운영)', rank: 12,
    desc: '초반은 느리지만 오래 간다. 개발비가 가장 비싸다. 랭크 12부터.',
    users: 1.30, arpu: 1.95, decay: 0.976,
    cost: 2.60, stam: 4,
  },
];

/* ---------- company rank ----------
   Rank gates the cash cap, headcount, motivation cap and unlockable floors,
   which is how the original paces its systems. */
export function rankInfo(rank) {
  const r = Math.max(1, rank);
  return {
    rank: r,
    cashCap: Math.round(2_000_000 * Math.pow(1.42, r - 1)),
    // Seven at rank 1, against five founders: hiring has to be possible on the
    // first day or the 채용 screen is a wall of "정원 초과" and the whole system
    // reads as broken.
    staffCap: Math.min(26, 7 + Math.floor(r * 0.9)),
    motivationCap: Math.min(60, 5 + r * 2),
    floors: Math.min(5, 1 + Math.floor((r - 1) / 4)),
    // Stamina has to cover development AND staff training AND proposals, and
    // it is the real throughput limiter: every point is another battle turn,
    // so this curve decides how many games a year the studio can ship.
    // 실시간 회복(3분/1점)이 생기면서 상한을 한 칸 올렸다. 크게 올리면
    // 처리량이 통째로 움직인다 — 8 → 14 로 올려 봤더니 5년차 출시작이
    // 125편(기준 65~83)이 되고 금상이 18개 나왔다. 지금 값은 랭크 1 에서
    // 11 (예전 9), 랭크 10 에서 20 (예전 18) 이다.
    staminaMax: Math.min(46, 10 + Math.floor(r * 1.05)),
    managedCap: 3,
  };
}

/* Rank thresholds: ~10k fans by rank 5, ~255k by 10, ~7M by 15. Tuned against
   the headless balance run: a studio reaches rank 2-3 in its first year (so
   year one still visibly moves), the platform ladder opens through the middle
   years, and the twenties stay a long career away rather than being exhausted
   before the second Christmas. */
export const RANK_UP_FANS = (rank) => Math.round(900 * Math.pow(2.2, rank - 1));

/* ---------- 창업 지원금 ----------
   A studio now opens with no staff and no furniture, so the opening move is
   spending this on desks and the people to sit at them. Sized against the
   opening costs rather than picked round: three basic desks (₩27,000), three
   rookie hires (about ₩20,000), a feature-phone project (₩25,000) and a couple
   of months of payroll still leaves room to make the office liveable — and not
   so much room that the first decision is free. */
export const STARTUP_GRANT = 100000;

/* ---------- 긴급 지원금 ----------
   The design rule is that a player is never permanently stuck. A studio that
   runs its balance negative gets rescued rather than deleted — but each rescue
   is smaller than the last and costs the roster's morale, so living on them is
   visibly a losing way to play. The floor means there is always a next chance.

   Contracts remain the cheap way out: they cost stamina, not pride. */
export const RESCUE_FIRST = 120000;
export const RESCUE_DECAY = 0.72;
export const RESCUE_FLOOR = 30000;

/* `need` is what it actually costs this studio to get moving again — the
   cheapest project it could start plus a month of running costs. Without it the
   grants shrink below the price of a game and the studio ends up permanently
   solvent and permanently unable to do anything, which is the same dead end as
   bankruptcy with extra steps. The headless sloppy-play run is what caught it. */
export function rescueAmount(count, need = 0) {
  const decayed = Math.max(RESCUE_FLOOR, RESCUE_FIRST * Math.pow(RESCUE_DECAY, count));
  return Math.round(Math.max(decayed, need) / 1000) * 1000;
}

/* Morale is the price. It rises with each rescue: the first is a lifeline, the
   fourth is the staff reading about the company in the news. */
export function rescueMorale(count) { return -(1 + Math.min(3, count)); }

/* ---------- 초봉 할인 ----------
   Rank 1-2 applicants are graduates: cheaper to hire and cheaper to keep, so a
   studio with a grant and no staff can actually field a team on day one. The
   discount disappears as the company becomes somewhere people want to work. */
export function hireDiscount(rank) {
  if (rank <= 1) return 0.40;
  if (rank === 2) return 0.60;
  if (rank === 3) return 0.80;
  return 1;
}

/* ---------- items ---------- */
/* `level` is how many levels the gift is worth; the price is derived from the
   recipient's current level rather than being flat, so late-career growth is
   the money sink the original makes it. `cost` is only a per-item multiplier. */
export const ITEMS = [
  { id: 'coffee', ko: '고급 원두', cost: 0.7, level: 1, motivation: 1 },
  { id: 'book', ko: '기술 서적', cost: 0.9, level: 2, motivation: 0 },
  { id: 'chair', ko: '인체공학 의자', cost: 1.1, level: 2, motivation: 2 },
  { id: 'headset', ko: '스튜디오 헤드셋', cost: 1.3, level: 3, motivation: 1 },
  { id: 'monitor', ko: '4K 모니터', cost: 1.5, level: 3, motivation: 2 },
  { id: 'trip', ko: '컨퍼런스 참가권', cost: 2.4, level: 5, motivation: 4 },
];

/* ---------- names ---------- */
export const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '홍'];
export const GIVEN = ['지훈', '서연', '민준', '하윤', '도윤', '지우', '예준', '수아', '시우', '지아', '주원', '유진', '건우', '채원', '현우', '다은', '준서', '소율', '지호', '나윤', '태윤', '리아', '승민', '가은'];

export const TITLE_WORDS_A = ['드림', '스타', '판타', '몬스터', '크리스탈', '네오', '무한', '리틀', '그랜드', '하이퍼', '미라클', '오르카', '루나', '블레이즈', '코스믹'];
export const TITLE_WORDS_B = ['사가', '월드', '퀘스트', '타워', '러시', '스토리', '마스터', '리그', '아레나', '킹덤', '파티', '크래프트', '레전드', '체이서'];

/* ═══════════════════════════════════════════════════════════════════════════
   Systems from the design analysis: traits, research, marketing, contracts,
   market trends and office expansion. Each exists to answer one of the doc's
   points about why the loop keeps its grip.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ---------- 직원 특성 ----------
   The doc is explicit that staff must have clear strengths AND weaknesses, or
   the roster stops being a decision. Each trait is a visible reason to pick one
   person over another for a given project. */
export const TRAITS = {
  workaholic: { ko: '일벌레', desc: '데미지 +18%, 의욕이 잘 안 오른다', dmg: 1.18, moodGain: 0.4 },
  perfectionist: { ko: '완벽주의', desc: '품질 +22%, 데미지 -12%', quality: 1.22, dmg: 0.88 },
  spark: { ko: '번뜩임', desc: '크리티컬 확률 +12%p', crit: 0.12 },
  veteran: { ko: '베테랑', desc: '버그를 크게 줄인다', bugCut: 0.35 },
  cheerful: { ko: '분위기 메이커', desc: '팀 전체 의욕 유지에 도움', teamMood: 1 },
  cheap: { ko: '박봉 감수', desc: '급여 -30%', salary: 0.7 },
  star: { ko: '스타 개발자', desc: '출시 시 팬 +15%', fans: 1.15, salary: 1.25 },
  genreFan: { ko: '장르 덕후', desc: '특정 장르에서 +35%', genreBonus: 1.35 },
  nightowl: { ko: '올빼미', desc: '데미지 +25%, 버그 +40%', dmg: 1.25, bugs: 1.4 },
  mentor: { ko: '멘토', desc: '아이템 육성 효과 +50%', train: 1.5 },
};
export const TRAIT_IDS = Object.keys(TRAITS);

/* ---------- 연구 포인트 ----------
   The long-horizon currency. Development produces it; it buys permanent
   capability rather than a one-off boost, which is what separates it from cash. */
export const RESEARCH = [
  { id: 'genre', ko: '장르 연구', desc: '기획서 등급이 오를 확률 증가', cost: 40, max: 8 },
  { id: 'tools', ko: '개발 도구', desc: '모든 팀원 데미지 +6%/단계', cost: 55, max: 8 },
  { id: 'qa', ko: 'QA 체계', desc: '완성 시 버그 -12%/단계', cost: 45, max: 6 },
  { id: 'market', ko: '시장 조사', desc: '초기 유저 +8%/단계', cost: 60, max: 8 },
  { id: 'ops', ko: '운영 노하우', desc: '유저 이탈 완화', cost: 70, max: 6 },
];

export function researchEffect(levels) {
  const L = levels || {};
  return {
    grade: (L.genre || 0) * 0.14,
    dmg: 1 + (L.tools || 0) * 0.06,
    bugs: Math.max(0.25, 1 - (L.qa || 0) * 0.12),
    users: 1 + (L.market || 0) * 0.08,
    decay: (L.ops || 0) * 0.0035,
  };
}

export function researchCost(id, level) {
  const r = RESEARCH.find((x) => x.id === id);
  if (!r) return Infinity;
  return Math.round(r.cost * Math.pow(1.55, level));
}

/* ---------- 홍보 ----------
   Buys expectation before launch. The doc lists it as a distinct managed axis:
   you can win users with quality, or with money, and the trade should be legible. */
export const MARKETING = [
  { id: 'none', ko: '홍보 없음', cost: 0, users: 1.0, fans: 1.0, desc: '입소문에 맡긴다' },
  { id: 'sns', ko: 'SNS 바이럴', cost: 0.55, users: 1.26, fans: 1.15, desc: '가성비가 좋다' },
  { id: 'influencer', ko: '인플루언서', cost: 1.4, users: 1.52, fans: 1.35, desc: '화제성이 크게 오른다' },
  { id: 'tv', ko: 'TV / 옥외 광고', cost: 3.0, users: 1.90, fans: 1.70, desc: '비싸지만 확실하다' },
];
/* 값이 세다. 홍보는 **잘 팔릴 게임에 거는 내기**여야 한다 — 개발비의
   몇 배가 나가므로, 매출이 개발비의 다섯 배쯤 나오는 게임에 걸면 남고
   두 배밖에 못 내는 게임에 걸면 손해다. 예전에는 어느 게임에 걸어도
   무조건 이득이라 고민할 자리가 아니었다. */
/* Cost is a multiple of the project's development cost, so promotion always
   scales with the size of what you are promoting. */
/* ---------- 초반 수익의 천장 ----------

   데뷔작 한 편이 개발비의 열 배를 벌면, 그 뒤의 모든 판단은 의미가 없다 —
   무엇을 만들든 돈이 남으니 상점도 계약도 연구도 볼 이유가 없고, 회사를
   키우는 게임이 첫 게임에서 끝난다.

   그래서 **초반에는 한 편이 개발비의 1.5배까지만 남긴다.** 이 배수는 랭크가
   오를수록 풀리고, 랭크 7 부터는 아예 걸리지 않는다. 회사를 키우는 것이
   돈을 버는 유일한 길이 되게 하는 장치다.

   홍보비는 천장의 기준에 같이 들어간다. 홍보를 건 게임이 그만큼 더 벌 수
   없다면 홍보는 그냥 손해이고, 그러면 그 칸은 누르지 않는 칸이 된다. */
export const EARLY_RETURN = { base: 1.5, perRank: 0.6, freeRank: 7 };

export function returnCap(rank) {
  const r = Math.max(1, rank || 1);
  if (r >= EARLY_RETURN.freeRank) return Infinity;
  return EARLY_RETURN.base + (r - 1) * EARLY_RETURN.perRank;
}

export function marketingCost(mk, devCost) {
  return Math.round(devCost * mk.cost);
}

/* ---------- 계약 일감 ----------
   The doc's anti-bankruptcy rule: never let a player be permanently stuck at
   zero. Contracts are dull, safe money that always exists. */
export const CONTRACTS = [
  { id: 'port', ko: '이식 외주', weeks: 1, stamina: 3, pay: 26000, research: 4 },
  { id: 'asset', ko: '에셋 제작 대행', weeks: 1, stamina: 2, pay: 17000, research: 2 },
  { id: 'qa', ko: 'QA 대행', weeks: 1, stamina: 2, pay: 14000, research: 6 },
  { id: 'server', ko: '서버 구축 대행', weeks: 1, stamina: 4, pay: 42000, research: 8 },
];
/* Contract pay scales with company rank so it stays a floor, not a career. */
export function contractPay(c, rank) {
  return Math.round(c.pay * Math.pow(1.28, rank - 1));
}

/* ---------- 시장 유행 ----------
   One genre and one content run hot each quarter. The doc calls for exactly
   this: a reason a known-good combo is not always the right answer. */
export const TREND_BONUS = 1.55;
export const TREND_PENALTY = 0.78;

/* ---------- 사무실 ----------
   Floors are bought, not granted. Rank says what you are allowed to occupy;
   money says what you actually do occupy. */
export function floorCost(n) {
  // n is the floor being bought, 1-indexed: the second floor is n = 2. The
  // ratio is steep on purpose: the top floor should be a thing a studio saves
  // for across a couple of years, not a rounding error on one good launch.
  return Math.round(320000 * Math.pow(3.0, n - 2));
}
export const FLOOR_UPKEEP = 9000;

/* ═══════════════════════════════════════════════════════════════════════════
   개발 = 보스전 · 상점과 가방 · 직원 체력 · 도감
   ═══════════════════════════════════════════════════════════════════════════ */

/* ---------- 직원 체력 ----------
   원작의 하트 게이지를 규칙으로 옮긴 것. 개발 턴마다 팀원이 체력을 쓰고,
   보스(아이디어)의 반격이 체력을 크게 깎는다. 체력이 바닥난 직원은 데미지가
   크게 줄지만 0이 되지는 않는다 — "영구히 막히는 상태"를 만들지 않는다는
   설계 원칙 때문이다. 회복은 세 갈래: 주간 휴식, 상점 음식, 휴게실 회복. */
export const HP = {
  base: 56, perLevel: 3.2, talent: 26, perReborn: 12,
  turnCost: 0.040,        // 한 번 때릴 때 쓰는 최대 체력 비율 (한 풀로 25타)
  weekly: 0.78,           // 다음 주로 넘길 때 회복되는 비율
  tired: 0.40,            // 이 아래로 떨어지면 '지침'
  minMult: 0.50,          // 체력 0에서의 데미지 배율 (0이 되면 게임이 멈춘다)
  attackEvery: 4,         // 보스가 반격하는 주기(턴)
  bugCap: 8,              // 반격이 남길 수 있는 버그의 상한
};

/* 숫자의 근거: 후반 프로젝트는 40턴 안팎이고 한 주에 20~38 스태미나가 나온다.
   턴당 3% + 반격을 합치면 프로젝트 하나가 체력 한 풀 반쯤을 먹고, 주간 회복은
   70% 다. 즉 **후반에는 밥을 사주는 쪽이 확실히 빠르지만, 안 사줘도 진행은
   된다.** 이 균형이 상점을 선택지로 만든다 — 없으면 세금이 된다. */

/* 체력 비율 → 데미지 배율. 0.45 위는 손해가 없고, 거기서 아래로 완만하게
   떨어진다. 배고픈 팀은 느려질 뿐 멈추지 않는다. */
export function hpMult(ratio) {
  if (ratio >= HP.tired) return 1;
  const t = Math.max(0, ratio) / HP.tired;
  return HP.minMult + (1 - HP.minMult) * t;
}

/* ---------- 보스 = 아이디어 ----------
   개발은 진행 바가 아니라 싸움이다. 장르마다 상대하는 아이디어의 성격이
   다르고, 이름과 색과 형태가 붙으면 "이번엔 뭘 잡는가"가 기억에 남는다.
   shape 는 world/boss.js 가 읽는 실루엣 종류다. */
export const BOSSES = {
  puzzle: { ko: '퍼즐 골렘', shape: 'cube', col: '#59b6d8', accent: '#ffd66e', line: '한 조각도 맞지 않는다!' },
  rpg: { ko: '대마왕 시나리오', shape: 'spike', col: '#8c5ad8', accent: '#ffcf5a', line: '설정만 300페이지다!' },
  action: { ko: '콤보 야수', shape: 'spike', col: '#d85a4a', accent: '#ffe08a', line: '손맛이 안 난다!' },
  sim: { ko: '스프레드시트 크라켄', shape: 'cube', col: '#4a9a7a', accent: '#d8f06a', line: '수치가 끝없이 늘어난다!' },
  card: { ko: '확률의 신', shape: 'orb', col: '#d85a9a', accent: '#ffe08a', line: '밸런스가 무너진다!' },
  shoot: { ko: '탄막 드론', shape: 'drone', col: '#5a7ad8', accent: '#ff8a5a', line: '프레임이 떨어진다!' },
  racing: { ko: '폭주 엔진', shape: 'drone', col: '#d88a3a', accent: '#ffe08a', line: '물리가 터진다!' },
  rhythm: { ko: '박자 요괴', shape: 'orb', col: '#c95ad8', accent: '#8affd8', line: '싱크가 밀린다!' },
  board: { ko: '룰북 대왕', shape: 'cube', col: '#9a7a4a', accent: '#ffe6a0', line: '규칙이 또 늘었다!' },
  sports: { ko: '규칙의 심판', shape: 'spike', col: '#4aa85a', accent: '#ffffff', line: '판정이 애매하다!' },
  adv: { ko: '미완성 시나리오', shape: 'ghost', col: '#6a6ad8', accent: '#ffd66e', line: '결말이 안 나온다!' },
  strategy: { ko: '밸런스 마왕', shape: 'spike', col: '#7a5ad8', accent: '#5affc8', line: '한 유닛이 너무 세다!' },
  raise: { ko: '육성 트리', shape: 'ghost', col: '#4ab8a8', accent: '#ffe08a', line: '분기가 폭발한다!' },
  idle: { ko: '무한 루프', shape: 'orb', col: '#8a8a9a', accent: '#8affd8', line: '아무 일도 일어나지 않는다!' },
  mmo: { ko: '서버 리바이어던', shape: 'drone', col: '#3a6ad8', accent: '#ff5a5a', line: '동접이 감당이 안 된다!' },
  party: { ko: '파티 광대', shape: 'ghost', col: '#d8a03a', accent: '#ff6ad8', line: '아무도 안 웃는다!' },
};

export function bossFor(genreId) {
  return BOSSES[genreId] || { ko: '이름 없는 아이디어', shape: 'orb', col: '#8a8a9a', accent: '#ffd66e', line: '형체가 잡히지 않는다!' };
}

/* 보스의 반격. `hp` 는 대상 직원 최대 체력에 대한 비율, `bugs` 는 이 공격이
   완성작에 남기는 버그 수다. 3턴마다 하나가 나오고, 페이즈가 바뀔 때는
   반드시 큰 것이 나온다. */
/* `targets` 는 몇 명을 때리는가다. 'all' 은 팀 전원 — 한 명만 노리는 기술과
   전체를 쓸어 가는 기술이 섞여 있어야, 화면을 보고 있는 쪽에서 "이번 건
   위험하다" 가 구분된다. 전체기는 한 사람당 데미지를 낮춰 잡는다: 같은
   비율로 전원을 때리면 그 한 방에 팀이 통째로 눕는다.

   반격이 드물어진(BOSS_STAGES 의 atk) 대신 한 명만 노리는 기술은 세졌다.
   자주 조금씩 깎이는 것보다, 가끔 크게 맞고 그 한 명을 챙기는 쪽이 화면에서
   읽힌다. 총량은 프로젝트의 야심(strainOf)이 다시 한 번 곱해서 정한다. */
export const BOSS_MOVES = [
  { id: 'spec', ko: '사양 변경', hp: 0.045, bugs: 1, targets: 2, line: '기획이 또 바뀌었다!' },
  { id: 'bug', ko: '버그 폭주', hp: 0.052, bugs: 2, targets: 1, line: '재현이 안 되는 버그다!' },
  { id: 'deadline', ko: '납기 압박', hp: 0.058, bugs: 0, targets: 2, line: '출시일이 앞당겨졌다!' },
  { id: 'crash', ko: '컴퓨터 응답 없음', hp: 0.062, bugs: 1, targets: 1, line: '저장을 안 했다…' },
  { id: 'review', ko: '리뷰 폭격', hp: 0.040, bugs: 1, targets: 2, line: '내부 평가가 최악이다!' },
  { id: 'allnight', ko: '전원 야근', hp: 0.030, bugs: 1, targets: 'all', line: '오늘은 다 같이 남는다!' },
  { id: 'rework', ko: '전면 재작업', hp: 0.036, bugs: 2, targets: 'all', line: '처음부터 다시 만든다!' },
];
export const BOSS_RAGE = { id: 'rage', ko: '격노', hp: 0.055, bugs: 2, targets: 'all', line: '아이디어가 형태를 바꾼다!' };

/* ---------- 3연전 ----------
   보스는 하나가 세 번 변신하는 게 아니라 **세 마리**다. 장르를 정하면 장르
   보스가 나오고, 그 놈을 잡으면 게임 내용을 고르고, 고른 조합이 두 번째
   보스가 되고, 마지막으로 마감이 온다. 각자 자기 체력 바를 갖는다 —
   한 프로젝트에 바가 하나뿐이면 "얼마나 남았나" 밖에 안 보이지만, 셋이면
   "지금 어디까지 왔나" 가 보인다.

   dmg 는 그 스테이지의 방어력이다(데미지가 그만큼 나눠진다). species 는
   world/boss.js 가 불러올 3D 모델.

   atk 는 반격 주기(초)다. 짧을수록 자주 때린다 — 예전 값(7.6/5.6/4.4)에서는
   반격 로그가 초 단위로 흘러가서 어느 것이 무슨 기술인지 볼 수가 없었다.
   드물게, 대신 한 방이 기억에 남는 쪽으로 옮겼다. */
export const BOSS_STAGES = [
  { ko: '장르 보스', species: 'cat', dmg: 1.00, share: 0.24, atk: 10.5, card: 'content' },
  { ko: '조합 보스', species: 'orc', dmg: 1.08, share: 0.32, atk: 8.2, card: 'method' },
  { ko: '마감 보스', species: 'demon', dmg: 1.16, share: 0.44, atk: 6.4, card: null },
];

/* 이름이 바뀐 뒤로도 예전 저장 파일과 UI 가 phase 를 읽는다. 스테이지
   인덱스를 그대로 페이즈로 쓴다. */
export const BOSS_PHASES = BOSS_STAGES.map((s, i) => ({
  at: 1 - i * 0.33, ko: s.ko, dmg: s.dmg,
}));
export const WEAK_TURNS = 3;      // 스테이지가 넘어간 직후 약점이 드러나는 타격 수
export const WEAK_MULT = 1.45;    // 그 동안의 데미지 배율

/* ---------- 자동 전투 ----------
   스태미나는 **게임을 만드는 데** 쓴다. 기획서를 뽑고, 개발에 착수하고,
   디버그하고, 교육하는 자리다. 보스는 스태미나로 때리는 게 아니라 직원들이
   자기 체력으로 때린다 — 그래서 배틀에는 버튼이 없다. 각자 게이지가 차면
   알아서 친다.

   `strikeSec` 는 한 사람이 한 번 치는 데 걸리는 시간이다. 팀이 넷이면
   초당 세 번쯤 숫자가 뜨고, 그 정도가 눈으로 따라갈 수 있는 상한이었다. */
export const RAID = {
  strikeSec: 1.30,     // 한 사람의 공격 주기(초) — 체력이 낮으면 느려진다
  slowest: 1.9,        // 지친 사람의 주기 배율 상한
  rounds: 26,          // ★1 · 피처폰 · 기준 장르 데뷔작의 라운드 수
  minRounds: 22,
  maxRounds: 62,
  downSec: 7.0,        // 쓰러진 직원이 다시 일어서기까지(초)
  speeds: [1, 2, 4],   // 배속 버튼
};

/* 개발 착수에 드는 스태미나. 야심이 클수록 비싸다 — 이것이 "게임을 만들 때
   쓰는 스태미나" 의 본체이고, 배틀 중에는 한 점도 들지 않는다. */
export function devStamina(platform, grade, seriesN = 1, monetize = null) {
  const p = platform ? platform.rank : 0;
  const m = monetize ? (monetize.stam || 0) : 0;
  return Math.max(2, Math.round(2 + p * 0.22 + (grade - 1) * 0.7 + (seriesN - 1) * 0.5 + m));
}

/* ---------- 탈진 ----------
   팀이 전원 쓰러지면 그 단계는 거기서 끝난다. 예전에는 "다음 주로 넘기기" 로
   체력을 공짜로 채워 계속 팰 수 있었고, 그러면 상점의 음식을 살 이유가
   사라졌다 — 시간은 무한하고 밥은 돈이 드니까. 이제 쓰러지면 남은 체력만큼
   그 단계를 **못 만든 채로** 마감하고 다음 보스로 넘어간다. 밥은 그 손해를
   막는 값이 된다.

   `grace` 는 마감이 자동으로 걸리기까지의 시간이다. 그 사이에 가방에서 밥을
   먹이면 팀이 일어서고 마감은 취소된다. */
export const EXHAUST = {
  grace: 8,          // 자동 마감까지의 시간(초)
  qualityLoss: 0.62, // 못 만든 비율 × 이 값만큼 완성도가 깎인다
  minQuality: 0.34,  // 완성도의 하한 — 전부 뻗어도 게임은 나온다
  bugs: 9,           // 못 만든 비율 × 이 개수만큼 버그가 더 붙는다
  /* 보스가 바뀌면 쓰러진 사람도 **피 한 칸**으로 일어선다. 한 마리를 잡고
     다음 놈 앞에 시체로 서 있으면, 남은 두 마리는 볼 것도 없이 탈진 마감이
     된다 — 한 스테이지의 실패가 프로젝트 전체의 실패로 확정되는 자리였다.
     한 칸은 "이어서 싸울 수는 있지만 곧 또 눕는다" 의 양이다. */
  reviveHp: 0.20,    // 다음 보스가 설 때 되살아나는 최대 체력 비율
};

/* ---------- 부담 ----------
   같은 40회 타격이라도 ★1 피처폰 데뷔작과 ★5 콘솔 대작이 사람을 똑같이
   갈아 넣으면 안 된다. 데뷔작에서 직원이 줄줄이 쓰러지면 플레이어가 배우는
   것은 "밥을 사라" 가 아니라 "이 게임은 원래 이렇다" 이고, 그러면 상점이
   의미를 잃는다.

   `strainOf` 는 한 프로젝트가 사람에게 매기는 배율이다. 타격마다 빠지는
   체력과 보스의 반격이 **둘 다** 이 값을 곱해서 본다:

     ★1 · 피처폰   0.34 → 밥을 안 사도 아무도 쓰러지지 않고, 절반쯤 남긴다
     ★3 · 스마트폰 0.66 → 후반에 한둘이 눕는다
     ★5 · 콘솔     1.11 → 밥을 안 사면 못 끝낸다 */
export function strainOf(grade, platform) {
  const g = Math.max(1, Math.min(5, grade || 1));
  const rank = platform ? (platform.rank || 0) : 0;
  return Math.max(0.30, Math.min(1.25, 0.34 + (g - 1) * 0.15 + rank * 0.012));
}

/* ---------- 직원 강화 ----------
   레벨은 아이템(돈+스태미나)으로 오르고, 경험치는 게임을 내면 오른다. 그
   둘은 "이 사람이 전체적으로 얼마나 크는가" 만 정한다. 강화는 그 위에 얹는
   **방향**이다: 같은 프로그래머라도 체력을 올려 오래 버티게 할지, 공격력을
   올려 세게 치게 할지, 미술을 올려 임팩트를 밀게 할지가 갈린다.

   비용은 단계마다 가파르게 오른다(grow). 돈이 남아도는 후반에도 한 사람을
   전부 만렙으로 채우는 것이 아니라 누구를 어느 방향으로 키울지 고르게 하려면
   이 지수가 계수보다 중요하다. */
export const UPGRADES = [
  { id: 'hp', ko: '체력 단련', emoji: '💪', unit: '최대 체력 +10', max: 12, base: 6800, grow: 1.42 },
  { id: 'atk', ko: '공격력 훈련', emoji: '⚔️', unit: '데미지 +7%', max: 12, base: 9600, grow: 1.46 },
  { id: 'speed', ko: '속도 훈련', emoji: '⚡', unit: '공격 속도 +5%', max: 8, base: 12000, grow: 1.52 },
  { id: 'crit', ko: '번뜩임 훈련', emoji: '✨', unit: '번뜩임 확률 +2%p', max: 8, base: 14000, grow: 1.52 },
  { id: 'plan', ko: '기획 강의', emoji: '📐', unit: '기획 +5', max: 10, base: 7200, grow: 1.40, ability: 'plan' },
  { id: 'prog', ko: '개발 강의', emoji: '⌨️', unit: '개발 +5', max: 10, base: 7200, grow: 1.40, ability: 'prog' },
  { id: 'graph', ko: '미술 강의', emoji: '🎨', unit: '그래픽 +5', max: 10, base: 7200, grow: 1.40, ability: 'graph' },
  { id: 'sound', ko: '사운드 강의', emoji: '🎧', unit: '사운드 +5', max: 10, base: 7200, grow: 1.40, ability: 'sound' },
  { id: 'social', ko: '소셜 강의', emoji: '📡', unit: '소셜 +5', max: 10, base: 7200, grow: 1.40, ability: 'social' },
];
export const UPGRADE_BY_ID = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

/* 다음 한 단계의 값. 재능이 높은 사람은 조금 더 비싸다 — 될 사람에게
   몰아주는 선택에도 값이 붙어야 선택이 된다. */
export function upgradeCost(up, level, talent = 1) {
  return Math.round(up.base * Math.pow(up.grow, level) * (0.85 + (talent || 1) * 0.15));
}

/* ---------- 판매 중 사건 ----------
   출시한 게임의 매출이 매주 같은 비율로 식기만 하면 그래프를 볼 이유가 없다.
   주마다 낮은 확률로 사건이 하나 붙어서, 유저가 튀거나 빠진다 — 연예인이
   방송에서 언급하면 그 주에 40% 가 더 팔리고, 경쟁작이 나오면 그만큼 빠진다.
   `users` 는 그 사건이 유저 수 자체에 남기는 흔적이다(일시적 매출 배율과
   달리 다음 주에도 이어진다). */
export const SALE_EVENTS = [
  { id: 'celeb', ko: '연예인 광고', emoji: '📺', p: 0.045, mult: [0.30, 0.75], users: 0.5, cls: 'great' },
  { id: 'stream', ko: '인기 스트리머 방송', emoji: '🎥', p: 0.045, mult: [0.20, 0.50], users: 0.45, cls: 'good' },
  { id: 'sns', ko: 'SNS 입소문', emoji: '💬', p: 0.050, mult: [0.12, 0.35], users: 0.55, cls: 'good' },
  { id: 'store', ko: '앱마켓 추천', emoji: '🏅', p: 0.035, mult: [0.25, 0.60], users: 0.6, cls: 'great' },
  { id: 'update', ko: '대형 업데이트', emoji: '🧩', p: 0.040, mult: [0.15, 0.32], users: 0.4, cls: 'good' },
  { id: 'server', ko: '서버 점검', emoji: '🛠️', p: 0.030, mult: [-0.32, -0.12], users: 0.3, cls: 'bad' },
  { id: 'rival', ko: '경쟁작 출시', emoji: '⚔️', p: 0.035, mult: [-0.38, -0.15], users: 0.7, cls: 'bad' },
  { id: 'review', ko: '악평 확산', emoji: '💢', p: 0.025, mult: [-0.30, -0.10], users: 0.6, cls: 'bad' },
];

/* ---------- 성급 ----------
   상점의 모든 물건에 ★1~★5 가 붙는다. 별은 두 가지를 한꺼번에 말한다:
   얼마나 비싼가, 그리고 **보물상자에서 얼마나 안 나오는가**. 같은 🍰 라도
   ★3 이면 흔하고 ★5 짜리 장비는 평생 몇 번 못 본다.

   별이 왜 필요한가: 물건이 상점에만 있으면 가격표가 곧 가치라서 고를 것이
   없다. 상자에서 나오기 시작하면 "무엇이 나왔는가" 가 그 자체로 사건이
   되고, 그러려면 등급이 눈에 보여야 한다. */
export const STAR_MAX = 5;
export const starText = (n) => '★'.repeat(Math.max(0, Math.min(STAR_MAX, n || 1)));

/* 능력치의 한국어 이름. 선물이 무엇을 올리는지 화면에 적을 때 쓴다. */
export const ABILITY_KO = {
  plan: '기획', prog: '개발', graph: '그래픽', sound: '사운드', social: '소셜',
};

/* ---------- 선물 ----------
   직원에게 주면 **경험치와 능력치**가 오르는 음식·물건. 원작의 육성
   아이템을 그대로 옮긴 자리다.

   레벨은 다섯 능력치를 고루 올리고, 선물은 그 위에 **한 쪽만** 더 밀어
   준다. 그래픽 담당에게 화집을 주면 그래픽이, 사운드 담당에게 LP 를 주면
   사운드가 오른다 — 같은 직업 두 명이 다르게 자라는 자리가 여기다.

   별이 값과 효과를 같이 정한다. 표에는 이름·이모지·별·올릴 능력치만 적고
   숫자는 GIFT_TIER 가 준다: 물건 하나를 추가할 때 밸런스를 다시 계산할
   필요가 없어야 표가 늘어난다. */
export const GIFT_TIER = {
  1: { price: 1600, exp: 70, gain: 1.2, mot: 0, rank: 1 },
  2: { price: 5200, exp: 210, gain: 2.4, mot: 1, rank: 1 },
  3: { price: 15000, exp: 620, gain: 4.5, mot: 1, rank: 2 },
  4: { price: 44000, exp: 1700, gain: 8, mot: 2, rank: 5 },
  5: { price: 120000, exp: 4400, gain: 13, mot: 3, rank: 9 },
};

const GIFT_BASE = [
  ['comic', '만화책', '📚', 1, 'plan'],
  ['gagdvd', '개그 DVD', '📀', 2, 'plan'],
  ['novel', '설정집 원서', '📖', 3, 'plan'],
  ['artfilm', '거장 감독 전집', '🎞️', 4, 'plan'],
  ['museum', '해외 미술관 초대권', '🎫', 5, 'plan'],

  ['snackbar', '초코바', '🍫', 1, 'prog'],
  ['techmag', '기술 잡지', '📰', 2, 'prog'],
  ['algobook', '알고리즘 명저', '📗', 3, 'prog'],
  ['devcon', '개발자 컨퍼런스 티켓', '🎟️', 4, 'prog'],
  ['retropc', '전설의 8비트 PC', '🖲️', 5, 'prog'],

  ['sketchpad', '스케치북', '✏️', 1, 'graph'],
  ['artbook', '화집', '🖼️', 2, 'graph'],
  ['pigment', '고급 물감 세트', '🎨', 3, 'graph'],
  ['figurine', '한정판 원형 피규어', '🗿', 4, 'graph'],
  ['origart', '거장의 원화', '🏞️', 5, 'graph'],

  ['earbuds', '이어폰', '🎧', 1, 'sound'],
  ['lp', '희귀 LP', '💿', 2, 'sound'],
  ['harmonica', '수제 하모니카', '🪗', 3, 'sound'],
  ['concert', '오케스트라 초대권', '🎼', 4, 'sound'],
  ['maestro', '명장의 바이올린', '🎻', 5, 'sound'],

  ['sticker', '스티커 팩', '🏷️', 1, 'social'],
  ['phonecase', '한정 폰케이스', '📱', 2, 'social'],
  ['drone', '촬영용 드론', '🛸', 3, 'social'],
  ['fanmeet', '팬미팅 초대권', '💌', 4, 'social'],
  ['satellite', '개인 위성 회선', '🛰️', 5, 'social'],

  /* 능력치를 가리지 않는 것들. 누구에게 줘도 손해가 없어서 상자에서
     나왔을 때 "쓸 데가 없다" 가 되지 않는다. */
  ['teaset', '따뜻한 차 세트', '🍵', 1, null],
  ['lunchbox', '엄마표 도시락', '🍲', 2, null],
  ['massage', '마사지 이용권', '💆', 3, null],
  ['resort', '리조트 숙박권', '🏝️', 4, null],
  ['worldtrip', '세계일주 항공권', '✈️', 5, null],
];

/* 표를 실제 상점 항목으로 편다. 능력치가 없는 선물은 경험치가 조금 더 많다 —
   방향이 없는 대신 총량으로 갚는다. */
const GIFTS = GIFT_BASE.map(([id, ko, emoji, star, ability]) => {
  const t = GIFT_TIER[star];
  const exp = Math.round(t.exp * (ability ? 1 : 1.45));
  return {
    id: 'g_' + id, ko, kind: 'gift', emoji, star,
    price: Math.round(t.price * (ability ? 1 : 1.2)),
    rank: t.rank, exp, gain: ability ? t.gain : 0, ability, mot: t.mot,
    desc: (ability ? `${ABILITY_KO[ability]} UP · ` : '전 능력 성장 · ')
      + `EXP +${exp}${t.mot ? ` · 의욕 +${t.mot}` : ''}`,
  };
});

/* ---------- 상점 ----------
   가방에 넣어두고 필요할 때 쓴다. 음식은 체력, 음료는 회사 스태미나,
   장난감은 의욕, 선물은 직원의 경험치와 능력치, 장비는 직원에게 장착하는
   영구 강화다.

   장비와 선물이 이 시스템의 핵심이다. 사운드 담당에게 피아노를 사주면
   사운드 능력치가 오르고, 그 사람이 개발 배틀에서 밀어 올리는 품질 축
   (화제성·임팩트)의 상승폭까지 같이 오른다 — 직원마다 특색이 생긴다. */
export const SHOP = [
  /* 음식 — 체력 회복 */
  { id: 'onigiri', ko: '삼각김밥', kind: 'food', emoji: '🍙', star: 1, price: 1400, rank: 1, hp: 30, desc: '체력 30 회복' },
  { id: 'banana', ko: '바나나', kind: 'food', emoji: '🍌', star: 1, price: 2000, rank: 1, hp: 42, desc: '체력 42 회복' },
  { id: 'ramen', ko: '컵라면', kind: 'food', emoji: '🍜', star: 2, price: 3200, rank: 1, hp: 60, desc: '체력 60 회복' },
  { id: 'bento', ko: '도시락', kind: 'food', emoji: '🍱', star: 2, price: 6400, rank: 2, hp: 100, desc: '체력 100 회복' },
  { id: 'cake', ko: '조각 케이크', kind: 'food', emoji: '🍰', star: 3, price: 9000, rank: 3, hp: 130, mot: 1, desc: '체력 130 회복 · 의욕 +1' },
  { id: 'pizza', ko: '피자 한 판', kind: 'food', emoji: '🍕', star: 4, price: 22000, rank: 4, hp: 9999, all: true, desc: '전 직원 체력 완전 회복' },

  /* 음료 — 스태미나 회복 (다음 주까지 기다리지 않는 길) */
  { id: 'cancoffee', ko: '캔커피', kind: 'drink', emoji: '☕', star: 1, price: 4200, rank: 1, stam: 2, desc: '스태미나 +2' },
  { id: 'energy', ko: '에너지 드링크', kind: 'drink', emoji: '🧃', star: 2, price: 11000, rank: 2, stam: 5, desc: '스태미나 +5' },
  { id: 'beans', ko: '스페셜티 원두', kind: 'drink', emoji: '🫖', star: 4, price: 30000, rank: 5, stam: 12, desc: '스태미나 +12' },

  /* 장난감 — 의욕 */
  { id: 'figure', ko: '피규어', kind: 'toy', emoji: '🧸', star: 2, price: 14000, rank: 1, mot: 3, desc: '의욕 +3' },
  { id: 'handheld', ko: '휴대용 게임기', kind: 'toy', emoji: '🎮', star: 3, price: 30000, rank: 2, mot: 6, desc: '의욕 +6' },
  { id: 'darts', ko: '다트 보드', kind: 'toy', emoji: '🎯', star: 3, price: 46000, rank: 3, mot: 2, all: true, desc: '전 직원 의욕 +2' },

  /* 선물 — 경험치와 능력치 (표에서 펴진다) */
  ...GIFTS,

  /* 도구 — 그 자리에서 쓰는 소모품 */
  { id: 'debugkit', ko: '디버그 킷', kind: 'tool', emoji: '🧰', star: 3, price: 18000, rank: 2, bugs: 7, desc: '완성작 버그 7개 즉시 수정' },
  { id: 'clover', ko: '네잎클로버', kind: 'tool', emoji: '🍀', star: 3, price: 26000, rank: 3, crit: 0.12, desc: '개발 중인 팀의 번뜩임 확률 +12%p (그 게임 동안)' },

  /* 장비 — 직원에게 장착하는 영구 강화 (한 사람당 3칸) */
  { id: 'notebook', ko: '아이디어 노트', kind: 'gear', emoji: '📓', star: 2, price: 42000, rank: 1, ability: 'plan', gain: 6, axis: { impact: 0.08 }, desc: '기획 +6 · 임팩트 +8%' },
  { id: 'strategyboard', ko: '전략 보드', kind: 'gear', emoji: '🗂️', star: 4, price: 120000, rank: 4, ability: 'plan', gain: 12, axis: { impact: 0.13, craze: 0.06 }, desc: '기획 +12 · 임팩트 +13% · 화제성 +6%' },
  { id: 'keyboard', ko: '기계식 키보드', kind: 'gear', emoji: '⌨️', star: 2, price: 48000, rank: 1, ability: 'prog', gain: 7, axis: { usability: 0.12 }, desc: '개발 +7 · 조작성 +12%' },
  { id: 'workstation', ko: '듀얼 워크스테이션', kind: 'gear', emoji: '🖥️', star: 4, price: 150000, rank: 4, ability: 'prog', gain: 13, axis: { usability: 0.17, craze: 0.05 }, desc: '개발 +13 · 조작성 +17%' },
  { id: 'tablet', ko: '액정 타블렛', kind: 'gear', emoji: '🖊️', star: 2, price: 52000, rank: 1, ability: 'graph', gain: 8, axis: { impact: 0.14 }, desc: '그래픽 +8 · 임팩트 +14%' },
  { id: 'colormon', ko: '컬러 캘리브레이션 모니터', kind: 'gear', emoji: '🖼️', star: 5, price: 160000, rank: 5, ability: 'graph', gain: 14, axis: { impact: 0.19 }, desc: '그래픽 +14 · 임팩트 +19%' },
  { id: 'mic', ko: '콘덴서 마이크', kind: 'gear', emoji: '🎤', star: 2, price: 45000, rank: 1, ability: 'sound', gain: 6, axis: { craze: 0.09 }, desc: '사운드 +6 · 화제성 +9%' },
  { id: 'piano', ko: '업라이트 피아노', kind: 'gear', emoji: '🎹', star: 4, price: 128000, rank: 3, ability: 'sound', gain: 10, axis: { craze: 0.13, impact: 0.11 }, desc: '사운드 +10 · 화제성 +13% · 임팩트 +11%' },
  { id: 'synth', ko: '아날로그 신디사이저', kind: 'gear', emoji: '🎛️', star: 5, price: 220000, rank: 6, ability: 'sound', gain: 15, axis: { craze: 0.18, impact: 0.13 }, desc: '사운드 +15 · 화제성 +18% · 임팩트 +13%' },
  { id: 'camera', ko: '방송용 카메라', kind: 'gear', emoji: '📷', star: 3, price: 56000, rank: 2, ability: 'social', gain: 8, axis: { social: 0.12 }, desc: '소셜 +8 · 소셜 +12%' },
  { id: 'rack', ko: '전용 서버 랙', kind: 'gear', emoji: '🗄️', star: 5, price: 210000, rank: 6, ability: 'social', gain: 14, axis: { social: 0.15, retention: 0.16 }, desc: '소셜 +14 · 소셜 +15% · 지속성 +16%' },
];

export const GEAR_SLOTS = 3;
export const SHOP_KINDS = [
  { id: 'food', ko: '음식', hint: '직원 체력을 회복한다' },
  { id: 'gift', ko: '선물', hint: '직원에게 주면 경험치와 능력치가 오른다' },
  { id: 'drink', ko: '음료', hint: '스태미나를 그 자리에서 채운다' },
  { id: 'toy', ko: '장난감', hint: '의욕을 올린다' },
  { id: 'tool', ko: '도구', hint: '개발과 디버그를 돕는다' },
  { id: 'gear', ko: '장비', hint: '직원에게 장착하는 영구 강화' },
];

export function shopItem(id) { return SHOP.find((i) => i.id === id) || null; }
export function shopFor(rank) { return SHOP.filter((i) => rank >= (i.rank || 1)); }
export function starOf(item) { return Math.max(1, Math.min(STAR_MAX, (item && item.star) || 1)); }

/* ---------- 보물상자 ----------
   보스를 때리는 동안 상자가 떨어진다. 이것이 개발 배틀을 **보는** 이유다:
   예전에는 자동 전투를 켜 놓고 다른 탭을 봐도 결과가 같았고, 그러면 화면
   한가운데의 싸움이 로딩 바와 다를 게 없었다.

     perStrike   한 번 칠 때 상자가 떨어질 확률
     onClear     보스 한 마리를 잡았을 때 상자가 떨어질 확률
     perStage    한 스테이지에서 나올 수 있는 상한 (긴 싸움이 곧 이득이
                 되면 일부러 약한 팀으로 오래 끄는 쪽이 최적이 된다)
     weights     ★1..★5 의 기본 분포
     luck        야심(strain)이 별 분포를 오른쪽으로 미는 세기. ★5 대작을
                 만들면 상자에서도 큰 것이 나온다. */
export const TREASURE = {
  perStrike: 0.0045,
  /* 격파 보상은 **확률**이다. 확정으로 주면 한 게임에 상자 세 개가 보장되고,
     그러면 상점은 "돈이 남을 때 들르는 곳" 이 된다. 상자가 안 나오는 판이
     있어야 나오는 판이 사건이 된다. */
  onClear: 0.45,
  perStage: 2,
  /* ★4·★5 는 사실상 사고여야 한다. 예전 분포(5%/2%)로는 데뷔작 한 편에
     ★4 장비가 붙는 일이 잦았고, 상점의 비싼 칸이 통째로 의미를 잃었다. */
  weights: [72, 21, 6, 0.9, 0.1],
  luck: 0.5,
};

/* 별 하나를 뽑는다. `push` 는 0..1 — 클수록 높은 별이 잘 나온다. */
export function rollStar(rnd, push = 0) {
  const w = TREASURE.weights.map((v, i) => v * Math.pow(1 + Math.max(0, push) * TREASURE.luck, i));
  const total = w.reduce((a, b) => a + b, 0);
  let r = rnd() * total;
  for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i + 1; }
  return 1;
}

/* 그 별에서 나올 수 있는 물건들. 랭크 제한은 상자에 걸지 않는다 — 상자는
   "지금 살 수 없는 것이 나오는" 자리여야 열어 볼 맛이 난다. */
export function lootPool(star) {
  const s = Math.max(1, Math.min(STAR_MAX, star));
  const pool = SHOP.filter((i) => starOf(i) === s);
  return pool.length ? pool : SHOP.filter((i) => starOf(i) <= s);
}

/* ---------- 야근 ----------
   스태미나를 기다리지 않고 사는 길. 돈과 직원 체력·의욕을 지불한다.
   주 1회로 제한하는 이유는 이것이 기본 루프를 대체하면 안 되기 때문이다. */
export const OVERTIME = { stamina: 0.55, hpCost: 0.16, motCost: 1, payPerHead: 5200 };

/* ---------- 도감 ----------
   무엇을 모으는 게임인지 한 화면에서 보이게 하는 장치. 실제 수집 상태는
   회사 상태(company.dex)에 쌓이고, 여기에는 "무엇을 세는가"만 있다. */
export const DEX_SECTIONS = [
  { id: 'genres', ko: '장르', icon: '🎲', total: () => GENRES.length },
  { id: 'contents', ko: '소재', icon: '🧩', total: () => CONTENTS.length },
  { id: 'bosses', ko: '아이디어', icon: '👾', total: () => Object.keys(BOSSES).length },
  { id: 'items', ko: '아이템', icon: '🎁', total: () => SHOP.length },
  { id: 'jobs', ko: '직업', icon: '💼', total: () => Object.keys(JOBS).length },
];
