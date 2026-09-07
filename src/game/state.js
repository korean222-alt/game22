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
  EXHAUST, ABILITY_KO, starText, starOf,
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
  canUpgrade, applyUpgrade, upgradeList, giveGift,
} from './staff.js';
import {
  generateProposal, startProject, battleTurn, battleTick, chooseCard, finishProject,
  scoreCritics, useHelperSkill,
  turnCost, seedProjectIds, previewQuality, previewBugs, funScore,
  ensureStages, currentStage, raidProgress, teamDown, advanceStage, stageName,
  forfeitStage, completion, projectQuality,
  urgeStaff, canUrge, comboMult, URGE,
} from './project.js';
import { TASKS, rollEvent, grantReward, rewardText } from './events.js';
import {
  RIVALS, marketScale, rivalReleaseChance, makeRivalRelease, tickRival,
  buildChart, myBestRank, CHART_FAN_BONUS, rivalTitle,
} from './rivals.js';
import {
  HELPERS, HELPER_BY_ID, helperSlots, helperBonus, helperLevel,
  helperSkillText, drawHelper,
} from './helpers.js';
import {
  MAIL_CAP, welcomeMail, fanMail, fanMailChance, dlMail, DL_MARKS,
  recordMail, sealMail, giftText,
} from './mail.js';
import {
  EXPO_PLANS, awardBar, judge, awardTotals, nearMiss, rivalAwards,
  expoVisitors, expoResult, expoNote,
} from './awards.js';
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

/* 출시작이 운영 칸을 붙들고 있는 기간(주).

   1 이다. 게임을 내면 실시간 판매 카드가 그 판의 전부를 보여주고, 정산을
   확인한 뒤 한 주가 지나면 서비스가 닫힌다. 예전에는 유저가 60명 밑으로
   빠질 때까지 — 잘 만든 게임이면 반년 넘게 — 칸을 붙들고 있었고, 세 칸이
   차면 새 게임을 못 냈다. 그 상태에서 개발 탭은 이미 출시 화면에 가 있어서
   내릴 방법이 화면에 없었다. 파는 기간을 짧게 못 박는 편이, 화면 어딘가에
   '내리기' 를 찾아 헤매게 하는 것보다 낫다. */
const RELEASE_SALE_WEEKS = 1;

/* 시상식이 심사하는 기간(주). 두 달 = 8주.
   행사 주기를 두 달로 늘렸으므로 심사 창도 같이 늘린다 — 안 그러면 행사가
   없는 달에 낸 게임은 영영 심사를 못 받는다. */
const AWARD_WINDOW_WEEKS = 8;

/* ---------- 실시간 스태미나 ----------
   3분에 한 점. 게임을 닫아 둔 사이에도 차므로 계산은 벽시계로 한다.

   이 시계가 생기면서 스태미나는 "주를 넘겨야만 차는 것" 이 아니게 됐고,
   그래서 다음 주로 넘기기에 값을 매길 수 있게 됐다 — 코인이 하나도 없는
   회사도 기다리면 기획서를 뽑고 계약을 받을 수 있다. 막다른 길이 없다는
   설계 원칙(HANDOFF 3.6)을 지키는 것이 이 시계의 진짜 역할이다. */
export const STAMINA_REGEN = 180;       // 초/1점
/* 같은 시계로 체력도 조금씩 돈다. 코인이 없어 주를 못 넘기는 회사가
   탈진한 팀을 영원히 못 일으키면 그것이 막다른 길이다. 주간 회복(78%)에
   비하면 한참 느리다 — 밥과 휴식을 대체하지 않을 만큼만. */
const HP_REGEN_PER_TICK = 0.020;        // 한 점 찰 때마다 최대 체력의 2%

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
      seenTabs: {},                 // 안내가 "가 봤다" 로 세는 탭들
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
      devIntroSeen: false,          // 개발 화면이 무엇인지 한 번 설명했나
      /* ---- 실시간 스태미나 ----
         스태미나가 "다음 주로 넘기기" 로만 찼을 때는, 그 버튼을 연타하는
         것이 언제나 최적이었다 — 공짜였고, 달력만 앞으로 밀면 시상식도
         계약도 알아서 굴러왔다. 이제 스태미나는 **실제 시간**으로 찬다
         (STAMINA_REGEN 초에 1). 게임을 꺼 둔 사이에도 차므로 벽시계를
         저장하고, 돌아올 때 그동안 지난 만큼 한 번에 넣는다. */
      stamAt: Date.now(),
      /* ---- 경쟁사 ----
         라이벌이 낸 게임들과, 우리가 차트에서 몇 위였나. 지난주 순위를
         들고 있어야 "1위를 뺏겼다" 를 말할 수 있다. */
      rivalGames: [],
      rivalSeq: 0,
      chartRank: 0,          // 지난주 우리 최고 순위 (0 = 차트 밖)
      chartWeeksNo1: 0,      // 1위를 지킨 주의 누계
      /* ---- 도우미 ----
         뽑아서 모으고, 랭크가 열어 주는 자리 수만큼 낀다.
         helpers 는 { id: 보유 수 }, helperSlots 는 지금 낀 id 목록. */
      helpers: {},
      helperSlots: [],
      /* 축별 최고 기록. 개발 중인 점수가 이 값을 넘으면 화면이 금색이 된다 —
         "지금 만들고 있는 게 우리 회사 역사상 제일 좋은 것" 이 실시간으로
         보이는 것이, 자동 전투를 끝까지 보게 만드는 유일한 이유다. */
      best: {},
      /* ---- 편지함 ----
         받은 편지가 최신순으로 쌓인다. 선물이 붙은 편지는 수령하기 전까지
         지워지지 않는다 — 정리하다가 상금을 버리는 일은 없어야 한다. */
      mail: [],
      mailSeq: 0,
      /* ---- 누적 다운로드 ----
         출시 유저와 그 뒤 매주 늘어난 유저를 더한 값. 회사가 지금까지
         몇 명에게 닿았는지를 한 숫자로 들고 있는 곳이고, 100만 같은
         자릿수를 넘을 때 편지가 온다. */
      totalDl: 0,
      dlMarks: {},                  // 이미 축하받은 자릿수
      /* ---- 행사 ----
         시상식은 짝수 달, 게임덱스는 홀수 달. 마지막으로 연 달을 적어 두는
         것으로 중복 개최를 막는다 — 주를 여러 번 넘겨도 달이 같으면 한 번. */
      lastAwardKey: null,
      lastExpoKey: null,
      // 열려 있는 게임덱스 초대장. 세이브에 남는다 — 초대장을 받고 저장한
      // 다음 날 들어왔더니 행사가 없어져 있으면 그건 잃어버린 것이다.
      expoInvite: null,
      awards: [],                   // 지금까지 받은 상 (행사 탭의 진열장)
      expoBest: 0,                  // 역대 최다 부스 방문자
      expoLog: [],
      buff: null,                   // { ko, dl, weeks } — 게임덱스가 남긴 화제
      fanMailSent: {},              // 게임별로 몇 통까지 왔나
    };
    // Bought but not yet placed. The bag is what makes buying and placing two
    // separate decisions rather than one click that teleports a desk somewhere.
    this.bag = [];
    this.pendingEvent = null;       // a weekly event waiting on the player
    /* 열려 있는 행사. 주를 막지 않는다 — 시상식은 결과만 보여주면 되고,
       게임덱스는 나중에 행사 탭에서 골라도 된다. */
    this.pendingAward = null;
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
    // 첫 편지. 지원금과 별개인 개발비가 들어 있고, 그것이 편지함이라는
    // 화면이 있다는 사실을 알리는 방법이기도 하다.
    this.sendMail(welcomeMail(c, this.dateLabel()));
    this.emit('founded', { name: c.name, grant: STARTUP_GRANT });
    return { ok: true, name: c.name, grant: STARTUP_GRANT };
  }

  /* ---------- 안내 ----------
     지금 할 일 한 가지. 마지막 단계를 끝내면 null 이 되고, 화면의 카드도
     그때 통째로 사라진다 — 그래서 건너뛰기도 '다시 보지 않기' 도 없다. */
  tutorialStep() { return tutorialStep(this); }

  /* 안내가 "그 탭에 가 봤는가" 를 세는 자리. 상점처럼 **살 것이 없을 수도
     있는** 탭은 방문만으로 끝나야 한다. 안 그러면 끝낼 방법이 손에 없는
     줄이 되고, 예전에 안내가 통째로 지워진 이유가 그것이었다. */
  markTabSeen(name) {
    const c = this.company;
    c.seenTabs = c.seenTabs || {};
    if (c.seenTabs[name]) return false;
    c.seenTabs[name] = true;
    this.save();
    return true;
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
      // 낀 도우미가 주는 배율. project.js 가 이걸 읽어 한 방·번뜩임·상자에
      // 얹는다. 없으면 전부 1 이라 예전과 완전히 같은 수가 나온다.
      helpers: this.helperBonus(),
      ...extra,
    };
  }

  /* ══════════════════════ 도우미 ══════════════════════ */
  helperSlotCount() { return helperSlots(this.company.rank); }

  helperBonus() {
    const c = this.company;
    return helperBonus(c.helpers, (c.helperSlots || []).slice(0, this.helperSlotCount()));
  }

  helperList() {
    const c = this.company;
    return HELPERS
      .filter((h) => (c.helpers || {})[h.id])
      .map((h) => ({
        def: h, count: c.helpers[h.id], level: helperLevel(c.helpers[h.id]),
        equipped: (c.helperSlots || []).includes(h.id),
      }));
  }

  /* ---------- 도우미는 뽑는 것이 아니라 찾아오는 것 ----------
     코인을 넣으면 나오는 자판기였을 때, 도우미는 "코인이 남으면 돌리는 것"
     이었다. 지금은 행사와 사건만이 데려온다 — 게임덱스 부스, 시상식, 주간
     사건, 팬 편지. 그래서 도우미 한 마리는 회사가 바깥과 만난 흔적이 되고,
     같은 이유로 언제 올지는 고를 수 없다.

     `luck` 은 그 자리의 씀씀이다. 게임덱스에 큰돈을 쓰면 좋은 쪽이 잘 나온다. */
  grantHelper(luck = 1, from = '') {
    const c = this.company;
    const def = drawHelper(this.rnd, luck);
    c.helpers = c.helpers || {};
    const had = c.helpers[def.id] || 0;
    c.helpers[def.id] = had + 1;
    const level = helperLevel(had + 1);
    // 첫 마리는 자리가 비어 있으면 알아서 낀다. 받고 나서 어디에 넣는지를
    // 또 찾아야 하면, 받은 순간의 기쁨이 심부름으로 바뀐다.
    c.helperSlots = c.helperSlots || [];
    if (!had && c.helperSlots.length < this.helperSlotCount()) c.helperSlots.push(def.id);
    const where = from ? `${from}에서 ` : '';
    this.note(had
      ? `${where}${def.icon} ${def.ko} — 레벨 ${level}! (${helperSkillText(def, level)})`
      : `${where}${def.icon} ${def.ko} 합류! ${helperSkillText(def, level)}`,
    def.star >= 4 ? 'good' : '');
    this.emit('helper', { def, level, isNew: !had, from });
    return { ok: true, def, level, isNew: !had, from };
  }

  /* 사건이 도우미를 데려올 확률. 이미 다 모았으면 겹쳐서 레벨이 오르므로
     확률을 낮추지 않는다 — 도우미는 열두 마리뿐이고, 레벨 5 까지가 끝이다. */
  maybeGrantHelper(p, luck = 1, from = '') {
    if (this.rnd() >= p) return null;
    return this.grantHelper(luck, from);
  }

  /* ---------- 능력을 쓴다 ----------
     보스 한 마리에 한 번. 개발 현장의 얼굴을 누르면 여기로 온다. */
  useHelper(id) {
    const p = this.project;
    if (!p) return { ok: false, why: '개발 중이 아닙니다' };
    const entry = this.helperBonus().list.find((h) => h.id === id);
    if (!entry) return { ok: false, why: '끼지 않은 도우미' };
    const r = useHelperSkill(p, entry, this.rnd, this.ctx({ staffById: this.staffById() }));
    if (!r.ok) return r;
    this.note(`${entry.def.icon} ${entry.def.ko} · ${r.skill.ko} — ${r.text}`, 'good');
    this._battleEvents(p, r.events);
    this.save();
    return r;
  }

  /* 이 도우미를 지금 쓸 수 있나. 개발 현장의 버튼이 이걸 보고 흐려진다. */
  helperReady(id) {
    const p = this.project;
    if (!p || p.done) return false;
    if (p.pendingCards) return false;
    return (p.helperUsed || {})[id] !== (p.stage || 0);
  }

  toggleHelper(id) {
    const c = this.company;
    if (!(c.helpers || {})[id]) return { ok: false, why: '없는 도우미' };
    c.helperSlots = c.helperSlots || [];
    const i = c.helperSlots.indexOf(id);
    if (i >= 0) c.helperSlots.splice(i, 1);
    else {
      if (c.helperSlots.length >= this.helperSlotCount()) {
        return { ok: false, why: `자리가 ${this.helperSlotCount()}개뿐입니다` };
      }
      c.helperSlots.push(id);
    }
    this.emit('helper', null);
    this.save();
    return { ok: true };
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

  /* ---------- 실시간 시계 ----------
     main.js 의 프레임 루프가 매 프레임 부르지만, 실제로 보는 것은 벽시계다.
     그래서 탭이 백그라운드에 있었거나 앱을 껐다 켜도 결과가 같다.

     순수 시뮬레이션 안에서 Date.now() 를 쓰는 유일한 자리다. 헤드리스
     시뮬레이션(tools/balance.mjs)은 이 함수를 부르지 않으므로 밸런스
     계산에는 시계가 끼어들지 않는다. */
  tickClock(now = Date.now()) {
    const c = this.company;
    if (!c.stamAt) { c.stamAt = now; return 0; }
    // 시계가 뒤로 갔으면(기기 시간 변경) 그냥 지금으로 맞춘다.
    if (now < c.stamAt) { c.stamAt = now; return 0; }
    const max = this.info().staminaMax;
    if (c.stamina >= max) { c.stamAt = now; return 0; }
    const step = STAMINA_REGEN * 1000;
    const ticks = Math.floor((now - c.stamAt) / step);
    if (ticks <= 0) return 0;
    const gain = Math.min(ticks, max - c.stamina);
    c.stamina += gain;
    // 남은 나머지는 다음 판으로 넘긴다. 매번 now 로 리셋하면 프레임마다
    // 시계가 0 으로 돌아가 영원히 한 점도 안 찬다.
    c.stamAt += ticks * step;
    if (c.stamina >= max) c.stamAt = now;
    for (const st of this.staff) {
      syncHp(st);
      if (st.hp < st.hpMax) healHp(st, st.hpMax * HP_REGEN_PER_TICK * ticks);
    }
    // 스태미나가 찼다는 것 자체가 하나의 사건이다 — 소리와 HUD 가 이걸 듣는다.
    this.emit('stamina', gain);
    this.emit('staff', null);
    return gain;
  }

  /* 다음 한 점까지 남은 초. HUD 가 이걸로 카운트다운을 찍는다. */
  staminaEta(now = Date.now()) {
    const c = this.company;
    if (c.stamina >= this.info().staminaMax) return 0;
    const left = STAMINA_REGEN * 1000 - ((now - (c.stamAt || now)) % (STAMINA_REGEN * 1000));
    return Math.max(0, Math.ceil(left / 1000));
  }

  /* ---------- 최고 기록 ----------
     완성된 게임의 축 점수를 회사 기록과 비교해 큰 쪽을 남긴다.
     `fun` 은 다섯 축에서 유도되는 값이라 같이 저장해 둔다 — 화면에서
     여섯 줄을 같은 규칙으로 칠하려면 여섯 개가 다 있어야 한다. */
  recordBests(project) {
    if (!project) return null;
    const c = this.company;
    c.best = c.best || {};
    const q = projectQuality(project);
    const beaten = [];
    for (const [k, v] of Object.entries({ ...q, fun: funScore(q) })) {
      const val = Math.round(v || 0);
      if (val > (c.best[k] || 0)) { beaten.push(k); c.best[k] = val; }
    }
    return beaten;
  }

  /* 지금 만들고 있는 게임이 회사 기록을 넘긴 축들. UI 가 금색으로 칠한다. */
  recordsNow(project = this.project) {
    if (!project) return {};
    const c = this.company, best = c.best || {};
    const q = previewQuality(project);
    const out = {};
    for (const [k, v] of Object.entries({ ...q, fun: funScore(q) })) {
      out[k] = Math.round(v || 0) > (best[k] || 0);
    }
    return out;
  }

  /* ══════════════════════ 경쟁사와 차트 ══════════════════════
     매주: 라이벌 게임이 한 주를 살고, 새 게임이 나오고, 차트를 다시 세운다.
     그리고 우리 순위가 바뀌었으면 그것을 사건으로 알린다. */
  _tickRivals() {
    const c = this.company;
    c.rivalGames = c.rivalGames || [];
    for (const r of c.rivalGames) tickRival(r, this.rnd);
    // 서비스가 끝난 게임은 차트에서 빠지고, 목록도 무한정 자라지 않는다.
    c.rivalGames = c.rivalGames.filter((r) => r.managing).slice(-12);

    const scale = marketScale(c, this.releases);
    for (const rv of RIVALS) {
      if (this.rnd() >= rivalReleaseChance(rv)) continue;
      c.rivalSeq = (c.rivalSeq || 0) + 1;
      const rel = makeRivalRelease(rv, scale, this.rnd, c.rivalSeq);
      c.rivalGames.push(rel);
      // 우리가 운영 중일 때만 알린다. 아무것도 안 팔고 있는 회사에게 남의
      // 신작은 소식이 아니라 소음이다.
      if (this.releases.some((r) => r.managing)) {
        this.note(`${rv.icon} ${rv.ko}가 「${rel.title}」을 출시했습니다.`);
      }
    }

    const chart = this.chart();
    const rank = myBestRank(chart);
    const was = c.chartRank || 0;
    if (rank === 1) {
      c.chartWeeksNo1 = (c.chartWeeksNo1 || 0) + 1;
      // 1위는 팬을 부른다. 차트가 숫자로만 존재하면 장식이 된다.
      const gain = Math.round(chart[0].users * CHART_FAN_BONUS);
      if (gain > 0) c.fans += gain;
      if (was !== 1) this.note(`👑 「${chart[0].title}」이 주간 차트 1위입니다!`, 'good');
      else this.note(`👑 차트 1위 유지 (${c.chartWeeksNo1}주째) · 팬 +${gain.toLocaleString('ko-KR')}`, 'good');
    } else if (was === 1 && rank > 1) {
      const top = chart[0];
      this.note(`차트 1위를 ${top.studio}의 「${top.title}」에 내줬습니다.`, 'bad');
    }
    c.chartRank = rank;
    this._maybeRankUp();
    this.emit('chart', chart);
  }

  /* 이번 주 차트. UI 가 그대로 그린다. */
  chart(limit = 8) {
    return buildChart(this.releases, this.company.rivalGames, this.company.name, limit);
  }

  /* ---------- 재촉 ----------
     개발 화면에서 직원 카드를 눌렀을 때. 규칙은 project.js 안에 있고
     여기서는 이벤트만 흘린다. */
  urge(staffId) {
    const p = this.project;
    if (!p) return { ok: false };
    const s = this.staff.find((x) => x.id === staffId);
    if (!s) return { ok: false };
    const r = urgeStaff(p, s);
    if (r.ok) this.emit('urge', { staffId, name: s.name, combo: r.combo, mult: r.mult });
    return r;
  }

  canUrge(staffId) {
    const s = this.staff.find((x) => x.id === staffId);
    return this.project && s ? canUrge(this.project, s) : false;
  }

  comboMult() { return comboMult(this.project); }

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
    // 돈이 나갔다 = 회사가 뭔가 했다. 연속 넘김 카운터가 풀린다.
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
    /* 발자국의 중심은 놓는 점이 아니다. 책상은 의자가 한쪽으로 나와 있어서
       모델의 한가운데가 상판의 한가운데보다 뒤에 있다 — 그 어긋남을 무시하면
       화면의 의자는 통로에 나와 있는데 판정은 통과한다. */
    const f = footprint(def, rot);
    const fx = x + f.ox, fz = z + f.oz;
    if (checks.zoneOk && !checks.zoneOk(floor, fx, fz, f.w, f.d)) {
      return { ok: false, why: '배치할 수 없는 자리 (파란 구역 안에만)' };
    }
    if (checks.clearOfWalls && !checks.clearOfWalls(floor, fx, fz, f.w, f.d)) {
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
    /* ---- 순서가 연출을 정한다 ----
       The office walks a new hire in through the front door rather than
       teleporting them into a chair, so hiring is something you SEE happen.

       그런데 오랫동안 그 일이 실제로는 안 일어났다. `assignDesks` 가 먼저
       `desks` 를 쏘고, 그 신호를 받은 3D 층이 **아직 오지 않은 사람의 몸을
       만들어 의자에 앉혀 버렸기** 때문이다. 그 뒤에 오는 `hired` 는 이미
       앉아 있는 사람을 보고 아무것도 하지 않았다 — 신입은 늘 자기 자리에
       뿅 하고 나타났다.

       그래서 `hired` 를 먼저 쏜다. 그때는 아직 책상이 없으므로 3D 층은
       정문에 세워만 두고, 바로 뒤의 `desks` 가 어디로 걸어갈지를 알려준다. */
    this.emit('hired', c);
    if (this.desks) this.assignDesks(this.desks);
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
    /* 예전에는 아이템 지급에도 스태미나가 들었다. 스태미나가 개발 착수
       한 자리로 모이면서 그 값은 사라진다 — 교육은 이제 순수하게 돈으로
       하고, 값은 레벨에 따라 오르는 itemCost 가 혼자 맡는다. */
    const cost = itemCost(s, item);
    if (!this.spend(cost)) return { ok: false, why: '자금 부족' };
    const r = giveItem(s, itemId, this.company.rank);
    if (!r.ok) { this.company.money += cost; return r; }
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
    // 기획서는 이제 공짜다. 스태미나는 **착수**할 때만 나간다 — 뽑는 데
    // 값이 붙어 있으면 마음에 안 드는 기획서를 붙잡고 있는 쪽이 이득이 되고,
    // 그건 고르는 재미를 없애는 값이었다.
    // The staffer with the most planning weight is credited as the author, and
    // is the one who gains motivation if the game ships.
    let author = null, best = -1;
    for (const s of this.staff) {
      const p = proposalPower(s, this.floorRoleOf(s));
      if (p > best) { best = p; author = s; }
    }
    // 기획 요정 같은 도우미는 기획서 굴림에 얹힌다.
    const hb = this.helperBonus();
    const pr = generateProposal(this.rnd, author,
      this.totalPlanPower() * (hb.plan || 1), this.company.rank, this.company.research);
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
  beginDevelopment({ proposalId, platformId, monetizeId, teamIds, seriesOfId, title = null }) {
    if (this.project) return { ok: false, why: '이미 개발 중' };
    if (this.finished) return { ok: false, why: '완성작을 먼저 출시하세요' };
    /* 앞의 게임이 아직 팔리고 있으면 다음 게임에 착수할 수 없다.

       한동안 이 자리를 열어 두었는데, 그러면 출시가 아무 무게도 없는 사건이
       된다 — 파는 화면이 오른쪽에서 도는 동안 다음 게임을 시작해 버리면
       판매 곡선을 보는 사람이 아무도 없다. 정산 확인 버튼 하나를 누르는
       값으로 "이 게임은 여기까지" 를 매듭짓게 한다. */
    if (this.sales) {
      return {
        ok: false,
        why: this.sales.ended
          ? '판매 정산을 먼저 확인하세요'
          : `「${this.sales.title}」 판매 중입니다. 정산이 끝나면 다음 게임을 시작할 수 있습니다`,
      };
    }
    const pr = this.proposals.find((p) => p.id === proposalId);
    if (!pr) return { ok: false, why: '없는 기획서' };
    const team = teamIds.map((id) => this.staff.find((s) => s.id === id)).filter(Boolean);
    if (!team.length) return { ok: false, why: '팀원을 배정하세요' };

    const seriesOf = seriesOfId ? this.releases.find((r) => r.id === seriesOfId) : null;
    const p = startProject({
      proposal: pr, platformId, monetizeId, team,
      rank: this.company.rank, seriesOf, helpers: this.helperBonus(),
      // 상대는 착수할 때 제비뽑기로 정해지고, 그 결과가 프로젝트에 박힌다.
      // 제목은 플레이어가 바꿔 넣을 수 있다 — 비워 두면 기획서 이름 그대로.
      rnd: this.rnd, title,
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
    const events = forfeitStage(p, this.rnd, this.ctx({ staffById: this.staffById() }));
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
      } else if (ev.kind === 'loot') {
        this._takeLoot(ev);
      }
    }
    this.emit('battle', { project: p, events });
    if (complete) this._completeProject();
    else this.emit('project', p);
    return { cleared, complete };
  }

  /* 보물상자 하나를 가방에 넣는다. 로그는 별을 그대로 찍는다 — ★5 가
     떴다는 사실이 흘러가는 한 줄로 묻히면 상자를 열 이유가 없어진다. */
  _takeLoot(ev) {
    const item = shopItem(ev.itemId);
    if (!item) return;
    this.company.bag[item.id] = this.bagCount(item.id) + 1;
    this.dexSee('items', item.id);
    this.note(`🎁 보물상자! ${starText(ev.star)} ${item.emoji} ${item.ko} — 가방에 넣었다.`,
      ev.star >= 4 ? 'good' : 'info');
    this.emit('bag', { id: item.id, n: 1, loot: true });
    this.checkTasks();
  }

  pickCard(optionId) {
    const p = this.project;
    if (!p || !p.pendingCards) return { ok: false };
    const r = chooseCard(p, optionId, this.staffById());
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
      // 쓰러져 있던 사람은 다음 보스가 설 때 피 한 칸으로 일어선다. 그
      // 이벤트를 같이 흘려야 아레나 로그와 파티 카드가 같은 순간에 바뀐다.
      const evs = [{ kind: 'stageStart', ...r.started }, ...(r.revived || [])];
      if ((r.revived || []).length) {
        this.note(`쓰러졌던 ${r.revived.length}명이 겨우 일어섰다.`, 'good');
      }
      this.emit('battle', { project: p, events: evs });
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
      if (up) {
        this.note(`${s.name} 경험치 상승 → Lv.${s.level}`, 'good');
        this.emit('levelup', { id: s.id, name: s.name, level: s.level });
      }
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

    // 축별 최고 기록을 갱신한다. 개발 화면이 "지금 신기록" 을 금색으로
    // 보여주려면 비교 대상이 필요하고, 그 대상은 **완성된 게임**이어야
    // 한다 — 만들다 만 숫자를 기록으로 치면 기록이 계속 앞질러 간다.
    this.recordBests(p);

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
    // 만드는 데 걸린 시간이 여기서 달력에 실린다. 큰 기획일수록 오래 걸린다.
    this.advanceWeeks(this.devWeeksOf(p), `「${p.title}」 개발 완료`);
  }

  /* 「디버그」 버튼이 있던 자리다. 버그는 이제 마지막 공정의 **버그 보스**로
     잡는다 — 고칠 것이 남아 있는 한 누르는 게 언제나 옳던 버튼은 선택이
     아니라 잡일이었고, 스태미나까지 먹고 있었다. 손으로 고치는 길은 상점의
     디버그 킷 하나로 남는다. */

  /* ══ 출시 ══

     예전에는 여기서 막았다: 동시 운영이 3작품까지고, 네 번째를 내려면 먼저
     하나를 서비스 종료해야 했다. 그런데 그 '종료' 버튼은 운영 탭에 있고,
     게임을 다 만든 사람의 개발 탭은 이미 **홍보·출시** 화면에 가 있다.
     즉 다 만들어 놓고 출시를 눌렀는데 "하나를 내리세요" 만 뜨고, 어디서
     내리는지는 화면에 없는 상태가 된다 — 실제로 진행이 막혔다.

     이제 출시작은 판매가 끝나면 스스로 서비스를 접는다(_retireRelease).
     그래서 칸이 찰 일이 사실상 없지만, 옛 세이브처럼 이미 세 개가 차 있는
     회사도 있다. 그런 경우에는 **가장 오래된 것을 자동으로 접고** 출시를
     그대로 진행한다. 막다른 길을 만들지 않는다는 원칙(HANDOFF 3.6)이
     이 자리에서는 이 뜻이다. */
  release() {
    const p = this.finished;
    if (!p) return { ok: false, why: '출시할 게임이 없다' };
    let active = this.managed();
    while (active.length >= this.info().managedCap) {
      const oldest = active[active.length - 1];
      this._retireRelease(oldest, '새 작품 출시로 서비스 종료');
      active = this.managed();
    }
    const mk = MARKETING.find((x) => x.id === this.company.marketingId) || MARKETING[0];
    const mkCost = marketingCost(mk, p.devCost);
    if (mkCost > 0 && !this.spend(mkCost)) {
      return { ok: false, why: `홍보비 부족 (₩${mkCost.toLocaleString()})` };
    }
    const { release, fansGained } = releaseGame(p, this.company, this.rnd,
      this.ctx({ marketingId: mk.id, team: this.teamOf(p), recent: this.company.recentCombos || [] }));
    // 출시 시점을 박아 둔다. 시상식이 "지난 한 달에 낸 게임" 을 고르는
    // 유일한 근거고, 이게 없으면 심사 대상이 늘 전작 전체가 된다.
    release.at = { year: this.company.year, month: this.company.month, week: this.company.week };
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
    this.addDl(release.launchUsers || release.users);
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
    const boost = this.dlBuff();
    while (s.done < want) {
      // 화제 배율이 걸린 '이번 주에 붙어 있는 사람' 을 센다. rel.users 는
      // 배율이 빠진 자연 곡선이라, 그걸 세면 버프가 다운로드에 안 잡힌다.
      const before = rel.liveUsers || rel.users;
      const { income, event, users } = tickRelease(rel, this.rnd, boost);
      this.earn(income);
      this.addDl(Math.max(0, users - before));
      s.done += 1;
      s.total += income;
      s.peak = Math.max(s.peak, income);
      s.points.push({ w: rel.weeks, income, users, event });
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

  /* 정산을 확인했다. 여기서부터 다시 게임을 만들 수 있다. 출시 뒷정리에
     한 주가 간다 — 달력이 움직이는 세 자리 중 하나다. */
  closeSalesRun() {
    if (!this.sales) return null;
    const s = this.sales;
    this.sales = null;
    this.emit('sales', null);
    /* ── 판매는 여기서 끝난다 ──
       이 게임의 출시는 "한 주 동안 파는 것" 이다. 실시간 판매 카드가 그
       한 주의 전부를 보여주고, 정산을 확인하면 서비스가 닫힌다. 운영 칸에
       계속 쌓이지 않으므로 다음 게임을 낼 때 아무것도 내릴 필요가 없다. */
    const rel = this.releases.find((r) => r.id === s.id);
    if (rel) this._retireRelease(rel, '판매 종료');
    this.advanceWeeks(1, `「${s.title}」 출시 정리`);
    this.save();
    return s;
  }

  /* 한 작품의 서비스를 닫는다. 이유는 로그에만 남는다 — 자동으로 닫힌
     것과 플레이어가 닫은 것이 규칙상 같은 일이라야 나중에 헷갈리지 않는다. */
  _retireRelease(rel, why = '서비스 종료') {
    if (!rel || !rel.managing) return false;
    rel.managing = false;
    rel.retiredAt = this.dateLabel();
    this.note(`「${rel.title}」 ${why}. 누적 매출 ₩${(rel.earned || 0).toLocaleString()}`);
    /* 'release' 가 아니라 'retired' 다. 출시는 회사에 몇 번 없는 좋은 소식이라
       화면에 종이가 쏟아지는데(hud 의 confetti), 서비스가 닫히는 것은 그
       반대다. 한 주마다 닫히게 된 지금 같은 이벤트를 쓰면 판매가 끝날 때마다
       축하 종이가 쏟아진다. */
    this.emit('retired', rel);
    return true;
  }

  /* 출시하고 한 주가 지난 작품은 스스로 닫힌다.

     정산 창을 닫는 자리(closeSalesRun)가 정상 경로이지만, 그 창을 못 보고
     넘어가는 길이 몇 개 있다 — 판매 중에 새로고침, 세이브를 옮긴 폰, 아주
     옛 세이브. 달력이 도는 자리에서 한 번 더 걸러 두면 어느 경로로 와도
     운영 칸이 차서 출시가 막히는 일은 없다. */
  _retireStaleReleases() {
    for (const r of this.releases) {
      if (!r.managing || !r.at) continue;
      if (this.sales && this.sales.id === r.id && !this.sales.ended) continue;
      if (this._weeksSince(r.at) >= RELEASE_SALE_WEEKS) this._retireRelease(r, '판매 기간 종료');
    }
  }

  selling() { return !!this.sales; }

  endService(releaseId) {
    const r = this.releases.find((x) => x.id === releaseId);
    if (!r || !r.managing) return { ok: false };
    this._retireRelease(r, '서비스 종료');
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
      // 평론가 점수도 같이 올라야 한다. 버그만 줄고 점수가 그대로면 이
      // 물건을 쓸 이유가 화면 어디에도 없다.
      const before = p.criticTotal;
      scoreCritics(p);
      const up = p.criticTotal - before;
      msg = `${item.emoji} ${item.ko} — 버그 ${fixed}개 수정 (남은 ${p.bugs}개)`
        + (up > 0 ? ` · 평론가 +${up}점` : '');
      this.emit('finished', p);
    } else if (item.kind === 'tool' && item.crit) {
      const p = this.project;
      if (!p) return { ok: false, why: '개발 중인 게임이 없다' };
      p.critBonus = (p.critBonus || 0) + item.crit;
      msg = `${item.emoji} ${item.ko} — 번뜩임 확률 +${Math.round(item.crit * 100)}%p`;
      this.emit('project', p);
    } else if (item.kind === 'gift') {
      /* 선물. 경험치와 능력치가 같이 오른다 — 레벨은 다섯 축을 고루
         올리고, 물건이 가리키는 한 축만 추가로 더 오른다. */
      const st = this.staff.find((x) => x.id === staffId);
      if (!st) return { ok: false, why: '누구에게 줄지 고르세요' };
      const r = giveGift(st, item, c.rank);
      if (!r.ok) return r;
      const lvl = r.levels ? ` · Lv.${r.level} (+${r.levels})` : '';
      const ab = r.ability && r.gain ? ` · ${ABILITY_KO[r.ability]} +${r.gain}` : '';
      const waste = r.wasted ? ' (최대 레벨, 경험치는 버려졌다)' : '';
      msg = `${item.emoji} ${st.name} — ${item.ko} · EXP +${r.exp}${lvl}${ab}${waste}`;
      this.emit('staff', null);
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
    // 무엇을 썼는지까지 실어 보낸다. 화면 쪽이 밥과 음료와 선물을 서로 다른
    // 소리로 낼 수 있어야 "썼다" 가 아니라 "무엇을 썼다" 가 귀에 온다.
    this.emit('bag', { id, n: -1, used: item.kind });
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
    this.emit('bag', { id, n: -1, used: 'gear' });
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

  /* ---------- 외주 일감 ----------
     회사 탭에 늘 서 있던 목록이었다. 자금이 마르면 아무 때나 눌러서 돈을
     받는 자판기였고, 그 자판기가 있는 한 "돈이 없다" 는 상황이 상황이 되지
     못했다. 이제 외주는 **찾아오는 것**이다 — 랭크가 어느 정도 오른 회사에
     주간 사건으로 갑자기 의뢰가 들어오고, 받을지 말지를 그 자리에서 정한다.
     (events.js 의 `outsource`)

     스태미나는 더 이상 들지 않는다. 나가는 것은 시간뿐이다. */
  availableContracts() { return CONTRACTS; }

  contractPayFor(id) {
    const c = CONTRACTS.find((x) => x.id === id);
    return c ? contractPay(c, this.company.rank) : 0;
  }

  takeContract(id) {
    const c = CONTRACTS.find((x) => x.id === id);
    if (!c) return { ok: false };
    if (this.company.contract) return { ok: false, why: '이미 계약을 진행 중' };
    const pay = contractPay(c, this.company.rank);
    this.company.contract = { id, ko: c.ko, weeksLeft: c.weeks, pay, research: c.research };
    this.note(`${c.ko} 수주. ${c.weeks}주 동안 팀이 남의 일을 한다.`);
    this.emit('contract', this.company.contract);
    /* 계약은 그 자리에서 기간이 흐른다. 달력을 미는 버튼이 없어졌으므로,
       개발할 돈이 없는 회사가 시간을 흘릴 수 있는 유일한 길이 여기다 —
       이 자리가 막히면 "돈이 없어서 아무것도 못 한다" 가 영구히 남는다. */
    this.advanceWeeks(c.weeks, `${c.ko} 진행`);
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
    // 사건이 붙들고 있던 나머지 주를 마저 흘린다.
    this._drainWeeks();
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

  /* ══════════════════════════ 편지함 ══════════════════════════

     편지는 상태를 세 개 갖는다: 읽었나, 선물을 받았나, 잠갔나. 셋을 나눠
     두는 이유는 각각 다른 실수를 막기 때문이다 — 안 읽은 편지는 배지로
     알려야 하고, 안 받은 선물은 지워지면 안 되고, 마음에 드는 편지는
     넘쳐도 남아야 한다. */
  sendMail(mail) {
    const c = this.company;
    c.mail = c.mail || [];
    c.mailSeq = (c.mailSeq || 0) + 1;
    const m = sealMail({ at: this.dateLabel(), ...mail }, `ml${c.mailSeq}`);
    c.mail.unshift(m);
    this._trimMail();
    this.note(`${m.icon} 편지가 왔습니다 — ${m.title}`, 'good');
    this.emit('mail', m);
    return m;
  }

  /* 넘치면 오래된 것부터 지운다. 단, 아직 안 받은 선물이 붙었거나 자물쇠가
     걸린 편지는 건너뛴다. 그 둘을 지우면 편지함은 보관함이 아니라 타이머가
     된다. */
  _trimMail() {
    const c = this.company;
    while (c.mail.length > MAIL_CAP) {
      const i = c.mail.slice().reverse().findIndex((m) => m.claimed && !m.locked);
      if (i < 0) break;
      c.mail.splice(c.mail.length - 1 - i, 1);
    }
    /* 한 번도 안 받고 쌓기만 하면 편지함이 끝없이 길어진다. 두 배를 넘기면
       가장 오래된 편지의 선물을 **대신 받아 주고** 지운다 — 지우기 위해
       선물을 버리는 일은 없어야 하고, 목록이 수백 줄이 되는 것도 화면이
       아니다. */
    while (c.mail.length > MAIL_CAP * 2) {
      const i = c.mail.slice().reverse().findIndex((m) => !m.locked);
      if (i < 0) break;
      const at = c.mail.length - 1 - i;
      const old = c.mail[at];
      if (!old.claimed) this.mailClaim(old.id);
      c.mail.splice(at, 1);
    }
  }

  mailList() { return this.company.mail || []; }
  mailUnread() { return this.mailList().filter((m) => !m.read).length; }
  mailPending() { return this.mailList().filter((m) => !m.claimed).length; }

  mailOpen(id) {
    const m = this.mailList().find((x) => x.id === id);
    if (!m) return null;
    if (!m.read) { m.read = true; this.emit('mail', m); }
    return m;
  }

  /* 선물 수령. 돈·코인·연구·팬은 그 자리에서 들어가고, 물건은 가방으로
     간다. 한 번 받은 편지는 다시 받을 수 없다. */
  mailClaim(id) {
    const m = this.mailList().find((x) => x.id === id);
    if (!m || m.claimed || !m.gift) return { ok: false, why: '받을 것이 없습니다' };
    const g = m.gift;
    grantReward(this, g);
    for (const it of g.items || []) {
      const def = shopItem(it.id);
      if (!def) continue;
      this.company.bag[it.id] = this.bagCount(it.id) + (it.n || 1);
      this.dexSee('items', it.id);
    }
    m.claimed = true;
    m.read = true;
    const txt = giftText(g, (iid) => { const d = shopItem(iid); return d ? `${d.emoji} ${d.ko}` : iid; });
    this.note(`편지의 선물을 받았습니다 — ${txt}`, 'good');
    this.checkTasks();
    this._maybeRankUp();
    this.emit('mail', m);
    return { ok: true, text: txt };
  }

  mailClaimAll() {
    const open = this.mailList().filter((m) => !m.claimed && m.gift);
    for (const m of open) this.mailClaim(m.id);
    return { ok: true, n: open.length };
  }

  mailLock(id) {
    const m = this.mailList().find((x) => x.id === id);
    if (!m) return { ok: false };
    m.locked = !m.locked;
    this.emit('mail', m);
    return { ok: true, locked: m.locked };
  }

  mailDelete(id) {
    const c = this.company;
    const i = (c.mail || []).findIndex((x) => x.id === id);
    if (i < 0) return { ok: false };
    const m = c.mail[i];
    if (m.locked) return { ok: false, why: '보호 중인 편지입니다' };
    if (!m.claimed) return { ok: false, why: '선물을 먼저 받으세요' };
    c.mail.splice(i, 1);
    this.emit('mail', null);
    return { ok: true };
  }

  /* ---------- 누적 다운로드와 기념 편지 ----------
     자릿수를 넘길 때마다 한 번씩. 이미 축하한 자릿수는 dlMarks 에 남으므로
     세이브를 오가도 두 번 오지 않는다. */
  addDl(n) {
    const c = this.company;
    if (!(n > 0)) return;
    c.totalDl = (c.totalDl || 0) + Math.round(n);
    c.dlMarks = c.dlMarks || {};
    for (const mark of DL_MARKS) {
      if (c.totalDl < mark.at || c.dlMarks[mark.at]) continue;
      c.dlMarks[mark.at] = true;
      this.sendMail(dlMail(mark, this.dateLabel()));
      this.note(`축! ${mark.ko} 다운로드 첫 달성!`, 'good');
      this.emit('milestone', { mark, total: c.totalDl });
    }
  }

  /* ---------- 유저 편지 ----------
     운영 중인 게임 하나를 골라 굴린다. 게임당 세 통까지만: 그 이상은
     편지함이 한 게임의 팬레터로 가득 찬다. */
  _rollFanMail() {
    const live = this.managed();
    if (!live.length) return;
    const c = this.company;
    c.fanMailSent = c.fanMailSent || {};
    const r = live[Math.floor(this.rnd() * live.length)];
    if ((c.fanMailSent[r.id] || 0) >= 3) return;
    const fun = funScore(r.quality);
    if (this.rnd() >= fanMailChance(fun, r.users)) return;
    // 어느 축이 높았는지가 편지의 문장을 정한다.
    let top = STATS[0];
    for (const st of STATS) if ((r.quality[st] || 0) > (r.quality[top] || 0)) top = st;
    c.fanMailSent[r.id] = (c.fanMailSent[r.id] || 0) + 1;
    this.sendMail(fanMail(r, fun, top, this.rnd, this.dateLabel()));
  }

  /* ══════════════════════════ 시상식 ══════════════════════════
     두 달에 한 번, 짝수 달 첫 주에 지난 두 달의 출시작을 심사한다. 상금은
     그 자리에서 들어간다 — 결과 창을 닫아 버린 플레이어가 상금을 못 받으면
     그건 벌칙이다. */
  _runAwards() {
    const c = this.company;
    const key = `${c.year}-${c.month}`;
    if (c.lastAwardKey === key) return null;
    c.lastAwardKey = key;
    // 지난 두 달(8주) 안에 낸 게임. 날짜가 없는 옛 세이브의 출시작은 뺀다.
    // `<` 이다. `<=` 면 시상식과 같은 주에 낸 게임이 8주 뒤 시상식에도 다시
    // 걸려서 같은 작품이 두 번 심사받는다.
    const entries = this.releases.filter((r) => r.at && this._weeksSince(r.at) < AWARD_WINDOW_WEEKS);
    /* 우리가 낸 게임이 없어도 시상식은 열린다.

       예전에는 여기서 돌아섰다. 그러면 데뷔 전의 몇 달과 개발이 길어진 달에는
       달력에 아무 일도 안 적히고, 시상식은 "우리가 잘한 달에만 있는 것" 이
       되었다. 업계의 행사가 우리 사정에 맞춰 열리지는 않는다 — 우리가 아무
       것도 안 냈으면 남들 이름이 불릴 뿐이다. */
    const wins = entries.length ? judge(entries, c.year, c.rank) : [];
    const totals = awardTotals(wins);
    const near = wins.length ? null : nearMiss(entries, c.year);
    if (wins.length) {
      grantReward(this, totals);
      c.awards = [...(c.awards || []), ...wins.map((w) => ({
        catKo: w.catKo, icon: w.icon, gradeKo: w.grade.ko, gradeId: w.grade.id,
        title: w.title, value: w.value, at: this.dateLabel(),
      }))].slice(-40);
      const head = wins.map((w) => `${w.icon} ${w.catKo} ${w.grade.ko}`).join(' · ');
      this.note(`${c.month}월 시상식: ${head}`, 'good');
      this.sendMail(recordMail('award', `${c.year}년차 ${c.month}월 시상식 결과`,
        wins.map((w) => `${w.icon} ${w.catKo} ${w.grade.ko} — 「${w.title}」 (${w.statKo} ${w.value})`).join('\n')
        + `\n\n상금 ${rewardText(totals)} 은(는) 이미 계좌로 보냈습니다.`,
        this.dateLabel(), '🏆'));
      // 금상은 사람을 부른다. 시상식에서 만난 누군가가 따라오기도 한다.
      const top = wins.some((w) => w.grade.id === 'gold') ? 0.5
        : wins.some((w) => w.grade.id === 'silver') ? 0.25 : 0.12;
      this.maybeGrantHelper(top, 1.3, '시상식');
      this._maybeRankUp();
    }
    // 우리가 못 가져간 부문은 남이 가져간다. 무대에만 뜨고 규칙은 안 바꾼다.
    const others = rivalAwards(wins, c.year, this.rnd, RIVALS, rivalTitle);
    if (!wins.length && others.length) {
      const top = others[0];
      this.note(`${c.month}월 시상식: ${top.catKo} ${top.grade.ko}은(는) ${top.studio}의 「${top.title}」에 돌아갔다.`);
    }
    this.pendingAward = {
      year: c.year, month: c.month, wins, totals, near, others,
      entries: entries.length, rank: c.rank, studio: c.name || '우리 스튜디오',
    };
    this.emit('award', this.pendingAward);
    this.checkTasks();
    return this.pendingAward;
  }

  /* 출시일로부터 몇 주가 지났나. 한 해를 48주(12달 × 4주)로 세는 이 게임의
     달력을 그대로 쓴다. */
  _weeksSince(at) {
    const c = this.company;
    const now = ((c.year - 1) * 12 + (c.month - 1)) * 4 + (c.week - 1);
    const then = ((at.year - 1) * 12 + (at.month - 1)) * 4 + (at.week - 1);
    return now - then;
  }

  awardBarFor(catId) { return awardBar(this.company.year, catId); }

  /* ══════════════════════════ 게임덱스 ══════════════════════════
     두 달에 한 번 열린다. 초대장은 남아 있고, 다음 회차가 열리면 지난
     초대장은 사라진다 — 두 개를 쌓아 두고 한꺼번에 나가는 길은 없다. */
  _openExpo() {
    const c = this.company;
    const key = `${c.year}-${c.month}`;
    if (c.lastExpoKey === key) return null;
    c.lastExpoKey = key;
    c.expoInvite = { year: c.year, month: c.month };
    this.note(`게임덱스 ${c.month}월 개최 — 부스 출전 초대장이 왔습니다.`, 'good');
    this.emit('expo', c.expoInvite);
    return c.expoInvite;
  }

  expoOpen() { return this.company.expoInvite || null; }

  joinExpo(planId) {
    if (!this.company.expoInvite) return { ok: false, why: '지금은 열린 행사가 없습니다' };
    const plan = EXPO_PLANS.find((p) => p.id === planId);
    if (!plan) return { ok: false, why: '없는 출전 방식' };
    const c = this.company;
    if (plan.coins && c.coins < plan.coins) return { ok: false, why: `코인 ${plan.coins} 필요` };
    if (plan.cost && !this.spend(plan.cost)) return { ok: false, why: '자금 부족' };
    if (plan.coins) c.coins -= plan.coins;

    // 부스에서 보여줄 수 있는 가장 좋은 게임. 없으면 데뷔 전이라 사람이 덜 온다.
    const best = this.releases.reduce((a, r) => Math.max(a, funScore(r.quality)), 0);
    const visitors = expoVisitors(plan, c.fans, best, this.rnd);
    const res = expoResult(plan, visitors, this.rnd);
    const note = expoNote(visitors, c.expoBest || 0);
    c.expoBest = Math.max(c.expoBest || 0, visitors);
    c.fans += res.fans;
    c.buff = { ko: '게임덱스 화제', dl: res.dl, weeks: res.weeks };
    c.expoLog = [{ at: this.dateLabel(), planKo: plan.ko, visitors, fans: res.fans, dl: res.dl }, ...(c.expoLog || [])].slice(0, 12);
    c.expoInvite = null;
    this.note(`게임덱스 부스 방문자 ${visitors.toLocaleString('ko-KR')}명 · 팬 +${res.fans.toLocaleString('ko-KR')} · `
      + `${res.weeks}주 동안 DL ${Math.round((res.dl - 1) * 100)}% UP`, 'good');
    this.sendMail(recordMail('expo', `게임덱스 ${c.month}월 결산`,
      `${plan.ko}\n\n부스 방문자 ${visitors.toLocaleString('ko-KR')}명\n`
      + `팬 +${res.fans.toLocaleString('ko-KR')}명\n`
      + `${res.weeks}주 동안 다운로드 ${Math.round((res.dl - 1) * 100)}% 증가`,
      this.dateLabel(), '🎪'));
    /* 부스에 서 있다 보면 누군가 따라온다. 크게 차린 부스일수록 잘 따라오고,
       좋은 쪽이 나온다 — 도우미를 얻는 가장 확실한 자리가 여기다. */
    const luck = { small: 1.0, mid: 1.2, big: 1.55 }[plan.id] || 1;
    const chance = { small: 0.30, mid: 0.55, big: 0.90 }[plan.id] || 0.3;
    const got = this.maybeGrantHelper(chance, luck, '게임덱스');
    this._maybeRankUp();
    this.checkTasks();
    const out = { ok: true, plan, visitors, note, helper: got, ...res };
    this.emit('expoDone', out);
    return out;
  }

  /* 지금 걸려 있는 다운로드 배율. 버프가 없으면 1 이다. */
  dlBuff() {
    const b = this.company.buff;
    return b && b.weeks > 0 ? b.dl : 1;
  }

  /* ══════════════════════ 달력 ══════════════════════

     "다음 주로 넘기기" 버튼은 없앴다. 그 버튼이 있는 동안 최적의 플레이는
     언제나 같았다 — 아무것도 만들지 않고 달력만 연타하면 시상식도 계약도
     판매도 알아서 굴러왔다. 코인 값을 붙여 막아 봤지만, 그건 연타를 막은
     것이지 연타가 이득이라는 사실을 없앤 것은 아니었다.

     이제 시간은 **게임을 만들면 흐른다.**
       · 게임을 완성하면  기획서 등급만큼 (★1 한 주 → ★5 세 주)
       · 판매 정산을 확인하면  한 주
       · 계약을 받으면  그 계약의 기간만큼 그 자리에서

     그래서 달력은 누르는 것이 아니라 **일한 결과**가 되고, 한 해에 몇
     작품을 낼 수 있는가가 곧 회사의 속도가 된다.

     `weeksDue` 는 아직 못 흘린 주다. 주간 사건이 답을 기다리는 동안에는
     달력이 멈춰야 하므로(사건의 요점이 그것이다), 남은 주는 여기 쌓였다가
     답을 하는 순간 마저 흐른다. */

  /* 완성한 게임이 잡아먹은 개발 기간. */
  devWeeksOf(project) {
    const grade = (project && project.proposal && project.proposal.grade) || 1;
    return 1 + Math.floor(grade / 2);
  }

  advanceWeeks(n, why = '') {
    const c = this.company;
    c.weeksDue = (c.weeksDue || 0) + Math.max(0, Math.round(n));
    if (why) this.note(`${why} — ${Math.max(0, Math.round(n))}주가 지났다.`);
    return this._drainWeeks();
  }

  /* 쌓인 주를 흘린다. 사건이 걸리면 거기서 멈추고, 답을 하면 이어서 흐른다. */
  _drainWeeks() {
    const c = this.company;
    let ran = 0;
    let guard = 0;
    while ((c.weeksDue || 0) > 0 && !this.pendingEvent && guard++ < 64) {
      c.weeksDue -= 1;
      this.nextWeek();
      ran += 1;
    }
    return { weeks: ran, left: c.weeksDue || 0 };
  }

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
    const boost = this.dlBuff();
    for (const r of this.releases) {
      // 실시간 판매가 도는 게임은 그 팝업이 자기 주차를 흘리고 있다. 여기서
      // 또 한 주를 태우면 같은 주가 두 번 팔린다.
      if (this.sales && this.sales.id === r.id && !this.sales.ended) continue;
      const before = r.liveUsers || r.users;
      const tick = tickRelease(r, this.rnd, boost);
      income += tick.income;
      // 늘어난 유저만 다운로드로 센다. 빠져나간 주는 0 이다 — 누적
      // 다운로드는 줄어들 수 있는 숫자가 아니다.
      this.addDl(Math.max(0, tick.users - before));
    }
    // 경쟁사도 한 주를 산다. 우리 게임이 식는 동안 남의 게임은 뜬다.
    this._tickRivals();

    const costs = weeklyCosts(c, this.staff);
    this.earn(income);
    c.money -= costs;

    // Contract work settles before the week rolls over.
    if (c.contract) {
      c.contract.weeksLeft -= 1;
      if (c.contract.weeksLeft <= 0) {
        this.earn(c.contract.pay);
        c.researchPts += c.contract.research;
        // 코인이 마르지 않게 하는 자리. 계약은 스태미나로 받고 스태미나는
        // 실시간으로 차므로, 이 한 개가 "코인이 없어 주가 안 넘어간다" 를
        // 영구적인 벽이 아니라 기다림으로 만든다.
        c.coins += 1;
        this.note(`${c.contract.ko} 납품 완료. ₩${c.contract.pay.toLocaleString()} · 연구 +${c.contract.research} · 코인 +1`, 'good');
        c.contract = null;
        this.emit('contract', null);
      }
    }

    // 한 주 판 작품은 여기서 닫힌다.
    this._retireStaleReleases();

    const wasMonth = c.month;
    c.week += 1;
    if (c.week > 4) { c.week = 1; c.month += 1; }
    if (c.month > 12) { c.month = 1; c.year += 1; }
    // A new quarter, a new fashion.
    if (c.week === 1 && (c.month - 1) % 3 === 0) {
      this.rollTrends();
      this.note(`시장 유행이 바뀌었다: ${c.trends.genreKo} · ${c.trends.contentKo}`);
    }

    /* ---- 달이 바뀌었다 ----
       시상식은 짝수 달(2·4·6…), 게임덱스는 홀수 달(1·3·5…)에 열린다.

       예전에는 시상식이 **매달**이었다. 무대가 1분 가까이 서는 행사가 매달
       열리면 그건 사건이 아니라 통행료가 된다 — 개발 한 판이 서너 주니까,
       게임 하나를 만드는 동안 시상식을 두 번 앉아서 보게 된다. 두 달에 한
       번이면 무대는 그대로 사건이고, 심사 대상도 넉넉히 두 달치가 쌓인다.

       두 행사가 서로 다른 홀짝에 서므로 한 달에 두 개가 겹치는 일도 없다. */
    if (c.month !== wasMonth) {
      if (c.month % 2 === 0) this._runAwards();
      else this._openExpo();
    }

    // 게임덱스가 남긴 화제는 몇 주 만에 식는다.
    if (c.buff && c.buff.weeks > 0) {
      c.buff.weeks -= 1;
      if (c.buff.weeks <= 0) {
        this.note(`${c.buff.ko} 효과가 끝났습니다.`);
        c.buff = null;
      }
    }

    /* 한 주가 지나면 스태미나가 조금 찬다. 예전에는 가득 찼는데, 그건
       버튼을 누른 대가였다. 이제 주는 일한 결과로 흐르므로 가득 채우면
       계약 한 건이 스태미나 자판기가 된다. 주력은 실시간 회복이고,
       한 주는 거기에 얹히는 보너스다. */
    c.staminaMax = this.info().staminaMax;
    c.stamina = Math.min(c.staminaMax, c.stamina + Math.max(2, Math.round(c.staminaMax * 0.25)));
    c.stamAt = Date.now();
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
    // 주가 예전만큼 자주 넘어가지 않는다(달력이 일한 결과로만 흐른다).
    // 명단이 새로 들어오는 빈도는 그만큼 올려 준다 — 사람을 못 뽑아서
    // 회사가 멈추는 것은 판단이 아니라 대기다.
    if (this.rnd() > 0.45) this.rollCandidates();

    this.emit('week', { income, costs });
    this.checkTasks();
    // Roughly one week in five. Frequent enough that a year has a shape,
    // rare enough that it never becomes the thing you are playing.
    if (this.rnd() < 0.21) this.rollWeeklyEvent();
    // 유저 편지. 이벤트와 달리 주를 막지 않으므로 매주 굴려도 된다.
    this._rollFanMail();
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
      // 실시간 스태미나·최고 기록이 없던 세이브. 시계는 지금부터 돌고,
      // 기록은 이미 출시한 게임들에서 되짚는다.
      c.stamAt = c.stamAt || Date.now();
      c.weeksDue = c.weeksDue || 0;
      c.rivalGames = Array.isArray(c.rivalGames) ? c.rivalGames : [];
      c.rivalSeq = c.rivalSeq || 0;
      c.chartRank = c.chartRank || 0;
      c.chartWeeksNo1 = c.chartWeeksNo1 || 0;
      c.helpers = (c.helpers && typeof c.helpers === 'object') ? c.helpers : {};
      c.helperSlots = Array.isArray(c.helperSlots)
        ? c.helperSlots.filter((id) => HELPER_BY_ID.has(id) && c.helpers[id]) : [];
      c.staminaMax = rankInfo(c.rank).staminaMax;
      c.stamina = Math.min(c.stamina || 0, c.staminaMax);
      if (!c.best || typeof c.best !== 'object') {
        c.best = {};
        for (const r of g.releases) {
          const q = r.quality || {};
          for (const [k, v] of Object.entries({ ...q, fun: funScore(q) })) {
            const val = Math.round(v || 0);
            if (val > (c.best[k] || 0)) c.best[k] = val;
          }
        }
      }
      c.devIntroSeen = !!c.devIntroSeen;
      /* 편지함·행사가 없던 세이브. 빈 값으로 열리면 되고, 지난 출시작에는
         날짜가 없으니 시상식 심사 대상에서 자연히 빠진다. */
      c.mail = Array.isArray(c.mail) ? c.mail : [];
      c.mailSeq = c.mailSeq || c.mail.length;
      c.totalDl = c.totalDl || 0;
      c.dlMarks = c.dlMarks || {};
      c.awards = c.awards || [];
      c.expoLog = c.expoLog || [];
      c.expoBest = c.expoBest || 0;
      c.buff = c.buff && c.buff.weeks > 0 ? c.buff : null;
      c.fanMailSent = c.fanMailSent || {};
      c.lastAwardKey = c.lastAwardKey || null;
      c.lastExpoKey = c.lastExpoKey || null;
      c.expoInvite = c.expoInvite || null;
      c.seenTabs = c.seenTabs || {};
      /* 누적 다운로드가 없던 세이브는 지금 있는 출시작으로 되짚는다.
         0 으로 열면 이미 백만을 판 회사가 10만 축하 편지를 받는다. */
      if (!c.totalDl) {
        c.totalDl = g.releases.reduce((a, r) => a + (r.launchUsers || r.users || 0), 0);
        for (const mark of DL_MARKS) if (c.totalDl >= mark.at) c.dlMarks[mark.at] = true;
      }
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
        pj.lootThisStage = pj.lootThisStage || 0;
        pj.lootTotal = pj.lootTotal || 0;
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
  expToNext, STARTUP_GRANT, TASKS, TUTORIAL, rewardText,
  hpRatio, isTired, isSpent, gearOf, basePower, shopItem, GEAR_SLOTS,
};
