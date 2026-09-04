/* The company: state, the week clock, and every action the UI can take.

   This module owns the whole simulation and knows nothing about rendering.
   `Game.listeners` is how the 3D layer and the DOM hear about things — a
   battle turn emits hit events the office animates, a release emits a banner.

   Save format is the plain state object, so localStorage round-trips it with
   JSON and nothing needs a migration layer yet. */

import {
  JOBS, PLATFORMS, MONETIZE, GENRES, CONTENTS, STATS, rankInfo, RANK_UP_FANS, ITEMS,
  STARTING_JOBS, RESEARCH, researchCost, CONTRACTS, contractPay, MARKETING,
  marketingCost, floorCost, comboScore,
} from './data.js';
import {
  makeStaff, rollCandidates, proposalPower, giveItem, promote, canPromote,
  reincarnate, canReincarnate, addMotivation, abilities, power, role, seedIds, itemCost,
  trainStamina, gainExp, expToNext,
} from './staff.js';
import {
  generateProposal, startProject, battleTurn, chooseCard, finishProject, debug,
  turnCost, seedProjectIds,
} from './project.js';
import { TASKS, rollEvent, grantReward, rewardText } from './events.js';
import {
  releaseGame, tickRelease, weeklyCosts, checkRankUp, cashCap, coinsFromRelease,
  researchFromProject,
} from './economy.js';
import { mulberry32 } from '../core/math.js';

const SAVE_KEY = 'socialdev3d.save.v1';

export class Game {
  constructor(seed = Date.now() & 0x7fffffff) {
    this.seed = seed;
    this.rnd = mulberry32(seed);
    this.listeners = [];
    this.reset();
  }

  on(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((f) => f !== fn); }; }
  emit(type, payload) { for (const fn of this.listeners) fn(type, payload); }

  reset() {
    const info = rankInfo(1);
    this.company = {
      name: '스튜디오 게임22',
      money: 260000,
      coins: 20,
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
      recentCombos: [],             // the last few genre|content keys shipped
      tasksDone: {},                // sales tasks already paid out
      eventsSeen: 0,
    };
    this.pendingEvent = null;       // a weekly event waiting on the player
    this.staff = [];
    this.proposals = [];
    this.project = null;         // the project currently in development
    this.finished = null;        // finished, awaiting release
    this.releases = [];
    this.candidates = [];
    this.history = [];
    this.log = [];

    // Five founders, one of each discipline, so every system is reachable on
    // turn one instead of gated behind a hire.
    for (const job of STARTING_JOBS) {
      this.staff.push(makeStaff(this.rnd, job, { talent: 0.95 + this.rnd() * 0.3, level: 3 }));
    }
    this.rollCandidates();
    this.rollTrends();
    this.note('오늘부터 사장님입니다. 기획서를 뽑고 개발을 시작하세요.');
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

  /* ---------- desks ---------- */
  /* Assign every staffer to a desk on a floor matching their discipline where
     one is free. The separation of planners from developers is not cosmetic:
     proposalPower pays a bonus for sitting on the matching floor. */
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

  hire(candidateId) {
    const c = this.candidates.find((x) => x.id === candidateId);
    if (!c) return { ok: false, why: '없는 후보' };
    if (this.staff.length >= this.info().staffCap) {
      return { ok: false, why: `정원 초과 (랭크 ${this.company.rank} 정원 ${this.info().staffCap}명)` };
    }
    if (!this.spend(c.hireCost)) return { ok: false, why: '자금 부족' };
    this.staff.push(c);
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
    return this.staff.reduce((a, s) => a + proposalPower(s, this.floorRoleOf(s)), 0);
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
    let discovered = null;
    if (p.contentId) {
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
    this._maybeRankUp();
    this.checkTasks();
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
    // actually raises motivation.
    for (const s of this.staff) {
      if (!this.project || !this.project.team.includes(s.id)) {
        if (s.motivation > 3 && this.rnd() > 0.85) s.motivation -= 1;
      }
    }

    if (c.money < 0) {
      this.note(`자금이 마이너스입니다 (₩${c.money.toLocaleString()}). 계약 일감으로 급한 불을 끄세요.`, 'bad');
      if (c.money < -120000) {
        // The safety net the design doc asks for: a studio is never PERMANENTLY
        // stuck at zero. It is deliberately not free money — the roster's
        // morale takes the hit, so repeated rescues visibly cost you output.
        c.money = 40000;
        for (const s of this.staff) addMotivation(s, -2, c.rank);
        this.note('스폰서가 급한 불을 꺼줬다. 직원들의 의욕이 떨어졌다.', 'bad');
      }
    }
    if (income > 0) this.note(`주간 정산: 매출 ₩${income.toLocaleString()} / 비용 ₩${costs.toLocaleString()}`);
    if (this.rnd() > 0.72) this.rollCandidates();

    this.emit('week', { income, costs });
    this.checkTasks();
    // Roughly one week in five. Frequent enough that a year has a shape,
    // rare enough that it never becomes the thing you are playing.
    if (this.rnd() < 0.21) this.rollWeeklyEvent();
    return { income, costs };
  }

  /* ---------- save / load ---------- */
  serialize() {
    return JSON.stringify({
      v: 1, seed: this.seed,
      company: this.company, staff: this.staff, proposals: this.proposals,
      project: this.project, finished: this.finished, releases: this.releases,
      candidates: this.candidates, history: this.history,
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
    try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { return null; }
    if (!raw) return null;
    try {
      const d = JSON.parse(raw);
      const g = new Game(d.seed);
      g.company = d.company; g.staff = d.staff; g.proposals = d.proposals;
      g.project = d.project; g.finished = d.finished; g.releases = d.releases;
      g.candidates = d.candidates || []; g.history = d.history || [];
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
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* private mode */ }
  }
}

export {
  STATS, JOBS, GENRES, CONTENTS, PLATFORMS, MONETIZE, ITEMS, RESEARCH, CONTRACTS, MARKETING,
  abilities, power, role, rankInfo, RANK_UP_FANS, itemCost, trainStamina, floorCost,
  expToNext, TASKS, rewardText,
};
