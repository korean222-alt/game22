/* The company: state, the week clock, and every action the UI can take.

   This module owns the whole simulation and knows nothing about rendering.
   `Game.listeners` is how the 3D layer and the DOM hear about things — a
   battle turn emits hit events the office animates, a release emits a banner.

   Save format is the plain state object, so localStorage round-trips it with
   JSON and nothing needs a migration layer yet. */

import {
  JOBS, PLATFORMS, MONETIZE, GENRES, CONTENTS, METHODS, STATS, rankInfo, RANK_UP_FANS, ITEMS,
  RESEARCH, researchCost, CONTRACTS, contractPay, MARKETING,
  marketingCost, floorCost, comboScore,
  STARTUP_GRANT, rescueAmount, rescueMorale,
  SHOP, shopItem, shopFor, GEAR_SLOTS, OVERTIME, DEX_SECTIONS, HP, bossFor, RAID,
  CONTENT_BY_ID, CONTENT_BASE, CONTENT_GACHA_COST, CONTENT_GACHA_DUP,
  EXHAUST,
} from './data.js';
import {
  FURNITURE_BY_ID, RESELL, comfortScore, comfortLevel, footprint, overlaps,
} from './furniture.js';
import { TUTORIAL, tutorialStep } from './tutorial.js';
import {
  rollCandidates, proposalPower, giveItem, promote, canPromote,
  reincarnate, canReincarnate, addMotivation, abilities, power, role, seedIds, itemCost,
  trainStamina, gainExp, expToNext, syncHp, healHp, hpRatio, drainHp,
  equipGear, unequipGear, canEquip, gearOf, isTired, isSpent, basePower,
  canUpgrade, applyUpgrade, upgradeList,
} from './staff.js';
import {
  generateProposal, startProject, battleTurn, battleTick, chooseCard, finishProject, debug,
  turnCost, seedProjectIds, previewQuality, previewBugs, funScore,
  ensureStages, currentStage, raidProgress, teamDown, advanceStage, stageName,
  forfeitStage, completion,
} from './project.js';
import { TASKS, rollEvent, grantReward, rewardText } from './events.js';
import {
  releaseGame, tickRelease, weeklyCosts, checkRankUp, cashCap, coinsFromRelease,
  researchFromProject,
} from './economy.js';
import { mulberry32 } from '../core/math.js';

/* Bumped from v1 deliberately rather than migrated. A v1 save was written by a
   build that generated the desks with the floor and handed you five founders;
   in this one desks exist only because the player bought them, so a v1 roster
   would load with every staffer assigned to a desk that no longer exists and
   standing in the lobby. Starting those saves over is the honest outcome, and
   the old key is dropped so it does not sit in storage forever. */
const SAVE_KEY = 'socialdev3d.save.v2';
const LEGACY_KEYS = ['socialdev3d.save.v1'];

/* 이름이 바뀐 소재의 옛 id. 세이브 안에는 contentId, dex.contents,
   discovered 의 키("장르|소재") 세 군데에 박혀 있으므로 불러올 때 한 번에
   옮긴다. 표를 남겨 두면 다음에 또 이름을 고칠 때 줄만 늘리면 된다. */
const CONTENT_ALIAS = { sports2: 'soccer' };
const aliasContent = (id) => CONTENT_ALIAS[id] || id;

/* 출시 직후의 실시간 판매. 18초에 열두 주치.
   화면을 막지 않게 된 뒤로 길이의 제약이 하나 풀렸다 — 예전에는 이 시간이
   곧 '아무것도 못 하는 시간' 이라 짧아야 했다. 이제는 봉우리가 보일 만큼
   길어야 한다: 정점이 보통 3주차에 서므로, 열두 주면 오르고 꺾이고 식는
   모양이 한 화면에 다 들어온다. 주당 1.5초면 막대가 서는 것이 눈에 보인다. */
const SALES = { secs: 18, weeks: 12 };

export class Game {
  constructor(seed = Date.now() & 0x7fffffff) {
    this.seed = seed;
    this.rnd = mulberry32(seed);
    this.listeners = [];
    this.reset();
  }

  on(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((f) => f !== fn); }; }
  emit(type, payload) { for (const fn of this.listeners) fn(type, payload); }

  reset(opts = {}) {
    const info = rankInfo(1);
    this.company = {
      name: opts.name || '이름 없는 스튜디오',
      // The grant IS the starting capital. There is no separate opening
      // balance: everything the studio owns on turn one came from it, which is
      // what makes the number legible when the popup shows it.
      money: STARTUP_GRANT,
      coins: 5,
      rank: 1,
      fans: 0,
      stamina: info.staminaMax,
      staminaMax: info.staminaMax,
      floors: 1,
      year: 1, month: 1, week: 1,
      platformKnowledge: 0,
      totalEarned: 0,
      shipped: 0,
      // Rank permits floors; money buys them. maxFloors is the ceiling.
      maxFloors: info.floors,
      researchPts: 0,
      research: {},                 // { [researchId]: level }
      trends: null,                 // { genreId, contentId, setAt }
      discovered: {},               // combo log: "genre|content" -> best score
      contract: null,               // { id, weeksLeft, pay, research }
      marketingId: 'none',
      // Furniture the player has put down: { uid, id, floor, x, z, rot }.
      // Desks come from here, so an empty list means nobody can be hired yet.
      placed: [],
      rescues: 0,                   // how many emergency grants have been taken
      founded: false,               // the naming + grant ceremony has happened
      tutorialDone: false,
      recentCombos: [],             // the last few genre|content keys shipped
      tasksDone: {},                // sales tasks already paid out
      eventsSeen: 0,
      // 상점에서 산 소모품·장비가 쌓이는 가방. { itemId: 개수 }
      // (가구 가방은 Game.bag 이다 — 이름은 같지만 다른 물건이고 다른 곳에 산다.)
      bag: {},
      // 뽑아서 가지고 있는 소재. 개발 중 '게임 내용' 카드는 여기서만 나온다.
      contentsOwned: [...CONTENT_BASE],
      gachaPulls: 0,
      // 도감. 본 것과 잡은 것이 여기에 남는다.
      dex: { genres: {}, contents: {}, bosses: {}, items: {}, jobs: {} },
      overtimeUsed: false,
      spentOnShop: 0,
    };
    // Bought but not yet placed. The bag is what makes buying and placing two
    // separate decisions rather than one click that teleports a desk somewhere.
    this.bag = [];
    this.pendingEvent = null;       // a weekly event waiting on the player
    this.staff = [];
    this.proposals = [];
    this.project = null;         // the project currently in development
    this.finished = null;        // finished, awaiting release
    this.releases = [];
    /* 출시 직후 화면 오른쪽에서 도는 실시간 판매. 저장하지 않는다 — 탭을 닫았다
       열면 그 판매는 이미 끝난 것으로 친다. */
    this.sales = null;
    this.candidates = [];
    this.history = [];
    this.log = [];

    // No founders. The studio opens as an empty floor with a grant in the bank,
    // so the first decisions — how many desks, who to seat at them — are the
    // player's rather than a starting roster's. The other branch seeded five
    // of them here; that is the thing the opening was rebuilt to remove.
    this.rollCandidates();
    this.rollTrends();
    this.note('오늘부터 사장님입니다. 책상을 사고 직원을 뽑으세요.');
  }

  /* The naming ceremony: sets the company name and hands over the grant, once.
     Called from the opening popup and by nothing else, so a save that has
     already been founded can never be handed a second grant. */
  found(name) {
    const c = this.company;
    if (c.founded) return { ok: false, why: '이미 창업했습니다' };
    c.name = (name || '').trim().slice(0, 18) || '이름 없는 스튜디오';
    c.founded = true;
    this.note(`「${c.name}」 설립. 창업 지원금 ₩${STARTUP_GRANT.toLocaleString()}이 입금되었다.`, 'good');
    this.emit('founded', { name: c.name, grant: STARTUP_GRANT });
    return { ok: true, name: c.name, grant: STARTUP_GRANT };
  }

  /* ---------- tutorial ---------- */
  tutorialStep() { return tutorialStep(this); }

  skipTutorial() {
    this.company.tutorialDone = true;
    this.emit('tutorial', null);
  }

  note(text, kind = 'info') {
    this.log.unshift({ text, kind, at: this.dateLabel() });
    if (this.log.length > 60) this.log.pop();
    this.emit('log', { text, kind });
  }

  dateLabel() { const c = this.company; return `${c.year}년차 ${c.month}월 ${c.week}주`; }

  /* Everything company-wide that modifies a project. Assembled in one place so
     the battle, the completion and the release can never disagree about which
     research levels or trends were in force. */
  ctx(extra = {}) {
    return {
      research: this.company.research,
      trends: this.company.trends,
      contents: this.ownedContents(),
      ...extra,
    };
  }

  /* ---------- 소재 뽑기 ----------
     코인은 쌓이기만 하고 쓸 데가 없었고, 소재는 처음부터 전부 열려 있어서
     "쓸 수 있는 재료가 늘어난다" 는 감각이 없었다. 둘을 붙였다. */
  ownedContents() {
    const c = this.company;
    if (!c.contentsOwned || !c.contentsOwned.length) c.contentsOwned = [...CONTENT_BASE];
    return c.contentsOwned;
  }

  hasContent(id) { return this.ownedContents().includes(id); }

  lockedContents() {
    const have = new Set(this.ownedContents());
    return CONTENTS.filter((c) => !have.has(c.id));
  }

  gachaCost() { return CONTENT_GACHA_COST; }

  /* 한 번 뽑는다. 남은 소재가 있으면 그중 하나가 열리고, 다 모았으면
     코인을 돌려주는 대신 연구 포인트로 바꿔 준다 — 눌러서 손해 보는
     버튼은 만들지 않는다. */
  drawContent() {
    const c = this.company;
    const cost = this.gachaCost();
    if (c.coins < cost) return { ok: false, why: `코인이 부족합니다 (🪙 ${cost} 필요)` };
    c.coins -= cost;
    c.gachaPulls = (c.gachaPulls || 0) + 1;
    const locked = this.lockedContents();
    if (!locked.length) {
      c.researchPts += CONTENT_GACHA_DUP.research;
      c.coins += CONTENT_GACHA_DUP.coins;
      this.note(`소재를 모두 모았습니다. 연구 +${CONTENT_GACHA_DUP.research} · 코인 +${CONTENT_GACHA_DUP.coins}`, 'good');
      this.emit('gacha', { dup: true });
      this.save();
      return { ok: true, dup: true };
    }
    const got = locked[Math.floor(this.rnd() * locked.length)];
    this.ownedContents().push(got.id);
    this.dexSee('contents', got.id);
    this.note(`새 소재 획득: ${got.ko}! (남은 소재 ${locked.length - 1}종)`, 'good');
    this.emit('gacha', { content: got, left: locked.length - 1 });
    this.checkTasks();
    this.save();
    return { ok: true, content: got, left: locked.length - 1 };
  }

  /* ---------- 테스트 도구 ----------
     디버그용 손잡이. 사장이 층·랭크 해금 같은 후반 화면을 직접 눌러 볼 수
     있어야 하고, 그러자고 몇 시간을 플레이하게 만들 이유는 없다. 회사 탭
     맨 아래 '테스트 도구' 에서만 부른다. */
  cheatMoney(n = 1_000_000) {
    this.earn(n);
    this.note(`[테스트] 자금 +₩${Math.round(n).toLocaleString('ko-KR')}`, 'good');
    this.emit('money', this.company.money);
    this.save();
    return { ok: true, money: this.company.money };
  }

  /* 랭크는 팬 수가 올린다. 랭크만 억지로 밀어 올리면 팬과 어긋나서 다음
     승급이 즉시 또 터지므로, 다음 문턱까지 팬을 채워 정상 경로로 올린다. */
  cheatRankUp(times = 1) {
    for (let i = 0; i < times; i++) {
      const need = RANK_UP_FANS(this.company.rank);
      if (this.company.fans < need) this.company.fans = need;
      this._maybeRankUp();
    }
    this.emit('staff', null);
    this.checkTasks();
    this.save();
    return { ok: true, rank: this.company.rank, maxFloors: this.company.maxFloors };
  }

  cheatCoins(n = 10) {
    this.company.coins += n;
    this.note(`[테스트] 코인 +${n}`, 'good');
    this.emit('money', this.company.money);
    this.save();
    return { ok: true, coins: this.company.coins };
  }

  cheatStamina() {
    this.company.stamina = this.info().staminaMax;
    for (const s of this.staff) { s.hp = s.hpMax; }
    this.note('[테스트] 스태미나·체력 회복', 'good');
    this.emit('staff', null);
    this.save();
    return { ok: true };
  }

  roleOf(staffer) { return role(staffer); }

  teamOf(project) {
    if (!project) return [];
    return project.team.map((id) => this.staff.find((s) => s.id === id)).filter(Boolean);
  }
  info() { return rankInfo(this.company.rank); }
  staffById() { return new Map(this.staff.map((s) => [s.id, s])); }
  managed() { return this.releases.filter((r) => r.managing); }

  /* ---------- money ---------- */
  spend(n) {
    if (this.company.money < n) return false;
    this.company.money -= n;
    return true;
  }

  earn(n) {
    const cap = cashCap(this.company);
    this.company.money = Math.min(cap, this.company.money + n);
    this.company.totalEarned += n;
  }

  /* ---------- 가구 ----------
     Buying puts a piece in the bag; placing takes it out and pins it to a
     floor. Keeping those separate is what makes the placement mode a mode:
     the shop is a spending decision, the floor is a spatial one, and a player
     who buys six desks can lay them out at leisure. */
  buyFurniture(id) {
    const def = FURNITURE_BY_ID.get(id);
    if (!def) return { ok: false, why: '없는 가구' };
    if (!this.spend(def.price)) return { ok: false, why: '자금 부족' };
    const item = { uid: 'f' + (this._fuid = (this._fuid || 0) + 1) + '_' + Date.now().toString(36), id };
    this.bag.push(item);
    this.note(`${def.ko} 구입. 가방에서 배치하세요.`, 'good');
    this.emit('furniture', { bought: item });
    return { ok: true, item };
  }

  /* Selling from the bag only. A placed piece has to be picked up first, which
     keeps "where is my stuff" answerable: it is on a floor, or in the bag. */
  sellFurniture(uid) {
    const i = this.bag.findIndex((b) => b.uid === uid);
    if (i < 0) return { ok: false, why: '가방에 없다' };
    const def = FURNITURE_BY_ID.get(this.bag[i].id);
    const back = Math.round((def ? def.price : 0) * RESELL);
    this.bag.splice(i, 1);
    this.earn(back);
    this.note(`${def ? def.ko : '가구'} 처분. ₩${back.toLocaleString()} 회수.`);
    this.emit('furniture', null);
    return { ok: true, back };
  }

  /* Can this piece stand here? `zoneOk` and `clearOfWalls` are supplied by the
     view, which owns the floor plan and the collision grid; everything the
     simulation can answer for itself — is it in the bag, does it hit another
     piece — is answered here so the rules live in one place. */
  canPlace(uid, floor, x, z, rot, checks = {}) {
    const item = this.bag.find((b) => b.uid === uid);
    if (!item) return { ok: false, why: '가방에 없는 가구' };
    const def = FURNITURE_BY_ID.get(item.id);
    if (!def) return { ok: false, why: '없는 가구' };
    if (floor >= this.company.floors) return { ok: false, why: '입주하지 않은 층' };
    const f = footprint(def, rot);
    if (checks.zoneOk && !checks.zoneOk(floor, x, z, f.w, f.d)) {
      return { ok: false, why: '배치할 수 없는 자리 (파란 구역 안에만)' };
    }
    if (checks.clearOfWalls && !checks.clearOfWalls(floor, x, z, f.w, f.d)) {
      return { ok: false, why: '벽이나 기존 설비와 겹칩니다' };
    }
    // A rug lies on the floor and is walked over, so it only fights other rugs.
    const cand = { x, z, rot };
    for (const p of this.company.placed) {
      if (p.floor !== floor) continue;
      const other = FURNITURE_BY_ID.get(p.id);
      if (!other) continue;
      if (def.flat && !other.flat) continue;
      if (other.flat && !def.flat) continue;
      if (overlaps(cand, def, p, other)) return { ok: false, why: '다른 가구와 겹칩니다' };
    }
    return { ok: true, def };
  }

  placeFurniture(uid, floor, x, z, rot, checks) {
    const chk = this.canPlace(uid, floor, x, z, rot, checks);
    if (!chk.ok) return chk;
    const i = this.bag.findIndex((b) => b.uid === uid);
    const [item] = this.bag.splice(i, 1);
    this.company.placed.push({ uid: item.uid, id: item.id, floor, x, z, rot: rot & 3 });
    this.emit('furniture', { placed: item.uid });
    return { ok: true };
  }

  /* Back into the bag, free. Undoing a placement must not cost anything or the
     mode becomes something players avoid using. */
  pickUpFurniture(uid) {
    const i = this.company.placed.findIndex((p) => p.uid === uid);
    if (i < 0) return { ok: false };
    const [p] = this.company.placed.splice(i, 1);
    this.bag.push({ uid: p.uid, id: p.id });
    this.emit('furniture', { pickedUp: p.uid });
    return { ok: true };
  }

  comfort() {
    return comfortLevel(comfortScore(this.company.placed), this.staff.length);
  }

  /* ---------- desks ---------- */
  /* Assign every staffer to a desk on a floor matching their discipline where
     one is free. The separation of planners from developers is not cosmetic:
     proposalPower pays a bonus for sitting on the matching floor.

     `desks` now comes from the player's placed furniture rather than the floor
     generator, so this runs again on every placement change. */
  assignDesks(desks) {
    this.desks = desks;
    const open = desks.filter((d) => d.floor < this.company.floors);
    const taken = new Set();
    for (const s of this.staff) {
      const want = role(s);
      let d = open.find((x) => !taken.has(x.id) && x.role === want);
      if (!d) d = open.find((x) => !taken.has(x.id));
      if (d) { taken.add(d.id); s.deskId = d.id; } else s.deskId = null;
    }
    this.emit('desks', null);
  }

  floorRoleOf(staffer) {
    if (!this.desks || !staffer.deskId) return null;
    const d = this.desks.find((x) => x.id === staffer.deskId);
    return d ? d.role : null;
  }

  /* ---------- hiring ---------- */
  rollCandidates(quality = 1) {
    this.candidates = rollCandidates(this.rnd, this.company.rank, 3, quality);
    this.emit('staff', null);
  }

  /* Desks on floors the company actually occupies. This is the real headcount
     ceiling now — rank raises the cap, but a desk is what fills a seat. */
  deskCount() {
    return (this.desks || []).filter((d) => d.floor < this.company.floors).length;
  }

  freeDesks() { return Math.max(0, this.deskCount() - this.staff.length); }

  hire(candidateId) {
    const c = this.candidates.find((x) => x.id === candidateId);
    if (!c) return { ok: false, why: '없는 후보' };
    if (this.staff.length >= this.info().staffCap) {
      return { ok: false, why: `정원 초과 (랭크 ${this.company.rank} 정원 ${this.info().staffCap}명)` };
    }
    // Somewhere to sit comes before someone to sit there. It is the one rule
    // that ties the office to the roster, and it is why the game opens in the
    // furniture shop rather than on the hiring board.
    if (this.freeDesks() <= 0) {
      return { ok: false, why: '빈 책상이 없습니다. 사무실 탭에서 책상을 사서 배치하세요.' };
    }
    if (!this.spend(c.hireCost)) return { ok: false, why: '자금 부족' };
    this.staff.push(c);
    this.dexSee('jobs', c.job);
    this.candidates = this.candidates.filter((x) => x.id !== candidateId);
    this.note(`${c.name} (${JOBS[c.job].ko}) 입사.`, 'good');
    if (this.desks) this.assignDesks(this.desks);
    // The office walks a new hire in through the front door rather than
    // teleporting them into a chair, so hiring is something you SEE happen.
    this.emit('hired', c);
    this.emit('staff', null);
    this.checkTasks();
    return { ok: true };
  }

  fire(staffId) {
    const s = this.staff.find((x) => x.id === staffId);
    if (!s) return { ok: false };
    if (this.project && this.project.team.includes(staffId)) {
      return { ok: false, why: '개발 중인 팀원은 내보낼 수 없다' };
    }
    this.staff = this.staff.filter((x) => x.id !== staffId);
    this.note(`${s.name} 퇴사.`, 'bad');
    // Emitted BEFORE 'staff' so the view can hold on to the agent and walk it
    // out of the building instead of deleting a body that is still in a chair.
    this.emit('fired', s);
    this.emit('staff', null);
    return { ok: true };
  }

  /* ---------- staff growth ---------- */
  train(staffId, itemId) {
    const s = this.staff.find((x) => x.id === staffId);
    const item = ITEMS.find((i) => i.id === itemId);
    if (!s || !item) return { ok: false };
    // A gift costs stamina as well as money. Without that, growth is limited
    // only by cash and the whole company maxes out in a handful of weeks —
    // spending stamina here means training genuinely competes with shipping.
    const stam = trainStamina(s);
    if (this.company.stamina < stam) return { ok: false, why: `스태미나 ${stam} 필요` };
    const cost = itemCost(s, item);
    if (!this.spend(cost)) return { ok: false, why: '자금 부족' };
    this.company.stamina -= stam;
    const r = giveItem(s, itemId, this.company.rank);
    if (!r.ok) { this.company.money += cost; this.company.stamina += stam; return r; }
    this.note(`${s.name}에게 ${item.ko} 지급 → Lv.${s.level}`, 'good');
    this.emit('staff', null);
    return r;
  }

  promoteStaff(staffId) {
    const s = this.staff.find((x) => x.id === staffId);
    if (!s) return { ok: false };
    const c = canPromote(s);
    if (!c.ok) return c;
    const before = JOBS[s.job].ko;
    promote(s);
    this.dexSee('jobs', s.job);
    this.note(`${s.name} 전직: ${before} → ${JOBS[s.job].ko}`, 'good');
    if (this.desks) this.assignDesks(this.desks);
    this.emit('staff', null);
    return { ok: true };
  }

  reincarnateStaff(staffId, newJob) {
    const s = this.staff.find((x) => x.id === staffId);
    if (!s) return { ok: false };
    const r = reincarnate(s, newJob);
    if (r.ok) {
      this.dexSee('jobs', newJob);
      this.note(`${s.name} 환생 → ${JOBS[newJob].ko}. 기본 재능은 남는다.`, 'good');
      if (this.desks) this.assignDesks(this.desks);
      this.emit('staff', null);
    }
    return r;
  }

  /* ---------- proposals ---------- */
  /* Total planning power across every floor, matching the original's rule that
     all floors' writers feed the proposal grade. */
  totalPlanPower() {
    // A whiteboard on the wall and somewhere decent to sit are worth a little
    // planning power. Small on purpose: furniture supports a good roster, it
    // does not replace one.
    return this.staff.reduce((a, s) => a + proposalPower(s, this.floorRoleOf(s)), 0)
      * this.comfort().planBonus;
  }

  makeProposal() {
    if (this.company.stamina < 1) return { ok: false, why: '스태미나 부족' };
    this.company.stamina -= 1;
    // The staffer with the most planning weight is credited as the author, and
    // is the one who gains motivation if the game ships.
    let author = null, best = -1;
    for (const s of this.staff) {
      const p = proposalPower(s, this.floorRoleOf(s));
      if (p > best) { best = p; author = s; }
    }
    const pr = generateProposal(this.rnd, author, this.totalPlanPower(), this.company.rank,
      this.company.research);
    this.proposals.unshift(pr);
    this.dexSee('genres', pr.genreId);
    if (this.proposals.length > 8) this.proposals.pop();
    const g = GENRES.find((x) => x.id === pr.genreId);
    this.note(`${pr.authorName}의 기획서: 「${pr.title}」 ${g.ko} ★${pr.grade}`);
    this.emit('proposals', pr);
    return { ok: true, proposal: pr };
  }

  availablePlatforms() { return PLATFORMS.filter((p) => this.company.rank >= p.rank); }
  availableMonetize() { return MONETIZE.filter((m) => this.company.rank >= m.rank); }

  /* ---------- development ---------- */
  beginDevelopment({ proposalId, platformId, monetizeId, teamIds, seriesOfId }) {
    if (this.project) return { ok: false, why: '이미 개발 중' };
    if (this.finished) return { ok: false, why: '완성작을 먼저 출시하세요' };
    // 실시간 판매는 더 이상 화면을 막지 않는다. 오른쪽 카드에서 혼자 돌고,
    // 그 사이에도 기획서를 뽑고 다음 게임에 착수할 수 있다 — 15초 동안
    // 아무것도 못 하게 만드는 것은 연출이 아니라 대기시간이었다.
    const pr = this.proposals.find((p) => p.id === proposalId);
    if (!pr) return { ok: false, why: '없는 기획서' };
    const team = teamIds.map((id) => this.staff.find((s) => s.id === id)).filter(Boolean);
    if (!team.length) return { ok: false, why: '팀원을 배정하세요' };

    const seriesOf = seriesOfId ? this.releases.find((r) => r.id === seriesOfId) : null;
    const p = startProject({
      proposal: pr, platformId, monetizeId, team,
      rank: this.company.rank, seriesOf,
    });
    // 스태미나는 **여기서** 나간다. 게임을 만드는 데 쓰는 것이 스태미나이고,
    // 보스를 잡는 데 쓰는 것은 직원들의 체력이다.
    if (this.company.stamina < p.devStamina) {
      return { ok: false, why: `개발 착수에 스태미나 ${p.devStamina} 필요 (보유 ${this.company.stamina})` };
    }
    if (!this.spend(p.devCost)) return { ok: false, why: `개발비 부족 (₩${p.devCost.toLocaleString()})` };
    this.company.stamina -= p.devStamina;

    this.proposals = this.proposals.filter((x) => x.id !== proposalId);
    this.project = p;
    this.dexSee('bosses', p.genreId);
    this.note(`「${p.title}」 개발 착수! ${p.stages.length}마리를 잡으면 완성이다.`, 'good');
    this.emit('project', p);
    this.emit('raid', p);
    return { ok: true, project: p };
  }

  /* ---------- 자동 전투 ----------
     스태미나는 개발 착수에서 이미 냈다. 여기서는 한 점도 들지 않는다 —
     보스를 잡는 것은 직원들이고, 그들이 쓰는 것은 자기 체력이다.

     dt(초)를 받아 게이지를 돌린다. UI 의 rAF 루프가 매 프레임 부른다. */
  devTick(dt, speed = 1) {
    const p = this.project;
    if (!p) return { ok: false, idle: true };
    ensureStages(p);
    if (p.pendingCards) return { ok: true, idle: true, blocked: 'card' };
    if (p.paused) return { ok: true, idle: true, blocked: 'paused' };

    const staff = this.staffById();
    if (teamDown(p, staff)) {
      /* 팀 전원이 쓰러졌다. 이 단계는 여기서 끝난다.

         예전에는 "다음 주로 넘기기" 로 체력을 공짜로 채워 같은 보스를 계속
         팰 수 있었다. 시간이 무한하면 밥은 아무도 사지 않는 물건이 된다.
         이제 EXHAUST.grace 초 안에 밥을 먹여 일으키지 못하면 남은 체력만큼
         **못 만든 채로** 마감하고 다음 보스로 넘어간다. */
      if (!p.exhausted) {
        p.exhausted = true;
        p.exhaustT = 0;
        this.note('팀이 모두 쓰러졌다. 밥을 먹이지 않으면 이 단계는 이대로 마감된다.', 'bad');
        this.emit('battle', { project: p, events: [{ kind: 'exhausted', grace: EXHAUST.grace }] });
      }
      p.exhaustT = (p.exhaustT || 0) + Math.min(0.25, Math.max(0, dt));
      if (p.exhaustT >= EXHAUST.grace) return this.wrapUpStage();
      return {
        ok: true, idle: true, blocked: 'exhausted',
        left: Math.max(0, EXHAUST.grace - p.exhaustT),
      };
    }
    p.exhausted = false;
    p.exhaustT = 0;

    const r = battleTick(p, staff, this.rnd, this.ctx(), dt * speed);
    if (!r.events.length) return { ok: true, idle: r.idle };
    this._battleEvents(p, r.events);
    return { ok: true, ...r };
  }

  /* 한 라운드를 통째로. 시뮬레이터와 "즉시 진행" 이 쓴다. */
  devTurn() {
    const p = this.project;
    if (!p) return { ok: false, why: '개발 중인 프로젝트가 없다' };
    ensureStages(p);
    if (p.pendingCards) return { ok: false, why: '아이디어를 먼저 고르세요' };
    const staff = this.staffById();
    // 여기서는 마감을 걸지 않는다. 한 라운드 버튼(과 스페이스바)이 팀을
    // 말없이 접어 버리면, 실수로 누른 키 하나가 게임의 완성도를 깎는다.
    // 마감은 전투 화면의 유예 시간이 끝나거나, 주를 넘길 때 걸린다.
    if (teamDown(p, staff)) {
      return { ok: false, exhausted: true, why: '팀이 전부 쓰러졌다. 밥을 먹이거나 전투 화면에서 마감하세요.' };
    }
    const r = battleTurn(p, staff, this.rnd, this.ctx());
    this._battleEvents(p, r.events);
    return { ok: true, ...r };
  }

  /* ---------- 탈진 마감 ----------
     지금 상대하던 보스를 남은 체력째로 접고 다음으로 넘어간다. 자동으로도
     걸리고(유예 시간이 지나면), 플레이어가 "이대로 마감" 을 눌러도 걸린다. */
  wrapUpStage() {
    const p = this.project;
    if (!p || p.done || p.pendingCards) return { ok: false, why: '지금은 마감할 수 없다' };
    ensureStages(p);
    const st = currentStage(p);
    const left = Math.round((p.hp / Math.max(1, p.hpMax)) * 100);
    const events = forfeitStage(p, this.rnd, this.ctx());
    if (!events.length) return { ok: false, why: '지금은 마감할 수 없다' };
    p.exhausted = false;
    p.exhaustT = 0;
    this.note(`${st.name || st.ko} 을(를) ${left}% 남긴 채 마감했다. 완성도 ${Math.round(completion(p) * 100)}%.`, 'bad');
    this._battleEvents(p, events);
    return { ok: true, forfeited: true, events };
  }

  /* 배틀 이벤트를 로그와 3D 로 흘려보낸다. 스테이지가 넘어가는 자리도
     여기다 — 보스가 죽으면 카드가 서고, 카드를 고르면 다음 놈이 선다. */
  _battleEvents(p, events) {
    let cleared = false, complete = false;
    for (const ev of events) {
      if (ev.kind === 'boss') {
        this.note(`${currentStage(p).name || '아이디어'}의 ${ev.ko}! ${ev.line}`, 'bad');
      } else if (ev.kind === 'stageClear') {
        cleared = true;
        this.note(`${ev.name} 격파! (${ev.stage + 1}/${p.stages.length})`, 'good');
      } else if (ev.kind === 'stageStart') {
        this.note(`${ev.name} 등장!`, 'bad');
      } else if (ev.kind === 'forfeit') {
        this.note(`${ev.name} — 체력 ${ev.left}% 를 남긴 채 마감. 그만큼 게임이 덜 만들어졌다.`, 'bad');
      } else if (ev.kind === 'complete') {
        complete = true;
      } else if (ev.kind === 'down') {
        this.note(`${ev.name} 이(가) 쓰러졌다.`, 'bad');
      }
    }
    this.emit('battle', { project: p, events });
    if (complete) this._completeProject();
    else this.emit('project', p);
    return { cleared, complete };
  }

  pickCard(optionId) {
    const p = this.project;
    if (!p || !p.pendingCards) return { ok: false };
    const r = chooseCard(p, optionId);
    if (r.kind === 'content') {
      const c = CONTENTS.find((x) => x.id === p.contentId);
      this.note(`게임 내용 결정: ${c ? c.ko : p.contentId}`);
      this.dexSee('contents', p.contentId);
    } else {
      const m = METHODS.find((x) => x.id === p.methodId);
      this.note(`개발 방식 결정: ${m ? m.ko : p.methodId}`);
    }
    if (r.started) {
      this.note(`${r.started.name} 등장!`, 'bad');
      this.emit('battle', { project: p, events: [{ kind: 'stageStart', ...r.started }] });
    }
    if (r.complete) this._completeProject();
    else this.emit('project', p);
    return r;
  }

  /* 사무실로 돌아갈 때 전투를 멈춘다. 아레나 밖에서 체력이 말없이 녹는
     것만큼 나쁜 일은 없다. */
  pauseBattle(on = true) {
    if (this.project) { this.project.paused = !!on; this.emit('project', this.project); }
  }

  raidProgress() { return this.project ? raidProgress(this.project) : 0; }

  _completeProject() {
    const p = this.project;
    const res = finishProject(p, this.staffById(), this.rnd, this.ctx());
    if (res.author) addMotivation(res.author, 1, this.company.rank);

    // Research earned, and the combo written into the discovery log.
    const rp = researchFromProject(p);
    this.company.researchPts += rp;
    let discovered = null;
    if (p.contentId) {
      this.dexSee('contents', p.contentId);
      const key = `${p.genreId}|${p.contentId}`;
      const score = comboScore(p.genreId, p.contentId);
      const prev = this.company.discovered[key];
      if (!prev) discovered = { key, score };
      if (!prev || score > prev.score || p.criticTotal > prev.critic) {
        this.company.discovered[key] = {
          score, critic: Math.max(p.criticTotal, prev ? prev.critic : 0), title: p.title,
        };
      }
    }
    // Everyone who worked on it learns from it. A bigger, better-received game
    // teaches more, so the team that ships ambitious work grows fastest.
    const xp = Math.round(20 + (p.scale || p.hpMax) / 300 + p.criticTotal * 2);
    for (const id of p.team) {
      const s = this.staff.find((x) => x.id === id);
      if (!s) continue;
      s.gamesShipped += 1;
      const up = gainExp(s, xp);
      if (up) this.note(`${s.name} 경험치 상승 → Lv.${s.level}`, 'good');
    }
    // 도감: 이 아이디어를 잡았다. 최고 점수와 최단 턴이 남는다.
    const dex = this.company.dex.bosses;
    const prevB = typeof dex[p.genreId] === 'object' ? dex[p.genreId] : null;
    dex[p.genreId] = {
      beaten: (prevB ? prevB.beaten : 0) + 1,
      best: Math.max(prevB ? prevB.best : 0, p.criticTotal),
      turns: prevB && prevB.turns ? Math.min(prevB.turns, p.turn) : p.turn,
      title: p.title,
    };

    this.project = null;
    this.finished = p;
    this.company.marketingId = 'none';
    // Every proposal on the desk was written for a company that has now moved
    // on: finishing a game clears the pile and you draw fresh ones. Without
    // this a player banks a five-star proposal in year one and never has to
    // think about 기획 again.
    const dropped = this.proposals.length;
    this.proposals = [];
    this.note(`「${p.title}」 완성! 평론가 합계 ${p.criticTotal}점, 버그 ${p.bugs}개 · 연구 +${rp}`,
      p.hallOfFame ? 'good' : 'info');
    if (dropped) this.note(`남아 있던 기획서 ${dropped}건은 폐기됐다. 새로 뽑아야 한다.`);
    if (discovered) {
      const g = GENRES.find((x) => x.id === p.genreId);
      const c = CONTENTS.find((x) => x.id === p.contentId);
      this.company.researchPts += 8;
      this.company.coins += 1;
      this.note(`새 조합 발견: ${g ? g.ko : ''} × ${c ? c.ko : ''} — 도감에 기록됐다. 연구 +8 · 코인 +1`, 'good');
      this.emit('discovery', { ...discovered, genreKo: g ? g.ko : '', contentKo: c ? c.ko : '' });
    }
    if (p.hallOfFame) this.note('명예의 전당 등재! 이제 속편을 만들 수 있다.', 'good');
    this.emit('proposals', null);
    this.emit('finished', p);
    this.checkTasks();
  }

  debugProject() {
    const p = this.finished;
    if (!p || p.bugs <= 0) return { ok: false, why: '고칠 버그가 없다' };
    if (this.company.stamina < 1) return { ok: false, why: '스태미나 부족' };
    this.company.stamina -= 1;
    const wasHof = p.hallOfFame;
    const r = debug(p, this.staffById(), this.rnd);
    const gained = r.gained > 0 ? ` · 평론가 +${r.gained}점 (${p.criticTotal}점)` : '';
    this.note(`디버그: 버그 ${r.fixed}개 수정 (남은 ${p.bugs}개)${gained}`, r.gained > 0 ? 'good' : 'info');
    if (!wasHof && p.hallOfFame) this.note('버그를 잡아 명예의 전당에 올랐다!', 'good');
    this.emit('finished', p);
    return { ok: true, ...r };
  }

  release() {
    const p = this.finished;
    if (!p) return { ok: false, why: '출시할 게임이 없다' };
    const active = this.managed();
    if (active.length >= this.info().managedCap) {
      return { ok: false, why: `동시 운영은 ${this.info().managedCap}작품까지. 하나를 서비스 종료하세요.` };
    }
    const mk = MARKETING.find((x) => x.id === this.company.marketingId) || MARKETING[0];
    const mkCost = marketingCost(mk, p.devCost);
    if (mkCost > 0 && !this.spend(mkCost)) {
      return { ok: false, why: `홍보비 부족 (₩${mkCost.toLocaleString()})` };
    }
    const { release, fansGained } = releaseGame(p, this.company, this.rnd,
      this.ctx({ marketingId: mk.id, team: this.teamOf(p), recent: this.company.recentCombos || [] }));
    this.releases.unshift(release);
    this.company.fans += fansGained;
    this.company.coins += coinsFromRelease(release);
    this.company.shipped += 1;
    this.history.unshift({
      title: p.title, genreKo: p.genreKo, contentKo: p.contentKo,
      criticTotal: p.criticTotal, users: release.users, at: this.dateLabel(),
    });
    this.finished = null;
    // The last three shipped pairings, so 재탕 can be detected on the next one.
    const key = `${p.genreId}|${p.contentId}`;
    this.company.recentCombos = [key, ...(this.company.recentCombos || [])].slice(0, 3);
    const mkNote = mk.id === 'none' ? '' : ` · ${mk.ko} ₩${mkCost.toLocaleString()}`;
    const trendNote = release.trendHit ? ' · 유행을 탔다!' : '';
    this.note(`「${release.title}」 출시! 초기 유저 ${release.users.toLocaleString()}명, 팬 +${fansGained.toLocaleString()}${mkNote}${trendNote}`, 'good');
    for (const n of release.notes || []) {
      if (n.cls === 'bad') this.note(n.ko, 'bad');
    }
    this.emit('release', release);
    this._startSalesRun(release, fansGained);
    this._maybeRankUp();
    this.checkTasks();
    return { ok: true, release };
  }

  /* ══════════════════════ 출시 직후의 실시간 판매 ══════════════════════

     출시한 게임의 매출은 원래 '다음 주로 넘기기' 를 누를 때마다 한 줄씩
     들어왔다. 판 것은 게임인데 그 사실이 화면에 나타나는 순간이 없었다는
     뜻이다 — 버튼을 누르면 숫자가 이미 바뀌어 있을 뿐이었다.

     그래서 출시하면 15초 동안 화면에서 **실시간으로 팔린다**. 15초에
     SALES.weeks 주치가 흐르고, 막대가 하나씩 서고, 자금이 눈앞에서 오른다.
     실제로 흐르는 것은 그 게임의 판매 주차뿐이다: 달력은 그대로고, 받는 돈의
     총액도 예전과 같다. 바뀐 것은 **언제 보여주느냐** 하나다.

     이 15초 동안에는 새 게임을 만들 수 없고 주도 넘길 수 없다. 정산을
     확인하고 나서야 다음 판이 시작된다. */
  _startSalesRun(rel, fansGained) {
    // 앞의 판매가 아직 돌고 있으면 접는다. 카드는 하나뿐이고, 두 판이
    // 같은 자리에서 겹치면 어느 게임의 그래프인지 알 수가 없다.
    if (this.sales) this.closeSalesRun();
    this.sales = {
      id: rel.id,
      title: rel.title,
      secs: SALES.secs,
      weeks: SALES.weeks,
      t: 0,
      done: 0,            // 지금까지 흘린 주차
      total: 0,           // 이번 판매로 들어온 돈
      peak: 0,            // 가장 많이 판 주 (그래프의 위쪽 눈금)
      points: [],         // [{ w, income, users }]
      users: rel.launchUsers || rel.users,
      fans: fansGained || 0,
      event: null,        // 방금 터진 사건 (배지로 뜬다)
      events: [],
      ended: false,
    };
    this.emit('sales', this.sales);
    return this.sales;
  }

  /* UI 의 rAF 루프가 매 프레임 부른다. 전투와 같은 시계를 쓰므로 탭이
     백그라운드로 가면 판매도 같이 멈춘다. */
  salesTick(dt) {
    const s = this.sales;
    if (!s || s.ended) return s;
    const rel = this.releases.find((r) => r.id === s.id);
    if (!rel) { s.ended = true; this.emit('sales', s); return s; }
    s.t += dt;
    const per = s.secs / s.weeks;
    const want = Math.min(s.weeks, Math.floor(s.t / per));
    let changed = false;
    while (s.done < want) {
      const { income, event } = tickRelease(rel, this.rnd);
      this.earn(income);
      s.done += 1;
      s.total += income;
      s.peak = Math.max(s.peak, income);
      s.points.push({ w: rel.weeks, income, users: rel.users, event });
      if (event) {
        s.event = { ...event, at: s.done };
        s.events = [...(s.events || []), s.event].slice(-4);
        this.note(`${event.emoji} 「${s.title}」 ${event.ko} — 이번 주 매출 ${event.pct > 0 ? '+' : ''}${event.pct}%`,
          event.cls === 'bad' ? 'bad' : 'good');
      }
      changed = true;
      if (!rel.managing) { s.done = s.weeks; break; }   // 유저가 다 빠졌다
    }
    if (s.done >= s.weeks) {
      s.ended = true;
      changed = true;
      this.note(`「${s.title}」 ${s.done}주 판매 정산: ₩${s.total.toLocaleString()}`, 'good');
    }
    if (changed) this.emit('sales', s);
    return s;
  }

  /* 정산을 확인했다. 여기서부터 다시 게임을 만들 수 있다. */
  closeSalesRun() {
    if (!this.sales) return null;
    const s = this.sales;
    this.sales = null;
    this.emit('sales', null);
    this.save();
    return s;
  }

  selling() { return !!this.sales; }

  endService(releaseId) {
    const r = this.releases.find((x) => x.id === releaseId);
    if (!r || !r.managing) return { ok: false };
    r.managing = false;
    this.note(`「${r.title}」 서비스 종료. 누적 매출 ₩${r.earned.toLocaleString()}`);
    this.emit('release', r);
    return { ok: true };
  }

  _maybeRankUp() {
    let up = checkRankUp(this.company);
    while (up) {
      this.note(`회사 랭크 ${up.rank} 달성! 정원 ${up.info.staffCap}명, 스태미나 ${up.info.staminaMax}`, 'good');
      if (up.unlockedFloor) {
        this.note(`${up.info.floors}층까지 사용할 수 있게 되었다.`, 'good');
        this.emit('floors', this.company.floors);
      }
      this.emit('rank', up);
      up = checkRankUp(this.company);
    }
  }

  /* ---------- 사무실 ----------
     Rank permits a floor; money buys it. Making expansion a purchase rather
     than an automatic unlock turns "should I grow?" into a real decision
     against payroll, because every floor keeps charging upkeep afterwards. */
  nextFloorCost() { return floorCost(this.company.floors + 1); }

  canBuyFloor() {
    const c = this.company;
    if (c.floors >= (c.maxFloors || 1)) {
      return { ok: false, why: `랭크 ${1 + c.floors * 4} 부터 다음 층을 쓸 수 있다` };
    }
    if (c.floors >= 5) return { ok: false, why: '최고층까지 확장했다' };
    if (c.money < this.nextFloorCost()) return { ok: false, why: '자금 부족' };
    return { ok: true };
  }

  buyFloor() {
    const chk = this.canBuyFloor();
    if (!chk.ok) return chk;
    const cost = this.nextFloorCost();
    this.spend(cost);
    this.company.floors += 1;
    this.note(`${this.company.floors}층 입주 완료. 주간 유지비가 늘어난다.`, 'good');
    this.emit('floors', this.company.floors);
    this.emit('staff', null);
    return { ok: true, floors: this.company.floors };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     상점 · 가방 · 체력
     원작의 상점을 그대로 옮긴 자리다. 물건은 사면 **가방에 들어가고**, 쓸
     때 효과가 난다. 음식은 직원 체력을, 음료는 회사 스태미나를, 장난감은
     의욕을 올리고, 장비는 직원에게 장착돼 능력치와 품질 축을 영구히 올린다.
     ═══════════════════════════════════════════════════════════════════════ */

  shopStock() { return shopFor(this.company.rank); }

  bagCount(id) { return this.company.bag[id] || 0; }

  bagList() {
    return Object.entries(this.company.bag)
      .filter(([, n]) => n > 0)
      .map(([id, n]) => ({ item: shopItem(id), n }))
      .filter((x) => x.item);
  }

  buyItem(id, qty = 1) {
    const item = shopItem(id);
    if (!item) return { ok: false, why: '없는 물건' };
    if (this.company.rank < (item.rank || 1)) {
      return { ok: false, why: `랭크 ${item.rank} 부터 살 수 있다` };
    }
    const n = Math.max(1, Math.floor(qty));
    const cost = item.price * n;
    if (!this.spend(cost)) return { ok: false, why: '자금 부족' };
    this.company.bag[id] = this.bagCount(id) + n;
    this.company.spentOnShop = (this.company.spentOnShop || 0) + cost;
    this.dexSee('items', id);
    this.note(`${item.emoji} ${item.ko}${n > 1 ? ` ×${n}` : ''} 구입 — 가방에 넣었다.`);
    this.emit('bag', { id, n });
    return { ok: true, item };
  }

  /* Use one item out of the bag. Food and toys want a target; drinks, tools and
     anything marked `all` do not. Nothing is consumed unless it actually did
     something, so a mis-tap never eats an item. */
  useItem(id, staffId = null) {
    const item = shopItem(id);
    if (!item) return { ok: false, why: '없는 물건' };
    if (this.bagCount(id) <= 0) return { ok: false, why: '가방에 없다' };
    if (item.kind === 'gear') return { ok: false, why: '장비는 직원에게 장착하세요' };

    const c = this.company;
    let msg = null;

    if (item.kind === 'drink') {
      if (c.stamina >= c.staminaMax) return { ok: false, why: '스태미나가 이미 가득하다' };
      c.stamina = Math.min(c.staminaMax, c.stamina + item.stam);
      msg = `${item.emoji} ${item.ko} — 스태미나 ${c.stamina}/${c.staminaMax}`;
    } else if (item.kind === 'tool' && item.bugs) {
      const p = this.finished;
      if (!p || p.bugs <= 0) return { ok: false, why: '고칠 버그가 없다' };
      const fixed = Math.min(p.bugs, item.bugs);
      p.bugs -= fixed;
      msg = `${item.emoji} ${item.ko} — 버그 ${fixed}개 수정 (남은 ${p.bugs}개)`;
      this.emit('finished', p);
    } else if (item.kind === 'tool' && item.crit) {
      const p = this.project;
      if (!p) return { ok: false, why: '개발 중인 게임이 없다' };
      p.critBonus = (p.critBonus || 0) + item.crit;
      msg = `${item.emoji} ${item.ko} — 번뜩임 확률 +${Math.round(item.crit * 100)}%p`;
      this.emit('project', p);
    } else if (item.all) {
      // 전 직원 대상: 피자 한 판, 다트 보드.
      let touched = 0;
      for (const st of this.staff) {
        if (item.hp) { if (healHp(st, item.hp) > 0) touched++; }
        if (item.mot) { addMotivation(st, item.mot, c.rank); touched++; }
      }
      if (!touched) return { ok: false, why: '지금은 효과가 없다' };
      msg = `${item.emoji} ${item.ko} — 전 직원에게 돌렸다`;
      this.emit('staff', null);
    } else {
      const st = this.staff.find((x) => x.id === staffId);
      if (!st) return { ok: false, why: '누구에게 줄지 고르세요' };
      let did = 0;
      if (item.hp) did += healHp(st, item.hp);
      if (item.mot) { addMotivation(st, item.mot, c.rank); did += 1; }
      if (!did) return { ok: false, why: '체력이 이미 가득하다' };
      msg = `${item.emoji} ${st.name} — ${item.ko} (체력 ${st.hp}/${st.hpMax})`;
      this.emit('staff', null);
    }

    this.company.bag[id] = this.bagCount(id) - 1;
    if (msg) this.note(msg, 'good');
    this.emit('bag', { id, n: -1 });
    return { ok: true, item };
  }

  /* 장비를 직원에게 채운다. 가방에서 하나 빠지고, 그 사람의 능력치와 그가
     밀어 올리는 품질 축이 영구히 오른다. */
  equipItem(staffId, id) {
    const st = this.staff.find((x) => x.id === staffId);
    const item = shopItem(id);
    if (!st || !item) return { ok: false, why: '대상이 없다' };
    if (this.bagCount(id) <= 0) return { ok: false, why: '가방에 없다' };
    const chk = canEquip(st, id);
    if (!chk.ok) return chk;
    equipGear(st, id);
    this.company.bag[id] = this.bagCount(id) - 1;
    this.note(`${item.emoji} ${st.name}에게 ${item.ko} 지급 — ${item.desc}`, 'good');
    this.emit('staff', null);
    this.emit('bag', { id, n: -1 });
    return { ok: true };
  }

  unequipItem(staffId, id) {
    const st = this.staff.find((x) => x.id === staffId);
    if (!st) return { ok: false };
    const r = unequipGear(st, id);
    if (!r.ok) return r;
    this.company.bag[id] = this.bagCount(id) + 1;   // 가방으로 돌아온다
    this.emit('staff', null);
    this.emit('bag', { id, n: 1 });
    return { ok: true };
  }

  /* ---------- 야근 ----------
     "다음 주로 넘기는 것 말고는 스태미나를 채울 방법이 없다" 를 없애는 두
     번째 길. 돈과 직원의 체력·의욕을 스태미나로 바꾼다. 주 1회 — 이것이
     기본 루프를 대체해 버리면 주간 클록이 의미를 잃는다. */
  /* ---------- 직원 강화 ----------
     돈으로 사는 영구 강화. 레벨(아이템)과 장비 위에 얹는 **방향**이다:
     체력을 올려 보스전에서 오래 버티게 할지, 공격력을 올려 세게 치게 할지,
     미술을 올려 임팩트를 밀게 할지. 스태미나는 들지 않는다 — 아이템 지급이
     이미 스태미나를 먹으므로, 여기까지 먹으면 한 주에 할 수 있는 일이
     "누구 하나 키우기" 하나로 줄어든다. */
  upgradesOf(staffId) {
    const s = this.staff.find((x) => x.id === staffId);
    return s ? upgradeList(s) : [];
  }

  upgradeStaff(staffId, upId) {
    const s = this.staff.find((x) => x.id === staffId);
    if (!s) return { ok: false, why: '없는 직원' };
    const chk = canUpgrade(s, upId);
    if (!chk.ok) return chk;
    if (this.company.money < chk.cost) {
      return { ok: false, why: `자금 부족 (₩${chk.cost.toLocaleString()})` };
    }
    if (!this.spend(chk.cost)) return { ok: false, why: '자금 부족' };
    const r = applyUpgrade(s, upId);
    if (!r.ok) return r;
    syncHp(s);
    this.note(`${s.name} ${r.up.ko} ${r.level}단계 — ${r.up.unit}`, 'good');
    this.emit('staff', s);
    this.checkTasks();
    return { ok: true, level: r.level, cost: chk.cost };
  }

  overtimeCost() { return Math.round(OVERTIME.payPerHead * this.staff.length * (1 + this.company.rank * 0.12)); }

  canOvertime() {
    const c = this.company;
    if (c.overtimeUsed) return { ok: false, why: '이번 주 야근은 이미 했다' };
    if (c.stamina >= c.staminaMax) return { ok: false, why: '스태미나가 가득하다' };
    if (!this.staff.length) return { ok: false, why: '직원이 없다' };
    if (c.money < this.overtimeCost()) return { ok: false, why: '야근 수당이 부족하다' };
    return { ok: true };
  }

  overtime() {
    const chk = this.canOvertime();
    if (!chk.ok) return chk;
    const c = this.company;
    const cost = this.overtimeCost();
    this.spend(cost);
    const gain = Math.max(1, Math.round(c.staminaMax * OVERTIME.stamina));
    c.stamina = Math.min(c.staminaMax, c.stamina + gain);
    for (const st of this.staff) {
      drainHp(st, st.hpMax * OVERTIME.hpCost);
      addMotivation(st, -OVERTIME.motCost, c.rank);
    }
    c.overtimeUsed = true;
    this.note(`야근! 스태미나 +${gain} · 수당 ₩${cost.toLocaleString()} · 전원 체력과 의욕이 깎였다.`, 'bad');
    this.emit('staff', null);
    this.emit('week', { income: 0, costs: cost });
    return { ok: true, gain };
  }

  /* ---------- 체력 ---------- */
  restTeam() {
    for (const s of this.staff) syncHp(s);
  }

  tiredStaff() { return this.staff.filter((s) => isTired(s)); }

  /* The team member most in need of a meal — what the battle tray hands food to. */
  neediest(ids = null) {
    const pool = ids ? this.staff.filter((s) => ids.includes(s.id)) : this.staff;
    let worst = null;
    for (const s of pool) {
      syncHp(s);
      if (s.hp >= s.hpMax) continue;
      if (!worst || hpRatio(s) < hpRatio(worst)) worst = s;
    }
    return worst;
  }

  /* ---------- 도감 ---------- */
  dexSee(section, key) {
    const d = this.company.dex || (this.company.dex = {});
    const bag = d[section] || (d[section] = {});
    if (!bag[key]) bag[key] = true;
  }

  dexCount(section) {
    const d = (this.company.dex || {})[section] || {};
    return Object.keys(d).length;
  }

  dexProgress() {
    let have = 0, total = 0;
    for (const sec of DEX_SECTIONS) {
      have += this.dexCount(sec.id);
      total += sec.total();
    }
    // 조합 도감도 한 항목으로 친다: 발견한 조합 수 / 전체 조합 수.
    have += Object.keys(this.company.discovered || {}).length;
    total += GENRES.length * CONTENTS.length;
    return { have, total, pct: total ? Math.round(have / total * 100) : 0 };
  }

  /* ---------- 진행 상황 ----------
     개발 화면 옆에 띄우는 숫자 한 벌. UI 가 직접 계산하지 않고 여기서
     받아가므로, 화면에 뜬 값과 완성 결과가 어긋날 수 없다. */
  devProgress() {
    const p = this.project;
    if (!p) return null;
    const q = previewQuality(p);
    return {
      quality: q,
      fun: funScore(q),
      bugs: previewBugs(p, this.staffById(), this.ctx()),
      gain: p.lastGain || null,
      turn: p.turn,
      crits: p.crits,
      attacks: p.attacks || 0,
      phase: p.phase || 0,
      weak: p.weak || 0,
      team: p.team.map((id) => {
        const s = this.staff.find((x) => x.id === id);
        if (!s) return null;
        syncHp(s);
        return { id: s.id, name: s.name, hp: s.hp, hpMax: s.hpMax, tired: isTired(s), spent: isSpent(s) };
      }).filter(Boolean),
    };
  }

  /* ---------- 연구 ---------- */
  researchLevel(id) { return this.company.research[id] || 0; }

  researchPrice(id) { return researchCost(id, this.researchLevel(id)); }

  doResearch(id) {
    const def = RESEARCH.find((r) => r.id === id);
    if (!def) return { ok: false };
    const lvl = this.researchLevel(id);
    if (lvl >= def.max) return { ok: false, why: '최대 단계' };
    const price = this.researchPrice(id);
    if (this.company.researchPts < price) return { ok: false, why: '연구 포인트 부족' };
    this.company.researchPts -= price;
    this.company.research[id] = lvl + 1;
    this.note(`${def.ko} ${lvl + 1}단계 달성`, 'good');
    this.emit('research', id);
    return { ok: true, level: lvl + 1 };
  }

  /* ---------- 계약 일감 ----------
     The design doc's rule that a player must never be permanently stuck at
     zero. Contracts are dull, safe and always available. */
  availableContracts() { return CONTRACTS; }

  contractPayFor(id) {
    const c = CONTRACTS.find((x) => x.id === id);
    return c ? contractPay(c, this.company.rank) : 0;
  }

  takeContract(id) {
    const c = CONTRACTS.find((x) => x.id === id);
    if (!c) return { ok: false };
    if (this.company.contract) return { ok: false, why: '이미 계약을 진행 중' };
    if (this.company.stamina < c.stamina) return { ok: false, why: '스태미나 부족' };
    this.company.stamina -= c.stamina;
    const pay = contractPay(c, this.company.rank);
    this.company.contract = { id, ko: c.ko, weeksLeft: c.weeks, pay, research: c.research };
    this.note(`${c.ko} 수주. ${c.weeks}주 뒤 ₩${pay.toLocaleString()} 입금.`);
    this.emit('contract', this.company.contract);
    return { ok: true };
  }

  /* ---------- 홍보 ---------- */
  setMarketing(id) {
    if (!MARKETING.find((m) => m.id === id)) return { ok: false };
    this.company.marketingId = id;
    this.emit('finished', this.finished);
    return { ok: true };
  }

  marketingPrice(id) {
    const mk = MARKETING.find((m) => m.id === id);
    if (!mk || !this.finished) return 0;
    return marketingCost(mk, this.finished.devCost);
  }

  /* ---------- 시장 유행 ----------
     One genre and one content run hot per quarter. Rotating it is what stops a
     single discovered combo from being the answer forever. */
  rollTrends() {
    const g = GENRES[Math.floor(this.rnd() * GENRES.length)];
    // 유행은 **가지고 있는 소재** 중에서 고른다. 뽑지도 않은 소재가 유행하면
    // 보너스를 눈앞에 두고 손이 닿지 않는 분기가 생긴다.
    const owned = this.ownedContents();
    const pool = CONTENTS.filter((x) => owned.includes(x.id));
    const from = pool.length ? pool : CONTENTS;
    const c = from[Math.floor(this.rnd() * from.length)];
    this.company.trends = {
      genreId: g.id, genreKo: g.ko,
      contentId: c.id, contentKo: c.ko,
      setAt: `${this.company.year}-${this.company.month}`,
    };
    this.emit('trends', this.company.trends);
  }

  /* ---------- 주간 이벤트 ----------
     A week that is only "정산 + 스태미나 회복" has no texture. An event lands
     every few weeks; some are a flat outcome, some are a decision the player
     answers before the week can roll on. */
  rollWeeklyEvent() {
    if (this.pendingEvent) return null;
    const ev = rollEvent(this, this.rnd);
    if (!ev) return null;
    this.company.eventsSeen = (this.company.eventsSeen || 0) + 1;
    if (ev.def.choices) {
      // Only the options the company can actually afford are offered, and the
      // last one is always answerable, so an event can never soft-lock a turn.
      const opts = ev.def.choices.filter((c) => !c.can || c.can(this));
      ev.options = opts.length ? opts : [ev.def.choices[ev.def.choices.length - 1]];
      this.pendingEvent = ev;
      this.emit('event', ev);
      return ev;
    }
    const line = ev.def.apply ? ev.def.apply(this, this.rnd, ev.target) : '';
    this.note(`${ev.icon || ''} ${ev.ko}: ${ev.text}${line ? ' — ' + line : ''}`);
    this.emit('event', { ...ev, resolved: true, line });
    this.checkTasks();
    return ev;
  }

  answerEvent(index) {
    const ev = this.pendingEvent;
    if (!ev) return { ok: false };
    const opt = ev.options[index] || ev.options[0];
    const line = opt.apply ? opt.apply(this, this.rnd, ev.target) : '';
    this.pendingEvent = null;
    this.note(`${ev.icon || ''} ${ev.ko} → ${opt.ko}${line ? ' · ' + line : ''}`);
    this.emit('event', { ...ev, resolved: true, line });
    this.emit('staff', null);
    this.checkTasks();
    return { ok: true, line };
  }

  /* ---------- 세일즈 태스크 ----------
     A standing list of things the company has not done yet, each paying once.
     Checked after anything that could complete one rather than on a timer, so
     the reward lands in the same beat as the action that earned it. */
  tasks() {
    const done = this.company.tasksDone || {};
    return TASKS.map((t) => ({ ...t, complete: !!done[t.id] }));
  }

  checkTasks() {
    const done = this.company.tasksDone = this.company.tasksDone || {};
    let any = false;
    for (const t of TASKS) {
      if (done[t.id]) continue;
      let ok = false;
      try { ok = t.done(this); } catch (e) { ok = false; }
      if (!ok) continue;
      done[t.id] = true;
      grantReward(this, t.reward);
      this.note(`태스크 달성: ${t.ko} — ${rewardText(t.reward)}`, 'good');
      this.emit('task', t);
      any = true;
    }
    if (any) this._maybeRankUp();
    return any;
  }

  /* ---------- the week clock ---------- */
  nextWeek() {
    const c = this.company;
    // An unanswered event blocks the week: the whole point of a choice is that
    // the world waits for it.
    if (this.pendingEvent) { this.emit('event', this.pendingEvent); return { blocked: true }; }

    /* 팀이 전부 쓰러진 채로 주를 넘기면, 그 단계는 거기서 마감된다.

       이것이 없으면 "다음 주로 넘기기" 가 체력을 공짜로 채워 주는 버튼이
       되고, 시간이 무한해지므로 상점의 음식은 아무도 사지 않는 물건이
       된다. 쉬는 것은 자유지만, 쉬는 동안 게임은 그만큼 덜 만들어진다. */
    if (this.project && !this.project.pendingCards && teamDown(this.project, this.staffById())) {
      this.wrapUpStage();
    }

    let income = 0;
    for (const r of this.releases) {
      // 실시간 판매가 도는 게임은 그 팝업이 자기 주차를 흘리고 있다. 여기서
      // 또 한 주를 태우면 같은 주가 두 번 팔린다.
      if (this.sales && this.sales.id === r.id && !this.sales.ended) continue;
      income += tickRelease(r, this.rnd).income;
    }
    const costs = weeklyCosts(c, this.staff);
    this.earn(income);
    c.money -= costs;

    // Contract work settles before the week rolls over.
    if (c.contract) {
      c.contract.weeksLeft -= 1;
      if (c.contract.weeksLeft <= 0) {
        this.earn(c.contract.pay);
        c.researchPts += c.contract.research;
        this.note(`${c.contract.ko} 납품 완료. ₩${c.contract.pay.toLocaleString()} · 연구 +${c.contract.research}`, 'good');
        c.contract = null;
        this.emit('contract', null);
      }
    }

    c.week += 1;
    if (c.week > 4) { c.week = 1; c.month += 1; }
    if (c.month > 12) { c.month = 1; c.year += 1; }
    // A new quarter, a new fashion.
    if (c.week === 1 && (c.month - 1) % 3 === 0) {
      this.rollTrends();
      this.note(`시장 유행이 바뀌었다: ${c.trends.genreKo} · ${c.trends.contentKo}`);
    }

    c.stamina = c.staminaMax;
    c.overtimeUsed = false;

    // Idle staff drift back toward a neutral mood; a shipped game is what
    // actually raises motivation. A week off also restores health, and a
    // comfortable office pushes morale the other way — which is what the
    // furniture is for, and why 쾌적도 is worth spending on once you have more
    // people than the grant could seat.
    const cm = this.comfort();
    for (const s of this.staff) {
      syncHp(s);
      const idle = !this.project || !this.project.team.includes(s.id);
      healHp(s, s.hpMax * (idle ? HP.weekly + 0.2 : HP.weekly));
      if (!idle) continue;
      if (this.rnd() < cm.moodGain) addMotivation(s, 1, c.rank);
      else if (s.motivation > 3 && this.rnd() > 0.85) s.motivation -= 1;
    }

    // A warning before the cliff, so the rescue never arrives as a surprise.
    if (c.money >= 0 && c.money < costs * 2 && this.releases.every((r) => !r.managing)) {
      this.note(`자금이 얼마 남지 않았습니다 (₩${c.money.toLocaleString()}). 계약 일감을 받으세요.`, 'bad');
    }
    if (c.money < 0) this._rescue();

    if (income > 0) this.note(`주간 정산: 매출 ₩${income.toLocaleString()} / 비용 ₩${costs.toLocaleString()}`);
    if (this.rnd() > 0.72) this.rollCandidates();

    this.emit('week', { income, costs });
    this.checkTasks();
    // Roughly one week in five. Frequent enough that a year has a shape,
    // rare enough that it never becomes the thing you are playing.
    if (this.rnd() < 0.21) this.rollWeeklyEvent();
    return { income, costs };
  }

  /* ---------- 긴급 지원금 ----------
     The studio does not go bankrupt. It gets one more chance, and then another,
     each smaller than the last and each costing the roster's morale — so the
     grants are a slope you can feel yourself sliding down rather than a wall
     you hit once. The emit is what the UI turns into the popup; the money moves
     here either way, so a player who dismisses the modal is still rescued. */
  _rescue() {
    const c = this.company;
    const debt = -c.money;
    // Enough to start the cheapest game available and keep the lights on for a
    // month. A grant smaller than a project leaves the studio alive but unable
    // to act, which is the one outcome the safety net exists to prevent.
    const cheapest = Math.min(...this.availablePlatforms().map((p) => p.cost));
    const need = Math.round(cheapest * 1.8 + weeklyCosts(c, this.staff) * 4);
    const amount = rescueAmount(c.rescues, need);
    const morale = rescueMorale(c.rescues);
    c.rescues += 1;
    c.money = amount;
    for (const s of this.staff) addMotivation(s, morale, c.rank);
    this.note(`긴급 지원금 ₩${amount.toLocaleString()} 지급 (${c.rescues}번째). 직원 의욕 ${morale}.`, 'bad');
    this.emit('rescue', { amount, debt, count: c.rescues, morale });
    return { amount, count: c.rescues };
  }

  /* ---------- save / load ---------- */
  serialize() {
    return JSON.stringify({
      v: 2, seed: this.seed,
      company: this.company, staff: this.staff, proposals: this.proposals,
      project: this.project, finished: this.finished, releases: this.releases,
      candidates: this.candidates, history: this.history, bag: this.bag,
    });
  }

  save() {
    try { localStorage.setItem(SAVE_KEY, this.serialize()); return true; }
    catch (e) { console.warn('save failed', e); return false; }
  }

  static hasSave() {
    try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
  }

  static load() {
    let raw;
    try {
      raw = localStorage.getItem(SAVE_KEY);
      for (const k of LEGACY_KEYS) localStorage.removeItem(k);
    } catch (e) { return null; }
    if (!raw) return null;
    try {
      const d = JSON.parse(raw);
      const g = new Game(d.seed);
      g.company = d.company; g.staff = d.staff; g.proposals = d.proposals;
      g.project = d.project; g.finished = d.finished; g.releases = d.releases || [];
      g.candidates = d.candidates || []; g.history = d.history || [];
      g.bag = d.bag || [];
      g.log = [];
      // Saves written before these systems existed load with sane defaults
      // rather than crashing on a missing field.
      const c = g.company;
      c.research = c.research || {};
      c.researchPts = c.researchPts || 0;
      c.maxFloors = c.maxFloors || rankInfo(c.rank).floors;
      c.discovered = c.discovered || {};
      c.marketingId = c.marketingId || 'none';
      c.contract = c.contract || null;
      c.placed = c.placed || [];
      c.rescues = c.rescues || 0;
      c.founded = c.founded ?? true;
      c.tutorialDone = c.tutorialDone ?? false;
      c.recentCombos = c.recentCombos || [];
      c.tasksDone = c.tasksDone || {};
      c.eventsSeen = c.eventsSeen || 0;
      // Saves written before the score/bug split have no criticBase, so a
      // debug pass would have nothing to recompute from. Reconstruct it from
      // the scores the save does have.
      for (const pr of [g.finished, g.project]) {
        if (pr && pr.critics && !pr.criticBase) {
          const pen = Math.min(2.6, (pr.bugs || 0) * 0.11);
          pr.criticBase = pr.critics.map((v) => v + pen);
        }
      }
      c.bag = c.bag || {};
      c.dex = c.dex || {};
      // 강화·완성도가 없던 시절의 세이브. 없는 칸만 채운다.
      for (const st of g.staff) if (!st.up || typeof st.up !== 'object') st.up = {};
      for (const pj of [g.project, g.finished]) {
        if (!pj) continue;
        pj.unfinished = pj.unfinished || 0;
        pj.forfeits = pj.forfeits || 0;
        pj.rushBugs = pj.rushBugs || 0;
      }
      // 봉우리 곡선이 없던 시절의 출시작. 지금 유저 수를 정점으로 친다.
      for (const r of g.releases) {
        if (r.peakWeek === undefined) { r.peakWeek = 0; r.growth = 1; }
        if (r.launchUsers === undefined) r.launchUsers = r.peakUsers || r.users;
      }
      for (const k of ['genres', 'contents', 'bosses', 'items', 'jobs']) c.dex[k] = c.dex[k] || {};

      /* 이름이 바뀐 소재를 옮긴다. 세 군데에 박혀 있다: 진행 중/완성된
         프로젝트의 contentId, 도감, 조합 기록의 키. */
      for (const pj of [g.project, g.finished, ...g.releases]) {
        if (pj && pj.contentId) pj.contentId = aliasContent(pj.contentId);
      }
      for (const [k, v] of Object.entries(c.dex.contents)) {
        const nk = aliasContent(k);
        if (nk !== k) { delete c.dex.contents[k]; c.dex.contents[nk] = v; }
      }
      for (const [k, v] of Object.entries(c.discovered)) {
        const [gid, cid] = k.split('|');
        const nk = gid + '|' + aliasContent(cid);
        if (nk !== k) { delete c.discovered[k]; c.discovered[nk] = v; }
      }
      c.recentCombos = (c.recentCombos || []).map((k) => {
        const [gid, cid] = k.split('|');
        return gid + '|' + aliasContent(cid);
      });

      /* 소재 뽑기가 없던 세이브: 기본 소재에 더해 **이미 써 본 것**을 전부
         가진 것으로 친다. 예전에 만든 게임의 소재를 뒤늦게 잠그면, 아무
         잘못도 하지 않은 회사가 자기 대표작을 못 만들게 된다. */
      if (!Array.isArray(c.contentsOwned) || !c.contentsOwned.length) {
        const seen = new Set(CONTENT_BASE);
        for (const k of Object.keys(c.dex.contents)) seen.add(k);
        for (const pj of [g.project, g.finished, ...g.releases]) {
          if (pj && pj.contentId) seen.add(pj.contentId);
        }
        c.contentsOwned = [...seen].filter((id) => CONTENT_BY_ID.has(id));
      } else {
        c.contentsOwned = [...new Set(c.contentsOwned.map(aliasContent))]
          .filter((id) => CONTENT_BY_ID.has(id));
      }
      c.gachaPulls = c.gachaPulls || 0;
      if (c.trends && c.trends.contentId) {
        c.trends.contentId = aliasContent(c.trends.contentId);
        const tc = CONTENT_BY_ID.get(c.trends.contentId);
        if (tc) c.trends.contentKo = tc.ko;
      }
      c.overtimeUsed = !!c.overtimeUsed;
      c.spentOnShop = c.spentOnShop || 0;
      if (!c.trends) g.rollTrends();
      // Saves written before staff had health or equipment: give everyone a
      // pool sized to who they are now, and a project the boss it was missing.
      for (const st of [...g.staff, ...g.candidates]) {
        st.gear = st.gear || [];
        syncHp(st);
        g.company.dex.jobs[st.job] = true;
      }
      for (const pj of [g.project, g.finished]) {
        if (!pj) continue;
        if (!pj.boss) {
          const b = bossFor(pj.genreId);
          pj.boss = { id: pj.genreId, ko: b.ko, shape: b.shape, col: b.col, accent: b.accent };
        }
        pj.phase = pj.phase || 0;
        pj.weak = pj.weak || 0;
        pj.bugExtra = pj.bugExtra || 0;
        pj.critBonus = pj.critBonus || 0;
        pj.attacks = pj.attacks || 0;
      }
      // Ids must not collide with anything the save already used.
      seedIds(Math.max(0, ...g.staff.map((s) => s.id), ...g.candidates.map((s) => s.id)) + 1);
      seedProjectIds(Date.now() % 100000);
      g.note('저장된 회사를 불러왔습니다.');
      return g;
    } catch (e) {
      console.warn('load failed', e);
      return null;
    }
  }

  static clearSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
      for (const k of LEGACY_KEYS) localStorage.removeItem(k);
    } catch (e) { /* private mode */ }
  }

  static get SAVE_KEY() { return SAVE_KEY; }
}

export {
  STATS, JOBS, GENRES, CONTENTS, PLATFORMS, MONETIZE, ITEMS, RESEARCH, CONTRACTS, MARKETING,
  SHOP,
  abilities, power, role, rankInfo, RANK_UP_FANS, itemCost, trainStamina, floorCost,
  expToNext, STARTUP_GRANT, TUTORIAL, TASKS, rewardText,
  hpRatio, isTired, isSpent, gearOf, basePower, shopItem, GEAR_SLOTS,
};
