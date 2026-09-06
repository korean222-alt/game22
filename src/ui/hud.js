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
  shopItem,
  EXHAUST, ABILITY_KO, starText, starOf, weaponFor,
} from '../game/data.js';
import { helperSkillText } from '../game/helpers.js';
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
  previewQuality, funScore, canUrge, comboMult, URGE,
} from '../game/project.js';
import { TUTORIAL } from '../game/tutorial.js';
import { STAMINA_REGEN } from '../game/state.js';
import { giftText } from '../game/mail.js';
import { AWARD_CATS, AWARD_GRADES, EXPO_PLANS, awardBar } from '../game/awards.js';
import { monsterFor, monsterForStage } from '../game/monsters.js';
import { rewardText } from '../game/events.js';
import { FLOOR_PLANS } from '../world/office.js';
import { arenaSetFor } from '../world/arena.js';
import { kitReady } from '../world/kit.js';
import { isTouch, isFullscreen, goFullscreen, exitFullscreen, wireInstallGuide } from './device.js';
import { sfx, soundOn, setSound } from './sound.js';

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

/* ---- 개발의 세 공정 ----
   보스 세 마리는 사실 게임 하나의 세 공정이다. 장르 보스는 뼈대를 세우는
   기간이고, 조합 보스는 소재를 얹어 살을 붙이는 기간이고, 마감 보스는
   출시일을 앞두고 남은 것을 밀어 넣는 기간이다. 그 대응을 화면에 적어 두지
   않으면 "왜 괴물을 세 마리 잡아야 하는가" 에 답이 없다. */
const DEV_PHASES = [
  { ko: '기획', desc: '뼈대를 세우는 중 — 장르가 정해졌고 아직 형태가 없다' },
  { ko: '제작', desc: '살을 붙이는 중 — 고른 소재로 내용을 채운다' },
  { ko: '마감', desc: '출시 준비 중 — 남은 것을 밀어 넣고 다듬는다' },
];

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
    this._wireSalesFold();

    game.on((type, payload) => this._onGameEvent(type, payload));
    this.renderAll();
  }

  /* ---------- wiring ---------- */
  /* 탭은 두 곳에 산다 — 위 줄과 오른쪽 세로 레일. 둘 다 .tabbtn 이라
     선택은 한 번에 끝나고, 어느 쪽을 눌러도 나머지 전부의 on 이 꺼진다. */
  _wireTabs() {
    for (const t of document.querySelectorAll('.tabbtn')) {
      t.onclick = () => this.openTab(t.dataset.tab);
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
    // 처음 들어오는 사람에게는 이 화면이 무엇인지부터 말한다. 한 번만.
    if (!g.company.devIntroSeen) { this.showDevIntro(); return false; }
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

  /* 개발 화면이 무엇인지 한 번만 설명한다.

     "갑자기 보스를 잡으니 뭔가 이상하다" 는 말이 정확했다: 경영 시뮬레이션을
     하다가 사무실에 괴물이 나타나면, 그게 게임 개발의 은유라는 것을 알 길이
     없다. 그래서 첫 진입에 대응표를 한 장 보여준다 — 보스는 아이디어, 체력은
     남은 작업량, 때리는 것은 만드는 것. */
  showDevIntro() {
    const p = this.g.project;
    this.openModal('개발 시작', `「${p ? p.title : ''}」 개발에 들어갑니다`,
      `<p style="font-size:12px;line-height:1.75">
         다음 화면은 <b>전투가 아니라 개발 현장</b>입니다. 아직 형태가 없는
         <b>아이디어</b>를 팀이 붙들고 씨름해서 게임으로 만듭니다.</p>
       <div class="dvmap">
         <div><span class="k">👾 아이디어</span><span class="v">아직 게임이 아닌 기획</span></div>
         <div><span class="k">체력 바</span><span class="v">남은 작업량</span></div>
         <div><span class="k">직원의 공격</span><span class="v">만들어 낸 분량</span></div>
         <div><span class="k">✨ 번뜩임</span><span class="v">좋은 아이디어가 나온 순간</span></div>
         <div><span class="k">반격</span><span class="v">사양 변경 · 버그 · 납기 압박</span></div>
       </div>
       <p style="font-size:11.5px;line-height:1.7;color:var(--dim);margin-top:9px">
         공정은 <b>기획 → 제작 → 마감</b> 셋입니다. 팀의 체력이 다 떨어지면
         그 공정은 못 만든 채로 마감되고, 완성도가 그만큼 깎입니다.
         상점의 <b>음식</b>으로 체력을 채워 주세요.</p>`,
      null, () => {
        this.g.company.devIntroSeen = true;
        this.g.save();
        this.enterArena();
      });
  }

  exitArena() {
    if (!document.body.classList.contains('arena')) return;
    document.body.classList.remove('arena');
    document.body.classList.remove('rest');
    document.body.classList.remove('combo');
    /* 세트장에서 **먼저** 빠져나온다. 순서가 중요하다: 아래의 pauseBattle 은
       이벤트를 쏘고, 그 이벤트를 받은 쪽은 body 에서 arena 클래스가 이미
       사라진 것을 보고 "사무실이구나" 하고 회의 연출을 건다. 그때 카메라는
       아직 700 유닛 밖 세트장에 있으므로 회의가 그 좌표를 '원래 자리' 로
       저장하고, 회의가 끝나면 거기로 되돌아간다 — 사무실은 화면 밖이고
       세트장은 이미 지워졌으니 남는 것은 빈 화면이다. 그것이 "흰 화면" 의
       정체였다. */
    this.view.exitArena();
    // 사무실로 나가면 탈진 유예도 멈춘다. 보이지 않는 곳에서 마감이 걸리면
    // 돌아왔을 때 무슨 일이 있었는지 알 방법이 없다.
    if (this.g.project) this.g.project.exhaustT = 0;
    // 사무실로 돌아가면 전투는 멈춘다. 보이지 않는 곳에서 체력이 녹으면
    // 돌아왔을 때 무슨 일이 있었는지 알 방법이 없다.
    this.g.pauseBattle(true);
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
      sfx('clear');
    } else if (ev.kind === 'stageStart') {
      this.arenaLog(`${ev.name} 등장!`, 'bad');
      this._flash();
      this.renderArena(true);
    } else if (ev.kind === 'boss') {
      // 전체기는 그렇게 보여야 한다. 한 명만 맞는 것과 전원이 맞는 것이
      // 같은 줄로 지나가면 반격의 종류가 있다는 사실 자체가 안 보인다.
      const who = ev.all ? '전체' : (ev.hits || []).map((h) => h.name).join('·');
      this.arenaLog(`${ev.all ? '💥 ' : ''}${ev.ko}${who ? ` → ${who}` : ''} — ${ev.line}`, 'bad');
      sfx('boss');
    } else if (ev.kind === 'crit') {
      this.arenaLog(`✨ ${ev.name} 번뜩임! ${ev.stat ? `${STAT_KO[ev.stat]} +${num(ev.gain)}` : num(ev.damage)}`, 'good');
      this._arenaHit(ev);
    } else if (ev.kind === 'hit') {
      this._arenaHit(ev);
      /* 만들어지고 있다는 것이 글자로도 흘러야 한다.

         한 방마다 한 줄씩 흘리면 초당 서너 줄이라 아무것도 안 읽힌다.
         네 번에 한 줄이면 "누가 무엇을 얼마나 만들고 있다" 가 눈에 남으면서
         로그가 흘러가는 속도는 읽을 만하다. */
      this._hitN = (this._hitN || 0) + 1;
      if (this._hitN % 4 === 0 && ev.stat) {
        this.arenaLog(`${ev.name}(${ev.job}) — ${STAT_KO[ev.stat]} +${num(ev.gain)}`);
      }
    } else if (ev.kind === 'down') {
      this.arenaLog(`${ev.name} 쓰러짐`, 'bad');
      sfx('down');
    } else if (ev.kind === 'revive') {
      this.arenaLog(ev.stage ? `${ev.name} 겨우 일어섰다 (피 한 칸)` : `${ev.name} 복귀`, 'good');
    } else if (ev.kind === 'exhausted') {
      this.arenaLog('팀 전원 탈진 — 밥을 먹이지 않으면 이대로 마감됩니다', 'bad');
      this.renderRest(ev.grace);
    } else if (ev.kind === 'forfeit') {
      this.arenaLog(`${ev.name} — ${ev.left}% 를 남긴 채 마감`, 'bad');
      this._flash();
    } else if (ev.kind === 'comboEnd') {
      // 배율이 조용히 사라지면 "갑자기 약해졌다" 로 보인다. 한 줄로 알린다.
      if (ev.combo >= 3) this.arenaLog(`${ev.combo}연속 종료`, 'bad');
    } else if (ev.kind === 'helperHit') {
      // 도우미가 친 한 방. 직원의 타격과 같은 자리에서 터져야 "지금 이게
      // 통했다" 가 눈에 남는다.
      this._flash();
      sfx('clear');
    } else if (ev.kind === 'loot') {
      this.arenaLog(`🎁 ${starText(ev.star)} ${ev.emoji} ${ev.ko}`,
        ev.star >= 4 ? 'big' : 'good');
      sfx('loot');
      if (ev.star >= 4) this._flash();
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
      this.renderDevHead(p, stage);
      this._aParty = null;   // 파티 카드도 다시 짓는다
    }

    const frac = Math.max(0, p.hp / Math.max(1, p.hpMax));
    $('aBossHp').style.width = (frac * 100) + '%';
    // 보스의 체력은 사실 **남은 작업량**이다. 숫자만 두면 그냥 HP 로 읽힌다.
    $('aBossHpTx').textContent = `남은 작업 ${num(p.hp)} / ${num(p.hpMax)}`;
    const prog = raidProgress(p);
    $('aTotal').style.width = (prog * 100) + '%';
    const tk = $('aTotalK');
    if (tk) tk.textContent = `게임 완성도 ${Math.round(prog * 100)}%`;
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
           <div class="apx"></div>
           <div class="apcd"></div>`);
        /* 카드를 누르면 그 사람을 재촉한다. 자동 전투에 플레이어가 끼어드는
           유일한 자리이고, 이것이 개발 화면을 "보는 것" 에서 "하는 것" 으로
           바꾼다. 쿨다운 중이면 아무 일도 일어나지 않는다 — 그 사실은
           카드가 가라앉아 있는 것으로 이미 말하고 있다. */
        card.onclick = () => this.urgeStaff(id, card);
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
      // 재촉 쿨다운. 띠가 다 차면 다시 누를 수 있다.
      const since = (p.elapsed || 0) - ((p.urgeAt && p.urgeAt[id]) ?? -99);
      const ready = canUrge(p, s);
      card.classList.toggle('ready', ready);
      card.classList.toggle('cool', !ready && !down);
      const cd = card.querySelector('.apcd');
      if (cd) cd.style.width = ready ? '0%' : Math.min(100, (since / URGE.cool) * 100) + '%';
      const x = card.querySelector('.apx');
      const txt = down ? '쓰러짐' : `체력 ${Math.round(s.hp)}/${s.hpMax}`;
      if (x.textContent !== txt) x.textContent = txt;
    }
    this.renderCombo(p);
    this.renderHelpers();
    this.renderQual(p);
    this.renderTray($('aTray'));
    if (document.body.classList.contains('rest')) this.renderTray($('aRestTray'));
  }

  /* ---------- 개발 머리글 ----------
     "이건 전투가 아니라 게임을 만드는 중" 을 화면에 글자로 적는 자리다.

     처음 보는 사람에게 이 화면은 사무실에 괴물이 나타나 직원들이 때리는
     장면이다. 실제로 일어나는 일은 팀이 아직 형태가 없는 기획을 붙들고
     세 공정을 통과하는 것이고, 보스의 체력은 남은 작업량, 우리가 주는
     피해는 만들어진 분량이다. 그 대응을 말해 주지 않으면 이 화면은 경영
     게임 안에 낀 미니게임처럼 보인다. */
  renderDevHead(p, stage) {
    const gen = GENRES.find((x) => x.id === p.genreId);
    const con = p.contentId ? CONTENTS.find((x) => x.id === p.contentId) : null;
    const t = $('aDevTitle');
    if (t) t.textContent = `「${p.title}」`;
    const meta = $('aDevMeta');
    if (meta) {
      const bits = [gen ? gen.ko : '?'];
      if (con) bits.push(con.ko);
      bits.push(`★${p.proposal ? p.proposal.grade : '?'}`);
      bits.push(`팀 ${p.team.length}명`);
      meta.textContent = bits.join(' · ');
    }
    const box = $('aSteps');
    if (!box) return;
    box.innerHTML = '';
    for (let i = 0; i < DEV_PHASES.length; i++) {
      const ph = DEV_PHASES[i];
      const cls = i < stage ? 'done' : i === stage ? 'on' : '';
      box.appendChild(el('span', 'astep' + (cls ? ' ' + cls : ''),
        `<i>${i + 1}</i>${ph.ko}`));
    }
    const now = DEV_PHASES[Math.min(stage, DEV_PHASES.length - 1)];
    box.appendChild(el('span', 'astepd', now.desc));
  }

  /* ---------- 아레나의 품질 판 ----------
     보스를 때리는 동안 무엇이 쌓이고 있는가. 사무실의 진행 패널은 아레나에서
     비켜서므로, 그 숫자를 여기에 한 줄로 다시 세운다.

     다섯 축은 **점수**로 쓴다. 한동안 비중(%)으로 찍었는데, 그러면 세 가지가
     안 보인다: 지금 이 게임이 절대적으로 얼마나 잘 나오고 있는지, 이번 카드로
     무엇이 얼마나 올랐는지, 그리고 완성 화면에 뜰 숫자가 무엇인지. 비중은
     합이 100 이라 전부 올라도 아무것도 안 움직이는 것처럼 보인다.

     막대만 포화 곡선(999 위의 위치를 감마로 편 것)이다. 데뷔작의 20점을
     선형으로 그리면 2% 라 빈 칸으로 보이는데, 숫자는 정확하니 막대는
     "얼마나 왔는가" 를 눈으로 읽히게 하는 쪽이 낫다. */
  renderQual(p) {
    const box = $('aQual');
    if (!box) return;
    if (!p) { box.innerHTML = ''; box._sig = null; this._qCells = null; return; }
    // 여기는 초당 스무 번 돈다. 버그 추정까지 딸려오는 devProgress() 대신
    // 필요한 것만 뽑는다 — 같은 함수를 쓰므로 값은 그대로다.
    const q = previewQuality(p);
    const best = this.g.company.best || {};
    const vals = { fun: Math.round(funScore(q)) };
    for (const st of STATS) vals[st] = Math.round(q[st] || 0);

    const keys = ['fun', ...STATS];
    // 여섯 줄이 **같은 자로** 그려져야 한다. 재미만 다른 곡선을 쓰던 동안은
    // 재미 11 의 막대가 화제성 9 의 막대보다 짧게 나왔다.
    if (!this._qCells || this._qProj !== p.id) {
      this._qProj = p.id;
      this._qCells = new Map();
      this._qMark = { ...vals };
      this._qMarkT = 0;
      box.innerHTML = '';
      for (const k of keys) {
        const row = el('div', 'q' + (k === 'fun' ? ' fun' : ''),
          `<span class="l">${k === 'fun' ? '재미' : STAT_KO[k]}</span>
           <span class="b"><span class="f"></span></span>
           <span class="d"></span><span class="v">0</span>`);
        box.appendChild(row);
        this._qCells.set(k, {
          row, f: row.querySelector('.f'), d: row.querySelector('.d'), v: row.querySelector('.v'),
        });
      }
    }

    /* 증가분은 **한 번에 한 창씩** 보여준다. 매 프레임 차이를 찍으면 한 방의
       기여가 여섯 줄에 흩어져 소수점으로 흐르고, 결국 아무것도 안 읽힌다.
       0.9초마다 그 창 동안 오른 만큼을 한 숫자로 세운다 — 그게 "지금 몇 점
       오르고 있나" 에 대한 대답이다. */
    const now = performance.now();
    const mark = (this._qMarkT === 0) || (now - this._qMarkT > 900);
    if (mark) this._qMarkT = now;

    let anyRecord = false;
    for (const k of keys) {
      const c = this._qCells.get(k);
      if (!c) continue;
      const v = vals[k];
      // 기록이 아직 없으면(첫 게임) 모든 줄이 신기록이 되어 ★ 가 의미를
      // 잃는다. 비교 대상이 있을 때만 금색으로 칠한다.
      const rec = (best[k] || 0) > 0 && v > best[k];
      if (rec) anyRecord = true;
      if (c._v !== v) { c._v = v; c.v.textContent = num(v); }
      const w = barPct(v, QUALITY_MAX, QUALITY_GAMMA);
      if (c._w !== w) { c._w = w; c.f.style.width = w + '%'; }
      if (c._rec !== rec) { c._rec = rec; c.row.classList.toggle('rec', rec); }
      if (mark) {
        const diff = v - (this._qMark[k] || 0);
        this._qMark[k] = v;
        const txt = diff > 0 ? '+' + num(diff) : '';
        if (c._d !== txt) { c._d = txt; c.d.textContent = txt; }
        c.d.classList.remove('on');
        if (txt) { void c.d.offsetWidth; c.d.classList.add('on'); }
      }
    }
    $('arena').classList.toggle('record', anyRecord);
  }

  /* ---------- 재촉 ----------
     파티 카드를 눌렀을 때. 규칙은 game/project.js 가 갖고 있고 여기서는
     손끝의 반응만 만든다: 카드가 튀고, 콤보 숫자가 뛰고, 그 사람이 즉시
     한 방 친다 (실제 타격은 다음 tick 이 이벤트로 내보낸다). */
  urgeStaff(id, card) {
    if (!this.inArena()) return;
    const r = this.g.urge(id);
    if (!r.ok) return;
    sfx('combo', r.combo);
    if (card) {
      card.classList.remove('hit');
      void card.offsetWidth;
      card.classList.add('hit');
    }
    const box = $('aCombo');
    if (box) {
      box.classList.remove('bump');
      void box.offsetWidth;
      box.classList.add('bump');
    }
    this.renderCombo(this.g.project);
  }

  /* 개발 화면의 도우미 줄.

     예전에는 "지금 이런 보너스가 걸려 있습니다" 를 알리는 글자였다. 지금은
     **버튼**이다 — 누르면 그 자리에서 버그가 반으로 줄고, 축이 뛰고, 남은
     작업량이 한 뭉치 사라진다. 보스 한 마리에 한 번이므로, 쓰고 나면 흐려진
     채로 다음 공정을 기다린다.

     여기는 초당 스무 번 도는 자리라 내용이 그대로면 DOM 을 건드리지 않는다. */
  renderHelpers() {
    const box = $('aHelp');
    if (!box) return;
    const g = this.g;
    const list = g.helperBonus().list;
    const sig = list.map((h) => h.id + h.level + (g.helperReady(h.id) ? '1' : '0')).join(',');
    if (box._sig === sig) return;
    box._sig = sig;
    box.innerHTML = '';
    for (const h of list) {
      const ready = g.helperReady(h.id);
      const b = el('button', 'ah' + (ready ? ' rdy' : ' used'),
        `<b>${h.def.icon}</b><span class="ahn">${h.def.skill.ko}</span>`);
      b.title = `${h.def.ko} Lv.${h.level} — ${helperSkillText(h.def, h.level)}`;
      b.onclick = () => this.useHelper(h.id, b);
      box.appendChild(b);
    }
  }

  /* 능력을 쓴다. 규칙은 game 이 갖고 있고 여기서는 손끝의 반응만 만든다. */
  useHelper(id, btn) {
    const r = this.g.useHelper(id);
    if (!r.ok) { this.toast(r.why || '지금은 쓸 수 없다', 'bad'); return; }
    sfx('crit');
    if (btn) { btn.classList.remove('fire'); void btn.offsetWidth; btn.classList.add('fire'); }
    // 로그는 game 의 note() 가 이미 아레나 리본으로 흘려보냈다. 여기서 또
    // 찍으면 같은 줄이 두 번 지나간다.
    this.renderHelpers();
  }

  /* 콤보 표시. 0 이면 통째로 비켜선다 — 아무것도 안 하고 있을 때 화면
     아래에 '0 연속' 이 떠 있으면 그건 정보가 아니라 잔소리다. */
  renderCombo(p) {
    const on = !!(p && p.combo > 0);
    document.body.classList.toggle('combo', on);
    if (!on) return;
    const n = $('aComboN'), x = $('aComboX'), bar = $('aComboBar');
    if (n && n.textContent !== String(p.combo)) n.textContent = p.combo;
    if (x) {
      const t = '×' + comboMult(p).toFixed(2);
      if (x.textContent !== t) x.textContent = t;
    }
    if (bar) bar.style.width = Math.max(0, Math.min(1, (p.comboT || 0) / URGE.window) * 100) + '%';
  }

  /* ══════════════════════ 공격 연출 ══════════════════════
     "직원이 때리고 있다" 가 화면에 보여야 한다. 아레나에서 직원의 몸은
     화면에 없으므로 — 세트장은 사무실에서 700 유닛 밖이다 — 아래의 파티
     카드에서 보스가 선 자리로 **자기 도구를 던진다**. 프로그래머는 노트북,
     디자이너는 타블렛, 사운드는 마이크. 무엇을 만들고 있는지가 그림이 된다.

     맞는 순간 충격파가 퍼지고 그 자리에서 점수가 튄다. 회사 최고 기록을
     넘긴 축이면 금색으로. */
  _arenaHit(ev) {
    const layer = $('aFx');
    if (!layer || !this.inArena()) return;
    // 자동 전투는 초당 몇 방씩 나온다. 살아 있는 연출이 너무 많아지면
    // 폰에서 이 층이 프레임을 먹는다 — 넘치면 그냥 건너뛴다.
    if (layer.childElementCount > 14) return;

    const card = this._aCards && this._aCards.get(ev.staffId);
    const from = card ? card.getBoundingClientRect() : null;
    const to = this.view.bossScreen();
    if (!to) return;
    const x0 = from ? from.left + from.width / 2 : to.x;
    const y0 = from ? from.top : window.innerHeight;
    const crit = ev.kind === 'crit';

    const shot = el('div', 'afx' + (crit ? ' crit' : ''), weaponFor(ev.jobId) || '💥');
    layer.appendChild(shot);
    const dur = crit ? 420 : 300;
    // 포물선으로 던진다. 직선으로 가면 던진 것이 아니라 미끄러진 것으로 보인다.
    const arc = -Math.min(150, Math.abs(y0 - to.y) * 0.45 + 40);
    const anim = shot.animate([
      { transform: `translate(${x0}px, ${y0}px) rotate(0deg)`, opacity: 0 },
      { transform: `translate(${(x0 + to.x) / 2}px, ${(y0 + to.y) / 2 + arc}px) rotate(${crit ? 360 : 200}deg)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${to.x}px, ${to.y}px) rotate(${crit ? 720 : 400}deg)`, opacity: 1 },
    ], { duration: dur, easing: 'cubic-bezier(.3,.05,.6,1)' });
    anim.onfinish = () => {
      shot.remove();
      this._arenaImpact(to, ev, crit);
    };
    // 애니메이션이 어떤 이유로든 안 끝나도 층에 쓰레기가 남지 않게 한다.
    setTimeout(() => shot.remove(), dur + 900);
  }

  _arenaImpact(to, ev, crit) {
    const layer = $('aFx');
    if (!layer) return;
    const ring = el('div', 'afxh' + (crit ? ' crit' : ''));
    ring.style.left = to.x + 'px';
    ring.style.top = to.y + 'px';
    layer.appendChild(ring);
    setTimeout(() => ring.remove(), 420);

    if (this.view.boss) this.view.boss.hit(crit ? 1.2 : 0.45);
    // 소리는 **닿는 순간**에 난다. 던지는 순간에 내면 눈과 귀가 어긋난다.
    sfx(crit ? 'crit' : 'hit');

    /* 튀는 숫자는 **점수**다. 남은 작업량은 왼쪽 기둥의 막대가 이미 말하고
       있고, 여기서 알고 싶은 것은 "지금 몇 점 올랐나" 이기 때문이다. */
    const best = (this.g.company.best || {});
    const p = this.g.project;
    const rec = ev.stat && p && (best[ev.stat] || 0) > 0
      ? Math.round(previewQuality(p)[ev.stat] || 0) > best[ev.stat] : false;
    const pop = el('div', 'afxp' + (crit ? ' crit' : '') + (rec ? ' rec' : ''),
      ev.stat
        ? `<span class="k">${STAT_KO[ev.stat]}</span>+${num(ev.gain)}${rec ? ' ★' : ''}`
        : `+${num(ev.damage)}`);
    pop.style.left = (to.x + (Math.random() - 0.5) * 60) + 'px';
    pop.style.top = (to.y - 6 + (Math.random() - 0.5) * 30) + 'px';
    layer.appendChild(pop);
    setTimeout(() => pop.remove(), 1050);
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
      // 정산을 확인하면 한 주가 지나간다. 그 주에 시상식이나 게임덱스가
      // 걸리면 팝업이 먼저 서므로, 판매 결과도 같은 줄에 세운다 —
      // 안 그러면 결과 창이 시상식 위에 덮여서 둘 다 못 읽는다.
      const s = this.g.closeSalesRun();
      if (!s) return;
      const rel = this.g.releases.find((r) => r.id === s.id);
      if (rel) this._pop(() => this.showRelease(rel, s));
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

  /* 한 사람의 상세 화면을 연다. 3D 이름표, 층별 배치 목록, 개발 팀 목록이
     전부 여기로 들어온다 — 이름이 적힌 곳은 어디든 눌리는 것이 맞다. */
  openStaff(id) {
    if (!this.g.staff.some((s) => s.id === id)) return;
    this.selectedStaff = id;
    this.openTab('staff');
    if (this.view.focusStaff) this.view.focusStaff(id);
    // 명단이 길면 고른 카드가 화면 밖에 있다. 열자마자 그 자리로 보낸다.
    requestAnimationFrame(() => {
      const on = document.querySelector('#panel .item.on');
      if (on && on.scrollIntoView) on.scrollIntoView({ block: 'center' });
    });
  }

  openTab(name) {
    const t = document.querySelector(`.tabbtn[data-tab="${name}"]`);
    if (!t) return;
    for (const o of document.querySelectorAll('.tabbtn')) o.classList.remove('on');
    t.classList.add('on');
    this.tab = name;
    this.renderPanel();
    this.togglePanel(false);
  }

  /* ---------- game events ---------- */
  _onGameEvent(type, payload) {
    // 소리는 여기 한 곳에서 붙인다. 액션마다 흩뿌리면 새 액션이 생길 때마다
    // 빠뜨리고, 빠뜨린 것은 아무도 눈치채지 못한다.
    if (type === 'week') sfx('week');
    else if (type === 'release') sfx('release');
    else if (type === 'award') sfx('award');
    else if (type === 'helper') sfx('loot');
    else if (type === 'stamina') sfx('coin');
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
      // 판매가 시작·종료되는 순간에는 개발 탭의 안내(착수 차단, 정산 버튼)도
      // 같이 바뀌어야 한다. 매 주차마다 다시 그리지는 않는다.
      if (this.tab === 'dev' && (!payload || payload.done === 0 || payload.ended)) this.renderPanel();
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
    if (type === 'event' && !payload.resolved) this._pop(() => this._eventFlow());
    // 달이 바뀌며 열리는 것들. 한꺼번에 여러 개가 뜰 수 있으므로 줄을
    // 세운다 — 시상식 결과 위에 게임덱스 초대장이 덮이면 둘 다 못 읽는다.
    if (type === 'award') this._pop(() => this.showAwards(payload));
    // 도우미가 합류했다. 개발 현장 아래의 얼굴 줄도 같이 새로 짓는다.
    if (type === 'helper') {
      this.renderHelpers();
      if (payload && payload.def && !this.inArena()) this._pop(() => this.rollHelper(payload));
    }
    if (type === 'expo') this._pop(() => this.showExpo(payload));
    if (type === 'milestone') this._pop(() => this.showMilestone(payload));
    if (type === 'mail') this.renderBadges();

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
    this.renderBadges();
    this.renderBattle();
    this.renderProgress();
    this.renderSales();
    if (type !== 'log') this.renderPanel();
    this._cardFlow();
  }

  /* ══════════════════════ 시상식 · 게임덱스 연출 ══════════════════════ */

  /* 시상식 결과. 상금은 이미 들어와 있고, 이 창은 무엇을 왜 받았는지를
     말한다. 아무것도 못 받았을 때도 창을 띄우는 이유는 그쪽이 더 중요한
     정보이기 때문이다 — 어느 부문이 몇 점 모자랐는지가 다음 기획의 목표가
     된다. */
  showAwards(a) {
    if (!a) return;
    const tag = `${a.year}년차 ${a.month}월 · 시상식`;
    if (a.wins.length) {
      const rows = a.wins.map((w) => `
        <div class="awr ${w.grade.id}">
          <span class="awi">${w.icon}</span>
          <span class="awn">${w.catKo} <b>${w.grade.ko}</b><i>「${w.title}」</i></span>
          <span class="awv">${w.statKo} ${num(w.value)}<i>기준 ${num(w.bar)} · ${won(w.prize.money)}</i></span>
        </div>`).join('');
      this.openModal(tag, '수상을 축하합니다!',
        `${rows}<div class="gsub" style="margin-top:10px">상금 ${rewardText(a.totals)} 입금 완료</div>`,
        null, () => { this.g.pendingAward = null; this.g.save(); });
    } else {
      const n = a.near;
      this.openModal(tag, '올해의 수상은 없었습니다',
        `<p style="font-size:12px;line-height:1.7">지난달 출시작 ${a.entries}편은 어느 부문의 기준선도 넘지 못했습니다.<br><br>`
        + (n ? `가장 가까웠던 것은 <b>${n.catKo}</b> — 「${n.title}」 <b>${num(n.value)}점</b> (기준 ${num(n.bar)}점).
                ${Math.round((1 - n.ratio) * 100)}% 가 모자랐습니다.` : '')
        + '</p>',
        null, () => { this.g.pendingAward = null; this.g.save(); });
    }
  }

  /* 게임덱스 출전. 사진의 그 화면이다 — 예산을 고르고, 부스에 사람이
     몇 명 왔는지를 본다. */
  showExpo(x) {
    if (!x) return;
    const c = this.g.company;
    this.openModal(`게임덱스 ${x.month}월`, '출전 내용 선택',
      '<p style="font-size:12px;line-height:1.7">부스에 얼마를 쓸지 고르세요. '
      + '방문자 수만큼 <b>팬</b>이 늘고, 몇 주 동안 <b>다운로드</b>가 늘어납니다.<br>'
      + '보여줄 게임이 좋을수록 줄이 깁니다.</p>',
      EXPO_PLANS.map((p) => {
        const can = (p.cost ? c.money >= p.cost : true) && (p.coins ? c.coins >= p.coins : true);
        return {
          name: `${p.icon} ${p.ko}`,
          desc: can ? p.desc : '자금 또는 코인이 부족합니다',
          right: p.coins ? `🪙 ${p.coins}` : p.cost ? won(p.cost) : '무료',
          onPick: () => { if (can) this._expoFlow(p.id); else this.toast('자금이 부족합니다', 'bad'); },
        };
      }));
  }

  _expoFlow(planId) {
    const r = this.g.joinExpo(planId);
    if (!r.ok) { this.toast(r.why || '출전할 수 없습니다', 'bad'); return; }
    this.g.save();
    this.openModal('게임덱스 결산', `부스 방문자 ${num(r.visitors)}명`,
      `${r.note.ko ? `<div class="grade" style="font-size:22px">${r.note.ko}</div>` : ''}
       <div class="gsub">${r.plan.icon} ${r.plan.ko}</div>
       <div class="exr">
         <div><span class="k">부스 방문자</span><span class="v">${num(r.visitors)}명</span></div>
         <div><span class="k">팬</span><span class="v">+${num(r.fans)}명</span></div>
         <div><span class="k">다운로드</span><span class="v">${Math.round((r.dl - 1) * 100)}% UP · ${r.weeks}주</span></div>
       </div>`,
      null, () => this.renderAll());
  }

  /* 누적 다운로드 자릿수. 사진의 "축! 100만 다운로드 첫 달성!!" 이다. */
  showMilestone(m) {
    this.openModal('기념', `축! ${m.mark.ko} 다운로드 첫 달성!!`,
      `<div class="grade">${num(m.total)}</div>
       <div class="gsub">누적 다운로드</div>
       <p style="font-size:12px;margin-top:10px">축하 편지가 편지함에 도착했습니다. 선물이 들어 있습니다.</p>`,
      null, () => this.openTab('mail'));
  }

  /* ---------- the opening ----------
     A new studio has no name, no staff and no furniture. This is the ceremony
     that fixes the first of those and pays for the other two: a name box, then
     the grant, then the tutorial takes over. A save that has already been
     founded skips straight past. */
  openingFlow() {
    const c = this.g.company;
    if (c.founded) return;
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
    this.modalOnOk = async () => {
      const input = $('coInput');
      const name = (input && input.value.trim()) || pick;
      this.g.found(name);
      // 이름을 적고 나면 창립 영상이 돈다. 지원금 팝업은 그 뒤다 —
      // 회사가 세워지는 장면보다 숫자가 먼저 뜨면 순서가 거꾸로다.
      this.busy = true;
      try { await this.view.playFounding(name); } catch (e) { /* 영상이 실패해도 게임은 시작한다 */ }
      this.busy = false;
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

  /* ---------- 안내 ----------
     예전에는 게임을 켜자마자 화면 오른쪽에 안내 카드가 떠 있었고, 옆에
     '건너뛰기' 가 붙어 있었다. 둘 다 없앴다.

     띄워 두면: 처음 보는 사람은 사무실을 보기도 전에 글자부터 읽게 되고,
     아는 사람은 매번 닫는다. 건너뛰기가 있으면: 대부분은 그걸 누르고,
     그러면 안내는 애초에 없는 것과 같다. 그래서 안내는 **찾아오는 것**이
     됐다 — 오른쪽 레일의 ❓ 안내를 누르면 전체 순서가 열리고, 지금 할
     일이 표시된다. 언제든 다시 열 수 있으니 지울 이유도 없다. */
  panelGuide(box) {
    const g = this.g;
    const step = g.tutorialStep();
    const at = step ? TUTORIAL.indexOf(step) : TUTORIAL.length;

    box.appendChild(el('h4', 'sec', `안내 ${Math.min(at + 1, TUTORIAL.length)} / ${TUTORIAL.length}`));
    if (!step) {
      box.appendChild(el('div', 'item',
        '<div class="d">기본은 다 보셨습니다. 아래 순서는 언제든 다시 읽을 수 있습니다.</div>'));
    }

    TUTORIAL.forEach((st, i) => {
      const done = i < at;
      const now = step && st.id === step.id;
      const it = el('div', 'gstep' + (done ? ' done' : '') + (now ? ' now' : ''));
      it.innerHTML = `<div class="gt"><span class="gk">${done ? '✓' : now ? '▶' : i + 1}</span>
        <b>${st.title}</b></div>
        <div class="gb">${st.body}</div>`;
      if (now) {
        const go = el('button', 'btn sm primary', '그 탭으로');
        go.onclick = () => this.openTab(st.tab);
        it.appendChild(go);
      }
      box.appendChild(it);
    });

    box.appendChild(el('h4', 'sec', '기억할 것'));
    box.appendChild(el('div', 'item',
      '<div class="d">· <b>시간</b>은 일하면 흐릅니다. 게임을 완성하고, 정산을 확인하고, 계약을 받을 때.<br>'
      + '· <b>스태미나</b>는 실시간으로 찹니다. 게임을 꺼 둔 사이에도 찹니다.<br>'
      + '· <b>도우미</b>는 사거나 뽑는 것이 아니라 행사와 사건이 데려옵니다. 능력은 개발 현장에서 보스마다 한 번.<br>'
      + '· <b>초반</b>에는 한 작품이 개발비의 1.5배까지만 남습니다. 회사를 키워야 그 천장이 올라갑니다.</div>'));
  }

  /* A weekly event with a choice holds the week until it is answered.

     달력이 버튼이 아니라 일한 결과로 흐르게 되면서, 답을 못 받은 사건은
     시간을 통째로 멈춰 세운다. 그래서 화면이 바쁠 때(회의·룰렛·창립 영상)
     이 창을 그냥 버리지 않고 다시 줄을 선다 — 예전에는 여기서 return 하면
     팝업이 사라지고 사건만 남았다. */
  _eventFlow() {
    const ev = this.g.pendingEvent;
    if (!ev) return;
    if (this.busy) {
      if (this._evRetry) return;
      this._evRetry = setTimeout(() => { this._evRetry = null; this._pop(() => this._eventFlow()); }, 700);
      return;
    }
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
    if (!p || !p.pendingCards || this.busy || this._cardBusy) return;
    // 이 함수는 게임 이벤트가 날 때마다 불린다. 안쪽에서 부르는 것들(아레나
    // 퇴장, 회의 연출)이 또 이벤트를 쏘므로, 자기 자신이 재진입할 수 있다 —
    // this.busy 는 첫 await 뒤에야 서기 때문에 그 창을 못 막는다.
    this._cardBusy = true;
    try { await this._cardFlowBody(p); } finally { this._cardBusy = false; }
  }

  async _cardFlowBody(p) {
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
    this.renderHUD(); this.renderFloors(); this.renderPanel(); this.renderBadges();
    this.renderBattle(); this.renderProgress(); this.renderSales(); this.renderShell();
  }

  /* 판매 카드의 접기. 접었는지는 세이브가 아니라 기기에 남는다 — 화면의
     성질이지 회사의 기록이 아니다. */
  _wireSalesFold() {
    const h = $('sgHead');
    if (!h) return;
    try { this._salesFold = localStorage.getItem('socialdev3d.salesfold') === '1'; } catch (e) { this._salesFold = false; }
    const apply = () => {
      const card = $('sales');
      if (card) card.classList.toggle('fold', !!this._salesFold);
      h.setAttribute('aria-expanded', this._salesFold ? 'false' : 'true');
      this.measureRail();
    };
    h.onclick = () => {
      this._salesFold = !this._salesFold;
      try { localStorage.setItem('socialdev3d.salesfold', this._salesFold ? '1' : '0'); } catch (e) { /* private mode */ }
      apply();
    };
    apply();
  }

  /* 오른쪽 레일이 넘치는가. 넘칠 때만 레일이 손가락을 받는다 — 안 넘칠
     때까지 받으면 카드 사이의 빈 자리에서 카메라를 못 돌린다. */
  measureRail() {
    // 한 프레임에 한 번으로 묶는다. 이벤트마다 레이아웃을 재면 그 값이
    // 그대로 프레임에서 나간다.
    if (this._railT) return;
    this._railT = requestAnimationFrame(() => {
      this._railT = 0;
      const r = $('rrail');
      if (!r) return;
      document.body.classList.toggle('rail-scroll', r.scrollHeight > r.clientHeight + 2);
    });
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
    if ($('sales')) $('sales').classList.toggle('fold', !!this._salesFold);
  }

  /* 오른쪽 레일에 카드가 한 장이라도 서 있는가. 튜토리얼 줄이 그만큼
     비켜서야 판매 카드의 머리말이 덮이지 않는다. */
  renderRail() {
    const g = this.g;
    const running = g.sales && !g.sales.ended ? g.sales.id : null;
    this.renderBuff();
    // 상태에서 바로 읽는다. body 클래스를 보면 renderHUD 가 먼저 도는
    // 프레임에서 한 박자 늦게 반영된다.
    const buff = !!(g.company.buff && g.company.buff.weeks > 0);
    const on = buff || !!g.project || !!g.sales || g.managed().some((r) => r.id !== running);
    document.body.classList.toggle('has-rail', on && !this.inArena());
    // 카드가 서고 눕는 자리다. 넘치면 레일이 손가락을 받아야 스크롤이 된다.
    this.measureRail();
  }

  /* 지금 걸려 있는 회사 버프. 없으면 카드째로 사라진다. */
  renderBuff() {
    const b = this.g.company.buff;
    const card = $('buff');
    if (!card) return;
    const on = !!(b && b.weeks > 0);
    document.body.classList.toggle('has-buff', on);
    if (!on) return;
    $('bfKo').textContent = b.ko;
    $('bfVal').textContent = `DL ${Math.round((b.dl - 1) * 100)}% UP · ${b.weeks}주 남음`;
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
    // 다음 한 점까지 남은 시간. 가득 차 있으면 아무것도 적지 않는다.
    const eta = $('hStamEta');
    if (eta) {
      const left = this.g.staminaEta();
      const txt = left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : '';
      if (eta.textContent !== txt) eta.textContent = txt;
    }
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
    // 사무실 화면의 요약 줄도 "개발 중" 이라고 말한다.
    $('bTitle').textContent = `🎮 개발 중 「${p.title}」`;
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
    $('bHpTx').textContent = `남은 작업 ${num(p.hp)} / ${num(p.hpMax)}`;
    // 보스 줄: 지금 상대하는 놈의 이름과 몇 번째 공정인지.
    $('bBoss').textContent = st.name || st.ko;
    const ph = $('bPhase');
    const phase = DEV_PHASES[Math.min(p.stage || 0, DEV_PHASES.length - 1)];
    ph.textContent = (p.weak || 0) > 0
      ? `약점! ×1.45`
      : `${phase.ko} · ${(p.stage || 0) + 1}/${p.stages.length}`;
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
    // 선물과 장비는 트레이에 두지 않는다. 둘 다 "누구에게" 를 고르는
    // 물건이라, 싸우는 중에 손가락 하나로 눌러야 하는 자리와 맞지 않는다.
    const items = g.bagList()
      .filter((b) => b.item.kind !== 'gear' && b.item.kind !== 'gift').slice(0, 8);
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

    // 회사 최고 기록을 넘긴 축은 금색이 된다. 아레나의 기둥과 같은 규칙 —
    // 두 화면이 같은 것을 다르게 말하면 그건 정보가 아니라 혼란이다.
    const best = g.company.best || {};
    const funRec = (best.fun || 0) > 0 && pg.fun > best.fun;
    const funEl = $('pgFun');
    if (funEl) funEl.classList.toggle('rec', funRec);

    const stats = $('pgStats');
    stats.innerHTML = '';
    const mx = Math.max(1, ...STATS.map((st) => pg.quality[st]));
    const prev = this._lastQ || {};
    for (const st of STATS) {
      const v = pg.quality[st];
      const d = prev[st] === undefined ? 0 : v - prev[st];
      const rec = (best[st] || 0) > 0 && v > best[st];
      stats.appendChild(el('div', 'pgs' + (rec ? ' rec' : ''),
        `<span class="l">${STAT_KO[st]}</span>
         <span class="b"><span class="f" style="width:${v / mx * 100}%"></span></span>
         <span class="v">${v}${rec ? '★' : ''}</span><span class="d">${d > 0 ? '+' + d : ''}</span>`));
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
      mail: () => this.panelMail(box),
      event: () => this.panelEvents(box),
      guide: () => this.panelGuide(box),
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

    box.appendChild(el('h4', 'sec', '달력'));
    /* '다음 주로 넘기기' 버튼이 있던 자리다. 그 버튼이 있는 동안에는
       아무것도 만들지 않고 달력만 미는 것이 언제나 가장 빨랐다. 이제
       시간은 일한 결과로만 흐르고, 여기에는 무엇이 시간을 미는지가 적힌다. */
    box.appendChild(el('div', 'item',
      `<div class="t"><span class="n">📅 ${g.dateLabel()}</span></div>
       <div class="d">시간은 <b>일하면</b> 흐릅니다.<br>
       · 게임을 완성하면 기획서 등급만큼 (★1 한 주 → ★5 세 주)<br>
       · 판매 정산을 확인하면 한 주<br>
       · 계약 일감을 받으면 그 계약의 기간만큼<br>
       스태미나는 <b>${Math.round(STAMINA_REGEN / 60)}분에 1씩 저절로</b> 찹니다. 게임을 꺼 둔 사이에도 찹니다.</div>`));
    if (g.pendingEvent) {
      const evb = el('button', 'btn primary wide', '이번 주 사건을 처리하세요');
      evb.onclick = () => this._eventFlow();
      box.appendChild(evb);
    }

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
      `<div class="d">스태미나는 <b>${Math.round(STAMINA_REGEN / 60)}분에 1씩 저절로</b> 차고,
       <b>야근</b>·<b>상점의 음료</b>로도 채운다. 주가 넘어갈 때도 조금 찬다.
       체력은 주간 휴식과 <b>음식</b>으로 회복한다.</div>`));

    /* 계약 — the safety net */
    box.appendChild(el('h4', 'sec', '계약 일감'));
    if (c.contract) {
      box.appendChild(el('div', 'item',
        `<div class="t"><span class="n">${c.contract.ko}</span><span class="j">${c.contract.weeksLeft}주 남음</span></div>
         <div class="d">납품 시 ${won(c.contract.pay)} · 연구 +${c.contract.research}</div>`));
    } else {
      box.appendChild(el('div', 'item',
        '<div class="d">자금이 마르면 계약 일감으로 버틸 수 있다. 스태미나를 쓰고 <b>그 기간만큼 시간이 흐른다</b> — '
        + '개발할 돈이 없을 때 달력을 미는 유일한 길이다.</div>'));
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

    /* 소리 — 절차적으로 만들기 때문에 끄고 켜는 것 말고 조절할 것이 없다.
       전화기를 조용한 데서 꺼내는 사람이 반드시 있으므로 끄는 길은 있어야
       하고, 그 선택은 저장된다. */
    box.appendChild(el('h4', 'sec', '소리'));
    const snd = el('button', 'btn wide sm' + (soundOn() ? ' primary' : ''),
      soundOn() ? '🔊 효과음 켜짐' : '🔇 효과음 꺼짐');
    snd.onclick = () => { setSound(!soundOn()); if (soundOn()) sfx('buy'); this.renderPanel(); };
    box.appendChild(snd);

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

  /* ══════════════════════════ 편지함 ══════════════════════════

     목록은 세 가지를 한 줄에 담는다: 누가 보냈나, 무엇이 들었나, 받았나.
     본문은 접어 둔다 — 편지는 길고 패널은 좁아서, 다섯 통이 전부 펼쳐져
     있으면 목록이라기보다 두루마리가 된다. */
  panelMail(box) {
    const g = this.g;
    const list = g.mailList();
    const pending = g.mailPending();

    box.appendChild(el('h4', 'sec', `편지함 ${list.length}통 · 안 읽음 ${g.mailUnread()}`));
    if (!list.length) {
      box.appendChild(el('div', 'item',
        '<div class="d">아직 온 편지가 없습니다. 게임을 출시하면 유저 편지가 오고, '
        + '시상식과 게임덱스 결과도 여기로 옵니다.</div>'));
      return;
    }

    if (pending > 0) {
      const all = el('button', 'btn primary wide', `📥 선물 ${pending}건 모두 받기`);
      all.onclick = () => { g.mailClaimAll(); g.save(); this.renderPanel(); };
      box.appendChild(all);
    }

    for (const m of list) {
      const it = el('div', 'ml' + (m.read ? '' : ' new') + (m.claimed ? '' : ' gift'));
      const gift = m.gift ? giftText(m.gift, (id) => {
        const d = shopItem(id);
        return d ? `${d.emoji} ${d.ko}` : id;
      }) : '';
      it.innerHTML =
        `<div class="mlh">
           <span class="mli">${m.icon}</span>
           <span class="mlt">${m.title}</span>
           ${m.locked ? '<span class="mllock">🔒</span>' : ''}
         </div>
         <div class="mlf"><span>${m.from}</span><span>${m.at}</span></div>
         ${gift ? `<div class="mlg${m.claimed ? ' got' : ''}">🎁 ${gift}${m.claimed ? ' · 수령 완료' : ''}</div>` : ''}`;
      const body = el('div', 'mlb');
      body.textContent = m.body;
      body.hidden = this._mailOpen !== m.id;
      it.appendChild(body);

      const row = el('div', 'mlr');
      row.hidden = body.hidden;
      if (m.gift && !m.claimed) {
        const b = el('button', 'btn sm primary', '수령');
        b.onclick = (e) => {
          e.stopPropagation();
          const r = g.mailClaim(m.id);
          if (!r.ok) this.toast(r.why || '받을 수 없습니다', 'bad');
          g.save();
          this.renderPanel();
        };
        row.appendChild(b);
      }
      const lock = el('button', 'btn sm', m.locked ? '🔓 보호 해제' : '🔒 보호');
      lock.onclick = (e) => { e.stopPropagation(); g.mailLock(m.id); g.save(); this.renderPanel(); };
      row.appendChild(lock);
      const del = el('button', 'btn sm danger', '삭제');
      del.disabled = m.locked || !m.claimed;
      del.onclick = (e) => {
        e.stopPropagation();
        const r = g.mailDelete(m.id);
        if (!r.ok) this.toast(r.why || '지울 수 없습니다', 'bad');
        g.save();
        this.renderPanel();
      };
      row.appendChild(del);
      it.appendChild(row);

      it.onclick = () => {
        this._mailOpen = this._mailOpen === m.id ? null : m.id;
        g.mailOpen(m.id);
        g.save();
        this.renderPanel();
      };
      box.appendChild(it);
    }
  }

  /* ══════════════════════════ 행사 ══════════════════════════
     시상식(매달)과 게임덱스(두 달)가 여기 산다. 지나간 행사의 기록도 같이
     둔다 — 상은 받은 순간보다 진열장에 쌓인 모습이 오래 남는다. */
  panelEvents(box) {
    const g = this.g, c = g.company;

    /* ---- 열린 게임덱스 ---- */
    const expo = g.expoOpen();
    box.appendChild(el('h4', 'sec', '게임덱스 · 두 달에 한 번'));
    if (expo) {
      box.appendChild(el('div', 'item',
        `<div class="t"><span class="n">🎪 게임덱스 ${expo.month}월 개최</span><span class="j">출전 대기</span></div>
         <div class="d">부스에 얼마를 쓸지 고르세요. 방문자만큼 팬이 늘고,
           몇 주 동안 <b>다운로드가 늘어납니다</b>.</div>`));
      for (const p of EXPO_PLANS) {
        const cost = p.coins ? `코인 ${p.coins}` : p.cost ? won(p.cost) : '무료';
        const can = (p.cost ? c.money >= p.cost : true) && (p.coins ? c.coins >= p.coins : true);
        const b = el('button', 'btn sm' + (p.id === 'big' ? ' primary' : ''),
          `${p.icon} ${p.ko} · ${cost}`);
        b.style.cssText = 'display:block;width:100%;margin-bottom:4px;text-align:left';
        b.disabled = !can;
        b.onclick = () => this._expoFlow(p.id);
        box.appendChild(b);
      }
    } else {
      const nextMonth = ((c.month - 1) % 2 === 0) ? c.month + 2 : c.month + 1;
      box.appendChild(el('div', 'item',
        `<div class="d">다음 게임덱스는 <b>${((nextMonth - 1) % 12) + 1}월</b>에 열립니다.
          ${c.expoBest ? `역대 최다 방문자 <b>${num(c.expoBest)}명</b>.` : ''}</div>`));
    }

    if (c.buff && c.buff.weeks > 0) {
      box.appendChild(el('div', 'trend',
        `<span class="ic">🔥</span><span class="tx">${c.buff.ko}<br>
          <b>DL ${Math.round((c.buff.dl - 1) * 100)}% UP</b> · ${c.buff.weeks}주 남음</span>`));
    }

    for (const e of (c.expoLog || []).slice(0, 4)) {
      box.appendChild(el('div', 'row',
        `<span>${e.at} · ${e.planKo}</span><b>${num(e.visitors)}명</b>`));
    }

    /* ---- 시상식 ---- */
    box.appendChild(el('h4', 'sec', `시상식 · 매달 1주 · ${c.year}년차 기준선`));
    box.appendChild(el('div', 'item',
      '<div class="d">지난 한 달에 <b>출시한 게임</b>을 부문별로 심사합니다. '
      + '부문의 기준선을 넘으면 상과 상금이 나옵니다. 기준선은 해마다 올라갑니다.</div>'));
    for (const cat of AWARD_CATS) {
      box.appendChild(el('div', 'row',
        `<span>${cat.icon} ${cat.ko}</span><b>${num(awardBar(c.year, cat.id))}점부터</b>`));
    }
    box.appendChild(el('div', 'item',
      `<div class="d">등급: ${AWARD_GRADES.map((gr) => `<b>${gr.ko}</b> 기준선 ×${gr.at}`).join(' · ')}</div>`));

    const awards = c.awards || [];
    box.appendChild(el('h4', 'sec', `수상 진열장 ${awards.length}개`));
    if (!awards.length) {
      box.appendChild(el('div', 'item', '<div class="d">아직 받은 상이 없습니다.</div>'));
    }
    for (const a of awards.slice().reverse().slice(0, 12)) {
      box.appendChild(el('div', 'item',
        `<div class="t"><span class="n">${a.icon} ${a.catKo} ${a.gradeKo}</span><span class="j">${a.at}</span></div>
         <div class="d">「${a.title}」 · ${num(a.value)}점</div>`));
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
      box.appendChild(el('div', 'item', '<div class="d">지금은 지원자가 없다. 게임을 완성하거나 계약을 받아 주가 넘어가면 새 명단이 들어온다.</div>'));
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

    /* 가방에서 바로 먹이기. 선물은 여기서 주는 것이 가장 자연스럽다 —
       그 사람의 능력치를 보면서 무엇을 줄지 고르는 화면이기 때문이다. */
    const food = g.bagList().filter((b) => ['food', 'toy', 'gift'].includes(b.item.kind))
      .sort((a, b) => starOf(a.item) - starOf(b.item));
    d.appendChild(el('h4', 'sec', `가방에서 주기 (체력 ${s.hp}/${s.hpMax})`));
    if (!food.length) {
      d.appendChild(el('div', 'd', '<span style="color:var(--dim);font-size:10px">가방이 비었습니다. 상점 탭에서 음식과 선물을 사두거나, 개발 배틀에서 보물상자를 주우세요.</span>'));
    }
    for (const { item, n } of food) {
      // 선물은 이 사람에게 줬을 때 무엇이 얼마나 오르는지를 버튼에 적는다.
      const gainTxt = item.kind === 'gift'
        ? `EXP +${num(item.exp)}${item.ability ? ` · ${ABILITY_KO[item.ability]} ${abilities(s)[item.ability]} → ${Math.round(abilities(s)[item.ability] + item.gain)}` : ''}`
        : item.desc;
      const b = el('button', 'btn sm',
        `${item.emoji} ${item.ko} <span class="st s${starOf(item)}">${starText(starOf(item))}</span> ×${n} — ${gainTxt}`);
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

    /* 앞의 게임이 아직 팔리고 있으면 다음 게임은 시작할 수 없다. 버튼만
       조용히 비활성으로 두면 "왜 안 눌리지" 가 되므로, 이유와 함께 정산
       버튼을 여기에도 세운다 — 오른쪽 카드가 접혀 있을 수도 있다. */
    const sale = g.sales;
    if (sale) {
      const it = el('div', 'item warn');
      // 주차와 금액은 오른쪽 실시간 카드가 매 주 갱신한다. 여기 적으면
      // 패널을 다시 그릴 때까지 멈춰 있는 숫자가 되므로, 끝난 뒤에만 쓴다.
      it.innerHTML = `<div class="t"><span class="n">「${sale.title}」 판매 중</span>
          <span class="j">${sale.ended ? '정산 완료' : '진행 중'}</span></div>
        <div class="d">${sale.ended
          ? `${sale.done}주 누적 <b>${won(sale.total)}</b>. 정산을 확인하면 다음 게임을 시작할 수 있습니다.`
          : '판매가 끝나고 정산을 확인해야 다음 게임에 착수할 수 있습니다. 오른쪽 카드에서 팔리는 중입니다.'}</div>`;
      box.appendChild(it);
      if (sale.ended) {
        const ok = el('button', 'btn primary wide', '정산 확인');
        ok.onclick = () => {
          const s = g.closeSalesRun();
          if (!s) return;
          const rel = g.releases.find((r) => r.id === s.id);
          if (rel) this._pop(() => this.showRelease(rel, s));
        };
        box.appendChild(ok);
      }
    }

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

    // 기획서가 없어도 아래의 도우미 줄은 서야 한다. 예전에는 여기서 곧장
    // 돌아섰고, 그래서 첫 게임을 뽑기 전에는 도우미를 볼 길이 없었다.
    if (!g.proposals.length) {
      box.appendChild(el('div', 'item', '<div class="d">기획서가 없습니다. 위 버튼으로 뽑으세요. 기획자를 3층(기획실)에 앉히면 등급이 올라갑니다.</div>'));
    } else for (const pr of g.proposals) {
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

    /* 누구를 데리고 들어갈까. 도우미는 상점에서 파는 물건이 아니라 개발
       현장에서 쓰는 능력이므로, 고르는 자리도 착수하는 탭이 맞다. 맨 위가
       아닌 이유는 이 탭의 첫 줄이 언제나 '기획서' 여야 하기 때문이다 —
       도우미 넉 줄이 그 위를 덮으면 눌러야 할 버튼이 화면 밖으로 밀린다. */
    this.panelHelpers(box);
  }

  renderDraft(box, pr) {
    const g = this.g, d = this.draft;

    /* ---- 플랫폼 ----
       예전에는 이름만 적힌 버튼 줄이었다. 그러면 "왜 콘솔이 비싼가" 가
       화면 어디에도 없다. 이제 한 줄에 **시장 인구 · 구매력 · 개발비**가
       같이 서고, 아직 못 여는 플랫폼도 필요한 랭크와 함께 회색으로 보인다 —
       사다리가 보여야 다음 칸이 목표가 된다. */
    box.appendChild(el('h4', 'sec', '플랫폼'));
    const openIds = new Set(g.availablePlatforms().map((p) => p.id));
    // 막대는 가장 큰 시장을 100 으로 잡는다. 상수로 박아 두면 표를 손볼 때
    // 막대만 조용히 틀어진다.
    const widest = Math.max(...PLATFORMS.map((p) => p.market));
    for (const p of PLATFORMS) {
      const open = openIds.has(p.id);
      const on = open && d.platformId === p.id;
      const it = el('div', 'item plat' + (on ? ' on' : '') + (open ? ' click' : ' lock'));
      const bar = Math.round(p.market / widest * 100);
      it.innerHTML = `<div class="t"><span class="n">${p.ko}</span>
        <span class="j">${open ? won(p.cost) : `랭크 ${p.rank}`}</span></div>
        <div class="mkt"><span class="mb"><span class="mf" style="width:${bar}%"></span></span>
          <span class="mv">👥 ${num(p.market)}</span></div>
        <div class="d">구매력 ×${p.share.toFixed(2)} · 초기 유입 ×${p.fans.toFixed(2)}<br>${p.note}</div>`;
      if (open) it.onclick = () => { d.platformId = p.id; this.renderPanel(); };
      box.appendChild(it);
    }

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

    const selling = !!g.sales;
    const go = el('button', 'btn primary wide',
      selling ? '판매 중 — 정산 후에 시작' : '개발 시작');
    go.disabled = selling || !d.teamIds.length || g.company.money < cost || g.company.stamina < stam;
    go.onclick = () => {
      const r = g.beginDevelopment(d);
      if (!r.ok) { this.toast(r.why, 'bad'); return; }
      this.draft = null;
      this.view.startWork(g.project.team);
      this._kickoff(g.project);
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
    const phase = DEV_PHASES[Math.min(p.stage || 0, DEV_PHASES.length - 1)];
    box.appendChild(el('h4', 'sec', `${phase.ko} 공정 — ${st.name || st.ko}`));
    box.appendChild(el('div', 'item',
      `<div class="t"><span class="n">「${p.title}」</span><span class="stars">${stars(p.proposal.grade)}</span></div>
       <div class="d">${gen.ko} · ${PLATFORMS.find((x) => x.id === p.platformId).ko} · ${MONETIZE.find((x) => x.id === p.monetizeId).ko}</div>`));

    const arena = el('button', 'btn primary wide', '🎮 개발 현장으로');
    arena.onclick = () => this.enterArena();
    box.appendChild(arena);

    // 세 마리의 사다리. 어디까지 왔는지가 한눈에 보여야 한다.
    const icons = ['🐱', '👹', '👿'];
    box.appendChild(el('div', 'item',
      `<div class="t"><span class="n">공정 ${(p.stage || 0) + 1} / ${p.stages.length}</span>
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
        <span class="t">${item.ko} <span class="st s${starOf(item)}">${starText(starOf(item))}</span>
        <br><span style="color:var(--dim);font-size:9.5px">${item.desc || ''}</span></span>
        <span class="q">×${n}</span>`;
      if (item.kind !== 'gear') {
        const use = el('button', 'btn sm',
          item.kind === 'food' ? '먹이기' : item.kind === 'gift' ? '주기' : '사용');
        use.onclick = () => {
          if (item.kind === 'gift') { this.giftFlow(item); return; }
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

  /* ---------- 선물 주기 ----------
     누구에게 줄지 고르는 화면. 물건이 올려주는 능력치를 그 사람의 **현재
     값**과 나란히 놓는다 — "그래픽 82 → 86" 이 보이지 않으면 어느 직원에게
     줄지가 감으로만 남는다. 레벨업까지 남은 경험치도 같이 적는다. */
  giftFlow(item) {
    const g = this.g;
    if (!g.staff.length) { this.toast('직원이 없습니다', 'bad'); return; }
    const key = item.ability;
    const list = g.staff.slice().sort((a, b) => {
      if (!key) return a.level - b.level;
      return abilities(b)[key] - abilities(a)[key];
    });
    this.openModal('선물', `${starText(starOf(item))} ${item.emoji} ${item.ko}`,
      `EXP <b>+${num(item.exp)}</b>${key ? ` · <b>${ABILITY_KO[key]} +${item.gain}</b>` : ' · 능력치는 레벨로만 오른다'}
       ${item.mot ? ` · 의욕 +${item.mot}` : ''}<br>
       <span style="color:var(--dim);font-size:11px">누구에게 줄까요?</span>`,
      list.map((st) => {
        const now = key ? abilities(st)[key] : 0;
        const after = key ? Math.round(now + item.gain) : 0;
        return {
          name: `${st.name} · Lv.${st.level}${st.level >= st.maxLevel ? ' (MAX)' : ''}`,
          desc: `${JOBS[st.job].ko}`
            + (key ? ` · ${ABILITY_KO[key]} ${now} → ${after}` : '')
            + ` · 레벨업까지 ${num(Math.max(0, expToNext(st) - (st.exp || 0)))}`,
          onPick: () => {
            const r = g.useItem(item.id, st.id);
            if (!r.ok) this.toast(r.why, 'bad');
            g.save();
          },
        };
      }));
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

    // 별이 낮은 것부터. 상점의 한 분류가 곧 등급 사다리로 읽힌다.
    const stock = SHOP.filter((i) => i.kind === this.shopKind)
      .slice().sort((a, b) => starOf(a) - starOf(b) || a.price - b.price);
    for (const item of stock) {
      const locked = c.rank < (item.rank || 1);
      const row = el('div', 'sitem' + (locked ? ' locked' : ''));
      row.innerHTML = `<span class="e">${item.emoji}</span>
        <span class="m"><span class="t">${item.ko}
          <span class="st s${starOf(item)}">${starText(starOf(item))}</span></span>
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

  /* ---------- 도우미 ----------
     행사와 사건이 데려오는 마스코트들. 뽑기가 아니므로 여기에는 살 버튼이
     없고, 대신 **누가 무엇을 할 수 있는가**가 적힌다 — 능력은 개발 현장에서
     보스 한 마리에 한 번 쓰는 것이고, 그러니 이 화면의 일은 "어느 셋을
     데리고 들어갈까" 하나뿐이다. */
  panelHelpers(box) {
    const g = this.g, c = g.company;
    const slots = g.helperSlotCount();
    const list = g.helperList();

    box.appendChild(el('h4', 'sec',
      `도우미 <span class="hint">${(c.helperSlots || []).length} / ${slots} 자리</span>`));

    if (!list.length) {
      box.appendChild(el('div', 'item',
        '<div class="d">아직 도우미가 없습니다. 도우미는 돈으로 사는 것이 아니라 '
        + '<b>게임덱스 부스</b>·<b>시상식</b>·<b>주간 사건</b>에서 찾아옵니다. '
        + '데려오면 개발 현장 아래에 서고, <b>보스 한 마리에 한 번</b> 능력을 씁니다.</div>'));
      return;
    }

    for (const h of list) {
      const it = el('div', 'helper' + (h.equipped ? ' on' : ''));
      it.innerHTML = `<span class="hi">${h.def.icon}</span>
        <span class="ht"><b>${h.def.ko} <i>Lv.${h.level}</i></b>
        <span class="hd">${starText(h.def.star)} · <b>${h.def.skill.ko}</b> — ${helperSkillText(h.def, h.level)}</span></span>`;
      const b = el('button', 'btn sm' + (h.equipped ? ' primary' : ''), h.equipped ? '해제' : '장착');
      b.onclick = () => {
        const r = g.toggleHelper(h.def.id);
        if (!r.ok) this.toast(r.why, 'bad');
        this.renderPanel();
        this.renderHelpers();
      };
      it.appendChild(b);
      box.appendChild(it);
    }
    box.appendChild(el('div', 'item',
      '<div class="d">능력은 <b>개발 현장</b>에서 얼굴을 눌러 씁니다. 보스 한 마리에 한 번, '
      + '공정이 넘어가면 다시 찹니다. 자리는 랭크가 엽니다 — 랭크 4에 두 자리, 랭크 10에 세 자리. '
      + '같은 도우미가 또 오면 레벨이 올라 능력이 세집니다.</div>'));
  }

  /* 도우미가 합류했다. 행사나 사건이 데려온 순간에 뜬다. */
  rollHelper(r) {
    const skill = helperSkillText(r.def, r.level);
    this.openModal('도우미', r.isNew ? '새 도우미!' : `${r.def.ko} 레벨 ${r.level}`,
      `<div style="text-align:center;padding:6px 0">
         <div style="font-size:52px;line-height:1.1">${r.def.icon}</div>
         <div style="font-size:15px;font-weight:900;margin-top:4px">${r.def.ko}</div>
         <div style="font-size:12px;color:var(--gold);margin-top:2px">${starText(r.def.star)}${r.from ? ' · ' + r.from : ''}</div>
         <div style="font-size:12.5px;margin-top:8px"><b>${r.def.skill.ko}</b></div>
         <div style="font-size:12px;color:var(--dim);margin-top:2px">${skill}</div>
         <div style="font-size:11.5px;color:var(--dim);margin-top:8px">개발 현장에서 보스 한 마리에 한 번 쓸 수 있습니다.</div>
         ${r.isNew ? '' : `<div style="font-size:11.5px;color:var(--good);margin-top:6px">겹쳐서 레벨 ${r.level} — 능력이 세집니다</div>`}
       </div>`, null, () => this.renderPanel());
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
    this.panelChart(box);
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

    /* 회수는 화면을 눌러서 한다. 목록에서 "책상" 여섯 줄 중 어느 것이
       화면의 그 책상인지 고르는 것은 사실상 불가능하다. */
    const pick = el('button', 'btn wide sm',
      c.placed.length ? '🧹 치우기 — 화면에서 눌러 가방으로' : '놓은 가구가 없습니다');
    pick.disabled = !c.placed.length;
    pick.onclick = () => {
      this.view.startPickup();
      this.togglePanel(true);
      this.renderPlaceBar();
    };
    box.appendChild(pick);

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
      const row = el('div', 'row', `<span>${i + 1}F ${FLOOR_PLANS[i].short}</span>`);
      const names = el('b', 'names');
      if (!people.length) names.textContent = '비어 있음';
      // 이름은 누를 수 있다. 층 목록에서 사람을 발견하고 상세를 보려고
      // 직원 탭으로 가서 다시 찾는 것은 같은 일을 두 번 하는 것이다.
      for (const s of people) {
        const b = el('button', 'namebtn', s.name);
        b.onclick = () => this.openStaff(s.id);
        names.appendChild(b);
      }
      row.appendChild(names);
      box.appendChild(row);
    }
  }

  /* ---------- 주간 판매 차트 ----------
     우리 게임과 경쟁사 게임이 같은 표에서 유저 수로 줄을 선다.

     이것이 있기 전에는 출시 뒤에 볼 것이 자금뿐이었다. 20만 명이 많은
     것인지 적은 것인지는 옆에 다른 회사의 숫자가 있어야 알 수 있고,
     "1위" 는 큰 숫자와 다른 종류의 사실이다. */
  panelChart(box) {
    const g = this.g, c = g.company;
    const rows = g.chart();
    box.appendChild(el('h4', 'sec',
      `주간 판매 차트${c.chartWeeksNo1 ? ` <span class="hint">1위 ${c.chartWeeksNo1}주</span>` : ''}`));
    if (!rows.length) {
      box.appendChild(el('div', 'item',
        '<div class="d">아직 차트에 오른 게임이 없습니다. 게임을 출시하면 경쟁사와 같은 표에서 순위를 다툽니다.</div>'));
      return;
    }
    for (const r of rows) {
      const row = el('div', 'chartrow' + (r.mine ? ' mine' : '') + (r.rank === 1 ? ' top' : ''));
      row.innerHTML = `<span class="cr">${r.rank}</span>
        <span class="ci">${r.icon}</span>
        <span class="ct"><b>${r.title}</b><i>${r.studio}</i></span>
        <span class="cu">${num(r.users)}</span>`;
      box.appendChild(row);
    }
    const rivals = (c.rivalGames || []).filter((r) => r.managing).length;
    box.appendChild(el('div', 'item',
      `<div class="d">경쟁사 운영작 ${rivals}편. 1위를 지키면 매주 팬이 늘어납니다.</div>`));
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

    /* 회수 모드는 툴바가 한 줄이면 된다: 무엇을 하는 모드인지와 끝내는
       버튼. 배치 툴바와 같은 자리를 쓰므로 여기서 먼저 갈라진다. */
    if (this.view.pickup) {
      this._pb = null;
      bar2.innerHTML = '';
      bar2.classList.add('show');
      const info = el('div', 'pinfo',
        '<b>가구 회수</b><span class="ok">치울 가구를 화면에서 누르세요</span>');
      const done = el('button', 'btn sm primary', '끝내기');
      done.onclick = () => { this.view.stopPickup(); this.renderPlaceBar(); this.togglePanel(false); };
      bar2.append(info, done);
      return;
    }

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

  closeModal() {
    $('modal').classList.remove('show');
    // 닫히고 나면 줄에서 다음 것을 꺼낸다. 다음 틱으로 미루는 이유는 이
    // 함수를 부른 쪽이 곧바로 또 다른 모달을 열 수 있기 때문이다
    // (선택지를 고르면 결과 창이 뜨는 게임덱스가 그렇다).
    setTimeout(() => this._drainPops(), 0);
  }

  /* 모달 줄서기.

     한 주를 넘기면 주간 사건·시상식·게임덱스·다운로드 기념비가 동시에
     열릴 수 있다. 그때 openModal 을 네 번 부르면 마지막 하나만 보이고 앞의
     셋은 읽히지도 않은 채 사라진다 — 상금은 이미 들어와 있으니 손해는
     아니지만, 무슨 일이 있었는지를 모르게 된다.

     화면에 모달이 떠 있는 동안에는 줄이 움직이지 않는다. 확인 버튼이든
     선택지든 어느 쪽으로 닫히든 closeModal 을 지나가므로, 종류를 나눠
     처리할 필요가 없다. */
  _pop(show) {
    this._pops = this._pops || [];
    this._pops.push(show);
    this._drainPops();
  }

  _drainPops() {
    if ($('modal').classList.contains('show')) return;
    const show = (this._pops || []).shift();
    if (show) show();
  }

  /* 오른쪽 탭 레일의 배지. 안 읽은 편지와 열린 행사. */
  renderBadges() {
    const g = this.g;
    const mail = $('tbMail');
    if (mail) {
      const n = g.mailUnread ? g.mailUnread() : 0;
      mail.hidden = n <= 0;
    }
    const ev = $('tbEvent');
    if (ev) ev.hidden = !(g.expoOpen && g.expoOpen());
    /* 안내는 이제 저절로 뜨지 않는다. 그러면 처음 켠 사람이 그 탭이
       있다는 사실을 영영 모를 수 있으므로, 아직 안 끝난 동안에는 점을
       하나 켜 둔다. 열어 보는 순간 그 탭이 켜져 있으니 점은 물러난다. */
    const gd = $('tbGuide');
    if (gd) gd.hidden = this.tab === 'guide' || !g.tutorialStep();
  }

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
    sfx(kind === 'bad' ? 'bad' : 'tap');
    const t = $('toast');
    t.textContent = text;
    t.className = 'card show ' + (kind || '');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { t.classList.remove('show'); }, 3400);
  }
}
