/* The company: state, the week clock, and every action the UI can take.

   This module owns the whole simulation and knows nothing about rendering.
   `Game.listeners` is how the 3D layer and the DOM hear about things — a
   battle turn emits hit events the office animates, a release emits a banner.

   Save format is the plain state object, so localStorage round-trips it with
   JSON and nothing needs a migration layer yet. */

import {
  JOBS, PLATFORMS, MONETIZE, GENRES, CONTENTS, STATS, rankInfo, RANK_UP_FANS, ITEMS,
  RESEARCH, researchCost, CONTRACTS, contractPay, MARKETING,
  marketingCost, floorCost, comboScore,
  STARTUP_GRANT, rescueAmount, rescueMorale,
} from './data.js';
import {
  FURNITURE_BY_ID, RESELL, comfortScore, comfortLevel, footprint, overlaps,
} from './furniture.js';
import { TUTORIAL, tutorialStep } from './tutorial.js';
import {
  rollCandidates, proposalPower, giveItem, promote, canPromote,
  reincarnate, canReincarnate, addMotivation, abilities, power, role, seedIds, itemCost,
  trainStamina, gainExp, expToNext,
} from './staff.js';
import {
  generateProposal, startProject, battleTurn, chooseCard, finishProject, debug,
  turnCost, seedProjectIds,
} from './project.js';
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
    };
    // Bought but not yet placed. The bag is what makes buying and placing two
    // separate decisions rather than one click that teleports a desk somewhere.
    this.bag = [];
    this.staff = [];
    this.proposals = [];
    this.project = null;         // the project currently in development
    this.finished = null;        // finished, awaiting release
    this.releases = [];
    this.candidates = [];
    this.history = [];
    this.log = [];

    // No founders. The studio opens as an empty floor with a grant in the bank,
    // so the first decisions — how many desks, who to seat at them — are the
    // player's rather than a starting roster's.
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
      ...extra,
    };
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
  rollCandidates() {
    this.candidates = rollCandidates(this.rnd, this.company.rank, 3);
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
    this.candidates = this.candidates.filter((x) => x.id !== candidateId);
    this.note(`${c.name} (${JOBS[c.job].ko}) 입사.`, 'good');
    if (this.desks) this.assignDesks(this.desks);
    this.emit('staff', null);
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
    const pr = this.proposals.find((p) => p.id === proposalId);
    if (!pr) return { ok: false, why: '없는 기획서' };
    const team = teamIds.map((id) => this.staff.find((s) => s.id === id)).filter(Boolean);
    if (!team.length) return { ok: false, why: '팀원을 배정하세요' };

    const seriesOf = seriesOfId ? this.releases.find((r) => r.id === seriesOfId) : null;
    const p = startProject({
      proposal: pr, platformId, monetizeId, team,
      rank: this.company.rank, seriesOf,
    });
    if (!this.spend(p.devCost)) return { ok: false, why: `개발비 부족 (₩${p.devCost.toLocaleString()})` };

    this.proposals = this.proposals.filter((x) => x.id !== proposalId);
    this.project = p;
    this.note(`「${p.title}」 개발 착수. 아이디어 HP ${p.hpMax.toLocaleString()}`, 'good');
    this.emit('project', p);
    return { ok: true, project: p };
  }

  devTurn() {
    const p = this.project;
    if (!p) return { ok: false, why: '개발 중인 프로젝트가 없다' };
    if (p.pendingCards) return { ok: false, why: '아이디어를 먼저 고르세요' };
    const cost = turnCost(p);
    if (this.company.stamina < cost) return { ok: false, why: '스태미나 부족. 다음 주로 넘기세요.' };
    this.company.stamina -= cost;

    const r = battleTurn(p, this.staffById(), this.rnd, this.ctx());
    this.emit('battle', { project: p, events: r.events });

    if (p.hp <= 0 && !p.pendingCards) this._completeProject();
    else this.emit('project', p);
    return { ok: true, ...r };
  }

  pickCard(optionId) {
    const p = this.project;
    if (!p || !p.pendingCards) return { ok: false };
    const r = chooseCard(p, optionId);
    if (r.kind === 'content') {
      this.note(`게임 내용 결정: ${p.contentId}`);
    } else {
      this.note(`개발 방식 결정: ${p.methodId}`);
    }
    if (r.complete) this._completeProject();
    else this.emit('project', p);
    return r;
  }

  _completeProject() {
    const p = this.project;
    const res = finishProject(p, this.staffById(), this.rnd, this.ctx());
    if (res.author) addMotivation(res.author, 1, this.company.rank);

    // Research earned, and the combo written into the discovery log.
    const rp = researchFromProject(p);
    this.company.researchPts += rp;
    if (p.contentId) {
      const key = `${p.genreId}|${p.contentId}`;
      const score = comboScore(p.genreId, p.contentId);
      const prev = this.company.discovered[key];
      if (!prev || score > prev.score || p.criticTotal > prev.critic) {
        this.company.discovered[key] = {
          score, critic: Math.max(p.criticTotal, prev ? prev.critic : 0), title: p.title,
        };
      }
    }
    // Everyone who worked on it learns from it. A bigger, better-received game
    // teaches more, so the team that ships ambitious work grows fastest.
    const xp = Math.round(20 + p.hpMax / 300 + p.criticTotal * 2);
    for (const id of p.team) {
      const s = this.staff.find((x) => x.id === id);
      if (!s) continue;
      s.gamesShipped += 1;
      const up = gainExp(s, xp);
      if (up) this.note(`${s.name} 경험치 상승 → Lv.${s.level}`, 'good');
    }
    this.project = null;
    this.finished = p;
    this.company.marketingId = 'none';
    this.note(`「${p.title}」 완성! 평론가 합계 ${p.criticTotal}점, 버그 ${p.bugs}개 · 연구 +${rp}`,
      p.hallOfFame ? 'good' : 'info');
    if (p.hallOfFame) this.note('명예의 전당 등재! 이제 속편을 만들 수 있다.', 'good');
    this.emit('finished', p);
  }

  debugProject() {
    const p = this.finished;
    if (!p || p.bugs <= 0) return { ok: false, why: '고칠 버그가 없다' };
    if (this.company.stamina < 1) return { ok: false, why: '스태미나 부족' };
    this.company.stamina -= 1;
    const r = debug(p, this.staffById(), this.rnd);
    this.note(`디버그: 버그 ${r.fixed}개 수정 (남은 ${p.bugs}개)`);
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
      this.ctx({ marketingId: mk.id, team: this.teamOf(p) }));
    this.releases.unshift(release);
    this.company.fans += fansGained;
    this.company.coins += coinsFromRelease(release);
    this.company.shipped += 1;
    this.history.unshift({
      title: p.title, genreKo: p.genreKo, contentKo: p.contentKo,
      criticTotal: p.criticTotal, users: release.users, at: this.dateLabel(),
    });
    this.finished = null;
    const mkNote = mk.id === 'none' ? '' : ` · ${mk.ko} ₩${mkCost.toLocaleString()}`;
    const trendNote = release.trendHit ? ' · 유행을 탔다!' : '';
    this.note(`「${release.title}」 출시! 초기 유저 ${release.users.toLocaleString()}명, 팬 +${fansGained.toLocaleString()}${mkNote}${trendNote}`, 'good');
    this.emit('release', release);
    this._maybeRankUp();
    return { ok: true, release };
  }

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
    const c = CONTENTS[Math.floor(this.rnd() * CONTENTS.length)];
    this.company.trends = {
      genreId: g.id, genreKo: g.ko,
      contentId: c.id, contentKo: c.ko,
      setAt: `${this.company.year}-${this.company.month}`,
    };
    this.emit('trends', this.company.trends);
  }

  /* ---------- the week clock ---------- */
  nextWeek() {
    const c = this.company;
    let income = 0;
    for (const r of this.releases) income += tickRelease(r, this.rnd);
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

    // Idle staff drift back toward a neutral mood; a shipped game is what
    // actually raises motivation. A comfortable office pushes the other way —
    // this is what the furniture is for, and why 쾌적도 is worth spending on
    // once you have more people than the grant could seat.
    const cm = this.comfort();
    for (const s of this.staff) {
      if (this.project && this.project.team.includes(s.id)) continue;
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
      g.project = d.project; g.finished = d.finished; g.releases = d.releases;
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
      if (!c.trends) g.rollTrends();
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
  abilities, power, role, rankInfo, RANK_UP_FANS, itemCost, trainStamina, floorCost,
  expToNext, STARTUP_GRANT, TUTORIAL,
};
