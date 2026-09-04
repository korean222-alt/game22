/* DOM layer.

   The UI reads the Game and calls its actions; it never mutates state directly.
   Every panel re-renders wholesale on the relevant event — the panels are small
   enough that diffing them would cost more than it saves, and a full rebuild
   makes it impossible for the screen to disagree with the simulation.

   The one piece of real sequencing here is the meeting: an idea card must not
   appear until the team has actually walked to the room and discussed it, so
   the card and result flows await the 3D scene before opening a modal. */

import {
  JOBS, GENRES, CONTENTS, PLATFORMS, MONETIZE, ITEMS, STATS, STAT_KO, METHODS,
  RESEARCH, CONTRACTS, MARKETING, TRAITS, FLOOR_UPKEEP, UNKNOWN_COMBO,
  comboScore, comboLabel, rankInfo, RANK_UP_FANS, researchEffect,
  SHOP, SHOP_KINDS, GEAR_SLOTS, BOSSES, bossFor, BOSS_PHASES, FOCUS_STAMINA, OVERTIME,
} from '../game/data.js';
import {
  abilities, power, role, itemCost, trainStamina, traitsOf, expToNext,
  hpRatio, isTired, isSpent, gearOf, canEquip,
} from '../game/staff.js';
import { turnCost } from '../game/project.js';
import { rewardText } from '../game/events.js';
import { FLOOR_PLANS } from '../world/office.js';
import { isTouch, isFullscreen, goFullscreen, exitFullscreen, wireInstallGuide } from './device.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const won = (n) => '₩' + Math.round(n).toLocaleString('ko-KR');
const num = (n) => Math.round(n).toLocaleString('ko-KR');
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
/* Motivation is fractional for anyone with 일벌레, so it cannot be printed raw. */
const mot = (v) => (Number.isInteger(v) ? v : (Math.round(v * 10) / 10).toFixed(1));

/* Bar width for a 1-999 quality score.

   A straight percentage of 999 puts a debut game's 9 points at under one pixel,
   which reads as a broken graph rather than a weak game. The curve is
   saturating so the early career is legible and a late 900 still has headroom,
   and the floor of 3% means every bar is visibly a bar. */
const qBar = (v) => Math.max(3, Math.min(100, Math.round(Math.pow(Math.max(0, v) / 999, 0.4) * 100)));
const statBars = (q) => STATS.map((st) =>
  `<div class="sb"><span class="lb">${STAT_KO[st]}</span><span class="bar"><span class="fill" style="width:${qBar(q[st])}%"></span></span><span class="vv">${q[st]}</span></div>`).join('');

export class UI {
  constructor(game, view) {
    this.g = game;
    this.view = view;
    this.tab = 'company';
    this.selectedStaff = null;
    this.draft = null;
    this.auto = false;
    this.modalOnOk = null;
    this.busy = false;          // a cutscene is playing; hold modals back
    this.shopKind = 'food';     // 상점 탭의 현재 분류
    this.gearTarget = null;     // 장비를 채워줄 직원
    this.focus = null;          // 집중 개발 타이밍 바의 상태

    if (isTouch() && window.innerWidth < 900) document.body.classList.add('panel-hidden');

    this._wireTabs();
    this._wireBattle();
    this._wireModal();
    this._wireKeys();
    this._wireShell();

    game.on((type, payload) => this._onGameEvent(type, payload));
    this.renderAll();
  }

  /* ---------- wiring ---------- */
  _wireTabs() {
    for (const t of document.querySelectorAll('#tabs .tab')) {
      t.onclick = () => {
        for (const o of document.querySelectorAll('#tabs .tab')) o.classList.remove('on');
        t.classList.add('on');
        this.tab = t.dataset.tab;
        this.renderPanel();
      };
      t.style.touchAction = 'manipulation';
    }
  }

  _wireBattle() {
    $('bTurn').onclick = () => {
      // 집중 개발이 켜져 있으면 같은 버튼이 "지금!" 이 된다. 폰에서 버튼을
      // 하나 더 두는 것보다, 누르던 자리를 그대로 쓰는 편이 빠르다.
      if (this.focus) this.stopFocus();
      else this.doTurn();
    };
    $('bFocusBtn').onclick = () => {
      if (this.focus) this.cancelFocus();
      else this.startFocus();
    };
    $('bAuto').onclick = () => {
      this.auto = !this.auto;
      $('bAuto').classList.toggle('primary', this.auto);
      if (this.auto) this._autoTick();
    };
  }

  /* ---------- 집중 개발 ----------
     마커가 좌우로 왕복하고, 금색 구간에서 멈추면 데미지 배율이 붙는다.
     스태미나를 더 쓰므로 빗나가면 실제로 손해다 — 그래야 누를 때 긴장한다.
     자동 진행 중에는 뜨지 않는다. */
  startFocus() {
    const g = this.g;
    if (!g.project || g.project.pendingCards || this.busy) return;
    if (g.company.stamina < turnCost(g.project) + FOCUS_STAMINA) {
      this.toast(`집중 개발에는 스태미나 ${turnCost(g.project) + FOCUS_STAMINA} 이 필요합니다.`, 'bad');
      return;
    }
    this.auto = false;
    $('bAuto').classList.remove('primary');
    // 구간의 위치는 매번 다르고, 폭은 페이즈가 오를수록 좁아진다.
    const width = Math.max(14, 30 - (g.project.phase || 0) * 6);
    const at = 8 + Math.random() * (84 - width);
    this.focus = { at, width, pos: 0, dir: 1, speed: 78 + (g.project.phase || 0) * 26, t0: performance.now() };
    const zone = $('bZone');
    zone.style.left = at + '%';
    zone.style.width = width + '%';
    $('bFocus').classList.add('on');
    $('bTurn').textContent = '지금!';
    $('bFocusBtn').textContent = '취소';
    this._focusTick();
  }

  _focusTick() {
    const f = this.focus;
    if (!f) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - (f.last || f.t0)) / 1000);
    f.last = now;
    f.pos += f.dir * f.speed * dt;
    if (f.pos >= 100) { f.pos = 100; f.dir = -1; }
    if (f.pos <= 0) { f.pos = 0; f.dir = 1; }
    $('bMark').style.left = f.pos + '%';
    f.raf = requestAnimationFrame(() => this._focusTick());
  }

  cancelFocus() {
    if (this.focus && this.focus.raf) cancelAnimationFrame(this.focus.raf);
    this.focus = null;
    $('bFocus').classList.remove('on');
    $('bTurn').textContent = '개발 진행';
    $('bFocusBtn').textContent = '집중';
    this.renderBattle();
  }

  /* 멈춘 위치 → 배율. 한가운데면 2.2배, 구간 안이면 1.5배 언저리,
     빗나가면 0.75배. 빗나갔을 때 1.0 이면 누르지 않을 이유가 없어진다. */
  stopFocus() {
    const f = this.focus;
    if (!f) return;
    const centre = f.at + f.width / 2;
    const dist = Math.abs(f.pos - centre);
    let mult, label;
    if (dist <= f.width * 0.18) { mult = 2.2; label = '완벽한 타이밍!'; }
    else if (dist <= f.width / 2) { mult = 1.55; label = '좋은 타이밍'; }
    else if (dist <= f.width) { mult = 1.0; label = '아슬아슬'; }
    else { mult = 0.75; label = '빗나갔다…'; }
    this.cancelFocus();
    this.toast(`${label} ×${mult.toFixed(2)}`, mult >= 1.5 ? 'good' : mult < 1 ? 'bad' : '');
    this.doTurn({ focus: mult });
  }

  _wireModal() {
    $('mOk').onclick = () => {
      const fn = this.modalOnOk;
      this.modalOnOk = null;
      this.closeModal();
      if (fn) fn();
    };
  }

  _wireShell() {
    const menu = $('menuBtn');
    if (menu) { menu.onclick = () => this.togglePanel(); menu.style.touchAction = 'manipulation'; }
    const fs = $('fsBtn');
    if (fs) {
      fs.onclick = () => { if (isFullscreen()) exitFullscreen(); else goFullscreen(); };
      fs.style.touchAction = 'manipulation';
    }
  }

  /* 1인칭에 들어가면 패널을 접는다 — 걷는 동안 화면의 절반이 UI 면 곤란하다. */
  renderShell() {
    const walking = !!(this.view.fp && this.view.fp.on);
    if (walking) this.togglePanel(true);
    const b = $('fpBtn');
    if (b) b.textContent = walking ? '🏢' : '🚶';
  }

  _wireKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      // While walking the office, WASD/E/F belong to the first-person
      // controller; the management shortcuts would fight it for the same keys.
      if (this.view.fp && this.view.fp.on) return;
      const k = e.key.toLowerCase();
      if (k === ' ') { e.preventDefault(); this.doTurn(); }
      else if (k === 'q') this.view.stepFloor(-1);
      else if (k === 'e') this.view.stepFloor(1);
      else if (k === 'tab') { e.preventDefault(); this.view.toggleCut(); }
      else if (k >= '1' && k <= '7') {
        const tabs = ['company', 'staff', 'dev', 'shop', 'dex', 'live', 'office'];
        const t = document.querySelector(`#tabs .tab[data-tab="${tabs[+k - 1]}"]`);
        if (t) t.click();
      }
    });
  }

  togglePanel(force) {
    const b = document.body;
    const hide = force === undefined ? !b.classList.contains('panel-hidden') : force;
    b.classList.toggle('panel-hidden', hide);
  }

  openTab(name) {
    const t = document.querySelector(`#tabs .tab[data-tab="${name}"]`);
    if (t) t.click();
    this.togglePanel(false);
  }

  /* ---------- game events ---------- */
  _onGameEvent(type, payload) {
    if (type === 'log') this.toast(payload.text, payload.kind);
    if (type === 'battle') this.view.playBattle(payload);
    // 개발이 시작되면 그 자리에서 보스가 솟아오른다 — 첫 타격을 기다리지 않는다.
    if (type === 'project') this.view.ensureBoss(payload);
    if (type === 'rank') this.showRankUp(payload);
    if (type === 'finished') this._finishedFlow(payload);
    if (type === 'floors') this.view.setFloorCount(payload).then(() => this.renderFloors());
    if (type === 'hired') this.view.walkIn(payload);
    if (type === 'fired') this.view.walkOut(payload);
    if (type === 'staff') this.view.syncAgents();
    if (type === 'event' && !payload.resolved) this._eventFlow();
    this.renderHUD();
    this.renderBattle();
    this.renderProgress();
    if (type !== 'log') this.renderPanel();
    this._cardFlow();
  }

  /* A weekly event with a choice holds the week until it is answered. */
  _eventFlow() {
    const ev = this.g.pendingEvent;
    if (!ev || this.busy) return;
    this.openModal(`이번 주 · ${ev.ko}`, `${ev.icon || ''} ${ev.ko}`, ev.text,
      ev.options.map((o, i) => ({
        name: o.ko,
        desc: o.desc,
        onPick: () => { this.g.answerEvent(i); this.g.save(); },
      })));
  }

  /* Has the company ever shipped this pairing?

     The discovery game only works if the answer is hidden the first time. Once
     a combo is in the 도감 the card can say what it is worth, so a veteran
     studio plays with knowledge and a new one plays on instinct. */
  knownCombo(genreId, contentId) {
    const d = this.g.company.discovered || {};
    return !!d[`${genreId}|${contentId}`];
  }

  /* Variables the meeting dialogue interpolates. */
  mvars(p) {
    const g = GENRES.find((x) => x.id === p.genreId);
    const c = p.contentId ? CONTENTS.find((x) => x.id === p.contentId) : null;
    const pl = PLATFORMS.find((x) => x.id === p.platformId);
    return {
      genre: g ? g.ko : '', content: c ? c.ko : '',
      platform: pl ? pl.ko : '', title: p.title,
    };
  }

  /* Which beats are worth walking the whole team to the meeting room for.

     Every card used to summon a meeting, which meant four cutscenes per game
     and the room stopped being an event. The two that decide what the game IS
     — 착수 and 게임 내용 — keep the scene; 개발 방식 and the wrap-up are just
     the modal, and the office keeps working behind it. */
  wantsMeeting(phase) { return phase === 'kickoff' || phase === 'content'; }

  /* An idea card waits for the meeting that produces it. */
  async _cardFlow() {
    const p = this.g.project;
    if (!p || !p.pendingCards || this.busy) return;
    const kind = p.pendingCards.kind;
    if (this.wantsMeeting(kind)) {
      this.busy = true;
      try {
        await this.view.playMeeting(kind, p.team, this.mvars(p));
      } finally {
        this.busy = false;
      }
    }
    // The player may have skipped ahead and resolved it already.
    if (this.g.project && this.g.project.pendingCards) this.showCards();
  }

  _finishedFlow(p) {
    if (!p || this.busy) return;
    this.view.celebrate(p.team);
    if (this.g.finished) this.showFinished(p);
  }

  /* ---------- actions ---------- */
  doTurn(opts = {}) {
    const g = this.g;
    if (this.busy) return;
    if (g.project && g.project.pendingCards) { this._cardFlow(); return; }
    if (!g.project) return;
    const r = g.devTurn(opts);
    if (!r.ok) {
      this.toast(r.why, 'bad');
      this.auto = false;
      $('bAuto').classList.remove('primary');
    }
    g.save();
  }

  _autoTick() {
    if (!this.auto) return;
    const g = this.g;
    if (this.busy) { setTimeout(() => this._autoTick(), 500); return; }
    if (!g.project || g.project.pendingCards || g.company.stamina < 1) {
      this.auto = false;
      $('bAuto').classList.remove('primary');
      return;
    }
    this.doTurn();
    setTimeout(() => this._autoTick(), 620);
  }

  /* ---------- rendering ---------- */
  renderAll() {
    this.renderHUD(); this.renderFloors(); this.renderPanel();
    this.renderBattle(); this.renderProgress(); this.renderShell();
  }

  renderHUD() {
    const c = this.g.company;
    const set = (id, v) => {
      const e = $(id);
      if (!e || e.textContent === String(v)) return;
      e.textContent = v;
      e.classList.remove('pop');
      void e.offsetWidth;
      e.classList.add('pop');
    };
    set('hRank', c.rank);
    set('hStam', c.stamina);
    $('hStamMax').textContent = '/' + c.staminaMax;
    set('hMoney', num(c.money));
    set('hCoins', c.coins);
    set('hFans', num(c.fans));
    set('hRes', c.researchPts);
    $('hDate').textContent = this.g.dateLabel();
    $('coName').textContent = c.name;
  }

  renderFloors() {
    const box = $('floors');
    box.innerHTML = '';
    const owned = this.g.company.floors;
    for (let i = 0; i < FLOOR_PLANS.length; i++) {
      const locked = i >= owned;
      const b = el('div', 'fl' + (locked ? ' locked' : '') + (i === this.view.floor ? ' on' : ''),
        `${i + 1}F`);
      if (!locked) b.onclick = () => { this.view.setFloor(i); this.renderFloors(); };
      else b.title = '아직 입주하지 않은 층';
      box.appendChild(b);
    }
  }

  renderBattle() {
    const g = this.g, bar = $('battle'), p = g.project;
    if (!p) {
      bar.classList.remove('show');
      document.body.classList.remove('in-battle');
      if (this.focus) this.cancelFocus();
      return;
    }
    bar.classList.add('show');
    document.body.classList.add('in-battle');
    const gen = GENRES.find((x) => x.id === p.genreId);
    $('bTitle').textContent = `「${p.title}」`;
    const bits = [gen.ko, `★${p.proposal.grade}`, `${p.turn}턴`];
    if (p.contentId) {
      const c = CONTENTS.find((x) => x.id === p.contentId);
      const known = this.knownCombo(p.genreId, p.contentId);
      const lb = known ? comboLabel(comboScore(p.genreId, p.contentId)) : UNKNOWN_COMBO;
      bits.push(`${c ? c.ko : ''} ${known ? lb.ko : '???'}`);
    }
    if (p.seriesN > 1) bits.push(`시리즈 ${p.seriesN}편`);
    $('bMeta').textContent = bits.join(' · ');
    const pct = Math.max(0, p.hp / p.hpMax * 100);
    $('bHp').style.width = pct + '%';
    $('bHpTx').textContent = `${num(p.hp)} / ${num(p.hpMax)}`;
    // 보스 줄: 이름과 페이즈, 그리고 약점이 드러난 동안의 경고
    const boss = p.boss || bossFor(p.genreId);
    $('bBoss').textContent = boss.ko;
    const ph = $('bPhase');
    const phase = BOSS_PHASES[p.phase || 0] || BOSS_PHASES[0];
    ph.textContent = (p.weak || 0) > 0 ? `약점! ×1.45 (${p.weak}턴)` : phase.ko;
    ph.classList.toggle('weak', (p.weak || 0) > 0);

    const cost = turnCost(p);
    const focusCost = cost + FOCUS_STAMINA;
    $('bCost').innerHTML = `스태미나 <b style="color:var(--warn)">-${this.focus ? focusCost : cost}</b><br>보유 ${g.company.stamina}`;
    const blocked = !!p.pendingCards || this.busy;
    $('bTurn').disabled = blocked || (this.focus ? false : g.company.stamina < cost);
    $('bFocusBtn').disabled = blocked || g.company.stamina < focusCost;
    this.renderTray();
  }

  /* ---------- 도우미 트레이 ----------
     배틀 중에 가방을 열지 않고 밥을 먹인다. 음식은 가장 지친 팀원에게,
     음료와 도구는 회사에 바로 적용된다 — 폰에서 대상 고르기를 한 번 더
     시키면 아무도 안 쓴다. */
  renderTray() {
    const box = $('tray');
    if (!box) return;
    const g = this.g;
    box.innerHTML = '';
    const items = g.bagList().filter((b) => b.item.kind !== 'gear').slice(0, 8);
    for (const { item, n } of items) {
      const t = el('div', 'tray-i', `<span class="e">${item.emoji}</span><span class="n">${n}</span>`);
      t.title = `${item.ko} — ${item.desc || ''}`;
      t.onclick = () => {
        const target = item.kind === 'food' && !item.all
          ? (g.neediest(g.project ? g.project.team : null) || g.neediest())
          : null;
        const r = g.useItem(item.id, target ? target.id : null);
        if (!r.ok) this.toast(r.why || '지금은 쓸 수 없다', 'bad');
        g.save();
      };
      box.appendChild(t);
    }
  }

  /* ---------- 진행 상황 ----------
     화면 오른쪽에 붙는 실시간 점수판. 완성 시와 같은 곡선으로 계산한
     값이므로, 여기 뜬 숫자가 그대로 결과가 된다. */
  renderProgress() {
    const g = this.g, box = $('prog');
    if (!box) return;
    const pg = g.devProgress();
    if (!pg) return;
    const p = g.project;

    // 프로젝트가 바뀌면 증가분의 기준선도 새로 잡는다. 안 그러면 새 게임의
    // 첫 턴에 지난 게임과의 차이가 +로 뜬다.
    if (this._progId !== p.id) { this._progId = p.id; this._lastQ = null; this._lastFun = undefined; }

    $('pgTitle').textContent = `「${p.title}」`;
    $('pgTurn').textContent = `${pg.turn}턴`;
    $('pgFun').textContent = num(pg.fun);

    // 직전 턴에 오른 재미. 숫자가 왜 올랐는지가 이 패널의 존재 이유다.
    const prevFun = this._lastFun;
    this._lastFun = pg.fun;
    const dFun = prevFun === undefined ? 0 : pg.fun - prevFun;
    $('pgFunD').textContent = dFun > 0 ? `+${dFun}` : '';

    const stats = $('pgStats');
    stats.innerHTML = '';
    const mx = Math.max(1, ...STATS.map((st) => pg.quality[st]));
    const prev = this._lastQ || {};
    for (const st of STATS) {
      const v = pg.quality[st];
      const d = prev[st] === undefined ? 0 : v - prev[st];
      stats.appendChild(el('div', 'pgs',
        `<span class="l">${STAT_KO[st]}</span>
         <span class="b"><span class="f" style="width:${v / mx * 100}%"></span></span>
         <span class="v">${v}</span><span class="d">${d > 0 ? '+' + d : ''}</span>`));
    }
    this._lastQ = { ...pg.quality };

    $('pgBugs').textContent = pg.bugs + '개';
    $('pgCrit').textContent = pg.crits + '회';

    const team = $('pgTeam');
    team.innerHTML = '';
    for (const m of pg.team) {
      const pct = Math.round(m.hp / m.hpMax * 100);
      team.appendChild(el('div', 'pgm' + (m.spent ? ' spent' : m.tired ? ' tired' : ''),
        `<span class="n">${m.name}</span>
         <span class="b"><span class="f" style="width:${pct}%"></span></span>
         <span class="s">${m.spent ? '탈진' : m.tired ? '지침' : pct + '%'}</span>`));
    }
  }

  renderPanel() {
    const box = $('panel');
    const scroll = box.scrollTop;
    box.innerHTML = '';
    const fn = {
      company: () => this.panelCompany(box),
      staff: () => this.panelStaff(box),
      dev: () => this.panelDev(box),
      shop: () => this.panelShop(box),
      dex: () => this.panelDex(box),
      live: () => this.panelLive(box),
      office: () => this.panelOffice(box),
    }[this.tab];
    if (fn) fn();
    box.scrollTop = scroll;
  }

  /* ---------- 회사 ---------- */
  panelCompany(box) {
    const g = this.g, c = g.company, info = g.info();

    if (c.trends) {
      box.appendChild(el('div', 'trend',
        `<span class="ic">🔥</span><span class="tx">이번 분기 유행<br>
         <b>${c.trends.genreKo}</b> 장르 · <b>${c.trends.contentKo}</b> 소재</span>`));
    }

    box.appendChild(el('h4', 'sec', '회사 현황'));
    for (const [k, v] of [
      ['자금', won(c.money)],
      ['자금 상한', won(info.cashCap)],
      ['코인', c.coins + ' 🪙'],
      ['연구 포인트', num(c.researchPts)],
      ['팬', num(c.fans) + ' 명'],
      ['다음 랭크까지', num(Math.max(0, RANK_UP_FANS(c.rank) - c.fans)) + ' 명'],
      ['직원', `${g.staff.length} / ${info.staffCap} 명`],
      ['사무실', `${c.floors} / ${c.maxFloors} 층`],
      ['출시작', c.shipped + ' 작품'],
      ['누적 매출', won(c.totalEarned)],
    ]) box.appendChild(el('div', 'row', `<span>${k}</span><b>${v}</b>`));

    box.appendChild(el('h4', 'sec', '주간 진행'));
    const wk = el('button', 'btn primary wide',
      g.pendingEvent ? '이번 주 사건을 먼저 처리하세요' : '다음 주로 (스태미나 · 체력 회복)');
    wk.onclick = () => {
      if (g.pendingEvent) { this._eventFlow(); return; }
      g.nextWeek();
      g.save();
    };
    box.appendChild(wk);

    /* 야근 — 다음 주를 기다리지 않고 스태미나를 사는 길. 상점의 음료와 함께
       "스태미나는 하루를 넘겨야만 찬다" 를 없앤다. */
    const otChk = g.canOvertime();
    const ot = el('button', 'btn wide sm',
      otChk.ok ? `야근하기 · ${won(g.overtimeCost())} (스태미나 +${Math.max(1, Math.round(c.staminaMax * OVERTIME.stamina))})` : otChk.why);
    ot.disabled = !otChk.ok;
    ot.onclick = () => {
      this.confirm('야근을 시킬까요?',
        `수당 ${won(g.overtimeCost())}이 나가고 전 직원의 체력 ${Math.round(OVERTIME.hpCost * 100)}% 와 의욕 ${OVERTIME.motCost} 이 깎입니다.`,
        () => { const r = g.overtime(); if (!r.ok) this.toast(r.why, 'bad'); g.save(); });
    };
    box.appendChild(ot);
    box.appendChild(el('div', 'item',
      '<div class="d">스태미나는 <b>다음 주</b>·<b>야근</b>·<b>상점의 음료</b> 셋으로 찬다. 체력은 주간 휴식과 <b>음식</b>으로 회복한다.</div>'));

    /* 세일즈 태스크 — the standing checklist */
    const tasks = g.tasks();
    const doneN = tasks.filter((t) => t.complete).length;
    box.appendChild(el('h4', 'sec', `세일즈 태스크 ${doneN} / ${tasks.length}`));
    const open = tasks.filter((t) => !t.complete).slice(0, 5);
    for (const t of open) {
      box.appendChild(el('div', 'task',
        `<span class="tk"></span><span class="tt">${t.ko}</span><span class="tr">${rewardText(t.reward)}</span>`));
    }
    for (const t of tasks.filter((x) => x.complete).slice(-3)) {
      box.appendChild(el('div', 'task done',
        `<span class="tk">✓</span><span class="tt">${t.ko}</span><span class="tr">완료</span>`));
    }

    /* 계약 — the safety net */
    box.appendChild(el('h4', 'sec', '계약 일감'));
    if (c.contract) {
      box.appendChild(el('div', 'item',
        `<div class="t"><span class="n">${c.contract.ko}</span><span class="j">${c.contract.weeksLeft}주 남음</span></div>
         <div class="d">납품 시 ${won(c.contract.pay)} · 연구 +${c.contract.research}</div>`));
    } else {
      box.appendChild(el('div', 'item', '<div class="d">자금이 마르면 계약 일감으로 버틸 수 있다. 스태미나를 쓰지만 확실한 수입이다.</div>'));
      for (const ct of CONTRACTS) {
        const b = el('button', 'btn sm',
          `${ct.ko} · ${won(g.contractPayFor(ct.id))} · 스태미나 -${ct.stamina}`);
        b.style.cssText = 'display:block;width:100%;margin-bottom:4px;text-align:left';
        b.disabled = c.stamina < ct.stamina;
        b.onclick = () => { const r = g.takeContract(ct.id); if (!r.ok) this.toast(r.why, 'bad'); g.save(); };
        box.appendChild(b);
      }
    }

    /* 연구 */
    box.appendChild(el('h4', 'sec', `연구 · 보유 ${num(c.researchPts)}P`));
    for (const r of RESEARCH) {
      const lvl = g.researchLevel(r.id);
      const price = g.researchPrice(r.id);
      const maxed = lvl >= r.max;
      const row = el('div', 'res');
      const pips = Array.from({ length: r.max },
        (_, i) => `<span class="pip${i < lvl ? ' on' : ''}"></span>`).join('');
      row.innerHTML = `<div class="rn"><div class="rt">${r.ko} <span style="color:var(--dim)">Lv.${lvl}</span></div>
        <div class="rd">${r.desc}</div><div class="pips">${pips}</div></div>`;
      const b = el('button', 'btn sm', maxed ? '완료' : `${price}P`);
      b.disabled = maxed || c.researchPts < price;
      b.onclick = () => { const res = g.doResearch(r.id); if (!res.ok) this.toast(res.why, 'bad'); g.save(); };
      row.appendChild(b);
      box.appendChild(row);
    }

    /* 설정 */
    box.appendChild(el('h4', 'sec', '설정'));
    const tg = el('div', 'toggle' + (this.view.meetingScenes ? ' on' : ''),
      '<span>회의 연출 보기</span><span class="sw"></span>');
    tg.onclick = () => {
      this.view.meetingScenes = !this.view.meetingScenes;
      this.renderPanel();
    };
    box.appendChild(tg);

    const a2 = el('button', 'btn wide sm', '홈 화면에 추가하는 법 보기');
    a2.onclick = () => {
      const root = $('a2hs');
      if (root) { wireInstallGuide(root); this.togglePanel(true); }
    };
    box.appendChild(a2);

    /* 밝기 — 기기와 주변 밝기에 따라 화면이 너무 어둡다는 문제가 실제로
       있었다. 노출·앰비언트·천장 조명·비네트를 한 손잡이로 같이 움직인다. */
    if (this.view.setBrightness) {
      box.appendChild(el('h4', 'sec', '화면 밝기'));
      const row = el('div');
      row.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap';
      const label = { dim: '어둡게', normal: '보통', bright: '밝게', max: '아주 밝게' };
      const cur = this.view.brightness ? this.view.brightness() : 'bright';
      for (const k of (this.view.brightnessSteps || ['dim', 'normal', 'bright', 'max'])) {
        const b = el('button', 'btn sm' + (cur === k ? ' primary' : ''), label[k] || k);
        b.style.flex = '1 0 auto';
        b.onclick = () => { this.view.setBrightness(k); this.renderPanel(); };
        row.appendChild(b);
      }
      box.appendChild(row);
    }

    /* 1인칭 */
    box.appendChild(el('h4', 'sec', '1인칭 둘러보기'));
    const walk = el('button', 'btn wide sm' + (this.view.fp.on ? ' primary' : ''),
      this.view.fp.on ? '1인칭 나가기' : '사무실을 직접 걸어보기 (F)');
    walk.onclick = () => { this.view.fp.toggle(); this.renderShell(); this.renderPanel(); };
    box.appendChild(walk);
    box.appendChild(el('div', 'item',
      '<div class="d">왼쪽 아래를 누르면 그 자리에 <b>조이스틱</b>이 생기고, 오른쪽을 끌면 시점이 돈다. 데스크톱은 <kbd>WASD</kbd>.</div>'));

    const sv = el('button', 'btn wide sm', '저장하기');
    sv.onclick = () => { g.save(); this.toast('저장했습니다.', 'good'); };
    box.appendChild(sv);
    const rs = el('button', 'btn wide sm danger', '처음부터 다시');
    rs.onclick = () => {
      this.confirm('처음부터 다시 시작할까요?', '지금까지의 회사 기록이 모두 사라집니다.',
        () => location.reload(),
        () => { try { localStorage.removeItem('socialdev3d.save.v1'); } catch (e) { /* ignore */ } });
    };
    box.appendChild(rs);

    /* 기록 */
    box.appendChild(el('h4', 'sec', '기록'));
    for (const l of g.log.slice(0, 22)) {
      const col = l.kind === 'good' ? 'var(--good)' : l.kind === 'bad' ? 'var(--bad)' : 'var(--dim)';
      box.appendChild(el('div', 'item',
        `<div class="d" style="color:${col}"><b style="opacity:.6">${l.at}</b> — ${l.text}</div>`));
    }
  }

  /* ---------- 직원 ---------- */
  panelStaff(box) {
    const g = this.g, info = g.info();

    box.appendChild(el('h4', 'sec', `직원 ${g.staff.length} / ${info.staffCap}명`));
    for (const s of g.staff) {
      const ab = abilities(s);
      const inTeam = g.project && g.project.team.includes(s.id);
      const it = el('div', 'item click' + (this.selectedStaff === s.id ? ' on' : ''));
      const traitTags = traitsOf(s).map((t) => `<span class="pill">${t.ko}</span>`).join('');
      const gearTags = gearOf(s).map((gr) => `<span class="gearpill">${gr.emoji} ${gr.ko}</span>`).join('');
      it.innerHTML = `<div class="t"><span class="n">${s.name}</span>
        <span class="j">Lv.${s.level}/${s.maxLevel}${inTeam ? ' · 개발중' : ''}</span></div>
        <div class="d"><span class="pill ${role(s)}">${JOBS[s.job].ko}</span>${traitTags}<br>
        의욕 <span class="mot">${mot(s.motivation)}</span> · 힘 ${Math.round(power(s))}
        ${s.reincarnations ? ` · 환생 ${s.reincarnations}회` : ''}</div>
        ${this._hpBar(s)}${gearTags ? `<div class="d">${gearTags}</div>` : ''}`;
      it.onclick = () => {
        this.selectedStaff = this.selectedStaff === s.id ? null : s.id;
        this.renderPanel();
        this.view.focusStaff(this.selectedStaff);
      };
      if (this.selectedStaff === s.id) it.appendChild(this._staffDetail(s, ab));
      box.appendChild(it);
    }

    box.appendChild(el('h4', 'sec', '채용'));
    if (!g.candidates.length) {
      box.appendChild(el('div', 'item', '<div class="d">지금은 지원자가 없다. 다음 주에 다시 확인하세요.</div>'));
    }
    for (const cand of g.candidates) {
      const ab = abilities(cand);
      const it = el('div', 'item');
      const traitTags = traitsOf(cand)
        .map((t) => `<span class="pill" title="${t.desc}">${t.ko}</span>`).join('');
      it.innerHTML = `<div class="t"><span class="n">${cand.name}</span>
        <span class="j">Lv.${cand.level}</span></div>
        <div class="d"><span class="pill ${role(cand)}">${JOBS[cand.job].ko}</span>${traitTags}<br>
        기획 ${ab.plan} · 개발 ${ab.prog} · 그래픽 ${ab.graph} · 사운드 ${ab.sound} · 소셜 ${ab.social}<br>
        재능 ×${cand.talent.toFixed(2)} · 주급 ${won(cand.salary * 0.6)}</div>`;
      for (const t of traitsOf(cand)) {
        it.appendChild(el('div', 'd', `<span style="color:var(--dim);font-size:10px">· ${t.ko}: ${t.desc}</span>`));
      }
      const b = el('button', 'btn sm', `채용 ${won(cand.hireCost)}`);
      b.style.marginTop = '6px';
      b.disabled = g.company.money < cand.hireCost || g.staff.length >= info.staffCap;
      b.onclick = () => { const r = g.hire(cand.id); if (!r.ok) this.toast(r.why, 'bad'); g.save(); };
      it.appendChild(b);
      box.appendChild(it);
    }
    const rr = el('button', 'btn wide sm', '지원자 새로고침');
    rr.onclick = () => { g.rollCandidates(); this.renderPanel(); };
    box.appendChild(rr);
  }

  /* 체력 막대. 지침/탈진은 색으로 구분한다 — 숫자만 있으면 명단에서
     누가 위험한지 한눈에 안 보인다. */
  _hpBar(s) {
    const pct = Math.round(hpRatio(s) * 100);
    const cls = isSpent(s) ? ' spent' : isTired(s) ? ' tired' : '';
    return `<div class="hpline${cls}"><span>❤️</span>
      <span class="b"><span class="f" style="width:${pct}%"></span></span>
      <span class="v">${s.hp}/${s.hpMax}${isSpent(s) ? ' 탈진' : isTired(s) ? ' 지침' : ''}</span></div>`;
  }

  _staffDetail(s, ab) {
    const g = this.g;
    const d = el('div');
    d.style.marginTop = '7px';
    for (const [k, ko] of [['plan', '기획'], ['prog', '개발'], ['graph', '그래픽'], ['sound', '사운드'], ['social', '소셜']]) {
      d.appendChild(el('div', 'sb',
        `<span class="lb">${ko}</span><span class="bar"><span class="fill" style="width:${Math.min(100, ab[k])}%"></span></span><span class="vv">${ab[k]}</span>`));
    }
    if (s.level < s.maxLevel) {
      const need = expToNext(s);
      const have = s.exp || 0;
      d.appendChild(el('div', 'sb',
        `<span class="lb">경험치</span><span class="bar"><span class="fill" style="width:${Math.min(100, Math.round(have / need * 100))}%"></span></span><span class="vv">${have}/${need}</span>`));
    }
    d.appendChild(el('div', 'row', `<span>재능</span><b>×${s.talent.toFixed(2)}</b>`));
    d.appendChild(el('div', 'row', `<span>주급</span><b>${won(s.salary * 0.6)}</b>`));
    d.appendChild(el('div', 'row', `<span>받은 아이템</span><b>${s.itemsGiven.length} / 3</b>`));
    for (const t of traitsOf(s)) {
      const extra = t.id === 'genreFan'
        ? ` (${(GENRES.find((x) => x.id === s.favGenre) || {}).ko || ''})` : '';
      d.appendChild(el('div', 'd', `<b style="color:var(--gold)">${t.ko}${extra}</b> — ${t.desc}`));
    }

    /* 가방에서 바로 먹이기 */
    const food = g.bagList().filter((b) => b.item.kind === 'food' || b.item.kind === 'toy');
    d.appendChild(el('h4', 'sec', `가방에서 주기 (체력 ${s.hp}/${s.hpMax})`));
    if (!food.length) {
      d.appendChild(el('div', 'd', '<span style="color:var(--dim);font-size:10px">가방이 비었습니다. 상점 탭에서 음식을 사두세요.</span>'));
    }
    for (const { item, n } of food) {
      const b = el('button', 'btn sm', `${item.emoji} ${item.ko} ×${n} — ${item.desc}`);
      b.style.cssText = 'display:block;width:100%;margin-bottom:4px;text-align:left';
      b.onclick = (ev) => {
        ev.stopPropagation();
        const r = g.useItem(item.id, s.id);
        if (!r.ok) this.toast(r.why, 'bad');
        g.save();
      };
      d.appendChild(b);
    }

    /* 장비 — 직원마다 특색이 생기는 자리 */
    d.appendChild(el('h4', 'sec', `장비 ${gearOf(s).length}/${GEAR_SLOTS}`));
    for (const gr of gearOf(s)) {
      const row = el('div', 'sitem');
      row.innerHTML = `<span class="e">${gr.emoji}</span>
        <span class="m"><span class="t">${gr.ko}</span><span class="d">${gr.desc}</span></span>`;
      const rm = el('button', 'btn sm', '해제');
      rm.onclick = (ev) => { ev.stopPropagation(); g.unequipItem(s.id, gr.id); g.save(); };
      row.appendChild(rm);
      d.appendChild(row);
    }
    const gearBag = g.bagList().filter((b) => b.item.kind === 'gear');
    if (!gearBag.length && gearOf(s).length < GEAR_SLOTS) {
      d.appendChild(el('div', 'd', '<span style="color:var(--dim);font-size:10px">가방에 장비가 없습니다. 상점에서 사면 여기에 채울 수 있습니다 — 사운드 담당에게 피아노를 주면 사운드가 오르고 완성작의 화제성·임팩트가 함께 오릅니다.</span>'));
    }
    for (const { item, n } of gearBag) {
      const chk = canEquip(s, item.id);
      const b = el('button', 'btn sm', `${item.emoji} ${item.ko} ×${n} 장착`);
      b.style.cssText = 'display:block;width:100%;margin-bottom:4px;text-align:left';
      b.disabled = !chk.ok;
      b.title = chk.ok ? item.desc : chk.why;
      b.onclick = (ev) => {
        ev.stopPropagation();
        const r = g.equipItem(s.id, item.id);
        if (!r.ok) this.toast(r.why, 'bad');
        g.save();
      };
      d.appendChild(b);
    }

    d.appendChild(el('h4', 'sec', `아이템 지급 (스태미나 -${trainStamina(s)})`));
    for (const item of ITEMS) {
      const price = itemCost(s, item);
      const b = el('button', 'btn sm',
        `${item.ko} · ${won(price)} → Lv+${item.level}${item.motivation ? ` 의욕+${item.motivation}` : ''}`);
      b.style.cssText = 'display:block;width:100%;margin-bottom:4px;text-align:left';
      b.disabled = g.company.money < price || s.level >= s.maxLevel
        || g.company.stamina < trainStamina(s);
      b.onclick = (ev) => {
        ev.stopPropagation();
        const r = g.train(s.id, item.id);
        if (!r.ok) this.toast(r.why || '실패', 'bad');
        g.save();
      };
      d.appendChild(b);
    }

    const can = s.level >= s.maxLevel && s.itemsGiven.length >= 3 && JOBS[s.job].next;
    const pb = el('button', 'btn wide sm primary',
      JOBS[s.job].next
        ? `전직 → ${JOBS[JOBS[s.job].next].ko}${can ? '' : ' (만렙 + 아이템 3종)'}`
        : '최고 직급');
    pb.disabled = !can;
    pb.onclick = (ev) => {
      ev.stopPropagation();
      const r = g.promoteStaff(s.id);
      if (!r.ok) this.toast(r.why, 'bad');
      g.save();
    };
    d.appendChild(pb);

    if (!JOBS[s.job].next && s.level >= s.maxLevel) {
      d.appendChild(el('h4', 'sec', '환생 (직업 변경 · 재능 유지)'));
      for (const j of ['planner', 'programmer', 'designer', 'sound', 'networker']) {
        const b = el('button', 'btn sm', JOBS[j].ko);
        b.style.cssText = 'margin:0 4px 4px 0';
        b.onclick = (ev) => { ev.stopPropagation(); g.reincarnateStaff(s.id, j); g.save(); };
        d.appendChild(b);
      }
    }

    const fb = el('button', 'btn wide sm danger', '내보내기');
    fb.onclick = (ev) => {
      ev.stopPropagation();
      this.confirm(`${s.name} 씨를 내보낼까요?`, '되돌릴 수 없습니다.', () => {
        const r = g.fire(s.id);
        if (!r.ok) this.toast(r.why || '실패', 'bad');
        this.selectedStaff = null;
        g.save();
      });
    };
    d.appendChild(fb);
    return d;
  }

  /* ---------- 개발 ---------- */
  panelDev(box) {
    const g = this.g;
    if (g.finished) { this.panelFinished(box); return; }
    if (g.project) { this.panelInDev(box); return; }

    box.appendChild(el('h4', 'sec', '기획서'));
    const mk = el('button', 'btn primary wide', '기획서 뽑기 (스태미나 -1)');
    mk.disabled = g.company.stamina < 1;
    mk.onclick = () => { const r = g.makeProposal(); if (!r.ok) this.toast(r.why, 'bad'); g.save(); };
    box.appendChild(mk);
    box.appendChild(el('div', 'row', `<span>회사 기획력</span><b>${Math.round(g.totalPlanPower())}</b>`));

    if (!g.proposals.length) {
      box.appendChild(el('div', 'item', '<div class="d">기획서가 없습니다. 위 버튼으로 뽑으세요. 기획자를 3층(기획실)에 앉히면 등급이 올라갑니다.</div>'));
      return;
    }

    for (const pr of g.proposals) {
      const gen = GENRES.find((x) => x.id === pr.genreId);
      const hot = g.company.trends && g.company.trends.genreId === pr.genreId;
      const it = el('div', 'item click' + (this.draft && this.draft.proposalId === pr.id ? ' on' : ''));
      it.innerHTML = `<div class="t"><span class="n">「${pr.title}」</span>
        <span class="stars">${stars(pr.grade)}</span></div>
        <div class="d">${gen.ko}${hot ? ' <span class="pill great">유행</span>' : ''} · 기획 ${pr.authorName}<br>
        <span style="color:var(--gold)">👾 ${bossFor(pr.genreId).ko}</span> 와(과) 싸운다</div>`;
      it.onclick = () => {
        this.draft = this.draft && this.draft.proposalId === pr.id ? null : {
          proposalId: pr.id,
          platformId: g.availablePlatforms().slice(-1)[0].id,
          monetizeId: g.availableMonetize()[0].id,
          teamIds: g.staff.slice(0, Math.min(4, g.staff.length)).map((s) => s.id),
          seriesOfId: null,
        };
        this.renderPanel();
      };
      box.appendChild(it);
      if (this.draft && this.draft.proposalId === pr.id) this.renderDraft(box, pr);
    }
  }

  renderDraft(box, pr) {
    const g = this.g, d = this.draft;

    box.appendChild(el('h4', 'sec', '플랫폼'));
    const pw = el('div');
    for (const p of g.availablePlatforms()) {
      const b = el('button', 'btn sm' + (d.platformId === p.id ? ' primary' : ''), p.ko);
      b.style.cssText = 'margin:0 4px 4px 0';
      b.onclick = () => { d.platformId = p.id; this.renderPanel(); };
      pw.appendChild(b);
    }
    box.appendChild(pw);

    box.appendChild(el('h4', 'sec', '수익 모델'));
    for (const m of g.availableMonetize()) {
      const it = el('div', 'item click' + (d.monetizeId === m.id ? ' on' : ''));
      it.innerHTML = `<div class="n">${m.ko}</div><div class="d">${m.desc}</div>`;
      it.onclick = () => { d.monetizeId = m.id; this.renderPanel(); };
      box.appendChild(it);
    }

    const hof = g.releases.filter((r) => r.hallOfFame);
    if (hof.length) {
      box.appendChild(el('h4', 'sec', '속편으로 만들기 (명예의 전당)'));
      const none = el('button', 'btn sm' + (!d.seriesOfId ? ' primary' : ''), '신작');
      none.style.cssText = 'margin:0 4px 4px 0';
      none.onclick = () => { d.seriesOfId = null; this.renderPanel(); };
      box.appendChild(none);
      for (const r of hof) {
        const b = el('button', 'btn sm' + (d.seriesOfId === r.id ? ' primary' : ''), `${r.title} ${r.seriesN + 1}편`);
        b.style.cssText = 'margin:0 4px 4px 0';
        b.onclick = () => { d.seriesOfId = r.id; this.renderPanel(); };
        box.appendChild(b);
      }
    }

    box.appendChild(el('h4', 'sec', `개발 팀 (${d.teamIds.length}명)`));
    box.appendChild(el('div', 'item',
      '<div class="d">인원을 늘리면 <b>개발이 빨라질 뿐</b> 품질은 오르지 않는다. 품질은 1인·1턴당 기여로 계산되므로, 어떤 직군을 넣었는지가 중요하다.</div>'));
    for (const s of g.staff) {
      const on = d.teamIds.includes(s.id);
      const it = el('div', 'item click' + (on ? ' on' : ''));
      const contrib = Object.keys(JOBS[s.job].contrib).map((k) => STAT_KO[k]).join(' · ') || '기획서 등급';
      const fan = s.traits && s.traits.includes('genreFan') && s.favGenre === pr.genreId;
      it.innerHTML = `<div class="t"><span class="n">${s.name}</span>
        <span class="j">힘 ${Math.round(power(s))}</span></div>
        <div class="d"><span class="pill ${role(s)}">${JOBS[s.job].ko}</span>${contrib}
        ${fan ? ' <span class="pill great">장르 덕후!</span>' : ''}
        ${gearOf(s).map((gr) => `<span class="gearpill">${gr.emoji} ${gr.ko}</span>`).join('')}</div>
        ${this._hpBar(s)}`;
      it.onclick = () => {
        d.teamIds = on ? d.teamIds.filter((x) => x !== s.id) : [...d.teamIds, s.id];
        this.renderPanel();
      };
      box.appendChild(it);
    }

    const plat = PLATFORMS.find((p) => p.id === d.platformId);
    const gradeMult = 0.75 + pr.grade * 0.25;
    const seriesOf = d.seriesOfId ? g.releases.find((r) => r.id === d.seriesOfId) : null;
    const seriesMult = 1 + (seriesOf ? seriesOf.seriesN : 0) * 0.55;
    const cost = Math.round(plat.cost * gradeMult * seriesMult);
    box.appendChild(el('div', 'row', `<span>개발비</span><b>${won(cost)}</b>`));

    const go = el('button', 'btn primary wide', '개발 시작');
    go.disabled = !d.teamIds.length || g.company.money < cost;
    go.onclick = () => {
      const r = g.beginDevelopment(d);
      if (!r.ok) { this.toast(r.why, 'bad'); return; }
      this.draft = null;
      this.view.startWork(g.project.team);
      this.view.ensureBoss(g.project);
      this._kickoff(g.project);
      g.save();
    };
    box.appendChild(go);
  }

  async _kickoff(p) {
    if (this.busy) return;
    this.busy = true;
    try { await this.view.playMeeting('kickoff', p.team, this.mvars(p)); }
    finally { this.busy = false; this.renderBattle(); }
    // 회의가 끝나면 카메라가 상대를 잡아준다 — 무엇과 싸우는지 한 번은 보여야 한다.
    this.view.focusBoss(44);
    this.toast(`${(p.boss || bossFor(p.genreId)).ko} 등장!`, 'good');
  }

  panelInDev(box) {
    const g = this.g, p = g.project;
    const gen = GENRES.find((x) => x.id === p.genreId);
    const boss = p.boss || bossFor(p.genreId);
    box.appendChild(el('h4', 'sec', `개발 중 — ${boss.ko}`));
    box.appendChild(el('div', 'item',
      `<div class="t"><span class="n">「${p.title}」</span><span class="stars">${stars(p.proposal.grade)}</span></div>
       <div class="d">${gen.ko} · ${PLATFORMS.find((x) => x.id === p.platformId).ko} · ${MONETIZE.find((x) => x.id === p.monetizeId).ko}</div>`));
    box.appendChild(el('div', 'row', `<span>남은 HP</span><b>${num(p.hp)} / ${num(p.hpMax)}</b>`));
    box.appendChild(el('div', 'row', `<span>페이즈</span><b>${(BOSS_PHASES[p.phase || 0] || BOSS_PHASES[0]).ko}${(p.weak || 0) > 0 ? ' · 약점!' : ''}</b>`));
    box.appendChild(el('div', 'row', `<span>턴</span><b>${p.turn}</b>`));
    box.appendChild(el('div', 'row', `<span>번뜩임</span><b>${p.crits}회</b>`));
    box.appendChild(el('div', 'row', `<span>반격당한 횟수</span><b>${p.attacks || 0}회</b>`));
    if (p.contentId) {
      const c = CONTENTS.find((x) => x.id === p.contentId);
      const known = this.knownCombo(p.genreId, p.contentId);
      const lb = known ? comboLabel(comboScore(p.genreId, p.contentId)) : UNKNOWN_COMBO;
      box.appendChild(el('div', 'row',
        `<span>게임 내용</span><b>${c ? c.ko : ''} <span class="pill ${lb.cls}">${known ? lb.ko : '???'}</span></b>`));
    }
    if (p.methodId) {
      box.appendChild(el('div', 'row',
        `<span>개발 방식</span><b>${(METHODS.find((m) => m.id === p.methodId) || {}).ko || '-'}</b>`));
    }

    // 현재 품질 — 완성 시와 같은 곡선으로 계산한 값이라 그대로 결과가 된다.
    const pg = g.devProgress();
    box.appendChild(el('h4', 'sec', `현재 품질 · 재미 ${pg.fun}점 · 예상 버그 ${pg.bugs}개`));
    const mx = Math.max(1, ...STATS.map((st) => pg.quality[st]));
    for (const st of STATS) {
      box.appendChild(el('div', 'sb',
        `<span class="lb">${STAT_KO[st]}</span><span class="bar"><span class="fill" style="width:${pg.quality[st] / mx * 100}%"></span></span><span class="vv">${pg.quality[st]}</span>`));
    }

    box.appendChild(el('h4', 'sec', '팀'));
    for (const id of p.team) {
      const s = g.staff.find((x) => x.id === id);
      if (!s) continue;
      const it = el('div', 'item');
      it.innerHTML = `<div class="t"><span class="n">${s.name}</span><span class="j">힘 ${Math.round(power(s))}</span></div>
         <div class="d"><span class="pill ${role(s)}">${JOBS[s.job].ko}</span>의욕 <span class="mot">${mot(s.motivation)}</span>
         ${gearOf(s).map((gr) => `<span class="gearpill">${gr.emoji}</span>`).join('')}</div>
         ${this._hpBar(s)}`;
      box.appendChild(it);
    }

    // 지친 팀원이 있으면 바로 밥을 먹일 수 있게 한다.
    const hungry = g.staff.filter((s) => p.team.includes(s.id) && isTired(s));
    if (hungry.length) {
      box.appendChild(el('div', 'item',
        `<div class="d" style="color:var(--warn)">지친 팀원 ${hungry.length}명 — 체력이 낮으면 데미지와 품질이 같이 떨어집니다. 상점의 음식으로 회복하세요.</div>`));
      const go = el('button', 'btn wide sm', '상점으로');
      go.onclick = () => this.openTab('shop');
      box.appendChild(go);
    }
  }

  panelFinished(box) {
    const g = this.g, p = g.finished;
    box.appendChild(el('h4', 'sec', '완성 — 출시 준비'));
    box.appendChild(el('div', 'item',
      `<div class="t"><span class="n">「${p.title}」</span><span class="stars">${stars(p.proposal.grade)}</span></div>
       <div class="d">${p.genreKo} × ${p.contentKo} · ${p.methodKo}</div>`));
    const qw = el('div');
    qw.innerHTML = statBars(p.quality);
    box.appendChild(qw);
    box.appendChild(el('div', 'row', `<span>평론가</span><b>${p.critics.join(' · ')} = ${p.criticTotal} / 40</b>`));
    box.appendChild(el('div', 'row', `<span>버그</span><b>${p.bugs}개</b>`));
    if (p.hallOfFame) box.appendChild(el('div', 'row', '<span>명예의 전당</span><b class="stars">등재</b>'));

    // Buggy builds review worse; the panel says how many points are on the
    // table so debugging reads as a score decision, not as housekeeping. The
    // penalty is per critic, and there are four of them.
    if (p.bugs > 0) {
      const held = Math.round(Math.min(2.6, p.bugs * 0.11) * 4);
      box.appendChild(el('div', 'item',
        `<div class="d">버그 ${p.bugs}개가 평론가 점수를 <b style="color:var(--bad)">약 ${held}점</b> 깎고 있습니다. 고칠수록 점수가 올라갑니다.</div>`));
    }
    const db = el('button', 'btn wide', `디버그 (스태미나 -1) · 버그 ${p.bugs}개`);
    db.disabled = p.bugs <= 0 || g.company.stamina < 1;
    db.onclick = () => {
      const r = g.debugProject();
      if (!r.ok) this.toast(r.why, 'bad');
      else if (r.gained > 0) this.toast(`버그 ${r.fixed}개 수정 · 평론가 +${r.gained}점`, 'good');
      g.save();
    };
    box.appendChild(db);

    box.appendChild(el('h4', 'sec', '홍보'));
    for (const mk of MARKETING) {
      const price = g.marketingPrice(mk.id);
      const on = g.company.marketingId === mk.id;
      const it = el('div', 'item click' + (on ? ' on' : ''));
      it.innerHTML = `<div class="t"><span class="n">${mk.ko}</span>
        <span class="j">${price ? won(price) : '무료'}</span></div>
        <div class="d">${mk.desc} · 유저 ×${mk.users.toFixed(2)}</div>`;
      it.onclick = () => { g.setMarketing(mk.id); this.renderPanel(); };
      box.appendChild(it);
    }

    const rl = el('button', 'btn primary wide', '출시하기');
    rl.onclick = () => {
      const r = g.release();
      if (!r.ok) this.toast(r.why, 'bad');
      else this.showRelease(r.release);
      g.save();
    };
    box.appendChild(rl);
  }

  /* ══════════════════════════════ 상점 ══════════════════════════════
     산 물건은 가방에 들어가고, 쓸 때 효과가 난다. 원작의 상점을 그대로
     옮긴 자리이고, 이 게임에서 돈이 실제로 나가는 두 번째 구멍이다
     (첫 번째는 인건비). */
  panelShop(box) {
    const g = this.g, c = g.company;

    /* 가방 먼저. 산 물건이 어디로 갔는지 보이지 않으면 아무도 두 번 사지 않는다. */
    const bag = g.bagList();
    box.appendChild(el('h4', 'sec', `가방 ${bag.reduce((a, b) => a + b.n, 0)}개`));
    if (!bag.length) {
      box.appendChild(el('div', 'item', '<div class="d">가방이 비었습니다. 아래에서 물건을 사면 여기에 쌓입니다.</div>'));
    }
    for (const { item, n } of bag) {
      const line = el('div', 'bagline');
      line.innerHTML = `<span class="e">${item.emoji}</span>
        <span class="t">${item.ko}<br><span style="color:var(--dim);font-size:9.5px">${item.desc || ''}</span></span>
        <span class="q">×${n}</span>`;
      if (item.kind !== 'gear') {
        const use = el('button', 'btn sm', item.kind === 'food' ? '먹이기' : '사용');
        use.onclick = () => {
          if (item.kind === 'food' && !item.all) {
            // 대상 고르기. 체력이 가장 낮은 사람이 맨 위에 온다.
            const list = g.staff.slice().sort((a, b) => hpRatio(a) - hpRatio(b));
            this.openModal('가방', `${item.emoji} ${item.ko}`, '누구에게 줄까요?',
              list.map((st) => ({
                name: `${st.name} (${st.hp}/${st.hpMax})`,
                desc: `${JOBS[st.job].ko}${isSpent(st) ? ' · 탈진' : isTired(st) ? ' · 지침' : ''}`,
                onPick: () => { const r = g.useItem(item.id, st.id); if (!r.ok) this.toast(r.why, 'bad'); g.save(); },
              })));
          } else {
            const r = g.useItem(item.id);
            if (!r.ok) this.toast(r.why, 'bad');
            g.save();
          }
        };
        line.appendChild(use);
      } else {
        const eq = el('button', 'btn sm', '장착');
        eq.onclick = () => {
          const list = g.staff.filter((st) => canEquip(st, item.id).ok);
          if (!list.length) { this.toast('장착할 수 있는 직원이 없습니다 (칸 3개까지)', 'bad'); return; }
          this.openModal('장비', `${item.emoji} ${item.ko}`, item.desc,
            list.map((st) => ({
              name: st.name,
              desc: `${JOBS[st.job].ko} · ${item.ability ? `${{ plan: '기획', prog: '개발', graph: '그래픽', sound: '사운드', social: '소셜' }[item.ability]} ${abilities(st)[item.ability]}` : ''}`,
              onPick: () => { const r = g.equipItem(st.id, item.id); if (!r.ok) this.toast(r.why, 'bad'); g.save(); },
            })));
        };
        line.appendChild(eq);
      }
      box.appendChild(line);
    }

    /* 분류 */
    box.appendChild(el('h4', 'sec', `상점 · 보유 ${won(c.money)}`));
    const cats = el('div', 'shopcat');
    for (const k of SHOP_KINDS) {
      const b = el('div', 'c' + (this.shopKind === k.id ? ' on' : ''), k.ko);
      b.onclick = () => { this.shopKind = k.id; this.renderPanel(); };
      cats.appendChild(b);
    }
    box.appendChild(cats);
    const kind = SHOP_KINDS.find((k) => k.id === this.shopKind) || SHOP_KINDS[0];
    box.appendChild(el('div', 'item', `<div class="d">${kind.hint}</div>`));

    for (const item of SHOP.filter((i) => i.kind === this.shopKind)) {
      const locked = c.rank < (item.rank || 1);
      const row = el('div', 'sitem' + (locked ? ' locked' : ''));
      row.innerHTML = `<span class="e">${item.emoji}</span>
        <span class="m"><span class="t">${item.ko}</span>
        <span class="d">${item.desc || ''}</span>
        <span class="p">${won(item.price)}${locked ? ` · 랭크 ${item.rank} 필요` : ''}</span></span>`;
      const b = el('button', 'btn sm', '구입');
      b.disabled = locked || c.money < item.price;
      b.onclick = () => { const r = g.buyItem(item.id); if (!r.ok) this.toast(r.why, 'bad'); g.save(); };
      row.appendChild(b);
      box.appendChild(row);
    }
  }

  /* ══════════════════════════════ 도감 ══════════════════════════════
     무엇을 모으는 게임인지 한 화면에서 보이게 한다. 잡은 아이디어, 써본
     소재, 사본 물건, 거쳐간 직업이 전부 여기에 남는다. */
  panelDex(box) {
    const g = this.g, c = g.company;
    const prog = g.dexProgress();

    box.appendChild(el('div', 'dexhead',
      `<span class="big">${prog.pct}%</span>
       <span class="sub"><b>${prog.have}</b> / ${prog.total} 수집<br>
       출시 ${c.shipped}작 · 명예의 전당 ${g.releases.filter((r) => r.hallOfFame).length}작</span>`));

    /* 아이디어(보스) 도감 — 이 게임에서 가장 보고 싶은 목록 */
    const bosses = c.dex.bosses || {};
    box.appendChild(el('h4', 'sec', `아이디어 ${Object.keys(bosses).length} / ${Object.keys(BOSSES).length}`));
    const bg = el('div', 'dexgrid');
    for (const gen of GENRES) {
      const b = bossFor(gen.id);
      const got = bosses[gen.id];
      // dexSee 는 '만났다'만 남긴다. 잡은 횟수는 완성될 때 객체로 덮어쓴다 —
      // 아직 개발 중인 아이디어를 잡았다고 표시하면 도감이 거짓말을 한다.
      const beaten = got && typeof got === 'object' ? got.beaten : 0;
      const cell = el('div', 'dexc ' + (got ? 'got' : 'miss'));
      cell.innerHTML = `<span class="i">👾</span><span class="n">${got ? b.ko : '???'}</span>
        <span class="s">${got ? (beaten ? `${beaten}회` : '조우') : ''}</span>`;
      cell.title = got
        ? `${b.ko} · ${gen.ko} · 최고 ${(got.best || 0)}점 · 최단 ${(got.turns || '-')}턴`
        : `${gen.ko} 장르의 기획서로 개발을 시작하면 만난다`;
      bg.appendChild(cell);
    }
    box.appendChild(bg);

    /* 장르 · 소재 */
    for (const [key, list, icon] of [['genres', GENRES, '🎲'], ['contents', CONTENTS, '🧩']]) {
      const seen = c.dex[key] || {};
      const ko = key === 'genres' ? '장르' : '소재';
      box.appendChild(el('h4', 'sec', `${ko} ${Object.keys(seen).length} / ${list.length}`));
      const grid = el('div', 'dexgrid');
      for (const x of list) {
        const got = !!seen[x.id];
        const cell = el('div', 'dexc ' + (got ? 'got' : 'miss'));
        cell.innerHTML = `<span class="i">${icon}</span><span class="n">${got ? x.ko : '???'}</span>`;
        grid.appendChild(cell);
      }
      box.appendChild(grid);
    }

    /* 아이템 */
    const seenItems = c.dex.items || {};
    box.appendChild(el('h4', 'sec', `아이템 ${Object.keys(seenItems).length} / ${SHOP.length}`));
    const ig = el('div', 'dexgrid');
    for (const item of SHOP) {
      const got = !!seenItems[item.id];
      const cell = el('div', 'dexc ' + (got ? 'got' : 'miss'));
      cell.innerHTML = `<span class="i">${item.emoji}</span><span class="n">${got ? item.ko : '???'}</span>`;
      cell.title = got ? item.desc : `상점에서 사면 등록된다`;
      ig.appendChild(cell);
    }
    box.appendChild(ig);

    /* 직업 */
    const seenJobs = c.dex.jobs || {};
    const jobIds = Object.keys(JOBS);
    box.appendChild(el('h4', 'sec', `직업 ${Object.keys(seenJobs).length} / ${jobIds.length}`));
    const jg = el('div', 'dexgrid');
    for (const id of jobIds) {
      const got = !!seenJobs[id];
      const cell = el('div', 'dexc ' + (got ? 'got' : 'miss'));
      cell.innerHTML = `<span class="i">💼</span><span class="n">${got ? JOBS[id].ko : '???'}</span>`;
      jg.appendChild(cell);
    }
    box.appendChild(jg);

    /* 조합 — 원래 운영 탭에 있던 목록. 도감의 일부이므로 여기로 옮겼다. */
    const found = Object.entries(c.discovered || {});
    box.appendChild(el('h4', 'sec', `조합 ${found.length} / ${GENRES.length * CONTENTS.length}`));
    if (!found.length) {
      box.appendChild(el('div', 'item', '<div class="d">게임을 완성하면 그 장르 × 소재 조합이 기록됩니다.</div>'));
    }
    found.sort((a, b) => b[1].score - a[1].score);
    for (const [key, v] of found.slice(0, 40)) {
      const [gid, cid] = key.split('|');
      const gn = (GENRES.find((x) => x.id === gid) || {}).ko || gid;
      const cn = (CONTENTS.find((x) => x.id === cid) || {}).ko || cid;
      const lb = comboLabel(v.score);
      box.appendChild(el('div', 'combo',
        `<span>${gn} × ${cn}</span><span class="cs">${lb.ko} ×${v.score.toFixed(2)}</span>`));
    }

    /* 출시작 */
    if (g.history.length) {
      box.appendChild(el('h4', 'sec', `출시작 ${g.history.length}`));
      for (const h of g.history.slice(0, 20)) {
        box.appendChild(el('div', 'item',
          `<div class="t"><span class="n">「${h.title}」</span><span class="j">${h.criticTotal}점</span></div>
           <div class="d">${h.genreKo} × ${h.contentKo} · 초기 ${num(h.users)}명 · ${h.at}</div>`));
      }
    }
  }

  /* ---------- 운영 ---------- */
  panelLive(box) {
    const g = this.g;
    const live = g.managed();
    box.appendChild(el('h4', 'sec', `운영 중 ${live.length} / ${g.info().managedCap}`));
    if (!live.length) box.appendChild(el('div', 'item', '<div class="d">운영 중인 게임이 없습니다.</div>'));
    for (const r of live) {
      const it = el('div', 'item');
      it.innerHTML = `<div class="t"><span class="n">「${r.title}」</span>
        <span class="j">${r.weeks}주차</span></div>
        <div class="d">${r.genreKo} × ${r.contentKo} · ${MONETIZE.find((m) => m.id === r.monetizeId).ko}<br>
        유저 ${num(r.users)}명 (최고 ${num(r.peakUsers)}) · 누적 ${won(r.earned)}</div>`;
      const b = el('button', 'btn sm danger', '서비스 종료');
      b.style.marginTop = '6px';
      b.onclick = () => {
        this.confirm(`「${r.title}」 서비스를 종료할까요?`, '운영 슬롯이 하나 비워집니다.',
          () => { g.endService(r.id); g.save(); });
      };
      it.appendChild(b);
      box.appendChild(it);
    }

    const past = g.releases.filter((r) => !r.managing);
    if (past.length) {
      box.appendChild(el('h4', 'sec', '서비스 종료'));
      for (const r of past.slice(0, 12)) {
        box.appendChild(el('div', 'item',
          `<div class="t"><span class="n">「${r.title}」</span><span class="j">${r.criticTotal}점</span></div>
           <div class="d">최고 ${num(r.peakUsers)}명 · 누적 ${won(r.earned)}${r.hallOfFame ? ' · <span class="stars">명예의 전당</span>' : ''}</div>`));
      }
    }

    /* 조합 도감은 도감 탭으로 옮겼다 — 모으는 것은 모으는 자리에 모아둔다. */
    const found = Object.keys(g.company.discovered || {}).length;
    const dx = el('button', 'btn wide sm', `조합 도감 보기 (${found}개 발견)`);
    dx.onclick = () => this.openTab('dex');
    box.appendChild(dx);
  }

  /* ---------- 사무실 ---------- */
  panelOffice(box) {
    const g = this.g, c = g.company;
    box.appendChild(el('h4', 'sec', '사무실'));
    box.appendChild(el('div', 'item',
      `<div class="d">층은 <b>랭크가 허가</b>하고 <b>돈으로 산다</b>. 입주한 층은 매주 유지비가 나가므로,
       확장은 인건비와 저울질해야 하는 결정이다.<br><br>
       기획자를 <b>기획실</b>에, 개발자를 <b>개발실</b>에 앉히면 기획서 등급이 오른다.</div>`));

    const perFloor = {};
    for (const s of g.staff) {
      const d = g.desks && s.deskId ? g.desks.find((x) => x.id === s.deskId) : null;
      const f = d ? d.floor : -1;
      (perFloor[f] = perFloor[f] || []).push(s);
    }

    for (let i = 0; i < FLOOR_PLANS.length; i++) {
      const plan = FLOOR_PLANS[i];
      const owned = i < c.floors;
      const permitted = i < (c.maxFloors || 1);
      const people = perFloor[i] || [];
      const card = el('div', 'floorcard' + (owned ? ' owned' : permitted ? '' : ' locked'));
      card.innerHTML = `<div class="fn">${i + 1}F</div>
        <div class="fb"><div class="ft">${plan.short}</div>
        <div class="fs">${owned
          ? `직원 ${people.length}명 · 유지비 ${i === 0 ? '없음' : won(FLOOR_UPKEEP) + '/주'}`
          : permitted ? '입주 가능' : `랭크 ${1 + i * 4} 필요`}</div></div>`;
      if (owned) {
        const goBtn = el('button', 'btn sm', '보기');
        goBtn.onclick = () => { this.view.setFloor(i); this.renderFloors(); this.togglePanel(true); };
        card.appendChild(goBtn);
      }
      box.appendChild(card);
    }

    const chk = g.canBuyFloor();
    const cost = g.nextFloorCost();
    if (c.floors < FLOOR_PLANS.length) {
      const buy = el('button', 'btn primary wide',
        chk.ok ? `${c.floors + 1}층 입주 · ${won(cost)}` : chk.why);
      buy.disabled = !chk.ok;
      buy.onclick = () => {
        this.confirm(`${c.floors + 1}층에 입주할까요?`,
          `${won(cost)}이 나가고, 매주 유지비 ${won(FLOOR_UPKEEP)}이 추가됩니다.`,
          () => { const r = g.buyFloor(); if (!r.ok) this.toast(r.why, 'bad'); g.save(); });
      };
      box.appendChild(buy);
    }

    box.appendChild(el('h4', 'sec', '층별 배치'));
    for (let i = 0; i < c.floors; i++) {
      const people = perFloor[i] || [];
      box.appendChild(el('div', 'row',
        `<span>${i + 1}F ${FLOOR_PLANS[i].short}</span><b>${people.map((s) => s.name).join(', ') || '비어 있음'}</b>`));
    }
  }

  /* ---------- modals ---------- */
  openModal(tag, title, bodyHTML, options, onOk) {
    $('mTag').textContent = tag;
    $('mTitle').textContent = title;
    $('mBody').innerHTML = bodyHTML || '';
    const opts = $('mOpts');
    opts.innerHTML = '';
    if (options && options.length) {
      for (const o of options) {
        const c = el('div', 'choice');
        c.innerHTML = `<div><div class="cn">${o.name}</div>${o.desc ? `<div class="cd">${o.desc}</div>` : ''}</div>
          ${o.right ? `<div class="cr">${o.right}</div>` : ''}`;
        c.onclick = () => { this.closeModal(); o.onPick(); };
        opts.appendChild(c);
      }
      $('mOk').style.display = 'none';
    } else {
      $('mOk').style.display = '';
      $('mOk').textContent = '확인';
    }
    this.modalOnOk = onOk || null;
    $('modal').classList.add('show');
  }

  closeModal() { $('modal').classList.remove('show'); }

  confirm(title, body, onYes, onAlso) {
    this.openModal('확인', title, body, [
      { name: '예', onPick: () => { if (onAlso) onAlso(); onYes(); } },
      { name: '아니오', onPick: () => { } },
    ]);
  }

  showCards() {
    const p = this.g.project;
    if (!p || !p.pendingCards) return;
    const pc = p.pendingCards;
    if (pc.kind === 'content') {
      const gen = GENRES.find((x) => x.id === p.genreId);
      const anyKnown = pc.options.some((o) => this.knownCombo(p.genreId, o.id));
      this.openModal('회의 · 게임 내용', '무엇을 다룰까?',
        anyKnown
          ? `${gen ? gen.ko : ''}에 무엇을 얹을까요. 한 번 만들어 본 조합은 궁합이 보입니다.`
          : `${gen ? gen.ko : ''}에 무엇을 얹을까요. 아직 만들어 본 적 없는 조합이라 결과는 만들어 봐야 압니다.`,
        pc.options.map((o) => {
          const known = this.knownCombo(p.genreId, o.id);
          const lb = known ? comboLabel(o.combo) : UNKNOWN_COMBO;
          const hot = this.g.company.trends && this.g.company.trends.contentId === o.id;
          const desc = known
            ? `장르 궁합 ×${o.combo.toFixed(2)}${hot ? ' · 이번 분기 유행 소재' : ''}`
            : `아직 해본 적 없는 조합${hot ? ' · 이번 분기 유행 소재' : ''}`;
          return {
            name: o.ko + (hot ? ' 🔥' : ''),
            desc,
            right: `<span class="pill ${lb.cls}">${known ? lb.ko : '???'}</span>`,
            onPick: () => { this.g.pickCard(o.id); this.g.save(); },
          };
        }));
    } else {
      this.openModal('회의 · 개발 방식', '어떻게 만들까?',
        '남은 HP를 깎는 속도와 품질 상승폭이 달라집니다.',
        pc.options.map((o) => ({
          name: o.ko, desc: o.desc,
          onPick: () => { this.g.pickCard(o.id); this.g.save(); },
        })));
    }
  }

  showFinished(p) {
    const bars = statBars(p.quality);
    this.openModal('개발 완료', `「${p.title}」`,
      `<div class="grade">${p.criticTotal}</div>
       <div class="gsub">평론가 ${p.critics.join(' · ')} (40점 만점)${p.hallOfFame ? ' · <b class="stars">명예의 전당</b>' : ''}</div>
       ${bars}
       <div class="row"><span>장르 × 내용</span><b>${p.genreKo} × ${p.contentKo}</b></div>
       <div class="row"><span>개발 방식</span><b>${p.methodKo}</b></div>
       <div class="row"><span>궁합</span><b>×${p.combo.toFixed(2)}</b></div>
       <div class="row"><span>버그</span><b>${p.bugs}개</b></div>
       <div class="row"><span>번뜩임</span><b>${p.crits}회</b></div>
       <p style="color:var(--dim);font-size:11px;margin-top:9px">개발 탭에서 홍보를 고르고 출시하세요.</p>`);
  }

  showRelease(r) {
    const notes = (r.notes || [])
      .map((n) => `<div class="verd ${n.cls}">${n.ko}</div>`).join('');
    this.openModal('출시', `「${r.title}」 출시!`,
      `<div class="grade">${num(r.users)}</div>
       <div class="gsub">초기 유저${r.trendHit ? ' · 🔥 유행을 탔다' : ''}</div>
       ${notes}
       <div class="row"><span>플랫폼</span><b>${PLATFORMS.find((p) => p.id === r.platformId).ko}</b></div>
       <div class="row"><span>수익 모델</span><b>${MONETIZE.find((m) => m.id === r.monetizeId).ko}</b></div>
       <div class="row"><span>홍보</span><b>${(MARKETING.find((m) => m.id === r.marketingId) || {}).ko || '없음'}</b></div>
       <div class="row"><span>평론가</span><b>${r.criticTotal}점</b></div>
       <div class="row"><span>남은 버그</span><b>${r.bugs}개</b></div>
       <p style="color:var(--dim);font-size:11.5px;margin-top:10px">운영 탭에서 주간 매출을 확인할 수 있습니다. 다음 주로 넘기면 정산됩니다.</p>`);
  }

  showRankUp(up) {
    this.openModal('랭크 업', `회사 랭크 ${up.rank}!`,
      `<div class="grade">${up.rank}</div>
       <div class="gsub">RANK UP</div>
       <div class="row"><span>직원 정원</span><b>${up.info.staffCap}명</b></div>
       <div class="row"><span>스태미나</span><b>${up.info.staminaMax}</b></div>
       <div class="row"><span>의욕 상한</span><b>${up.info.motivationCap}</b></div>
       <div class="row"><span>자금 상한</span><b>${won(up.info.cashCap)}</b></div>
       ${up.unlockedFloor ? `<div class="row"><span>새 층</span><b>${up.info.floors}층 입주 가능</b></div>` : ''}
       ${up.unlockedFloor ? '<p style="color:var(--dim);font-size:11.5px;margin-top:8px">사무실 탭에서 입주할 수 있습니다.</p>' : ''}`);
    this.renderFloors();
  }

  toast(text, kind) {
    const t = $('toast');
    t.textContent = text;
    t.className = 'card show ' + (kind || '');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { t.classList.remove('show'); }, 3400);
  }
}
