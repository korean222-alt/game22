/* The company: state, the week clock, and every action the UI can take.

   This module owns the whole simulation and knows nothing about rendering.
   `Game.listeners` is how the 3D layer and the DOM hear about things — a
   battle turn emits hit events the office animates, a release emits a banner.

   Save format is the plain state object, so localStorage round-trips it with
   JSON and nothing needs a migration layer yet. */

import {
  JOBS, PLATFORMS, MONETIZE, GENRES, CONTENTS, STATS, rankInfo, RANK_UP_FANS, ITEMS,
  STARTING_JOBS, RESEARCH, researchCost, CONTRACTS, contractPay, MARKETING,
  marketingCost, floorCost, comboScore, SHOP, shopItem, shopFor, GEAR_SLOTS,
  OVERTIME, DEX_SECTIONS, HP, bossFor, FOCUS_STAMINA,
} from './data.js';
import {
  makeStaff, rollCandidates, proposalPower, giveItem, promote, canPromote,
  reincarnate, canReincarnate, addMotivation, abilities, power, role, seedIds, itemCost,
  trainStamina, gainExp, expToNext, syncHp, healHp, hpRatio, drainHp,
  equipGear, unequipGear, canEquip, gearOf, isTired, isSpent, basePower,
} from './staff.js';
import {
  generateProposal, startProject, battleTurn, chooseCard, finishProject, debug,
  turnCost, seedProjectIds, previewQuality, previewBugs, funScore,
} from './project.js';
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
      // 상점에서 산 물건이 쌓이는 가방. { itemId: 개수 }
      bag: {},
      // 도감. 본 것과 잡은 것이 여기에 남는다.
      dex: { genres: {}, contents: {}, bosses: {}, items: {}, jobs: {} },
      overtimeUsed: false,
      spentOnShop: 0,
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
      const s = makeStaff(this.rnd, job, { talent: 0.95 + this.rnd() * 0.3, level: 3 });
      this.staff.push(s);
      this.company.dex.jobs[job] = true;
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
    this.dexSee('jobs', c.job);
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
    this.dexSee('bosses', p.genreId);
    this.note(`「${p.title}」 개발 착수. ${p.boss.ko} 아이디어 HP ${p.hpMax.toLocaleString()}`, 'good');
    this.emit('project', p);
    return { ok: true, project: p };
  }

  /* `opts.focus` is the multiplier the 집중 개발 timing bar produced. It costs
     extra stamina, so a mistimed tap is a real loss rather than a free reroll. */
  devTurn(opts = {}) {
    const p = this.project;
    if (!p) return { ok: false, why: '개발 중인 프로젝트가 없다' };
    if (p.pendingCards) return { ok: false, why: '아이디어를 먼저 고르세요' };
    const focus = opts.focus || 0;
    const cost = turnCost(p) + (focus ? FOCUS_STAMINA : 0);
    if (this.company.stamina < cost) return { ok: false, why: '스태미나 부족. 다음 주로 넘기세요.' };
    this.company.stamina -= cost;

    const r = battleTurn(p, this.staffById(), this.rnd, this.ctx(focus ? { focus } : {}));
    for (const ev of r.events) {
      if (ev.kind === 'boss') {
        this.note(`${p.boss.ko}의 ${ev.ko}! ${ev.line}`, 'bad');
      } else if (ev.kind === 'phase') {
        this.note(`${ev.boss} ${ev.ko}! 약점이 드러났다 — 지금이 기회다.`, 'good');
      }
    }
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
      this.dexSee('contents', p.contentId);
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
    c.overtimeUsed = false;

    // Idle staff drift back toward a neutral mood; a shipped game is what
    // actually raises motivation. A week off also restores health — over half
    // a pool, so a studio that never buys food still recovers, it just never
    // gets to work at full strength for long.
    for (const s of this.staff) {
      syncHp(s);
      const idle = !this.project || !this.project.team.includes(s.id);
      healHp(s, s.hpMax * (idle ? HP.weekly + 0.2 : HP.weekly));
      if (idle && s.motivation > 3 && this.rnd() > 0.85) s.motivation -= 1;
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
      c.bag = c.bag || {};
      c.dex = c.dex || {};
      for (const k of ['genres', 'contents', 'bosses', 'items', 'jobs']) c.dex[k] = c.dex[k] || {};
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
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* private mode */ }
  }
}

export {
  STATS, JOBS, GENRES, CONTENTS, PLATFORMS, MONETIZE, ITEMS, RESEARCH, CONTRACTS, MARKETING,
  SHOP,
  abilities, power, role, rankInfo, RANK_UP_FANS, itemCost, trainStamina, floorCost,
  expToNext, hpRatio, isTired, isSpent, gearOf, basePower, shopItem, GEAR_SLOTS,
};
