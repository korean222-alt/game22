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
  { id: 'sports2', ko: '스포츠', tags: ['skill', 'social'], bias: { social: 1.15, usability: 1.10 } },
];

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
  ['board', 'school'], ['sports', 'sports2'], ['sim', 'cooking'], ['adv', 'space'],
];

const MASTER_SET = new Set(MASTER_COMBOS.map(([a, b]) => a + '|' + b));

/* Compatibility in [0.7, 2.0]. Tag overlap is the floor; a listed masterpiece
   pairing is what actually makes a hit. */
export function comboScore(genreId, contentId) {
  const g = GENRES.find((x) => x.id === genreId);
  const c = CONTENTS.find((x) => x.id === contentId);
  if (!g || !c) return 1;
  let s = 0.85;
  const shared = g.tags.filter((t) => c.tags.includes(t)).length;
  s += shared * 0.16;
  if (MASTER_SET.has(genreId + '|' + contentId)) s += 0.55;
  return Math.min(2.0, Math.max(0.7, s));
}

export function comboLabel(score) {
  if (score >= 1.55) return { ko: '환상의 조합', cls: 'great' };
  if (score >= 1.25) return { ko: '좋은 조합', cls: 'good' };
  if (score >= 1.0) return { ko: '무난한 조합', cls: 'ok' };
  return { ko: '아쉬운 조합', cls: 'bad' };
}

/* ---------- platforms ---------- */
export const PLATFORMS = [
  { id: 'feature', ko: '피처폰', rank: 0, fans: 0.55, hp: 0.75, cost: 20000, share: 0.55 },
  { id: 'smart', ko: '스마트폰', rank: 2, fans: 1.00, hp: 1.60, cost: 55000, share: 1.00 },
  { id: 'sns', ko: 'SNS 플랫폼', rank: 5, fans: 1.35, hp: 2.60, cost: 120000, share: 1.25 },
  { id: 'tablet', ko: '태블릿', rank: 9, fans: 1.20, hp: 3.20, cost: 190000, share: 1.10 },
  { id: 'console', ko: '콘솔 크로스', rank: 14, fans: 1.60, hp: 5.00, cost: 380000, share: 1.45 },
  { id: 'own', ko: '자체 플랫폼', rank: 20, fans: 2.10, hp: 7.50, cost: 800000, share: 2.00 },
];

/* ---------- monetisation ---------- */
export const MONETIZE = [
  {
    id: 'paid', ko: '유료', rank: 0,
    desc: '출시 직후 수익이 크다. 유저 수는 적다.',
    users: 0.55, arpu: 4.2, decay: 0.880,
  },
  {
    id: 'f2p', ko: '부분유료', rank: 4,
    desc: '유저가 많이 모이고 매출 상한이 높다.',
    users: 1.60, arpu: 1.0, decay: 0.935,
  },
  {
    id: 'f2p_long', ko: '부분유료 (장기운영)', rank: 12,
    desc: '초반은 느리지만 오래 간다. 랭크 12부터.',
    users: 1.30, arpu: 1.35, decay: 0.972,
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
    staffCap: Math.min(24, 5 + Math.floor(r * 0.9)),
    motivationCap: Math.min(60, 5 + r * 2),
    floors: Math.min(5, 1 + Math.floor((r - 1) / 4)),
    staminaMax: Math.min(40, 8 + Math.floor(r * 1.1)),
    managedCap: 3,
  };
}

/* Rank thresholds: ~28k fans by rank 5, ~550k by 10, ~11M by 15. Tuned against
   the headless balance run so a well-played five-year career lands near rank 20
   rather than exhausting the ladder in the first year. */
export const RANK_UP_FANS = (rank) => Math.round(2400 * Math.pow(1.85, rank - 1));

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
