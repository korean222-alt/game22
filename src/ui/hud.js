/* DOM layer.

   The UI reads the Game and calls its actions; it never mutates state directly.
   Every panel re-renders wholesale on the relevant event — the panels are small
   enough that diffing them would cost more than it saves, and a full rebuild
   makes it impossible for the screen to disagree with the simulation.

   The one piece of real sequencing here is the meeting: an idea card must not
   appear until the team has actually walked to the room and discussed it, so
   the card and result flows await the 3D scene before opening a modal. */

import {
  JOBS, JOB_ABILITY, GENRES, CONTENTS, PLATFORMS, MONETIZE, ITEMS, STATS, STAT_KO, METHODS,
  RESEARCH, CONTRACTS, MARKETING, TRAITS, FLOOR_UPKEEP, UNKNOWN_COMBO,
  comboScore, comboLabel, rankInfo, RANK_UP_FANS, researchEffect,
  STARTUP_GRANT, hireDiscount,
  SHOP, SHOP_KINDS, GEAR_SLOTS, BOSSES, bossFor, BOSS_STAGES, BOSS_PHASES, RAID, OVERTIME,
  EXHAUST,
} from '../game/data.js';
import {
  FURNITURE, FURNITURE_BY_ID, FURNITURE_CATS, RESELL, comfortLabel,
} from '../game/furniture.js';
import {
  abilities, power, role, itemCost, trainStamina, traitsOf, expToNext,
  hpRatio, isTired, isSpent, gearOf, canEquip, upgradeList,
} from '../game/staff.js';
import {
  turnCost, projectQuality, projectedQuality, ideaHp, raidRounds, devStaminaCost,
  currentStage, raidProgress, ensureStages, strikePeriod, devCostOf, completion,
} from '../game/project.js';
import { monsterFor, monsterForStage } from '../game/monsters.js';
import { rewardText } from '../game/events.js';
import { FLOOR_PLANS } from '../world/office.js';
import { arenaSetFor } from '../world/arena.js';
import { kitReady } from '../world/kit.js';
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

/* ---- the stat bars ----
   Every bar in the game reads against a stated maximum, and the maximum is
   written down here rather than being guessed per call site. That is what was
   wrong with them: quality runs 1-999 but the bars divided it by 4, so every
   game above 400 drew a full bar and the five axes of a good release were
   indistinguishable — the graph stopped carrying information exactly when it
   started mattering. The in-development bars had the opposite failure: they
   were normalised against the largest of the five, so the best axis was always
   100% and the picture never changed as the project grew.

   `bar` takes a value and its scale and draws one row. Nothing else does. */
const QUALITY_MAX = 999;        // finishProject clamps every axis to this
const QUALITY_GAMMA = 0.4;      // see barPct: a debut game must still draw a bar
const ABILITY_MAX = 120;        // a tier-2 job at max level with items sits near here

/* `gamma` below 1 pulls the bottom of the range up. Quality runs 1-999 but a
   debut game scores single digits, and a linear bar draws that as one pixel —
   which reads as a broken graph rather than as a weak game. At 0.4 a score of 9
   fills 13% and a 900 still has visible headroom. The number the bar is
   labelled with is untouched, so nothing is being hidden. */
function barPct(value, max, gamma) {
  const t = Math.max(0, Math.min(1, value / max));
  return Math.max(gamma < 1 ? 3 : 0, Math.min(100, Math.round(Math.pow(t, gamma) * 100)));
}

function bar(label, value, max, opts = {}) {
  const pct = barPct(value, max, opts.gamma ?? 1);
  const cls = opts.cls ? ' ' + opts.cls : '';
  const shown = opts.text !== undefined ? opts.text : num(value);
  return `<div class="sb${cls}"><span class="lb">${label}</span>`
    + `<span class="bar"><span class="fill" style="width:${pct.toFixed(1)}%"></span>`
    + (opts.mark !== undefined
      ? `<i class="mk" style="left:${barPct(opts.mark, max, opts.gamma ?? 1)}%"></i>` : '')
    + `</span><span class="vv">${shown}</span></div>`;
}

export class UI {
  constructor(game, view) {
    this.g = game;
    this.view = view;
    this.tab = 'company';
    this.selectedStaff = null;
    this.draft = null;
    this.modalOnOk = null;
    this.busy = false;          // a cutscene is playing; hold modals back
    this.shopKind = 'food';     // 상점 탭의 현재 분류
    this.gearTarget = null;     // 장비를 채워줄 직원
    this.speed = 1;             // 아레나 배속
    this._logs = [];

    if (isTouch() && window.innerWidth < 900) document.body.classList.add('panel-hidden');

    this._wireTabs();
    this._wireBattle();
    this._wireModal();
    this._wireKeys();
    this._wireShell();
    this._wireSaleRun();

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
    const go = (id, fn) => {
      const b = $(id);
      if (!b) return;
      b.onclick = fn;
      b.style.touchAction = 'manipulation';
    };
    // 사무실 화면에 남은 배틀 바는 이제 요약과 입구다. 때리는 버튼이 아니다.
    go('bArena', () => this.enterArena());
    go('bTurn', () => this.doTurn());
    // 사무실에는 보스가 없다. 이 버튼은 세트장으로 들어가는 두 번째 입구다.
    go('bBossCam', () => this.enterArena());

    // ── 아레나 ──
    go('aOut', () => this.exitArena());
    go('aRestOut', () => this.exitArena());
    /* 탈진 화면의 "이대로 마감". 예전 자리에는 "다음 주로 넘기기" 가 있었고,
       그것이 체력을 공짜로 채워 줬다 — 시간이 무한하면 밥은 아무도 안 산다.
       이제 남은 체력째로 이 단계를 접고 다음 보스로 넘어간다. */
    go('aWrap', () => {
      const r = this.g.wrapUpStage();
      if (!r.ok) { this.toast(r.why || '지금은 마감할 수 없습니다', 'bad'); return; }
      this.g.save();
      this.renderArena(true);
    });
    go('aBag', () => { this.exitArena(); this.openTab('bag'); });
    go('aRestBag', () => { this.exitArena(); this.openTab('bag'); });
    // 사람이 많으면 파티 카드가 보스를 가린다. 접을 수 있어야 한다.
    go('aFold', () => {
      const on = document.body.classList.toggle('party-fold');
      $('aFold').textContent = on ? '👥 팀 펴기' : '👥 팀 접기';
    });
    go('aSpeed', () => {
      const i = RAID.speeds.indexOf(this.speed);
      this.speed = RAID.speeds[(i + 1) % RAID.speeds.length];
      $('aSpeed').textContent = `⏩ ${this.speed}배속`;
    });
  }

  /* ══════════════════════ 보스 아레나 ══════════════════════
     개발에 착수하면 화면이 통째로 전투가 된다. 스태미나는 착수할 때 이미
     냈고, 여기서 드는 것은 직원들의 체력뿐이다 — 그래서 누를 것이 없다.
     플레이어가 하는 일은 지켜보고, 지친 사람에게 밥을 먹이고, 보스가
     바뀔 때 카드를 고르는 것이다. */
  enterArena() {
    const g = this.g;
    if (!g.project) return false;
    ensureStages(g.project);
    g.pauseBattle(false);
    document.body.classList.add('arena');
    this.speed = this.speed || 1;
    $('aSpeed').textContent = `⏩ ${this.speed}배속`;
    $('aFold').textContent = document.body.classList.contains('party-fold') ? '👥 팀 펴기' : '👥 팀 접기';
    this._logs = [];
    $('aLog').innerHTML = '';
    this.view.enterArena(g.project);
    this.renderArena(true);
    return true;
  }

  exitArena() {
    if (!document.body.classList.contains('arena')) return;
    document.body.classList.remove('arena');
    document.body.classList.remove('rest');
    // 사무실로 나가면 탈진 유예도 멈춘다. 보이지 않는 곳에서 마감이 걸리면
    // 돌아왔을 때 무슨 일이 있었는지 알 방법이 없다.
    if (this.g.project) this.g.project.exhaustT = 0;
    // 사무실로 돌아가면 전투는 멈춘다. 보이지 않는 곳에서 체력이 녹으면
    // 돌아왔을 때 무슨 일이 있었는지 알 방법이 없다.
    this.g.pauseBattle(true);
    this.view.exitArena();
    this.renderAll();
  }

  inArena() { return document.body.classList.contains('arena'); }

  /* main.js 의 단 하나뿐인 rAF 루프가 매 프레임 부른다. 시계를 하나로 두면
     탭이 백그라운드로 갔을 때 전투만 따로 달려나가는 일이 없다. */
  tickBattle(dt) {
    if (!this.inArena()) return;
    const g = this.g;
    if (!g.project) { this.exitArena(); return; }
    if (this.busy) return;
    // 모달이 떠 있으면 전투도 멈춘다. 카드나 합성 결과를 읽는 동안 뒤에서
    // 체력이 깎이면, 읽는 것 자체가 벌칙이 된다.
    if ($('modal').classList.contains('show')) return;
    const r = g.devTick(dt, this.speed || 1);
    // DOM 은 초당 20번이면 충분하다. 매 프레임 다시 그리면 폰에서 전투가
    // 프레임을 잡아먹고, 정작 3D 가 끊긴다.
    this._acc = (this._acc || 0) + dt;
    if (this._acc >= 0.05) { this._acc = 0; this.renderArena(); }
    const resting = !!(r && r.blocked === 'exhausted');
    document.body.classList.toggle('rest', resting);
    if (resting) this.renderRest(r.left);
  }

  /* 탈진 화면의 카운트다운. 남은 시간 안에 밥을 먹여 한 명이라도 일으키면
     마감은 취소되고 전투가 이어진다. */
  renderRest(left) {
    const t = Math.max(0, left === undefined ? EXHAUST.grace : left);
    const bar = $('aRestBar'), cnt = $('aRestCount');
    if (bar) bar.style.width = ((t / EXHAUST.grace) * 100).toFixed(1) + '%';
    if (cnt) cnt.textContent = `${t.toFixed(1)}초 후 이 단계를 이대로 마감합니다`;
    const p = this.g.project;
    const msg = $('aRestMsg');
    if (msg && p) {
      const leftHp = Math.round((p.hp / Math.max(1, p.hpMax)) * 100);
      msg.innerHTML = `아무도 더는 못 칩니다. 지금 밥을 먹이지 않으면
        <b>남은 체력 ${leftHp}%</b> 를 못 만든 채로 마감하고 다음 보스로 넘어갑니다.`;
    }
    this.renderTray($('aRestTray'));
  }

  _arenaEvent(ev) {
    if (ev.kind === 'stageClear') {
      this.arenaLog(`${ev.name} 격파!`, 'big');
      this._flash();
    } else if (ev.kind === 'stageStart') {
      this.arenaLog(`${ev.name} 등장!`, 'bad');
      this._flash();
      this.renderArena(true);
    } else if (ev.kind === 'boss') {
      this.arenaLog(`${ev.ko} — ${ev.line}`, 'bad');
    } else if (ev.kind === 'crit') {
      this.arenaLog(`${ev.name} 번뜩임! ${num(ev.damage)}`, 'good');
    } else if (ev.kind === 'down') {
      this.arenaLog(`${ev.name} 쓰러짐`, 'bad');
    } else if (ev.kind === 'revive') {
      this.arenaLog(`${ev.name} 복귀`, 'good');
    } else if (ev.kind === 'exhausted') {
      this.arenaLog('팀 전원 탈진 — 밥을 먹이지 않으면 이대로 마감됩니다', 'bad');
      this.renderRest(ev.grace);
    } else if (ev.kind === 'forfeit') {
      this.arenaLog(`${ev.name} — ${ev.left}% 를 남긴 채 마감`, 'bad');
      this._flash();
    }
  }

  arenaLog(text, cls = '') {
    if (!this.inArena()) return;
    const box = $('aLog');
    if (!box) return;
    const line = el('div', 'l' + (cls ? ' ' + cls : ''), text);
    box.appendChild(line);
    while (box.children.length > 6) box.removeChild(box.firstChild);
    setTimeout(() => { if (line.parentNode) line.parentNode.removeChild(line); }, 4200);
  }

  _flash() {
    const f = $('aFlash');
    if (!f) return;
    f.classList.remove('on');
    void f.offsetWidth;
    f.classList.add('on');
  }

  renderArena(full = false) {
    const g = this.g, p = g.project;
    if (!p || !this.inArena()) return;
    ensureStages(p);
    const st = currentStage(p);
    const n = p.stages.length;
    const stage = p.stage || 0;

    if (full || this._aStage !== stage || this._aProj !== p.id) {
      this._aStage = stage; this._aProj = p.id;
      // 무대 이름을 제목 옆에 붙인다. 보스마다 세트장이 다르다는 것이
      // 화면 어딘가에는 글자로도 적혀 있어야 한다.
      const setKo = arenaSetFor(st.species).ko;
      $('aTitle').textContent = `「${p.title}」 · ${setKo}`;
      $('aBossName').textContent = st.name || st.ko;
      $('aBossTag').textContent = `${st.ko} · ${stage + 1}/${n}`;
      $('aIco').textContent = ['🐱', '👹', '👿'][stage] || '👾';
      const pips = $('aPips');
      pips.innerHTML = '';
      for (let i = 0; i < n; i++) {
        pips.appendChild(el('span', 'apip' + (i < stage ? ' dead' : i === stage ? ' on' : '')));
      }
      this._aParty = null;   // 파티 카드도 다시 짓는다
    }

    const frac = Math.max(0, p.hp / Math.max(1, p.hpMax));
    $('aBossHp').style.width = (frac * 100) + '%';
    $('aBossHpTx').textContent = `${num(p.hp)} / ${num(p.hpMax)}`;
    $('aTotal').style.width = (raidProgress(p) * 100) + '%';
    $('aTurn').textContent = `${p.turn}라운드 · 번뜩임 ${p.crits}`;
    $('arena').classList.toggle('weak', (p.weak || 0) > 0);

    // ---- 파티 ----
    const box = $('aParty');
    if (!this._aParty || this._aParty !== p.team.join(',')) {
      this._aParty = p.team.join(',');
      // 카드 크기는 인원수가 정한다. 여덟 명 이상이면 이름과 체력만 남긴다 —
      // 그 아래는 보스가 서 있어야 하는 자리다.
      box.dataset.n = String(p.team.length);
      box.classList.toggle('many', p.team.length >= 8);
      box.innerHTML = '';
      this._aCards = new Map();
      for (const id of p.team) {
        const s = g.staff.find((x) => x.id === id);
        if (!s) continue;
        const card = el('div', 'apc',
          `<div class="apn">${s.name} <i>${JOBS[s.job].ko}</i></div>
           <div class="aph"><div class="aphf"></div></div>
           <div class="apa"><div class="apaf"></div></div>
           <div class="apx"></div>`);
        box.appendChild(card);
        this._aCards.set(id, card);
      }
    }
    for (const id of p.team) {
      const card = this._aCards.get(id);
      const s = g.staff.find((x) => x.id === id);
      if (!card || !s) continue;
      const r = hpRatio(s);
      const down = (p.down && p.down[id] > 0) || s.hp <= 0;
      card.classList.toggle('down', !!down);
      card.classList.toggle('tired', !down && r < 0.4);
      card.querySelector('.aphf').style.width = (r * 100) + '%';
      const gauge = down ? 0 : Math.min(1, p.atb[id] || 0);
      card.querySelector('.apaf').style.width = (gauge * 100) + '%';
      card.classList.toggle('act', gauge > 0.86);
      const x = card.querySelector('.apx');
      const txt = down ? '쓰러짐' : `체력 ${Math.round(s.hp)}/${s.hpMax}`;
      if (x.textContent !== txt) x.textContent = txt;
    }
    this.renderTray($('aTray'));
    if (document.body.classList.contains('rest')) this.renderTray($('aRestTray'));
  }

  _wireModal() {
    $('mOk').onclick = () => {
      const fn = this.modalOnOk;
      this.modalOnOk = null;
      this.closeModal();
      if (fn) fn();
    };
  }

  _wireSaleRun() {
    const ok = $('srOk');
    if (!ok) return;
    ok.style.touchAction = 'manipulation';
    ok.onclick = () => {
      const s = this.g.closeSalesRun();
      if (!s) return;
      const rel = this.g.releases.find((r) => r.id === s.id);
      if (rel) this.showRelease(rel, s);
    };
  }

  /* 매 프레임. 전투와 같은 시계를 쓴다 — 탭이 백그라운드로 가면 판매도 멈춘다. */
  tickSales(dt) {
    if (this.g.selling()) this.g.salesTick(dt);
  }

  /* ---------- 실시간 판매 화면 ----------
     막대 하나가 한 주다. 지금 서는 막대가 금색이고, 그 위를 꺾은선이 잇는다.
     다 팔면 헤더가 '정산 완료' 로 바뀌고 확인 버튼이 나온다 — 그 버튼을
     누르기 전까지는 새 게임을 만들 수 없다. */
  renderSaleRun(s) {
    const body = document.body;
    if (!s) { body.classList.remove('selling', 'settled'); this._srEv = null; return; }
    body.classList.add('selling');
    body.classList.toggle('settled', !!s.ended);

    $('srTag').textContent = s.ended ? '✅ 정산 완료' : '🔴 실시간 판매';
    $('srTitle').textContent = `「${s.title}」`;
    $('srTotal').textContent = won(s.total);
    const last = s.points[s.points.length - 1];
    $('srWeek').textContent = s.ended
      ? `${s.done}주 누적 매출`
      : `${s.done} / ${s.weeks}주차${last ? ` · 이번 주 ${won(last.income)}` : ''}`;

    /* 판매 중에 터진 사건. 최근 두 개만 남긴다 — 카드가 좁고, 지난주 일보다
       이번 주에 무슨 일이 있었는지가 중요하다. */
    const evBox = $('srEv');
    const shown = (s.events || []).slice(-2);
    const sig = shown.map((e) => `${e.at}:${e.id}`).join('|');
    if (evBox && this._srEv !== sig) {
      const fresh = this._srEv !== null && this._srEv !== undefined;
      this._srEv = sig;
      evBox.innerHTML = shown.map((e, i) =>
        `<div class="se ${e.cls === 'bad' ? 'bad' : ''}${fresh && i === shown.length - 1 ? ' fresh' : ''}">
           <span>${e.emoji}</span><span>${e.ko}</span>
           <span class="p">${e.pct > 0 ? '+' : ''}${e.pct}%</span></div>`).join('');
    }

    const bars = $('srBars');
    if (bars.children.length !== s.weeks) {
      bars.innerHTML = '';
      for (let i = 0; i < s.weeks; i++) bars.appendChild(el('i'));
    }
    const peak = Math.max(1, s.peak);
    const pts = [];
    for (let i = 0; i < s.weeks; i++) {
      const pt = s.points[i];
      const h = pt ? Math.max(3, (pt.income / peak) * 100) : 0;
      const bar2 = bars.children[i];
      bar2.style.height = h + '%';
      // 사건이 붙은 주는 색이 다르다. 튄 막대에 이유가 붙어 있어야 한다.
      const evCls = pt && pt.event ? (pt.event.cls === 'bad' ? 'dn' : 'up') : '';
      const now = pt && i === s.points.length - 1 && !s.ended ? 'now' : '';
      bar2.className = [evCls, now].filter(Boolean).join(' ');
      if (pt) pts.push(`${((i + 0.5) / s.weeks) * 100},${100 - h}`);
    }
    $('srPoly').setAttribute('points', pts.join(' '));

    const stat = $('srStat');
    const users = last ? last.users : s.users;
    stat.innerHTML =
      `<div><span class="k">현재 유저</span><span class="v">${num(users)}</span></div>
       <div><span class="k">초기 유저</span><span class="v">${num(s.users)}</span></div>
       <div><span class="k">팬</span><span class="v">+${num(s.fans)}</span></div>`;
  }

  /* ---------- 룰렛 ----------
     당첨은 이미 정해져 있다. 표가 흘러가다 그 칸에서 멈추는 것을 보여줄
     뿐이고, 그 2.6초가 "뽑았다" 는 감각의 전부다. 결과를 모달로 곧장
     띄우면 그냥 통보다. */
  spinRoulette(tag, labels, winIndex, hitText) {
    const strip = $('rStrip'), win = $('roul'), hit = $('rHit');
    if (!strip || !win || !labels.length) return Promise.resolve();
    const CELL = 110, LOOPS = 4;
    const cells = [];
    for (let r = 0; r <= LOOPS; r++) for (let i = 0; i < labels.length; i++) cells.push(labels[i]);
    // 마지막 바퀴의 당첨 칸에서 멈춘다. 앞의 네 바퀴는 속도를 보여주기 위한 것.
    const target = LOOPS * labels.length + winIndex;
    strip.innerHTML = '';
    cells.forEach((t, i) => {
      const c = el('div', 'rcell', t);
      if (i === target) c.dataset.win = '1';
      strip.appendChild(c);
    });
    $('rTag').textContent = tag;
    hit.textContent = '';
    hit.classList.remove('on');
    document.body.classList.add('rouling');

    const w = win.querySelector('.rwin').getBoundingClientRect().width || 380;
    strip.style.transition = 'none';
    strip.style.transform = 'translateX(0px)';
    void strip.offsetWidth;
    strip.style.transition = 'transform 2.6s cubic-bezier(.12,.72,.15,1)';
    strip.style.transform = `translateX(${w / 2 - (target * CELL + CELL / 2)}px)`;

    return new Promise((resolve) => {
      setTimeout(() => {
        const c = strip.querySelector('[data-win]');
        if (c) c.classList.add('hit');
        hit.textContent = hitText || labels[winIndex];
        hit.classList.add('on');
        setTimeout(() => {
          document.body.classList.remove('rouling');
          resolve();
        }, 1150);
      }, 2650);
    });
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
    if (this.view.walk) this.togglePanel(true);
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
    // 아레나에서는 알림이 로그 리본으로 간다. 화면 한복판은 보스의 자리고,
    // 자동 전투는 초당 몇 줄씩 나오므로 토스트로 받으면 서로를 덮는다.
    if (type === 'log') {
      // 룰렛이 도는 동안에는 로그를 접는다. 안 그러면 "새 소재 획득: 공룡"
      // 토스트가 룰렛보다 먼저 떠서 결과를 미리 말해 버린다.
      if (this._quietLog) return;
      if (this.inArena()) this.arenaLog(payload.text, payload.kind);
      else this.toast(payload.text, payload.kind);
    }
    if (type === 'battle') {
      this.view.playBattle(payload);
      // 아레나의 연출은 여기 한 곳에서만 돈다. tickBattle 안에서도 처리하면
      // 카드로 스테이지가 넘어갈 때(그 emit 은 tick 밖에서 난다) 헤더가
      // 한 박자 늦게 바뀐다.
      if (this.inArena()) for (const ev of payload.events) this._arenaEvent(ev);
    }
    // 개발이 시작되면 그 자리에서 보스가 솟아오른다 — 첫 타격을 기다리지 않는다.
    if (type === 'project') this.view.ensureBoss(payload);
    // 테스트 도구가 랭크를 한 번에 여러 단 올릴 때는 축하 팝업을 접는다.
    // 네 장을 연달아 닫게 만드는 것은 확인이 아니라 벌칙이다.
    if (type === 'rank' && !this._quietRank) this.showRankUp(payload);
    // 판매는 십몇 초 동안 열두 번 온다. 그때마다 사이드 패널을 통째로 다시
    // 지으면 그 비용이 그대로 프레임에서 나간다 — 화면에 필요한 것은 판매 카드뿐이다.
    if (type === 'sales') {
      this.renderSaleRun(payload);
      this.renderHUD();
      // 판매가 시작·종료되는 순간에만 옆의 목록을 다시 짓는다. 주차마다
      // 다시 지으면 한 번의 판매에 사이드 패널을 열두 번 새로 세우게 된다.
      if (!payload || payload.done === 0 || payload.ended) this.renderSales();
      if (!payload) this.renderAll();
      return;
    }
    if (type === 'finished') this._finishedFlow(payload);
    if (type === 'floors') this.view.setFloorCount(payload).then(() => this.renderFloors());
    if (type === 'rescue') this.showRescue(payload);
    if (type === 'hired') this.view.walkIn(payload);
    if (type === 'fired') this.view.walkOut(payload);
    // A hire, a departure or a desk reshuffle changes who exists and where they
    // sit. The office starts empty now, so every person in the building arrived
    // through one of these — without this the first hire is invisible until
    // something else happens to rebuild the world.
    if (type === 'staff' || type === 'desks') this.view.syncAgents();
    if (type === 'event' && !payload.resolved) this._eventFlow();

    // 아레나에서는 경영 패널이 한 장도 보이지 않는다. 자동 전투는 초당
    // 서너 번 이벤트를 뿜으므로, 여기서 사이드 패널까지 통째로 다시 지으면
    // 그 비용이 그대로 프레임에서 나간다.
    if (this.inArena()) {
      this.renderHUD();
      if (type !== 'battle') this.renderArena(true);
      this._cardFlow();
      return;
    }

    this.renderHUD();
    this.renderBattle();
    this.renderProgress();
    this.renderSales();
    if (type !== 'log') this.renderPanel();
    this.renderTutorial();
    this._cardFlow();
  }

  /* ---------- the opening ----------
     A new studio has no name, no staff and no furniture. This is the ceremony
     that fixes the first of those and pays for the other two: a name box, then
     the grant, then the tutorial takes over. A save that has already been
     founded skips straight past. */
  openingFlow() {
    const c = this.g.company;
    if (c.founded) { this.renderTutorial(); return; }
    this.askCompanyName();
  }

  askCompanyName() {
    const suggest = ['픽셀하트', '코코아 스튜디오', '나인볼트', '달빛상자', '스튜디오 여백', '토끼굴 게임즈'];
    const pick = suggest[Math.floor(Math.random() * suggest.length)];
    $('mTag').textContent = '창업';
    $('mTitle').textContent = '회사 이름을 정하세요';
    $('mBody').innerHTML =
      `<p style="color:var(--dim);font-size:12px;margin-bottom:10px">
         오늘부터 사장님입니다. 이 이름으로 게임을 출시하게 됩니다.</p>
       <input id="coInput" class="tin" maxlength="18" placeholder="${pick}" autocomplete="off">
       <p style="color:var(--dim);font-size:11px;margin-top:8px">최대 18자. 나중에는 바꿀 수 없습니다.</p>`;
    $('mOpts').innerHTML = '';
    $('mOk').style.display = '';
    $('mOk').textContent = '설립하기';
    this.modalOnOk = () => {
      const input = $('coInput');
      const name = (input && input.value.trim()) || pick;
      this.g.found(name);
      this.showGrant(name);
    };
    $('modal').classList.add('show');
    setTimeout(() => { const i = $('coInput'); if (i) i.focus(); }, 60);
  }

  showGrant(name) {
    this.openModal('창업 지원금', `「${name}」 설립!`,
      `<div class="grade">${won(STARTUP_GRANT)}</div>
       <div class="gsub">창업 지원금이 입금되었습니다</div>
       <p style="font-size:12px;line-height:1.6;margin-top:10px">
         사무실은 비어 있고 직원도 없습니다. 이 돈으로
         <b>책상을 사서 배치하고</b>, 그 자리에 <b>직원을 뽑으면</b> 회사가 굴러가기 시작합니다.<br><br>
         지금은 <b>신입 할인</b> 기간이라 채용비가 ${Math.round((1 - hireDiscount(1)) * 100)}% 쌉니다.</p>`,
      null, () => {
        this.openTab('office');
        this.renderTutorial();
        // 창업이 끝나고 나서야 '홈 화면에 추가' 안내가 뜬다.
        const f = this.onFounded; this.onFounded = null;
        if (f) f();
      });
  }

  showRescue({ amount, debt, count, morale }) {
    this.openModal('긴급 지원금', '자금이 바닥났습니다',
      `<div class="grade">${won(amount)}</div>
       <div class="gsub">${count}번째 지원 · 부족분 ${won(debt)}</div>
       <p style="font-size:12px;line-height:1.6;margin-top:10px">
         투자자가 급한 불을 꺼줬습니다. 회사는 문을 닫지 않습니다 — 대신
         <b>직원 의욕 ${morale}</b>. 다음 지원금은 더 적습니다.<br><br>
         회사 탭의 <b>계약 일감</b>은 스태미나만 쓰고 확실한 현금이 들어옵니다.
         지원금에 기대는 것보다 언제나 쌉니다.</p>`);
  }

  /* ---------- tutorial ----------
     A single line above the panel naming the next thing to do. It is not a
     wizard and it blocks nothing: the step it shows is derived from committed
     state, so doing things out of order simply skips ahead. */
  renderTutorial() {
    const box = $('tut');
    if (!box) return;
    const step = this.g.tutorialStep();
    if (!step || !this.g.company.founded) { box.classList.remove('show'); return; }
    box.classList.add('show');
    box.innerHTML = `<div class="tt">${step.title}</div><div class="tb">${step.body}</div>`;
    const go = el('button', 'btn sm primary', '이동');
    go.onclick = () => this.openTab(step.tab);
    const skip = el('button', 'btn sm', '건너뛰기');
    skip.onclick = () => { this.g.skipTutorial(); this.renderTutorial(); };
    const row = el('div', 'trow');
    row.append(go, skip);
    box.appendChild(row);
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

  /* An idea card waits for the meeting that produces it.

     아레나 안에서 이 회의가 걸리면 화면이 하얗게 비었다. 세트장 모드의
     draw() 는 사무실을 아예 그리지 않는데, 회의 연출은 카메라만 사무실
     회의실로 옮겼기 때문이다 — 700 유닛 밖의 빈 공간을 비추고 있었던 것.
     첫 보스를 잡고 '게임 내용' 회의로 넘어가는 길이 정확히 그 경우였다.

     그래서 회의 전에 세트장을 나갔다가, 카드를 고르고 나면 돌아온다.
     "회의하러 사무실로 올라갔다가 다시 내려간다" 는 뜻이 그대로 화면이 된다. */
  async _cardFlow() {
    const p = this.g.project;
    if (!p || !p.pendingCards || this.busy) return;
    const kind = p.pendingCards.kind;
    if (this.wantsMeeting(kind)) {
      if (this.inArena()) { this._resumeArena = true; this.exitArena(); }
      this.busy = true;
      try {
        await this.view.playMeeting(kind, p.team, this.mvars(p));
      } finally {
        this.busy = false;
      }
    }
    // The player may have skipped ahead and resolved it already.
    if (this.g.project && this.g.project.pendingCards) this.showCards();
    else this._backToArena();
  }

  /* 회의 때문에 잠시 나왔던 세트장으로 돌아간다. 카드를 고른 직후에만 돈다. */
  _backToArena() {
    if (!this._resumeArena) return;
    this._resumeArena = false;
    if (this.g.project && !this.g.project.pendingCards && !this.inArena()) this.enterArena();
  }

  _finishedFlow(p) {
    if (!p) return;
    /* 결과 → 홍보 → 출시는 게임 하나에 **한 번만** 흐른다.

       디버그도 'finished' 를 다시 쏘기 때문에, 예전에는 버그를 한 번 잡을
       때마다 완성 팝업이 다시 뜨고 그 확인이 다시 홍보 선택으로 이어졌다.
       홍보에서 "조금 더 다듬기" 를 고르고 디버그하면 또 홍보가 뜨는
       무한 반복이 정확히 이것이다. 이미 흘린 게임이면 패널만 새로 그린다. */
    if (this._finFlowed === p.id) { this.renderPanel(); return; }
    // 회의 연출이 돌고 있으면 결과창을 **버리지 말고 미룬다**. 예전에는 그냥
    // return 이라서, 마지막 카드 회의와 완성이 같은 순간에 겹치면 완성 화면이
    // 통째로 사라지고 게임이 아무 말 없이 멈춘 것처럼 보였다.
    if (this.busy) { clearTimeout(this._finT); this._finT = setTimeout(() => this._finishedFlow(p), 400); return; }
    this._finFlowed = p.id;
    this.view.celebrate(p.team);
    // 마지막 보스를 잡았으면 세트장에 남아 있을 이유가 없다. 결과 → 홍보 →
    // 출시가 여기서 한 줄로 이어진다.
    if (this.inArena()) this.exitArena();
    if (this.g.finished) this.showFinished(p);
  }

  /* ---------- actions ----------
     한 라운드를 통째로 돌린다. 아레나에 들어가지 않고 사무실에서 바로
     진행시키고 싶을 때의 지름길이다 — 스태미나는 들지 않는다. */
  doTurn() {
    const g = this.g;
    if (this.busy) return;
    if (g.project && g.project.pendingCards) { this._cardFlow(); return; }
    if (!g.project) return;
    const r = g.devTurn();
    if (!r.ok) this.toast(r.why, 'bad');
    // 전원이 쓰러졌으면 결정할 것이 있다. 전투 화면에서 밥을 먹이거나
    // 이대로 마감하거나 — 사무실에 선 채로 정할 일이 아니다.
    if (r.exhausted && !this.inArena()) this.enterArena();
    g.save();
  }

  /* ---------- rendering ---------- */
  renderAll() {
    this.renderHUD(); this.renderFloors(); this.renderPanel();
    this.renderBattle(); this.renderProgress(); this.renderSales(); this.renderShell();
  }

  /* ---------- 판매 현황 ----------
     출시한 게임은 한 번에 목돈이 되지 않는다. 몇 주에 걸쳐 팔리고, 매주
     조금씩 식는다. 그 곡선을 화면 옆에 붙여 두면 "다음 게임을 언제
     시작할까" 가 판단 가능한 질문이 된다 — 운영 탭을 열어야만 보인다면
     아무도 보지 않는다. */
  renderSales() {
    const g = this.g, box = $('sgList');
    if (!box) return;
    // 실시간 판매 카드가 돌고 있는 게임은 여기서 빼놓는다. 같은 게임의
    // 같은 숫자가 레일에 두 번 서면 어느 쪽이 지금인지 알 수가 없다.
    const running = g.sales && !g.sales.ended ? g.sales.id : null;
    const live = g.managed().filter((r) => r.id !== running);
    document.body.classList.toggle('has-sales', live.length > 0);
    if (!live.length) { box.innerHTML = ''; this._salesSig = null; return; }

    const week = live.reduce((a, r) => a + (r.lastIncome || 0), 0);
    $('sgWeek').textContent = `이번 주 ${won(week)}`;

    const sig = live.map((r) => `${r.id}:${r.weeks}:${r.users}:${r.lastIncome || 0}:${r.lastEvent ? r.lastEvent.id : ''}`).join('|');
    if (this._salesSig === sig) return;
    this._salesSig = sig;

    box.innerHTML = '';
    for (const r of live) {
      const hist = r.history || [];
      const peak = Math.max(1, ...hist.map((h) => h.income));
      const bars = hist.slice(-14).map((h, i, arr) => {
        const cls = [h.event ? (h.event.cls === 'bad' ? 'dn' : 'up') : '', i === arr.length - 1 ? 'now' : '']
          .filter(Boolean).join(' ');
        return `<i class="${cls}" style="height:${Math.max(6, h.income / peak * 100)}%"></i>`;
      }).join('');
      // 이 속도로 식으면 몇 주 더 팔리는가. 정점 전이면 아직 오르는 중이라
      // 남은 주를 세는 것 자체가 뜻이 없다 — 그때는 '상승 중' 이라고 쓴다.
      const rising = (r.peakWeek || 0) > r.weeks;
      const left = r.decay > 0 && r.decay < 1
        ? Math.max(0, Math.ceil(Math.log(60 / Math.max(1, r.users)) / Math.log(r.decay)))
        : 99;
      const drop = hist.length >= 2
        ? Math.round((1 - hist[hist.length - 1].income / Math.max(1, hist[hist.length - 2].income)) * 100)
        : 0;
      const ev = r.lastEvent;
      const tail = rising ? '📈 상승 중'
        : left < 90 ? `약 ${left}주 남음` : '판매 시작';
      const c = el('div', 'sgc',
        `<div class="sgt">「${r.title}」</div>
         <div class="sgv">${won(r.lastIncome || 0)}</div>
         <div class="sgn"><span>${r.weeks}주차</span><span>유저 ${num(r.users)}</span></div>
         ${bars ? `<div class="spark">${bars}</div>` : ''}
         ${ev ? `<div class="sgd">${ev.emoji} ${ev.ko} ${ev.pct > 0 ? '+' : ''}${ev.pct}%</div>` : ''}
         <div class="sgend">${drop > 0 ? `지난주 대비 −${drop}% · ` : ''}${tail}</div>`);
      box.appendChild(c);
    }
  }

  /* 오른쪽 레일에 카드가 한 장이라도 서 있는가. 튜토리얼 줄이 그만큼
     비켜서야 판매 카드의 머리말이 덮이지 않는다. */
  renderRail() {
    const g = this.g;
    const running = g.sales && !g.sales.ended ? g.sales.id : null;
    // 상태에서 바로 읽는다. body 클래스를 보면 renderHUD 가 먼저 도는
    // 프레임에서 한 박자 늦게 반영된다.
    const on = !!g.project || !!g.sales || g.managed().some((r) => r.id !== running);
    document.body.classList.toggle('has-rail', on && !this.inArena());
  }

  renderHUD() {
    this.renderRail();
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
      if (this.inArena()) this.exitArena();
      return;
    }
    ensureStages(p);
    bar.classList.add('show');
    document.body.classList.add('in-battle');
    // Tolerant of a project missing its lookups: a save written by another
    // build should degrade to a placeholder, not take the whole HUD down.
    const gen = GENRES.find((x) => x.id === p.genreId) || { ko: '?' };
    const st = currentStage(p);
    $('bTitle').textContent = `「${p.title}」`;
    const bits = [gen.ko, `★${p.proposal ? p.proposal.grade : '?'}`, `${p.turn}라운드`];
    if (p.contentId) {
      const c = CONTENTS.find((x) => x.id === p.contentId);
      const known = this.knownCombo(p.genreId, p.contentId);
      const lb = known ? comboLabel(comboScore(p.genreId, p.contentId)) : UNKNOWN_COMBO;
      bits.push(`${c ? c.ko : ''} ${known ? lb.ko : '???'}`);
    }
    if (p.seriesN > 1) bits.push(`시리즈 ${p.seriesN}편`);
    $('bMeta').textContent = bits.join(' · ');
    const pct = Math.max(0, p.hp / Math.max(1, p.hpMax) * 100);
    $('bHp').style.width = pct + '%';
    $('bHpTx').textContent = `${num(p.hp)} / ${num(p.hpMax)}`;
    // 보스 줄: 지금 상대하는 놈의 이름과 몇 번째인지.
    $('bBoss').textContent = st.name || st.ko;
    const ph = $('bPhase');
    ph.textContent = (p.weak || 0) > 0
      ? `약점! ×1.45`
      : `${(p.stage || 0) + 1}/${p.stages.length} · ${st.ko}`;
    ph.classList.toggle('weak', (p.weak || 0) > 0);

    // 스태미나는 착수할 때 이미 냈다. 여기 뜨는 것은 팀의 상태다.
    const team = p.team.map((id) => g.staff.find((x) => x.id === id)).filter(Boolean);
    const avg = team.length
      ? Math.round(team.reduce((a, s) => a + hpRatio(s) * 100, 0) / team.length) : 0;
    $('bCost').innerHTML = p.paused
      ? '<b style="color:var(--warn)">일시정지</b><br>팀 체력 ' + avg + '%'
      : '팀 체력<br><b style="color:' + (avg < 40 ? 'var(--warn)' : 'var(--good,#8affd8)') + '">' + avg + '%</b>';
    const blocked = !!p.pendingCards || this.busy;
    $('bTurn').disabled = blocked;
    this.renderTray();
  }

  /* ---------- 도우미 트레이 ----------
     배틀 중에 가방을 열지 않고 밥을 먹인다. 음식은 가장 지친 팀원에게,
     음료와 도구는 회사에 바로 적용된다 — 폰에서 대상 고르기를 한 번 더
     시키면 아무도 안 쓴다. */
  renderTray(box = null) {
    box = box || $('tray');
    if (!box) return;
    const g = this.g;
    const items = g.bagList().filter((b) => b.item.kind !== 'gear').slice(0, 8);
    // 아레나는 초당 20번 다시 그린다. 내용이 그대로면 DOM 을 건드리지 않는다 —
    // 안 그러면 손가락이 아이콘에 닿는 순간 그 아이콘이 이미 다른 노드다.
    const sig = items.map((b) => b.item.id + 'x' + b.n).join('|');
    if (box._sig === sig) return;
    box._sig = sig;
    box.innerHTML = '';
    for (const { item, n } of items) {
      const t = el('div', 'tray-i', `<span class="e">${item.emoji}</span><span class="n">${n}</span>`);
      t.title = `${item.ko} — ${item.desc || ''}`;
      t.onclick = () => {
        const who = item.kind === 'food' && !item.all
          ? (g.neediest(g.project ? g.project.team : null) || g.neediest())
          : null;
        const r = g.useItem(item.id, who ? who.id : null);
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
    // 탈진으로 마감한 단계가 있으면 그 손해를 개발 중에도 계속 보여준다.
    // 결과창에서 처음 알게 되면 그건 통보지 판단 재료가 아니다.
    const cpRow = $('pgComp');
    if (cpRow) {
      const on = (p.forfeits || 0) > 0;
      cpRow.hidden = !on;
      if (on) cpRow.querySelector('b').textContent =
        `${Math.round(completion(p) * 100)}% · 마감 ${p.forfeits}회`;
    }

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
      bag: () => this.panelBagTab(box),
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

    /* 카메라 조이스틱. 화면을 끌어 돌리는 게 불편하다는 제보에서 나왔고,
       배치 모드에서는 캔버스를 가구가 가져가므로 사실상 여기가 카메라의
       유일한 조작계다. 그래도 끄고 싶은 사람은 있다. */
    if (this.view.setCamPad) {
      const cp = el('div', 'toggle' + (this.view.camPadOn() ? ' on' : ''),
        '<span>카메라 조이스틱</span><span class="sw"></span>');
      cp.onclick = () => { this.view.setCamPad(!this.view.camPadOn()); this.renderPanel(); };
      box.appendChild(cp);
      box.appendChild(el('div', 'item',
        '<div class="d">오른쪽 아래 스틱으로 화면을 돌리고 옮깁니다. <b>⟳</b> 로 회전/이동을 바꾸고 <b>＋ −</b> 로 확대·축소합니다.</div>'));
    }

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
    walk.onclick = () => { this.view.fp.toggle(); this.renderPanel(); };
    box.appendChild(walk);
    box.appendChild(el('div', 'item',
      '<div class="d">왼쪽 아래 <b>조이스틱</b>으로 걷고, 화면을 끌면 시점이 돈다. 데스크톱은 <kbd>WASD</kbd>.</div>'));

    const sv = el('button', 'btn wide sm', '저장하기');
    sv.onclick = () => { g.save(); this.toast('저장했습니다.', 'good'); };
    box.appendChild(sv);
    const rs = el('button', 'btn wide sm danger', '처음부터 다시');
    rs.onclick = () => {
      this.confirm('처음부터 다시 시작할까요?', '지금까지의 회사 기록이 모두 사라집니다.',
        () => location.reload(),
        () => { try { Game.clearSave(); } catch (e) { /* ignore */ } });
    };
    box.appendChild(rs);

    this.panelDevTools(box);

    /* 기록 */
    box.appendChild(el('h4', 'sec', '기록'));
    for (const l of g.log.slice(0, 22)) {
      const col = l.kind === 'good' ? 'var(--good)' : l.kind === 'bad' ? 'var(--bad)' : 'var(--dim)';
      box.appendChild(el('div', 'item',
        `<div class="d" style="color:${col}"><b style="opacity:.6">${l.at}</b> — ${l.text}</div>`));
    }
  }

  /* ---------- 테스트 도구 ----------
     후반부 화면(2층 이후, 높은 랭크의 상점·플랫폼)을 직접 눌러 보려면
     지금은 몇 시간을 플레이해야 한다. 만드는 쪽에서도 노는 쪽에서도 그건
     확인이 아니라 고행이다. 그래서 손잡이를 몇 개 밖으로 낸다.

     숨기지 않고 회사 탭 맨 아래에 그냥 둔다. 이 게임에는 순위표도 대전도
     없고, 감춘 치트는 결국 "어떻게 켜더라" 를 따로 외우게 만들 뿐이다. */
  panelDevTools(box) {
    const g = this.g, c = g.company;
    box.appendChild(el('h4', 'sec', '테스트 도구'));
    box.appendChild(el('div', 'item',
      `<div class="d">아직 못 가 본 화면을 바로 열어 보기 위한 버튼입니다.
        <b>2층</b>은 랭크 5, <b>3층</b>은 랭크 9부터 허가되고 돈으로 삽니다.
        지금 랭크 ${c.rank} · 허가된 층 ${c.maxFloors || 1}층 · 입주 ${c.floors}층.</div>`));

    const row = (label, fn) => {
      const b = el('button', 'btn wide sm', label);
      b.onclick = () => { fn(); this.renderAll(); };
      box.appendChild(b);
    };
    row('💵 자금 +₩1,000,000', () => {
      const r = g.cheatMoney(1_000_000);
      this.toast(`자금 ${won(r.money)}`, 'good');
    });
    row('⭐ 랭크 +1', () => {
      const r = g.cheatRankUp(1);
      this.toast(`랭크 ${r.rank} · ${r.maxFloors}층까지 허가`, 'good');
    });
    row('🏢 2층 바로 열기 (랭크 5 + 자금)', () => {
      this._quietRank = true;
      try {
        while (g.company.rank < 5) g.cheatRankUp(1);
        g.cheatMoney(Math.max(0, g.nextFloorCost() - g.company.money) + 200000);
      } finally { this._quietRank = false; }
      const r = g.buyFloor();
      this.toast(r.ok ? `랭크 ${g.company.rank} · 2층 입주 완료. 오른쪽 층 버튼으로 올라가세요.` : (r.why || '실패'),
        r.ok ? 'good' : 'bad');
    });
    row('🪙 코인 +10', () => { const r = g.cheatCoins(10); this.toast(`코인 ${r.coins}`, 'good'); });
    row('⚡ 스태미나·체력 회복', () => { g.cheatStamina(); this.toast('회복했습니다.', 'good'); });
  }

  /* ---------- 직원 ---------- */
  panelStaff(box) {
    const g = this.g, info = g.info();

    box.appendChild(el('h4', 'sec', `직원 ${g.staff.length} / ${info.staffCap}명`));
    if (!g.staff.length) {
      box.appendChild(el('div', 'item',
        '<div class="d">아직 직원이 없습니다. 아래에서 채용하세요. '
        + '<b>빈 책상이 있어야</b> 뽑을 수 있으니, 사무실 탭에서 책상을 먼저 사고 배치하세요.</div>'));
    }
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

    const free = g.freeDesks();
    const disc = hireDiscount(g.company.rank);
    box.appendChild(el('h4', 'sec',
      `채용 <span class="hint">빈 책상 ${free}자리${disc < 1 ? ` · 신입 할인 -${Math.round((1 - disc) * 100)}%` : ''}</span>`));
    if (free <= 0) {
      box.appendChild(el('div', 'item',
        '<div class="d" style="color:var(--warn)">빈 책상이 없습니다. 사무실 탭에서 책상을 사서 배치하면 채용할 수 있습니다.</div>'));
    }
    if (!g.candidates.length) {
      box.appendChild(el('div', 'item', '<div class="d">지금은 지원자가 없다. 다음 주에 다시 확인하세요.</div>'));
    }
    for (const cand of g.candidates) {
      const ab = abilities(cand);
      const it = el('div', 'item');
      const traitTags = traitsOf(cand)
        .map((t) => `<span class="pill" title="${t.desc}">${t.ko}</span>`).join('');
      it.innerHTML = `<div class="t"><span class="n">${cand.name}</span>
        <span class="j">Lv.${cand.level}${cand.rookie ? ' · <span class="pill great">신입</span>' : ''}</span></div>
        <div class="d"><span class="pill ${role(cand)}">${JOBS[cand.job].ko}</span>${traitTags}<br>
        기획 ${ab.plan} · 개발 ${ab.prog} · 그래픽 ${ab.graph} · 사운드 ${ab.sound} · 소셜 ${ab.social}<br>
        재능 ×${cand.talent.toFixed(2)} · 주급 ${won(cand.salary * 0.6)}</div>`;
      for (const t of traitsOf(cand)) {
        it.appendChild(el('div', 'd', `<span style="color:var(--dim);font-size:10px">· ${t.ko}: ${t.desc}</span>`));
      }
      const b = el('button', 'btn sm', `채용 ${won(cand.hireCost)}`);
      b.style.marginTop = '6px';
      b.disabled = g.company.money < cand.hireCost || g.staff.length >= info.staffCap || free <= 0;
      b.onclick = () => {
        const r = g.hire(cand.id);
        if (!r.ok) this.toast(r.why, 'bad');
        this.renderTutorial();
        g.save();
      };
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
    // The five abilities share one axis so they can be compared with each
    // other; the driving ability for this person's job is highlighted, because
    // it is the only one the battle multiplies by.
    const drive = JOB_ABILITY[s.job];
    for (const [k, ko] of [['plan', '기획'], ['prog', '개발'], ['graph', '그래픽'], ['sound', '사운드'], ['social', '소셜']]) {
      d.appendChild(el('div', 'wrap',
        bar(ko, ab[k], ABILITY_MAX, { cls: k === drive ? 'drive' : '' })));
    }
    if (s.level < s.maxLevel) {
      const need = expToNext(s);
      const have = s.exp || 0;
      d.appendChild(el('div', 'wrap', bar('경험치', have, need, { cls: 'exp', text: `${have}/${need}` })));
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

    /* ---------- 직원 강화 ----------
       레벨은 "전체적으로 얼마나 크는가" 만 정한다. 강화는 그 위에 얹는
       **방향**이다 — 같은 프로그래머라도 체력을 올려 오래 버티게 할지,
       공격력을 올려 세게 치게 할지, 미술을 올려 임팩트를 밀게 할지. */
    d.appendChild(el('h4', 'sec', '강화 (돈으로 사는 영구 강화)'));
    const ups = el('div', 'upg');
    for (const u of upgradeList(s)) {
      const row = el('div', 'upr' + (u.maxed ? ' max' : ''));
      row.innerHTML = `<span class="e">${u.emoji}</span>
        <span class="m"><span class="t">${u.ko} <i>${u.level}/${u.max}</i></span>
        <span class="d">${u.unit}</span></span>`;
      const b = el('button', 'btn sm', u.maxed ? 'MAX' : won(u.cost));
      b.disabled = u.maxed || g.company.money < u.cost;
      b.onclick = (ev) => {
        ev.stopPropagation();
        const r = g.upgradeStaff(s.id, u.id);
        if (!r.ok) this.toast(r.why, 'bad');
        g.save();
      };
      row.appendChild(b);
      ups.appendChild(row);
    }
    d.appendChild(ups);

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
    mk.onclick = async () => {
      this._quietLog = true;
      const r = g.makeProposal();
      this._quietLog = false;
      if (!r.ok) { this.toast(r.why, 'bad'); return; }
      g.save();
      // 어떤 장르가 나왔는지가 기획서의 절반이다. 그 절반을 룰렛으로 돌린다.
      const idx = Math.max(0, GENRES.findIndex((x) => x.id === r.proposal.genreId));
      const gen = GENRES[idx];
      await this.spinRoulette('📝 기획서 장르', GENRES.map((x) => x.ko), idx,
        `${gen.ko} · ★${r.proposal.grade}`);
      this.toast(`「${r.proposal.title}」 ${gen.ko} ★${r.proposal.grade}`, 'good');
    };
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
      // 매출 상한이 높은 모델은 만드는 값도 비싸다. 그 값을 고르는 자리에서
      // 바로 보여주지 않으면, 착수 버튼 위의 개발비가 왜 뛰었는지 알 수 없다.
      const extra = m.cost && m.cost > 1
        ? `<span class="j">개발비 ×${m.cost.toFixed(2)}${m.stam ? ` · 스태미나 +${m.stam}` : ''}</span>` : '';
      it.innerHTML = `<div class="t"><span class="n">${m.ko}</span>${extra}</div>
        <div class="d">${m.desc}</div>`;
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

    const seriesOf = d.seriesOfId ? g.releases.find((r) => r.id === d.seriesOfId) : null;
    const seriesN = seriesOf ? seriesOf.seriesN + 1 : 1;
    // 미리보기와 착수가 **같은 함수**를 본다. 각자 계산하면 수익 모델의
    // 배율이 한쪽에만 붙어 숫자가 어긋난다.
    const cost = devCostOf({
      platformId: d.platformId, grade: pr.grade, seriesN, monetizeId: d.monetizeId,
    });
    const stam = devStaminaCost({
      platformId: d.platformId, grade: pr.grade, seriesN, monetizeId: d.monetizeId,
    });
    box.appendChild(el('div', 'row', `<span>개발비</span><b>${won(cost)}</b>`));
    // 스태미나는 여기서만 나간다. 전투는 직원들의 체력으로 한다.
    box.appendChild(el('div', 'row',
      `<span>착수 스태미나</span><b class="${g.company.stamina < stam ? 'warn' : ''}">${stam} / 보유 ${g.company.stamina}</b>`));

    const go = el('button', 'btn primary wide', '개발 시작');
    go.disabled = !d.teamIds.length || g.company.money < cost || g.company.stamina < stam;
    go.onclick = () => {
      const r = g.beginDevelopment(d);
      if (!r.ok) { this.toast(r.why, 'bad'); return; }
      this.draft = null;
      this.view.startWork(g.project.team);
      this._kickoff(g.project);
      this.renderTutorial();
      g.save();
    };
    box.appendChild(go);

    // 상대는 세 마리다. 무엇을 잡게 되는지 착수 전에 보여준다 — 세 번째는
    // 언제나 마감이고, 두 번째는 첫 놈을 잡은 뒤 고를 조합이 이름을 준다.
    const rounds = raidRounds({
      genreId: pr.genreId, platformId: d.platformId, grade: pr.grade, seriesN,
    });
    const boss1 = bossFor(pr.genreId);
    const names = [boss1.ko, '조합 보스 (내용 선택 후 결정)', '마감 데몬'];
    const icons = ['🐱', '👹', '👿'];
    box.appendChild(el('div', 'item',
      `<div class="t"><span class="n">3연전</span><span class="j">약 ${rounds}라운드</span></div>
       <div class="d">${BOSS_STAGES.map((st, i) =>
        `${icons[i]} <b>${names[i]}</b> <span style="color:var(--dim)">— ${st.ko}</span>`).join('<br>')}
       <br><br>보스는 <b>직원들이 자동으로</b> 공격해서 잡습니다. 전투에는 스태미나가 들지 않고,
       직원들의 <b>체력</b>이 줄어듭니다.</div>`));
  }

  async _kickoff(p) {
    if (this.busy) return;
    this.busy = true;
    try { await this.view.playMeeting('kickoff', p.team, this.mvars(p)); }
    finally { this.busy = false; this.renderBattle(); }
    // 착수 회의가 끝나면 곧장 세트장으로 넘어간다. 보스는 아레나 안에만
    // 있으므로, 여기서 사무실 카메라로 "상대를 보여주는" 컷은 이제 없다.
    this.enterArena();
    this.toast(`${(p.boss || bossFor(p.genreId)).ko} 등장!`, 'good');
  }

  panelInDev(box) {
    const g = this.g, p = g.project;
    ensureStages(p);
    const gen = GENRES.find((x) => x.id === p.genreId);
    const st = currentStage(p);
    box.appendChild(el('h4', 'sec', `개발 중 — ${st.name || st.ko}`));
    box.appendChild(el('div', 'item',
      `<div class="t"><span class="n">「${p.title}」</span><span class="stars">${stars(p.proposal.grade)}</span></div>
       <div class="d">${gen.ko} · ${PLATFORMS.find((x) => x.id === p.platformId).ko} · ${MONETIZE.find((x) => x.id === p.monetizeId).ko}</div>`));

    const arena = el('button', 'btn primary wide', '⚔ 전투 화면으로');
    arena.onclick = () => this.enterArena();
    box.appendChild(arena);

    // 세 마리의 사다리. 어디까지 왔는지가 한눈에 보여야 한다.
    const icons = ['🐱', '👹', '👿'];
    box.appendChild(el('div', 'item',
      `<div class="t"><span class="n">보스 ${(p.stage || 0) + 1} / ${p.stages.length}</span>
         <span class="j">${Math.round(raidProgress(p) * 100)}%</span></div>
       <div class="d">${p.stages.map((x, i) => {
        const done = i < (p.stage || 0);
        const now = i === (p.stage || 0);
        const nm = i <= (p.stage || 0) ? (x.name || x.ko) : (i === 1 ? '???' : (x.name || x.ko));
        return `${icons[i]} ${done ? '<s>' + nm + '</s> ✔' : now ? '<b>' + nm + '</b> ◀' : nm}`;
      }).join('<br>')}</div>`));
    box.appendChild(el('div', 'row', `<span>남은 HP</span><b>${num(p.hp)} / ${num(p.hpMax)}</b>`));
    box.appendChild(el('div', 'row', `<span>라운드</span><b>${p.turn}</b>`));
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

    /* Projected quality, on the same 0-999 axis the finished game will use.
       This is the same curve finishProject applies, fed with the contribution
       accumulated so far — so the bars during development and the bars on the
       results screen mean the same thing, and watching one axis lag behind
       tells you which discipline the team is missing while there is still time
       to notice.

       Normalising against the biggest of the five, which is what the other
       branch did here, is the bug: the leading axis is pinned at 100% from the
       first turn, so the picture never changes and a weak project looks like a
       strong one. Absolute scale, one ruler. */
    const pg = g.devProgress();
    box.appendChild(el('h4', 'sec',
      `예상 품질 <span class="hint">완성 시 · 재미 ${pg.fun} · 버그 ${pg.bugs}개</span>`));
    for (const st of STATS) {
      box.appendChild(el('div', 'wrap',
        bar(STAT_KO[st], pg.quality[st], QUALITY_MAX, { gamma: QUALITY_GAMMA })));
    }

    box.appendChild(el('h4', 'sec', '팀'));
    for (const id of p.team) {
      const s = g.staff.find((x) => x.id === id);
      if (!s) continue;
      const it = el('div', 'item');
      it.innerHTML = `<div class="t"><span class="n">${s.name}</span><span class="j">힘 ${Math.round(power(s))}</span></div>
         <div class="d"><span class="pill ${role(s)}">${JOBS[s.job].ko}</span>의욕 <span class="mot">${s.motivation}</span>
         ${gearOf(s).map((gr) => `<span class="gearpill">${gr.emoji}</span>`).join('')}</div>
         ${this._hpBar(s)}`;
      box.appendChild(it);
    }

    // 지친 팀원이 있으면 바로 밥을 먹일 수 있게 한다.
    const hungry = g.staff.filter((s) => p.team.includes(s.id) && isTired(s));
    if (hungry.length) {
      box.appendChild(el('div', 'item',
        `<div class="d" style="color:var(--warn)">지친 팀원 ${hungry.length}명 — 체력이 낮으면 데미지와 품질이 같이 떨어집니다.
         <b>전원이 쓰러지면 그 단계는 남은 체력째로 마감</b>되고 완성도가 그만큼 깎입니다. 상점의 음식으로 회복하세요.</div>`));
      const go = el('button', 'btn wide sm', '가방 열기');
      go.onclick = () => this.openTab('bag');
      box.appendChild(go);
    }
  }

  panelFinished(box) {
    const g = this.g, p = g.finished;
    box.appendChild(el('h4', 'sec', '완성 — 출시 준비'));
    box.appendChild(el('div', 'item',
      `<div class="t"><span class="n">「${p.title}」</span><span class="stars">${stars(p.proposal.grade)}</span></div>
       <div class="d">${p.genreKo} × ${p.contentKo} · ${p.methodKo}</div>`));
    for (const st of STATS) {
      box.appendChild(el('div', 'wrap', bar(STAT_KO[st], p.quality[st], QUALITY_MAX, { gamma: QUALITY_GAMMA })));
    }
    box.appendChild(el('div', 'row', `<span>평론가</span><b>${p.critics.join(' · ')} = ${p.criticTotal} / 40</b>`));
    box.appendChild(el('div', 'row', `<span>버그</span><b>${p.bugs}개</b>`));
    if (p.forfeits) {
      box.appendChild(el('div', 'row',
        `<span>완성도</span><b class="warn">${Math.round((p.completion || 1) * 100)}% · 탈진 마감 ${p.forfeits}회</b>`));
    }
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
      // 출시 결과는 실시간 판매가 끝나고 정산을 확인할 때 뜬다. 여기서 바로
      // 띄우면 아직 팔리고 있는 게임의 결산을 먼저 읽게 된다.
      if (!r.ok) this.toast(r.why, 'bad');
      g.save();
    };
    box.appendChild(rl);
  }

  /* ---------- 가방 탭 ----------
     소모품·장비는 상점 안에, 가구는 사무실 탭 안에 각각 숨어 있었다. 산
     물건을 찾으려면 어느 화면으로 들어가야 하는지를 외워야 했다는 뜻이다.
     둘을 한 탭으로 모으고, 원래 자리에는 여기로 오는 버튼만 남겼다. */
  panelBagTab(box) {
    this.panelItemBag(box);
    this.panelBag(box);
  }

  /* 가방 탭으로 보내는 한 줄. 상점과 사무실 화면이 같은 것을 쓴다. */
  _bagLink(text) {
    const it = el('div', 'item click', `<div class="d">🎒 ${text} <b>가방 탭</b>에서 쓰거나 배치합니다.</div>`);
    it.onclick = () => this.openTab('bag');
    return it;
  }

  /* ---------- 소모품·장비 가방 ----------
     상점 화면 위에 얹혀 있던 것을 가방 탭으로 옮겼다. 상점에 들어가야만
     가방이 보이면, 밥을 먹이려던 사람이 매번 물건을 파는 화면을 지나야 한다. */
  panelItemBag(box) {
    const g = this.g;
    const bag = g.bagList();
    box.appendChild(el('h4', 'sec', `소모품 · 장비 ${bag.reduce((a, b) => a + b.n, 0)}개`));
    if (!bag.length) {
      box.appendChild(el('div', 'item', '<div class="d">비어 있습니다. 상점 탭에서 사면 여기에 쌓입니다.</div>'));
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
  }

  /* ══════════════════════════════ 상점 ══════════════════════════════
     산 물건은 가방에 들어가고, 쓸 때 효과가 난다. 원작의 상점을 그대로
     옮긴 자리이고, 이 게임에서 돈이 실제로 나가는 두 번째 구멍이다
     (첫 번째는 인건비). */
  panelShop(box) {
    const g = this.g, c = g.company;
    box.appendChild(this._bagLink('산 물건은 🎒 가방 탭에 쌓입니다.'));
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

    this.panelGacha(box);
  }

  /* ---------- 소재 뽑기 ----------
     코인은 그동안 쌓이기만 하고 쓸 데가 없었고, 소재는 반대로 처음부터 전부
     열려 있어서 "만들 수 있는 것이 늘어난다" 는 감각이 없었다. 둘을 붙였다:
     🪙 로 뽑고, 뽑은 소재만 개발 중 '게임 내용' 카드로 나온다. */
  panelGacha(box) {
    const g = this.g, c = g.company;
    const owned = g.ownedContents();
    const locked = g.lockedContents();
    const cost = g.gachaCost();

    box.appendChild(el('h4', 'sec', `소재 뽑기 · 보유 🪙 ${c.coins}`));
    box.appendChild(el('div', 'item',
      `<div class="t"><span class="n">게임 소재</span>
        <span class="j">${owned.length} / ${CONTENTS.length}종</span></div>
       <div class="d">개발 중 <b>게임 내용</b> 카드는 여기서 뽑은 소재 중에서만 나옵니다.
         코인은 게임 출시·새 조합 발견·세일즈 태스크로 모입니다.</div>`));

    const pull = el('button', 'btn wide sm primary',
      locked.length ? `🪙 ${cost} — 소재 뽑기 (남은 ${locked.length}종)` : `🪙 ${cost} — 전부 모았습니다 (연구로 교환)`);
    pull.disabled = c.coins < cost;
    pull.onclick = async () => {
      // 뽑기 전의 후보 목록을 먼저 잡아 둔다. drawContent 가 당첨을 소유 목록으로
      // 옮기고 나면 "무엇들 중에서 뽑혔나" 를 다시 만들 수 없다.
      const pool = g.lockedContents();
      this._quietLog = true;
      const r = g.drawContent();
      this._quietLog = false;
      if (!r.ok) { this.toast(r.why, 'bad'); return; }
      if (r.dup) { this.toast('이미 모두 모았습니다. 연구 포인트로 바꿨습니다.', 'good'); return; }
      const idx = Math.max(0, pool.findIndex((x) => x.id === r.content.id));
      await this.spinRoulette('🎁 소재 뽑기', pool.map((x) => x.ko), idx, `${r.content.ko} 당첨!`);
      this.openModal('소재 뽑기', `🎁 ${r.content.ko}`,
        `<p>새 소재 <b>${r.content.ko}</b> 를 손에 넣었습니다.
          이제 개발 중 게임 내용 카드에 나옵니다.</p>
         <p style="color:var(--dim);font-size:11px;margin-top:6px">남은 소재 ${r.left}종</p>`,
        null, null);
    };
    box.appendChild(pull);

    // 가진 것과 못 가진 것을 한 화면에. 무엇을 노리고 뽑는지가 보여야 한다.
    const chips = el('div', 'gchips');
    for (const ct of CONTENTS) {
      const has = owned.includes(ct.id);
      chips.appendChild(el('span', 'gchip' + (has ? ' on' : ''), has ? ct.ko : '???'));
    }
    box.appendChild(chips);
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
        // 소재는 뽑아서 가지고만 있어도 이름은 보인다. 아직 게임에 써 보지
        // 않았을 뿐이므로 도감 칸은 비워 두되, "무엇을 가졌나" 는 알려 준다.
        const held = key === 'contents' && g.hasContent(x.id);
        const cell = el('div', 'dexc ' + (got ? 'got' : held ? 'held' : 'miss'));
        cell.innerHTML = `<span class="i">${icon}</span><span class="n">${got || held ? x.ko : '???'}</span>`;
        if (key === 'contents' && !got) cell.title = held ? '가지고 있다 — 아직 써 보지 않았다' : '소재 뽑기로 얻는다';
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

    /* 배치 상태 — the office at a glance: seats, who is sitting, how nice it is */
    const cm = g.comfort();
    const lb = comfortLabel(cm.score);
    box.appendChild(el('h4', 'sec', '사무실 현황'));
    for (const [k, v] of [
      ['책상', `${g.deskCount()}개 (빈자리 ${g.freeDesks()})`],
      ['직원', `${g.staff.length}명`],
      ['쾌적도', `<span class="pill ${lb.cls}">${lb.ko}</span> ${cm.score}`],
      ['기획력 보너스', `×${cm.planBonus.toFixed(2)}`],
    ]) box.appendChild(el('div', 'row', `<span>${k}</span><b>${v}</b>`));
    box.appendChild(el('div', 'item',
      '<div class="d">가구를 사면 <b>가방</b>에 들어갑니다. <b>배치</b>를 눌러 바닥의 파란 구역에 놓으세요. '
      + '책상 하나에 직원 한 명이 앉습니다. 쾌적도가 높으면 직원 의욕이 잘 유지되고 기획력이 오릅니다.</div>'));

    box.appendChild(this._bagLink('산 가구는 가방에 들어갑니다.'));
    this.panelFurnitureShop(box);
    this.panelPlaced(box);

    box.appendChild(el('h4', 'sec', '층'));
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

  /* ---------- 가방 ----------
     Bought but not yet standing anywhere. Placing from here is what opens the
     placement mode, so this list is the entry point to the whole system. */
  panelBag(box) {
    const g = this.g;
    box.appendChild(el('h4', 'sec', `가방 ${g.bag.length}개`));
    if (!g.bag.length) {
      box.appendChild(el('div', 'item', '<div class="d">비어 있습니다. 아래 가구점에서 구입하세요.</div>'));
      return;
    }
    // One row per kind rather than per item: six identical desks are six lines
    // of noise, and "place one of these" is the only action any of them offer.
    const groups = new Map();
    for (const b of g.bag) {
      if (!groups.has(b.id)) groups.set(b.id, []);
      groups.get(b.id).push(b);
    }
    for (const [id, items] of groups) {
      const def = FURNITURE_BY_ID.get(id);
      if (!def) continue;
      const it = el('div', 'item');
      it.innerHTML = `<div class="t"><span class="n">${def.ko}</span>
        <span class="j">${items.length}개</span></div><div class="d">${def.desc}</div>`;
      const row = el('div', 'brow2');
      const put = el('button', 'btn sm primary', '배치');
      put.onclick = () => {
        if (!this.view.startPlacing(items[0].uid)) return;
        this.togglePanel(true);
        this.renderPlaceBar();
      };
      const sell = el('button', 'btn sm', `처분 ${won(def.price * RESELL)}`);
      sell.onclick = () => { g.sellFurniture(items[0].uid); g.save(); };
      row.append(put, sell);
      it.appendChild(row);
      box.appendChild(it);
    }
  }

  /* ---------- 가구점 ----------
     이름이 panelShop 이었다. 상점 탭이 쓰는 메서드와 이름이 같아서, 클래스
     본문에서 **나중에 선언된 이쪽이 조용히 이겼다** — 상점 탭을 열면 음식도
     장비도 아닌 가구점이 나오고, 장비 시스템 전체가 화면에서 사라져 있었다.
     같은 이유로 카테고리 상태(shopCat)도 두 화면이 나눠 쓰고 있었다. */
  panelFurnitureShop(box) {
    const g = this.g;
    box.appendChild(el('h4', 'sec', '가구점'));
    this.furnCat = this.furnCat || 'work';
    const tabs = el('div', 'chips');
    for (const cat of FURNITURE_CATS) {
      const b = el('button', 'btn sm' + (this.furnCat === cat.id ? ' primary' : ''), cat.ko);
      b.onclick = () => { this.furnCat = cat.id; this.renderPanel(); };
      tabs.appendChild(b);
    }
    box.appendChild(tabs);

    // 모델이 안 왔으면 키트 가구는 아예 팔지 않는다. 돈을 냈는데 바닥에
    // 아무것도 안 서는 것보다는 목록에 없는 편이 낫다.
    const ready = kitReady();
    for (const def of FURNITURE.filter((f) => f.cat === this.furnCat && (ready || !f.kit))) {
      const it = el('div', 'item');
      const tags = [];
      if (def.seats) tags.push('<span class="pill great">자리 +1</span>');
      if (def.comfort) tags.push(`<span class="pill">쾌적 +${def.comfort}</span>`);
      if (def.plan) tags.push('<span class="pill">기획</span>');
      if (def.social) tags.push('<span class="pill">소셜</span>');
      if (def.kit) tags.push('<span class="pill good">수입 가구</span>');
      it.innerHTML = `<div class="t"><span class="n">${def.ko}</span>
        <span class="j">${won(def.price)}</span></div>
        <div class="d">${tags.join('')}<br>${def.desc}</div>`;
      const b = el('button', 'btn sm', '구입');
      b.style.marginTop = '6px';
      b.disabled = g.company.money < def.price;
      b.onclick = () => { const r = g.buyFurniture(def.id); if (!r.ok) this.toast(r.why, 'bad'); g.save(); };
      it.appendChild(b);
      box.appendChild(it);
    }
  }

  /* ---------- 배치된 가구 ----------
     Picking a piece back up is free and always available, so a bad layout is
     never permanent — which is what makes experimenting with one safe. */
  panelPlaced(box) {
    const g = this.g;
    const placed = g.company.placed;
    box.appendChild(el('h4', 'sec', `배치된 가구 ${placed.length}개`));
    if (!placed.length) {
      box.appendChild(el('div', 'item', '<div class="d">아직 아무것도 놓지 않았습니다.</div>'));
      return;
    }
    for (let f = 0; f < g.company.floors; f++) {
      const on = placed.filter((p) => p.floor === f);
      if (!on.length) continue;
      box.appendChild(el('div', 'row',
        `<span>${f + 1}F ${FLOOR_PLANS[f].short}</span><b>${on.length}개</b>`));
      for (const p of on) {
        const def = FURNITURE_BY_ID.get(p.id);
        if (!def) continue;
        const it = el('div', 'combo');
        it.innerHTML = `<span>${def.ko}</span>`;
        const b = el('button', 'btn sm', '회수');
        b.onclick = () => {
          g.pickUpFurniture(p.uid);
          this.view.rebuildFurniture();
          g.save();
        };
        it.appendChild(b);
        box.appendChild(it);
      }
    }
  }

  /* ---------- 배치 모드 툴바 ----------
     Lives outside the panel because the panel is closed while placing: the
     whole point of the mode is to see the floor. */
  renderPlaceBar() {
    const bar2 = $('placebar');
    if (!bar2) return;
    const p = this.view.place;
    if (!p) { bar2.classList.remove('show'); document.body.classList.remove('placing'); return; }

    // Built once and then updated in place: this refreshes on every pointer
    // move, and rebuilding the buttons under the player's finger would drop
    // the drag on some browsers.
    if (!this._pb) {
      const info = el('div', 'pinfo');
      /* 반 칸씩 미는 십자 버튼. 드래그로 반 칸을 조준하는 것은 폰에서
         사실상 불가능하고, 어떤 이유로든 드래그가 안 먹을 때 자리를 바꿀
         유일한 길이기도 하다. 방향은 화면 기준이다. */
      const nudge = el('div', 'pnudge');
      for (const [cls, u, v, ch] of [
        ['nu', 0, 1, '▲'], ['nl', -1, 0, '◀'], ['nr', 1, 0, '▶'], ['nd', 0, -1, '▼'],
      ]) {
        const b = el('button', 'nb ' + cls, ch);
        b.setAttribute('aria-label', '반 칸 옮기기');
        b.onclick = () => { this.view.nudgePlace(u, v); this.renderPlaceBar(); };
        nudge.appendChild(b);
      }
      const rot = el('button', 'btn sm', '⟳ 회전');
      rot.onclick = () => { this.view.rotatePlace(); this.renderPlaceBar(); };
      const ok = el('button', 'btn sm primary', '여기에 놓기');
      ok.onclick = () => {
        const r = this.view.commitPlace();
        if (!r.ok) { this.toast(r.why || '실패', 'bad'); return; }
        this.g.save();
        this.renderPlaceBar();
        this.renderPanel();
        this.renderTutorial();
        this.toast('배치했습니다.', 'good');
      };
      const cancel = el('button', 'btn sm danger', '취소');
      cancel.onclick = () => { this.view.stopPlacing(); this.renderPlaceBar(); this.togglePanel(false); };
      bar2.innerHTML = '';
      bar2.append(info, nudge, rot, ok, cancel);
      this._pb = { info, nudge, rot, ok, cancel };
    }
    bar2.classList.add('show');
    const def = FURNITURE_BY_ID.get(p.id);
    this._pb.info.innerHTML = `<b>${def ? def.ko : ''}</b>`
      + `<span class="${p.valid ? 'ok' : 'no'}">${p.valid ? '놓을 수 있습니다' : (p.why || '여기엔 안 됩니다')}</span>`;
    this._pb.ok.disabled = !p.valid;
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
            onPick: () => {
              this.g.pickCard(o.id);
              this.g.save();
              this.showFusion(o);
              this._backToArena();
            },
          };
        }));
    } else {
      this.openModal('회의 · 개발 방식', '어떻게 만들까?',
        '남은 HP를 깎는 속도와 품질 상승폭이 달라집니다.',
        pc.options.map((o) => ({
          name: o.ko, desc: o.desc,
          onPick: () => { this.g.pickCard(o.id); this.g.save(); this._backToArena(); },
        })));
    }
  }

  /* ---------- 합성 ----------
     내용을 고른 그 자리에서 장르와 합쳐 보여준다. 고르기 전에는 처음 해보는
     조합의 궁합을 감추지만(그게 발견의 재미다), 고르고 나면 무엇을 만들게
     됐는지는 알려줘야 한다 — 그게 두 번째 보스의 정체이기 때문이다. */
  showFusion(opt) {
    const p = this.g.project;
    if (!p) return;
    const gen = GENRES.find((x) => x.id === p.genreId);
    const c = CONTENTS.find((x) => x.id === p.contentId) || { ko: opt.ko };
    const score = comboScore(p.genreId, p.contentId);
    const lb = comboLabel(score);
    const first = !this.knownCombo(p.genreId, p.contentId);
    const st = p.stages && p.stages[1];
    const verdict = score >= 1.35
      ? '팀 전체가 손뼉을 쳤다. 이건 된다.'
      : score >= 1.12 ? '나쁘지 않다. 잘 다듬으면 물건이 된다.'
      : score >= 0.95 ? '무난하다. 결국은 만듦새 싸움이다.'
      : '어울리지 않는다. 각오하고 만들어야 한다.';
    this.openModal('합성', `${gen ? gen.ko : ''} × ${c.ko}`,
      `<div class="fuse">
         <span class="fz">${gen ? gen.ko : ''}</span>
         <span class="fx">✚</span>
         <span class="fz">${c.ko}</span>
         <span class="fx">➜</span>
         <span class="fz gold">${st ? st.name : '조합 보스'}</span>
       </div>
       <div class="grade" style="font-size:26px">×${score.toFixed(2)}</div>
       <div class="gsub"><span class="pill ${lb.cls}">${lb.ko}</span>${first ? ' · <b>새로운 조합!</b>' : ''}</div>
       <p style="font-size:12px;line-height:1.6;margin-top:10px">${verdict}</p>
       <p style="color:var(--dim);font-size:11px;margin-top:6px">
         궁합은 데미지와 품질에 함께 곱해집니다. 출시하면 도감에 남습니다.</p>`);
  }

  showFinished(p) {
    const q = p.quality;
    // The best axis of the studio's previous release is marked on each bar, so
    // "is this better than last time" is answerable without remembering.
    const prev = this.g.releases[0];
    const bars = STATS.map((st) =>
      bar(STAT_KO[st], q[st], QUALITY_MAX,
        prev && prev.quality
          ? { mark: prev.quality[st], gamma: QUALITY_GAMMA }
          : { gamma: QUALITY_GAMMA })).join('');
    this.openModal('개발 완료', `「${p.title}」`,
      `<div class="grade">${p.criticTotal}</div>
       <div class="gsub">평론가 ${p.critics.join(' · ')} (40점 만점)${p.hallOfFame ? ' · <b class="stars">명예의 전당</b>' : ''}</div>
       ${bars}
       <div class="row"><span>장르 × 내용</span><b>${p.genreKo} × ${p.contentKo}</b></div>
       <div class="row"><span>개발 방식</span><b>${p.methodKo}</b></div>
       <div class="row"><span>궁합</span><b>×${p.combo.toFixed(2)}</b></div>
       <div class="row"><span>버그</span><b>${p.bugs}개</b></div>
       <div class="row"><span>번뜩임</span><b>${p.crits}회</b></div>
       ${p.forfeits ? `<div class="row"><span>탈진 마감</span><b class="warn">${p.forfeits}회 · 완성도 ${Math.round((p.completion || 1) * 100)}%</b></div>
       <div class="verd bad">팀이 쓰러진 채로 마감한 단계가 있다. 그만큼 덜 만들어졌다.</div>` : ''}
       <p style="color:var(--dim);font-size:11px;margin-top:9px">다음은 홍보입니다. 확인을 누르면 바로 고릅니다.</p>`,
      null, () => this.showMarketing());
  }

  /* ---------- 홍보 → 출시 ----------
     보스를 다 잡아도 화면에는 "개발 탭에서 홍보를 고르고 출시하세요" 라는
     한 줄만 떴다. 처음 하는 사람은 그 탭을 찾아 들어가야 한다는 것을 모르고,
     완성한 게임이 그대로 책상에 남았다. 이제 결과창을 닫으면 홍보 선택이
     바로 이어서 뜬다 — 개발 탭은 다시 고르고 싶을 때만 가면 된다. */
  showMarketing() {
    const g = this.g, p = g.finished;
    if (!p) return;
    this.openTab('dev');
    const opts = MARKETING.map((mk) => {
      const price = g.marketingPrice(mk.id);
      const poor = price > g.company.money;
      return {
        name: mk.ko + (poor ? ' (자금 부족)' : ''),
        desc: `${mk.desc} · 유저 ×${mk.users.toFixed(2)} · 팬 ×${mk.fans.toFixed(2)}`,
        right: `<b>${price ? won(price) : '무료'}</b>`,
        onPick: () => {
          if (poor) { this.toast('홍보비가 모자랍니다', 'bad'); this.showMarketing(); return; }
          g.setMarketing(mk.id);
          g.save();
          this.renderPanel();
          this.confirmRelease();
        },
      };
    });
    this.openModal('홍보', `「${p.title}」 어떻게 알릴까?`,
      `홍보비를 많이 쓸수록 초기 유저가 늘어납니다. 버그가 남았다면
       <b>개발 탭</b>에서 디버그를 먼저 하고 와도 됩니다.
       <div class="row"><span>남은 버그</span><b>${p.bugs}개</b></div>
       <div class="row"><span>평론가</span><b>${p.criticTotal} / 40</b></div>`,
      opts);
  }

  confirmRelease() {
    const g = this.g, p = g.finished;
    if (!p) return;
    const mk = MARKETING.find((m) => m.id === g.company.marketingId) || MARKETING[0];
    const price = g.marketingPrice(mk.id);
    this.openModal('출시', `「${p.title}」 지금 출시할까요?`,
      `<div class="row"><span>홍보</span><b>${mk.ko}</b></div>
       <div class="row"><span>홍보비</span><b>${price ? won(price) : '무료'}</b></div>
       <p style="color:var(--dim);font-size:11px;margin-top:8px">
         출시하면 화면 오른쪽에서 <b>실시간 판매</b>가 시작됩니다. 화면을 막지 않으므로
         그동안에도 기획서를 뽑거나 직원을 키울 수 있습니다.</p>`,
      [
        {
          name: '출시하기',
          desc: '판매를 시작합니다',
          onPick: () => {
            const r = g.release();
            if (!r.ok) { this.toast(r.why, 'bad'); return; }
            g.save();
          },
        },
        { name: '조금 더 다듬기', desc: '개발 탭에서 디버그하고 나중에 출시', onPick: () => this.openTab('dev') },
      ]);
  }

  showRelease(r, run) {
    const notes = (r.notes || [])
      .map((n) => `<div class="verd ${n.cls}">${n.ko}</div>`).join('');
    this.openModal('출시', `「${r.title}」 출시!`,
      `<div class="grade">${run ? won(run.total) : num(r.users)}</div>
       <div class="gsub">${run ? `${run.done}주 누적 매출` : '초기 유저'}${r.trendHit ? ' · 🔥 유행을 탔다' : ''}</div>
       ${run ? `<div class="row"><span>초기 유저</span><b>${num(r.users)}</b></div>` : ''}
       ${notes}
       <div class="row"><span>플랫폼</span><b>${PLATFORMS.find((p) => p.id === r.platformId).ko}</b></div>
       <div class="row"><span>수익 모델</span><b>${MONETIZE.find((m) => m.id === r.monetizeId).ko}</b></div>
       <div class="row"><span>홍보</span><b>${(MARKETING.find((m) => m.id === r.marketingId) || {}).ko || '없음'}</b></div>
       <div class="row"><span>평론가</span><b>${r.criticTotal}점</b></div>
       <div class="row"><span>남은 버그</span><b>${r.bugs}개</b></div>
       <p style="color:var(--dim);font-size:11.5px;margin-top:10px">
         남은 수명은 화면 오른쪽 <b>판매 현황</b>에서 계속 이어집니다.
         주를 넘길 때마다 조금씩 더 들어옵니다.</p>`);
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
