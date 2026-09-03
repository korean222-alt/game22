/* The company: state, the week clock, and every action the UI can take.

   This module owns the whole simulation and knows nothing about rendering.
   `Game.listeners` is how the 3D layer and the DOM hear about things — a
   battle turn emits hit events the office animates, a release emits a banner.

   Save format is the plain state object, so localStorage round-trips it with
   JSON and nothing needs a migration layer yet. */

import {
  JOBS, PLATFORMS, MONETIZE, GENRES, STATS, rankInfo, RANK_UP_FANS, ITEMS,
  STARTING_JOBS,
} from './data.js';
import {
  makeStaff, rollCandidates, proposalPower, giveItem, promote, canPromote,
  reincarnate, canReincarnate, addMotivation, abilities, power, role, seedIds, itemCost,
} from './staff.js';
import {
  generateProposal, startProject, battleTurn, chooseCard, finishProject, debug,
  turnCost, seedProjectIds,
} from './project.js';
import {
  releaseGame, tickRelease, weeklyCosts, checkRankUp, cashCap, coinsFromRelease,
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
    };
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
    this.note('오늘부터 사장님입니다. 기획서를 뽑고 개발을 시작하세요.');
  }

  note(text, kind = 'info') {
    this.log.unshift({ text, kind, at: this.dateLabel() });
    if (this.log.length > 60) this.log.pop();
    this.emit('log', { text, kind });
  }

  dateLabel() { const c = this.company; return `${c.year}년차 ${c.month}월 ${c.week}주`; }
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
  rollCandidates() {
    this.candidates = rollCandidates(this.rnd, this.company.rank, 3);
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
    if (this.company.stamina < 1) return { ok: false, why: '스태미나 부족' };
    const cost = itemCost(s, item);
    if (!this.spend(cost)) return { ok: false, why: '자금 부족' };
    this.company.stamina -= 1;
    const r = giveItem(s, itemId, this.company.rank);
    if (!r.ok) { this.company.money += cost; this.company.stamina += 1; return r; }
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
    const pr = generateProposal(this.rnd, author, this.totalPlanPower(), this.company.rank);
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

    const r = battleTurn(p, this.staffById(), this.rnd);
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
    const res = finishProject(p, this.staffById(), this.rnd);
    if (res.author) addMotivation(res.author, 1, this.company.rank);
    for (const id of p.team) {
      const s = this.staff.find((x) => x.id === id);
      if (s) s.gamesShipped += 1;
    }
    this.project = null;
    this.finished = p;
    this.note(`「${p.title}」 완성! 평론가 합계 ${p.criticTotal}점, 버그 ${p.bugs}개`,
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
    const { release, fansGained } = releaseGame(p, this.company, this.rnd);
    this.releases.unshift(release);
    this.company.fans += fansGained;
    this.company.coins += coinsFromRelease(release);
    this.company.shipped += 1;
    this.history.unshift({
      title: p.title, genreKo: p.genreKo, contentKo: p.contentKo,
      criticTotal: p.criticTotal, users: release.users, at: this.dateLabel(),
    });
    this.finished = null;
    this.note(`「${release.title}」 출시! 초기 유저 ${release.users.toLocaleString()}명, 팬 +${fansGained.toLocaleString()}`, 'good');
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

  /* ---------- the week clock ---------- */
  nextWeek() {
    const c = this.company;
    let income = 0;
    for (const r of this.releases) income += tickRelease(r, this.rnd);
    const costs = weeklyCosts(c, this.staff);
    this.earn(income);
    c.money -= costs;

    c.week += 1;
    if (c.week > 4) { c.week = 1; c.month += 1; }
    if (c.month > 12) { c.month = 1; c.year += 1; }

    c.stamina = c.staminaMax;

    // Idle staff drift back toward a neutral mood; a shipped game is what
    // actually raises motivation.
    for (const s of this.staff) {
      if (!this.project || !this.project.team.includes(s.id)) {
        if (s.motivation > 3 && this.rnd() > 0.85) s.motivation -= 1;
      }
    }

    if (c.money < 0) {
      this.note(`자금이 마이너스입니다 (₩${c.money.toLocaleString()}). 운영비를 줄이세요.`, 'bad');
      if (c.money < -200000) {
        // The series' safety net: the sponsor covers you, but only so often.
        c.money += 300000;
        this.note('스폰서가 비상금을 지원했다. 다음은 없다.', 'bad');
      }
    }
    if (income > 0) this.note(`주간 정산: 매출 ₩${income.toLocaleString()} / 비용 ₩${costs.toLocaleString()}`);
    if (this.rnd() > 0.72) this.rollCandidates();

    this.emit('week', { income, costs });
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

export { STATS, JOBS, GENRES, PLATFORMS, MONETIZE, ITEMS, abilities, power, role, rankInfo, RANK_UP_FANS, itemCost };
