/* Staff: generation, growth, motivation, job changes.

   Motivation is the mechanic the original leans on hardest — every point is a
   flat +0.5% on the staffer's contribution, its cap rises with company rank,
   and finishing a game from someone's own proposal grants a point. That single
   loop is what makes you care which staffer proposed what. */

import {
  JOBS, JOB_ABILITY, JOB_ROLE, ITEMS, SURNAMES, GIVEN, rankInfo, TRAITS, TRAIT_IDS, GENRES,
  HP, hpMult, shopItem, GEAR_SLOTS,
} from './data.js';
import { SKINS, HAIRS, SHIRTS, PANTS, P } from '../world/palette.js';

const HAIRSTYLES = ['short', 'crop', 'curly', 'long', 'bob', 'pony', 'bun', 'balding'];

let _uid = 1;
export function nextId() { return _uid++; }
export function seedIds(n) { _uid = Math.max(_uid, n); }

/* The visual spec the rig builder consumes. Kept on the staffer so a reload
   rebuilds the same person, not a new one. */
function makeLook(rnd) {
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const feminine = rnd() > 0.5;
  const look = {
    height: 0.94 + rnd() * 0.16,
    build: 0.90 + rnd() * 0.28,
    skin: pick(SKINS),
    hairCol: pick(HAIRS),
    hair: feminine ? pick(['long', 'bob', 'pony', 'bun', 'short']) : pick(HAIRSTYLES),
    shirt: pick(SHIRTS),
    pants: pick(PANTS),
    shoe: rnd() > 0.5 ? '#26221d' : '#3a3630',
    eyeCol: pick(['#4a5a6a', '#3a2e24', '#2f4a3a', '#5a4a3a']),
    glasses: rnd() > 0.62,
    shortSleeve: rnd() > 0.55,
    collar: rnd() > 0.4,
    lanyard: true,
    lanyardCol: pick(['#2f4d7a', '#7a2f3f', '#2f7a4d']),
  };
  if (!feminine && rnd() > 0.78) { look.beard = true; look.beardCol = look.hairCol; }
  if (rnd() > 0.80) look.hoodie = pick(['#3a4048', '#4a3a48', '#38484a']);
  return look;
}

/* One or two traits per person. The analysis doc is blunt that a roster where
   everyone is simply better or worse stops being a decision — a trait is the
   visible reason to pick this person for this project. */
function rollTraits(rnd) {
  const n = rnd() > 0.62 ? 2 : 1;
  const pool = [...TRAIT_IDS];
  const out = [];
  while (out.length < n && pool.length) {
    out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  }
  return out;
}

export function traitsOf(s) {
  return (s.traits || []).map((id) => ({ id, ...TRAITS[id] })).filter((t) => t.ko);
}

/* Multiplicative trait keys (dmg, quality, bugs, salary, fans, train). */
export function traitMult(s, key) {
  let v = 1;
  for (const t of traitsOf(s)) if (t[key] !== undefined) v *= t[key];
  return v;
}

/* Additive trait keys (crit, teamMood). */
export function traitAdd(s, key) {
  let v = 0;
  for (const t of traitsOf(s)) if (t[key] !== undefined) v += t[key];
  return v;
}

export function hasTrait(s, id) { return (s.traits || []).includes(id); }

export function makeStaff(rnd, jobId, opts = {}) {
  const job = JOBS[jobId];
  const talent = opts.talent ?? (0.75 + rnd() * 0.7);      // a lifelong multiplier
  const traits = opts.traits || rollTraits(rnd);
  const s = {
    id: nextId(),
    name: SURNAMES[Math.floor(rnd() * SURNAMES.length)] + GIVEN[Math.floor(rnd() * GIVEN.length)],
    job: jobId,
    level: opts.level ?? 1,
    maxLevel: 30 + JOBS[jobId].tier * 30,
    exp: 0,
    motivation: opts.motivation ?? 3,
    talent,
    // Ability scores grow with level; `bonus` is what items have added.
    bonus: { plan: 0, prog: 0, graph: 0, sound: 0, social: 0 },
    itemsGiven: [],
    traits,
    // The genre a 장르 덕후 actually specialises in; harmless on anyone else.
    favGenre: GENRES[Math.floor(rnd() * GENRES.length)].id,
    salary: Math.round(job.cost * (0.85 + talent * 0.35)),
    deskId: null,
    look: makeLook(rnd),
    reincarnations: 0,
    gamesShipped: 0,
    // 장착한 장비 id. 상점에서 사서 가방을 거쳐 여기로 온다.
    gear: [],
  };
  s.salary = Math.round(s.salary * traitMult(s, 'salary'));
  s.hpMax = hpMaxOf(s);
  s.hp = s.hpMax;
  return s;
}

/* Effective ability: base for the job, scaled by level and talent, plus items
   and whatever equipment this person has been bought. */
export function ability(s, key) {
  const job = JOBS[s.job];
  const growth = 1 + (s.level - 1) * 0.085;
  return Math.round(job.base[key] * growth * s.talent + (s.bonus[key] || 0) + gearAbility(s, key));
}

/* ---------- 장비 ----------
   상점에서 산 물건을 직원에게 채워주면 두 가지가 같이 오른다: 그 사람의
   능력치와, 그 사람이 개발 배틀에서 밀어 올리는 품질 축. 사운드 담당에게
   피아노를 사주면 사운드 수치만 오르는 게 아니라 완성작의 화제성과 임팩트가
   실제로 더 높게 나온다 — 직원마다 특색이 생기는 자리다. */
export function gearOf(s) {
  return (s.gear || []).map((id) => shopItem(id)).filter((g) => g && g.kind === 'gear');
}

export function gearAbility(s, key) {
  let v = 0;
  for (const g of gearOf(s)) if (g.ability === key) v += g.gain || 0;
  return v;
}

/* Per-quality-axis multiplier this person's equipment adds. */
export function gearAxis(s, stat) {
  let v = 1;
  for (const g of gearOf(s)) if (g.axis && g.axis[stat]) v += g.axis[stat];
  return v;
}

export function canEquip(s, itemId) {
  const g = shopItem(itemId);
  if (!g || g.kind !== 'gear') return { ok: false, why: '장비가 아니다' };
  if ((s.gear || []).includes(itemId)) return { ok: false, why: '이미 같은 장비를 쓰고 있다' };
  if ((s.gear || []).length >= GEAR_SLOTS) return { ok: false, why: `장비 칸은 ${GEAR_SLOTS}개까지` };
  return { ok: true };
}

export function equipGear(s, itemId) {
  const c = canEquip(s, itemId);
  if (!c.ok) return c;
  s.gear = [...(s.gear || []), itemId];
  return { ok: true };
}

export function unequipGear(s, itemId) {
  if (!(s.gear || []).includes(itemId)) return { ok: false };
  s.gear = s.gear.filter((x) => x !== itemId);
  return { ok: true };
}

/* ---------- 체력 ----------
   개발 턴과 보스의 반격이 깎고, 음식과 주간 휴식이 채운다. 0이 되어도
   데미지가 0이 되지는 않는다 (HP.minMult): 굶은 팀은 느려질 뿐 멈추지
   않는다는 것이 이 게임의 하한선이다. */
export function hpMaxOf(s) {
  return Math.round(HP.base + s.level * HP.perLevel + (s.talent || 1) * HP.talent
    + (s.reincarnations || 0) * HP.perReborn);
}

/* Saves written before staff had health, and any staffer whose level moved,
   get their pool resized here rather than in five call sites. */
export function syncHp(s) {
  const max = hpMaxOf(s);
  if (s.hpMax !== max) {
    const ratio = s.hpMax > 0 ? (s.hp ?? max) / s.hpMax : 1;
    s.hpMax = max;
    s.hp = Math.round(Math.max(0, Math.min(1, ratio)) * max);
  }
  if (typeof s.hp !== 'number' || !isFinite(s.hp)) s.hp = max;
  s.hp = Math.max(0, Math.min(s.hpMax, s.hp));
  return s;
}

export function hpRatio(s) {
  syncHp(s);
  return s.hpMax > 0 ? s.hp / s.hpMax : 0;
}

export function drainHp(s, amount) {
  syncHp(s);
  const before = s.hp;
  s.hp = Math.max(0, s.hp - Math.max(0, Math.round(amount)));
  return before - s.hp;
}

export function healHp(s, amount) {
  syncHp(s);
  const before = s.hp;
  s.hp = Math.min(s.hpMax, s.hp + Math.max(0, Math.round(amount)));
  return s.hp - before;
}

export function isTired(s) { return hpRatio(s) < HP.tired; }
export function isSpent(s) { return hpRatio(s) <= 0.001; }

/* The damage/quality multiplier a staffer's current health buys. */
export function staminaMult(s) { return hpMult(hpRatio(s)); }

export function abilities(s) {
  return {
    plan: ability(s, 'plan'), prog: ability(s, 'prog'), graph: ability(s, 'graph'),
    sound: ability(s, 'sound'), social: ability(s, 'social'),
  };
}

/* The number every battle damage roll multiplies by: the job's driving ability
   scaled by motivation at the original's +0.5% per point. */
export function power(s) {
  return ability(s, JOB_ABILITY[s.job]) * motivationMult(s) * staminaMult(s);
}

/* Power ignoring fatigue — what the roster screen shows as the person's ceiling. */
export function basePower(s) {
  return ability(s, JOB_ABILITY[s.job]) * motivationMult(s);
}

export function motivationMult(s) { return 1 + s.motivation * 0.005; }

export function role(s) { return JOB_ROLE[s.job]; }

/* How much this staffer helps the proposal roll. All floors contribute, but a
   planner sitting on a planner floor contributes most — the original's advice
   to separate writers from developers, made mechanical. */
export function proposalPower(s, floorRole) {
  const job = JOBS[s.job];
  const onTheme = floorRole && floorRole === JOB_ROLE[s.job];
  return ability(s, 'plan') * job.proposal * motivationMult(s) * (onTheme ? 1.35 : 1.0);
}

/* Gifts are the late game's money sink. The exponent matters more than the
   coefficient: at 1.85 a mature studio's cash pile buys every remaining level
   in an afternoon, and money stops being a decision from about year four. At
   2.3 the same pile buys a handful of levels for the people who need them
   most, so "who do I grow?" stays a question for the whole career. */
export function levelUpCost(s) {
  return Math.round(320 + Math.pow(Math.max(1, s.level), 2.3) * 1.6);
}

/* What a specific gift costs this specific staffer right now. */
export function itemCost(s, item) {
  return Math.round(levelUpCost(s) * item.level * item.cost);
}

/* Stamina a gift costs. Rising with level is what actually paces growth: money
   stops mattering once the company is profitable, so if the stamina price were
   flat a mature studio could max its whole roster in a couple of months. */
export function trainStamina(s) {
  return 1 + Math.floor(s.level / 22);
}

export function giveItem(s, itemId, rank) {
  const item = ITEMS.find((i) => i.id === itemId);
  if (!item) return { ok: false, why: '없는 아이템' };
  if (s.level >= s.maxLevel) return { ok: false, why: '이미 최대 레벨' };
  const gain = Math.min(Math.round(item.level * traitMult(s, 'train')), s.maxLevel - s.level);
  s.level += Math.max(1, gain);
  if (s.level > s.maxLevel) s.level = s.maxLevel;
  const cap = rankInfo(rank).motivationCap;
  s.motivation = Math.min(cap, s.motivation + item.motivation);
  // Items nudge the ability the item is about, which is what makes the choice
  // of gift matter beyond raw levels.
  const key = { coffee: 'plan', chair: 'prog', monitor: 'graph', book: 'plan', headset: 'sound', trip: 'social' }[itemId];
  if (key) s.bonus[key] += 1 + item.level * 0.4;
  if (!s.itemsGiven.includes(itemId)) s.itemsGiven.push(itemId);
  syncHp(s);
  return { ok: true, gain };
}

/* ---------- experience ----------
   Gifts are the fast lane to a level; shipping is the slow one. Without a slow
   lane a studio that never spends a won on training is frozen at level 3
   forever, which is the one state the design must not allow — the doc's rule
   is that a player is never PERMANENTLY stuck. The curve is deliberately
   shallow at the bottom and steep by the sixties, so early games visibly grow
   the founders and late levels still have to be bought. */
export function expToNext(s) {
  return Math.round(18 * Math.pow(Math.max(1, s.level), 1.15));
}

export function gainExp(s, amount) {
  if (s.level >= s.maxLevel) { s.exp = 0; return 0; }
  s.exp = (s.exp || 0) + amount;
  let gained = 0;
  while (s.level < s.maxLevel && s.exp >= expToNext(s)) {
    s.exp -= expToNext(s);
    s.level += 1;
    gained += 1;
  }
  if (s.level >= s.maxLevel) s.exp = 0;
  if (gained) syncHp(s);
  return gained;
}

/* Job change: three distinct items given AND max level, per the original. */
export function canPromote(s) {
  const job = JOBS[s.job];
  if (!job.next) return { ok: false, why: '더 오를 직급이 없다' };
  if (s.level < s.maxLevel) return { ok: false, why: `최대 레벨(${s.maxLevel}) 필요` };
  if (s.itemsGiven.length < 3) return { ok: false, why: `아이템 3종 필요 (현재 ${s.itemsGiven.length})` };
  return { ok: true };
}

export function promote(s) {
  const c = canPromote(s);
  if (!c.ok) return c;
  const job = JOBS[s.job];
  s.job = job.next;
  s.maxLevel = 30 + JOBS[s.job].tier * 30;
  s.itemsGiven = [];
  syncHp(s);
  s.hp = s.hpMax;                   // 전직은 새 출발이다
  // Level and salary carry over: job cost stays the same, exactly as the wiki
  // describes, so a promotion is pure upside.
  return { ok: true };
}

/* Reincarnation: swap job family at max tier. Bonus stats and level reset, the
   talent multiplier earned over a career does not. */
export function canReincarnate(s) {
  if (JOBS[s.job].next) return { ok: false, why: '최고 직급에서만 가능' };
  if (s.level < s.maxLevel) return { ok: false, why: '최대 레벨 필요' };
  return { ok: true };
}

export function reincarnate(s, newJobId) {
  const c = canReincarnate(s);
  if (!c.ok) return c;
  if (!JOBS[newJobId]) return { ok: false, why: '없는 직업' };
  s.job = newJobId;
  s.level = 1;
  s.maxLevel = 30 + JOBS[newJobId].tier * 30;
  s.bonus = { plan: 0, prog: 0, graph: 0, sound: 0, social: 0 };
  s.itemsGiven = [];
  s.reincarnations += 1;
  s.talent *= 1.12;                 // the whole point of going around again
  syncHp(s);
  s.hp = s.hpMax;
  return { ok: true };
}

export function addMotivation(s, n, rank) {
  const cap = rankInfo(rank).motivationCap;
  const scaled = n > 0 ? n * (traitMult(s, 'moodGain') || 1) : n;
  s.motivation = Math.max(0, Math.min(cap, s.motivation + scaled));
}

/* Candidates for the hiring screen. Higher company rank surfaces better people
   and, past rank 6, occasionally an already-promoted one. */
export function rollCandidates(rnd, rank, n = 3) {
  const pool = ['planner', 'programmer', 'designer', 'sound', 'networker'];
  const out = [];
  for (let i = 0; i < n; i++) {
    let job = pool[Math.floor(rnd() * pool.length)];
    if (rank >= 6 && rnd() > 0.72) job = JOBS[job].next || job;
    const talent = 0.72 + rnd() * (0.55 + Math.min(0.6, rank * 0.035));
    const s = makeStaff(rnd, job, { talent, level: 1 + Math.floor(rnd() * Math.min(12, rank * 1.5)) });
    s.hireCost = Math.round(s.salary * (7 + talent * 6));
    out.push(s);
  }
  return out;
}

export const STAFF_COLORS = {
  plan: P.gold, dev: '#6fa8dc', art: '#c98fd0', net: '#7cc98f',
};
