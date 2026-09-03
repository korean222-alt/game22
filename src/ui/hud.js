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
  RESEARCH, CONTRACTS, MARKETING, TRAITS, FLOOR_UPKEEP,
  comboScore, comboLabel, rankInfo, RANK_UP_FANS, researchEffect,
} from '../game/data.js';
import { abilities, power, role, itemCost, trainStamina, traitsOf, expToNext } from '../game/staff.js';
import { turnCost } from '../game/project.js';
import { FLOOR_PLANS } from '../world/office.js';
import { isTouch, isFullscreen, goFullscreen, exitFullscreen } from './device.js';

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
    $('bTurn').onclick = () => this.doTurn();
    $('bAuto').onclick = () => {
      this.auto = !this.auto;
      $('bAuto').classList.toggle('primary', this.auto);
      if (this.auto) this._autoTick();
    };
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

  _wireKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === ' ') { e.preventDefault(); this.doTurn(); }
      else if (k === 'q') this.view.stepFloor(-1);
      else if (k === 'e') this.view.stepFloor(1);
      else if (k === 'tab') { e.preventDefault(); this.view.toggleCut(); }
      else if (k >= '1' && k <= '5') {
        const tabs = ['company', 'staff', 'dev', 'live', 'office'];
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
    if (type === 'rank') this.showRankUp(payload);
    if (type === 'finished') this._finishedFlow(payload);
    if (type === 'floors') this.view.setFloorCount(payload).then(() => this.renderFloors());
    this.renderHUD();
    this.renderBattle();
    if (type !== 'log') this.renderPanel();
    this._cardFlow();
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

  /* An idea card waits for the meeting that produces it. */
  async _cardFlow() {
    const p = this.g.project;
    if (!p || !p.pendingCards || this.busy) return;
    this.busy = true;
    try {
      await this.view.playMeeting(p.pendingCards.kind, p.team, this.mvars(p));
    } finally {
      this.busy = false;
    }
    // The player may have skipped ahead and resolved it already.
    if (this.g.project && this.g.project.pendingCards) this.showCards();
  }

  async _finishedFlow(p) {
    if (!p || this.busy) return;
    this.busy = true;
    try {
      await this.view.playMeeting('wrap', p.team, this.mvars(p));
    } finally {
      this.busy = false;
    }
    this.view.celebrate(p.team);
    if (this.g.finished) this.showFinished(p);
  }

  /* ---------- actions ---------- */
  doTurn() {
    const g = this.g;
    if (this.busy) return;
    if (g.project && g.project.pendingCards) { this._cardFlow(); return; }
    if (!g.project) return;
    const r = g.devTurn();
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
  renderAll() { this.renderHUD(); this.renderFloors(); this.renderPanel(); this.renderBattle(); }

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
      return;
    }
    bar.classList.add('show');
    document.body.classList.add('in-battle');
    const gen = GENRES.find((x) => x.id === p.genreId);
    $('bTitle').textContent = `「${p.title}」`;
    const bits = [gen.ko, `★${p.proposal.grade}`, `${p.turn}턴`];
    if (p.contentId) {
      const c = CONTENTS.find((x) => x.id === p.contentId);
      const lb = comboLabel(comboScore(p.genreId, p.contentId));
      bits.push(`${c ? c.ko : ''} ${lb.ko}`);
    }
    if (p.seriesN > 1) bits.push(`시리즈 ${p.seriesN}편`);
    $('bMeta').textContent = bits.join(' · ');
    const pct = Math.max(0, p.hp / p.hpMax * 100);
    $('bHp').style.width = pct + '%';
    $('bHpTx').textContent = `${num(p.hp)} / ${num(p.hpMax)}`;
    const cost = turnCost(p);
    $('bCost').innerHTML = `스태미나 <b style="color:var(--warn)">-${cost}</b><br>보유 ${g.company.stamina}`;
    $('bTurn').disabled = g.company.stamina < cost || !!p.pendingCards || this.busy;
  }

  renderPanel() {
    const box = $('panel');
    const scroll = box.scrollTop;
    box.innerHTML = '';
    const fn = {
      company: () => this.panelCompany(box),
      staff: () => this.panelStaff(box),
      dev: () => this.panelDev(box),
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
    const wk = el('button', 'btn primary wide', '다음 주로 (스태미나 회복)');
    wk.onclick = () => { g.nextWeek(); g.save(); };
    box.appendChild(wk);

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
      it.innerHTML = `<div class="t"><span class="n">${s.name}</span>
        <span class="j">Lv.${s.level}/${s.maxLevel}${inTeam ? ' · 개발중' : ''}</span></div>
        <div class="d"><span class="pill ${role(s)}">${JOBS[s.job].ko}</span>${traitTags}<br>
        의욕 <span class="mot">${s.motivation}</span> · 힘 ${Math.round(power(s))}
        ${s.reincarnations ? ` · 환생 ${s.reincarnations}회` : ''}</div>`;
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
        <div class="d">${gen.ko}${hot ? ' <span class="pill great">유행</span>' : ''} · 기획 ${pr.authorName}</div>`;
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
        ${fan ? ' <span class="pill great">장르 덕후!</span>' : ''}</div>`;
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
  }

  panelInDev(box) {
    const g = this.g, p = g.project;
    const gen = GENRES.find((x) => x.id === p.genreId);
    box.appendChild(el('h4', 'sec', '개발 중'));
    box.appendChild(el('div', 'item',
      `<div class="t"><span class="n">「${p.title}」</span><span class="stars">${stars(p.proposal.grade)}</span></div>
       <div class="d">${gen.ko} · ${PLATFORMS.find((x) => x.id === p.platformId).ko} · ${MONETIZE.find((x) => x.id === p.monetizeId).ko}</div>`));
    box.appendChild(el('div', 'row', `<span>남은 HP</span><b>${num(p.hp)} / ${num(p.hpMax)}</b>`));
    box.appendChild(el('div', 'row', `<span>턴</span><b>${p.turn}</b>`));
    box.appendChild(el('div', 'row', `<span>번뜩임</span><b>${p.crits}회</b>`));
    if (p.contentId) {
      const c = CONTENTS.find((x) => x.id === p.contentId);
      const lb = comboLabel(comboScore(p.genreId, p.contentId));
      box.appendChild(el('div', 'row',
        `<span>게임 내용</span><b>${c ? c.ko : ''} <span class="pill ${lb.cls}">${lb.ko}</span></b>`));
    }
    if (p.methodId) {
      box.appendChild(el('div', 'row',
        `<span>개발 방식</span><b>${(METHODS.find((m) => m.id === p.methodId) || {}).ko || '-'}</b>`));
    }

    box.appendChild(el('h4', 'sec', '누적 품질'));
    const denom = Math.max(1, p.turn * Math.max(1, p.team.length));
    const shown = STATS.map((st) => Math.round(180 * (1 - Math.exp(-(p.raw[st] / denom) / 40)) + (p.raw[st] / denom) * 0.35));
    const mx = Math.max(1, ...shown);
    STATS.forEach((st, i) => {
      box.appendChild(el('div', 'sb',
        `<span class="lb">${STAT_KO[st]}</span><span class="bar"><span class="fill" style="width:${shown[i] / mx * 100}%"></span></span><span class="vv">${shown[i]}</span>`));
    });

    box.appendChild(el('h4', 'sec', '팀'));
    for (const id of p.team) {
      const s = g.staff.find((x) => x.id === id);
      if (!s) continue;
      box.appendChild(el('div', 'item',
        `<div class="t"><span class="n">${s.name}</span><span class="j">힘 ${Math.round(power(s))}</span></div>
         <div class="d"><span class="pill ${role(s)}">${JOBS[s.job].ko}</span>의욕 <span class="mot">${s.motivation}</span></div>`));
    }
  }

  panelFinished(box) {
    const g = this.g, p = g.finished;
    box.appendChild(el('h4', 'sec', '완성 — 출시 준비'));
    box.appendChild(el('div', 'item',
      `<div class="t"><span class="n">「${p.title}」</span><span class="stars">${stars(p.proposal.grade)}</span></div>
       <div class="d">${p.genreKo} × ${p.contentKo} · ${p.methodKo}</div>`));
    for (const st of STATS) {
      box.appendChild(el('div', 'sb',
        `<span class="lb">${STAT_KO[st]}</span><span class="bar"><span class="fill" style="width:${Math.min(100, p.quality[st] / 4)}%"></span></span><span class="vv">${p.quality[st]}</span>`));
    }
    box.appendChild(el('div', 'row', `<span>평론가</span><b>${p.critics.join(' · ')} = ${p.criticTotal}</b>`));
    box.appendChild(el('div', 'row', `<span>버그</span><b>${p.bugs}개</b>`));
    if (p.hallOfFame) box.appendChild(el('div', 'row', '<span>명예의 전당</span><b class="stars">등재</b>'));

    const db = el('button', 'btn wide', '디버그 (스태미나 -1)');
    db.disabled = p.bugs <= 0 || g.company.stamina < 1;
    db.onclick = () => { const r = g.debugProject(); if (!r.ok) this.toast(r.why, 'bad'); g.save(); };
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

    /* 도감 — the combos this company has actually discovered */
    const found = Object.entries(g.company.discovered || {});
    box.appendChild(el('h4', 'sec', `조합 도감 ${found.length} / ${GENRES.length * CONTENTS.length}`));
    if (!found.length) {
      box.appendChild(el('div', 'item', '<div class="d">게임을 완성하면 그 장르 × 소재 조합이 기록됩니다.</div>'));
    }
    found.sort((a, b) => b[1].score - a[1].score);
    for (const [key, v] of found.slice(0, 30)) {
      const [gid, cid] = key.split('|');
      const gn = (GENRES.find((x) => x.id === gid) || {}).ko || gid;
      const cn = (CONTENTS.find((x) => x.id === cid) || {}).ko || cid;
      const lb = comboLabel(v.score);
      box.appendChild(el('div', 'combo',
        `<span>${gn} × ${cn}</span><span class="cs">${lb.ko} ×${v.score.toFixed(2)}</span>`));
    }
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
      this.openModal('회의 · 게임 내용', '무엇을 다룰까?',
        '장르와의 궁합이 완성도를 크게 좌우합니다.',
        pc.options.map((o) => {
          const lb = comboLabel(o.combo);
          const hot = this.g.company.trends && this.g.company.trends.contentId === o.id;
          return {
            name: o.ko + (hot ? ' 🔥' : ''),
            desc: `장르 궁합 ×${o.combo.toFixed(2)}${hot ? ' · 이번 분기 유행 소재' : ''}`,
            right: `<span class="pill ${lb.cls}">${lb.ko}</span>`,
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
    const q = p.quality;
    const bars = STATS.map((st) =>
      `<div class="sb"><span class="lb">${STAT_KO[st]}</span><span class="bar"><span class="fill" style="width:${Math.min(100, q[st] / 4)}%"></span></span><span class="vv">${q[st]}</span></div>`).join('');
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
    this.openModal('출시', `「${r.title}」 출시!`,
      `<div class="grade">${num(r.users)}</div>
       <div class="gsub">초기 유저${r.trendHit ? ' · 🔥 유행을 탔다' : ''}</div>
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
