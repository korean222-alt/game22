/* Boot, the frame loop, and the bridge between the simulation and the 3D view.

   Responsibilities are deliberately narrow: this file owns nothing about game
   rules and nothing about shading. It builds the world once, keeps one Agent
   per staffer, and translates game events into things you can watch happen in
   the office — a team walking to the meeting room, damage numbers over a desk,
   someone getting up for coffee. */

import { initGL, upload, disposeMesh } from './core/gl.js';
import { splitGlass } from './core/meshbuilder.js';
import { bakeAO, NavGrid } from './core/bake.js';
import { clamp, mulberry32 } from './core/math.js';
import { Renderer, LIGHT_ORDER } from './render/renderer.js';
import { OrbitCamera } from './render/camera.js';
import { Rig } from './char/rig.js';
import './world/palette.js';                  // registers the hex -> material map
import { buildOffice, BUILDING, FLOOR_PLANS, STOREY } from './world/office.js';
import { Crew, Agent, ST } from './world/agents.js';
import { Boss } from './world/boss.js';
import { Game } from './game/state.js';
import * as staffMod from './game/staff.js';
import { meetingScript, critLine, idleLine } from './game/dialogue.js';
import { UI } from './ui/hud.js';
import { Joystick } from './ui/joystick.js';
import {
  TIERS, detectTier, isTouch, isMobile, viewportSize, trackViewport,
  suppressBrowserGestures, goFullscreen,
} from './ui/device.js';

const $ = (id) => document.getElementById(id);
const canvas = $('gl');
const ov = $('ov');

/* Null-safe on purpose: `build()` runs again mid-game when a floor is bought,
   and by then the boot overlay has been removed from the document. Reaching
   through a missing element there threw on the first line of the rebuild, so
   buying a floor charged the money and then quietly built nothing. */
function bootStep(t) {
  const e = $('bootStep');
  if (e) e.textContent = t;
  const b = $('busy');
  if (b) b.textContent = t;
}
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

const STAT_LABEL = {
  craze: '화제성', usability: '조작성', impact: '임팩트',
  social: '소셜', retention: '지속성',
};

/* 화면 설정은 세이브(회사 상태)와 수명이 다르다 — 기기의 성질이지 회사의
   기록이 아니다. 그래서 별도 키에, 실패해도 조용히 넘어가게 저장한다. */
const PREF_KEY = 'socialdev3d.prefs.v1';
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch (e) { return {}; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) { /* private mode */ }
}

/* ══════════════════════════════════════ view ══════════════════════════════ */

class View {
  constructor(game) {
    this.game = game;
    this.floor = 0;
    this.floorCount = game.company.floors;
    this.frames = 0;              // a liveness counter the test harness reads
    this.wallCut = true;
    this.time = 0;
    this.crew = new Crew();
    this.tags = new Map();
    this.bubbles = new Map();
    this.roomEls = [];
    this.effects = [];
    this.focused = null;
    this.rnd = mulberry32(0xBEEF);
    this.meetingScenes = true;      // player-facing toggle
    this.camSaved = null;
    this._skip = null;

    /* ---- 개발 배틀의 보스 ---- */
    this.boss = null;
    this.bossAnchor = null;

    /* ---- 1인칭 ---- */
    this.walk = false;
    this.stick = null;
    this.keys = { fwd: false, back: false, left: false, right: false };
    this.prefs = loadPrefs();
  }

  /* ---- world ---- */
  async build() {
    bootStep('사무실 배치');
    await nextFrame();
    const built = buildOffice(Math.max(1, this.floorCount));
    this.desks = built.desks;
    this.rooms = built.rooms;

    bootStep('앰비언트 오클루전 굽는 중');
    await nextFrame();
    bakeAO(built.mesh, 0.68, 1.1);

    bootStep('보행 격자 계산');
    await nextFrame();
    // One grid per storey: the shared solids list spans the whole tower, so a
    // single grid would fuse every floor's furniture into one impassable mat.
    // The walkable area is the building interior, given explicitly: the mesh
    // also contains a plaza and a skyline, and letting the grid size itself to
    // those would blow past its cell budget.
    const area = { x0: BUILDING.x0 - 2, z0: BUILDING.z0 - 2, x1: BUILDING.x1 + 2, z1: BUILDING.z1 + 2 };
    const navs = [];
    for (let f = 0; f < built.floors; f++) {
      navs.push(new NavGrid(built.mesh, f * STOREY + 1.0, f * STOREY + 5.5, 0.5, 1, area));
      await nextFrame();
    }
    this.crew.setWorld({ navs, meetings: built.meetings, spots: built.spots });

    bootStep('GPU 업로드');
    await nextFrame();
    const split = splitGlass(built.mesh);
    disposeMesh(this.gSolid); disposeMesh(this.gGlass);
    this.gSolid = upload(split.solid);
    this.gGlass = upload(split.glass);

    this.game.assignDesks(this.desks);
    this.buildRoomLabels();
    this.syncAgents();
  }

  /* Floors are bought, which changes the geometry, so the world is rebuilt
     rather than patched. It happens at most four times a run. The rebuild bakes
     AO and a walk grid per storey, which takes a visible moment on a phone, so
     it puts a banner up rather than appearing to freeze. */
  async setFloorCount(n) {
    if (n <= this.floorCount) return;
    const prev = this.floorCount;
    this.floorCount = n;
    document.body.classList.add('busy');
    try {
      await this.build();
    } catch (e) {
      this.floorCount = prev;
      console.error('floor rebuild failed', e);
      throw e;
    } finally {
      document.body.classList.remove('busy');
    }
  }

  buildRoomLabels() {
    for (const r of this.roomEls) r.el.remove();
    this.roomEls = [];
    for (const r of this.rooms) {
      const e = document.createElement('div');
      e.className = 'lab';
      e.textContent = r.name;
      ov.appendChild(e);
      this.roomEls.push({ r, el: e });
    }
  }

  /* ---- staff ---- */
  syncAgents() {
    const live = new Set(this.game.staff.map((s) => s.id));
    for (const a of this.crew.all()) {
      if (live.has(a.id)) continue;
      disposeMesh(a.rig);
      this.crew.remove(a.id);
      for (const map of [this.tags, this.bubbles]) {
        const el = map.get(a.id);
        if (el) { el.remove(); map.delete(a.id); }
      }
    }

    for (const s of this.game.staff) {
      let a = this.crew.get(s.id);
      if (!a) {
        a = new Agent(s, new Rig(s.look), (s.id * 2.399) % 6.28);
        this.crew.add(a);
        for (const [map, cls] of [[this.tags, 'nm'], [this.bubbles, 'bub']]) {
          const el = document.createElement('div');
          el.className = cls;
          if (cls === 'nm') el.textContent = s.name;
          el.style.display = 'none';
          ov.appendChild(el);
          map.set(s.id, el);
        }
      }
      a.name = s.name;
      a.mood = s.motivation;
      a.role = this.game.roleOf ? this.game.roleOf(s) : 'plan';
      const d = this.deskOf(s);
      a.home = d;
      // A newly hired or newly seated person appears at their desk rather than
      // walking in from nowhere.
      if (d && !a.placed) { a.sitAt({ x: d.seatX, z: d.seatZ, yaw: d.yaw, floor: d.floor }); a.placed = true; }
      else if (!d && !a.placed) { a.placeAt(30 + (s.id % 5) * 2.4, 24, Math.PI, 0); a.state = ST.STAND; a.placed = true; }
    }
  }

  deskOf(staffer) {
    if (!this.desks || !staffer.deskId) return null;
    return this.desks.find((d) => d.id === staffer.deskId) || null;
  }

  /* ══════════════════════ 개발 배틀의 보스 ══════════════════════
     아이디어에 형체를 준다. 팀의 책상 한복판 위에 떠서, 맞으면 흔들리고,
     페이즈가 오르면 커지고, 완성되면 사라진다. 순수 연출이다 — 규칙은
     game/project.js 안에서만 돈다. */
  /* 프로젝트당 한 번만 만든다. 'project' 이벤트는 턴마다 오므로, 매번
     새로 지으면 프레임마다 VBO 를 버리고 다시 올리게 된다. */
  ensureBoss(project) {
    if (!project) { this.clearBoss(); return; }
    if (this.boss && !this.boss.dead && this.bossProject === project.id) return;
    this.spawnBoss(project);
  }

  spawnBoss(project) {
    this.clearBoss();
    if (!project || !project.boss) return;
    this.boss = new Boss(project.boss);
    this.bossProject = project.id;
    this.boss.phase = project.phase || 0;
    this.boss.scale = 1 + (project.phase || 0) * 0.08;
    this.boss.setAnchor(...this.bossSpot(project));
    this.boss.faceTo(this.bossFaceYaw());
    this.boss.yaw = this.boss.goalYaw;
  }

  clearBoss() {
    if (this.boss) this.boss.dispose();
    this.boss = null;
    this.bossProject = null;
  }

  /* 팀이 앉아 있는 자리들의 무게중심. 아무도 자리가 없으면 그 층 한복판. */
  bossSpot(project) {
    let sx = 0, sz = 0, n = 0, floor = this.floor;
    for (const id of project.team) {
      const st = this.game.staff.find((x) => x.id === id);
      const d = st && this.deskOf(st);
      if (!d) continue;
      sx += d.x; sz += d.z; n++;
      floor = d.floor;
    }
    const x = n ? sx / n : (BUILDING.x1 / 2);
    const z = n ? sz / n : (BUILDING.z1 / 2);
    this.bossFloor = floor;
    return [x, floor * STOREY + 7.2, z];
  }

  /* 눈이 카메라를 향하게. 궤도 모드에서는 방위각, 1인칭에서는 내 위치. */
  bossFaceYaw() {
    if (!this.boss) return 0;
    if (this.walk) return Math.atan2(cam.wx - this.boss.x, cam.wz - this.boss.z);
    return cam.az;
  }

  /* 보스를 화면에 잡아준다. 개발 착수와 페이즈 전환에서 부른다. */
  focusBoss(dist = 40) {
    if (!this.boss || this.walk) return;
    if (this.bossFloor !== undefined && this.bossFloor !== this.floor) {
      this.setFloor(this.bossFloor);
      ui.renderFloors();
    }
    cam.lookAt(this.boss.x, this.boss.y - 1.5, this.boss.z);
    cam.goalDist = dist;
    cam.el = 0.42;
  }

  /* ══════════════════════ 1인칭 ══════════════════════
     사장이 직접 사무실을 걷는다. 조이스틱은 화면 벡터만 만들고, 그것을
     월드 방향으로 바꾸는 일은 카메라가 한다 (facing 규약이 한 곳에만 있어야
     한다). 충돌은 층별 NavGrid 로 본다 — 걷기와 길찾기가 같은 격자를 보므로
     "직원은 지나가는데 나는 막히는" 자리가 생기지 않는다. */
  enterWalk() {
    if (this.walk) return;
    this.walk = true;
    document.body.classList.add('walking');
    if (this.stick) this.stick.setEnabled(true);
    const nav = this.crew.navFor(this.floor);
    // 엘리베이터 앞 로비에서 시작한다. 막혀 있으면 그 근처의 빈 칸을 찾는다.
    let x = 33, z = 32;
    if (nav && !nav.circleClear(x, z, 1.3)) {
      outer:
      for (let r = 2; r < 26; r += 1.5) {
        for (let a = 0; a < 12; a++) {
          const t = a * 0.5236;
          const px = x + Math.cos(t) * r, pz = z + Math.sin(t) * r;
          if (nav.circleClear(px, pz, 1.3)) { x = px; z = pz; break outer; }
        }
      }
    }
    cam.mode = 'walk';
    cam.setWalk(x, this.floor * STOREY + cam.eyeHeight, z, Math.PI);
    cam.wpitch = -0.06;
    this.wallCutSaved = this.wallCut;
    this.wallCut = false;          // 안에서 보는데 벽이 녹으면 방이 사라진다
  }

  exitWalk() {
    if (!this.walk) return;
    this.walk = false;
    document.body.classList.remove('walking');
    if (this.stick) this.stick.setEnabled(false);
    cam.mode = 'orbit';
    this.wallCut = this.wallCutSaved !== undefined ? this.wallCutSaved : true;
    this.setFloor(this.floor);
    cam.goalDist = isMobile() ? 82 : 86;
    cam.el = 0.78;
  }

  toggleWalk() { if (this.walk) this.exitWalk(); else this.enterWalk(); }

  /* 한 프레임의 걷기. 축을 따로 밀어보는 것이 요점이다: 한 번에 대각선으로
     밀면 벽에 스치는 순간 완전히 멈추고, 그게 "조이스틱이 이상하다"의
     정체다. X 를 먼저 시도하고 안 되면 Z 만 시도하면 벽을 타고 미끄러진다. */
  updateWalk(dt) {
    const st = this.stick;
    if (!st) return;
    st.setKeys(this.keys);
    const mag = st.magnitude();
    cam.bobAmp = mag;
    if (mag <= 0.001) return;

    const [dx, dz] = cam.walkVector(st.vx, st.vy);
    const speed = 13.5 * mag;
    const nav = this.crew.navFor(this.floor);
    const nx = cam.wx + dx * speed * dt;
    const nz = cam.wz + dz * speed * dt;
    const R = 1.25;
    if (!nav) { cam.wx = nx; cam.wz = nz; return; }
    // 이미 무언가 안에 서 있다면(층을 사서 가구가 새로 생겼거나, 세이브가
    // 예전 배치를 담고 있거나) 충돌을 풀어준다. 안 그러면 영원히 못 나온다.
    if (!nav.circleClear(cam.wx, cam.wz, R)) { cam.wx = nx; cam.wz = nz; return; }
    if (nav.circleClear(nx, nz, R)) { cam.wx = nx; cam.wz = nz; return; }
    if (nav.circleClear(nx, cam.wz, R)) { cam.wx = nx; return; }
    if (nav.circleClear(cam.wx, nz, R)) { cam.wz = nz; }
  }

  /* 1인칭에서 가장 가까운 직원. 말을 걸 수 있는 사람을 HUD 가 보여준다. */
  nearestStaff(maxDist = 7) {
    if (!this.walk) return null;
    let best = null, bd = maxDist * maxDist;
    for (const a of this.crew.all()) {
      if (a.floor !== this.floor) continue;
      const dx = a.x - cam.wx, dz = a.z - cam.wz;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  /* ---- camera / floor ---- */
  setFloor(f) {
    this.floor = clamp(f, 0, this.floorCount - 1);
    if (this.walk) {
      // 층을 바꾸면 걷고 있는 사람도 같이 올라간다. 안 그러면 허공에 선다.
      cam.wy = this.floor * STOREY + cam.eyeHeight;
    } else {
      cam.lookAt(BUILDING.x1 / 2, this.floor * STOREY + 6, BUILDING.z1 / 2);
    }
    renderer.fitLight([BUILDING.x1 / 2, this.floor * STOREY + 5, BUILDING.z1 / 2], 62);
  }

  stepFloor(d) {
    this.setFloor(this.floor + d);
    ui.renderFloors();
  }

  toggleCut() { this.wallCut = !this.wallCut; }

  focusStaff(id) {
    this.focused = id;
    if (!id) return;
    const a = this.crew.get(id);
    if (!a) return;
    if (a.floor !== this.floor) { this.setFloor(a.floor); ui.renderFloors(); }
    cam.lookAt(a.x, a.floor * STOREY + 5, a.z);
    cam.goalDist = Math.min(cam.goalDist, 30);
  }

  /* ---- the meeting scene ----
     Returns a promise that resolves when the scene is over, so the UI can hold
     an idea card back until the team has actually discussed it. A tap anywhere
     skips ahead. */
  playMeeting(phase, teamIds, vars) {
    if (!this.meetingScenes || !teamIds || !teamIds.length) return Promise.resolve();
    const mtg = this.crew.meetingOn(this.floor);
    if (!mtg) return Promise.resolve();

    return new Promise((resolve) => {
      let done = false;
      const timers = [];
      const finish = (disperse) => {
        if (done) return;
        done = true;
        for (const t of timers) clearTimeout(t);
        this._skip = null;
        document.body.classList.remove('meeting');
        if (disperse !== false) this.crew.endMeeting();
        this.restoreCam();
        for (const a of this.crew.all()) a.bubble = null;
        resolve();
      };
      this._skip = () => finish(true);

      document.body.classList.add('meeting');
      if (mtg.floor !== this.floor) { this.setFloor(mtg.floor); ui.renderFloors(); }
      this.focusMeeting(mtg);

      const speakers = teamIds
        .map((id) => this.crew.get(id))
        .filter(Boolean)
        .map((a) => ({ id: a.id, role: a.role || 'plan' }));

      let started = false;
      const begin = () => {
        if (started || done) return;
        started = true;
        const script = meetingScript(phase, speakers, vars || {}, this.rnd);
        let last = 0;
        for (const line of script) {
          last = Math.max(last, line.at);
          timers.push(setTimeout(() => {
            const a = this.crew.get(line.id);
            if (a) a.say(line.text, 2.6);
          }, line.at * 1000));
        }
        // Hold a beat after the last line so it can be read, then break up.
        timers.push(setTimeout(() => finish(true), (last + 2.4) * 1000));
      };

      this.crew.startMeeting(teamIds, mtg.floor, begin);

      // The walk is scenery, not a gate. Give it a few seconds to look good,
      // then seat whoever is still on their feet and start the discussion —
      // frame time is clamped for stability, so on a slow device the walk runs
      // in slow motion and waiting for it would stall the game.
      timers.push(setTimeout(() => { this.crew.forceSeat(); begin(); }, 4500));
    });
  }

  skipMeeting() { if (this._skip) this._skip(); }

  focusMeeting(mtg) {
    if (!this.camSaved) {
      this.camSaved = { x: cam.gx, y: cam.gy, z: cam.gz, d: cam.goalDist, el: cam.el, az: cam.az };
    }
    // Watch from inside the office looking north-east through the glass wall,
    // rather than from outside the building looking in past the facade. The
    // distance has to clear the speech bubbles, which sit above the heads and
    // are the thing the shot actually exists to show.
    cam.lookAt(mtg.center[0], mtg.center[1] + 1, mtg.center[2]);
    cam.goalDist = 44;
    cam.el = 0.55;
    cam.az = -0.90;
  }

  restoreCam() {
    const c = this.camSaved;
    this.camSaved = null;
    if (!c) return;
    cam.lookAt(c.x, c.y, c.z);
    cam.goalDist = c.d;
    cam.el = c.el;
    cam.az = c.az;
  }

  /* ---- effects driven by game events ---- */
  startWork(teamIds) {
    const set = new Set(teamIds);
    for (const a of this.crew.all()) a.busy = set.has(a.id);
  }

  playBattle({ project, events }) {
    this.startWork(project.team);
    this.ensureBoss(project);
    for (const ev of events) {
      if (ev.kind === 'hit' || ev.kind === 'crit') {
        const a = this.crew.get(ev.staffId);
        if (!a) continue;
        a.reactWith(ev.kind === 'crit' ? 'idea' : 'type', ev.kind === 'crit' ? 1.5 : 0.7);
        if (ev.kind === 'crit') a.say(critLine(this.rnd), 2.0, 'idea');
        if (this.boss) this.boss.hit(ev.kind === 'crit' ? 1.4 : 0.55);
        // 데미지 숫자는 맞은 쪽 — 보스 위로 뜬다. 때린 사람 위에 뜨면
        // 누가 맞고 있는지가 화면에서 사라진다.
        const src = this.boss
          ? { x: this.boss.x + (this.rnd() - 0.5) * 5, y: this.boss.y + 1.5 + this.rnd() * 2, z: this.boss.z + (this.rnd() - 0.5) * 4 }
          : { x: a.x, y: a.floor * STOREY + 6.4, z: a.z };
        this.effects.push({
          ...src, text: ev.damage, crit: ev.kind === 'crit',
          stat: ev.stat, life: 0, ttl: 1.15, el: null,
        });
      } else if (ev.kind === 'boss') {
        // 반격: 보스가 부풀었다가 팀원들 머리 위로 붉은 숫자가 뜬다.
        if (this.boss) this.boss.rage(this.boss.phase);
        for (const h of ev.hits || []) {
          const a = this.crew.get(h.staffId);
          if (!a) continue;
          a.reactWith('shock', 1.2);
          a.say(ev.line, 2.2);
          this.effects.push({
            x: a.x, y: a.floor * STOREY + 6.4, z: a.z,
            text: '-' + h.damage, hurt: true, stat: null, life: 0, ttl: 1.3, el: null,
          });
        }
        this.effects.push({
          x: this.boss ? this.boss.x : 0, y: (this.boss ? this.boss.y : 0) + 5.2,
          z: this.boss ? this.boss.z : 0,
          text: ev.ko, boss: true, life: 0, ttl: 1.8, el: null,
        });
      } else if (ev.kind === 'phase') {
        if (this.boss) { this.boss.rage((this.boss.phase || 0) + 1); this.boss.scale = 1 + (this.boss.phase || 0) * 0.08; }
        this.focusBoss(38);
        this.effects.push({
          x: this.boss ? this.boss.x : 0, y: (this.boss ? this.boss.y : 0) + 6.0,
          z: this.boss ? this.boss.z : 0,
          text: ev.ko + ' — 약점!', boss: true, life: 0, ttl: 2.2, el: null,
        });
      }
    }
  }

  celebrate(teamIds) {
    if (this.boss) this.boss.kill();
    for (const a of this.crew.all()) a.busy = false;
    for (const id of teamIds || []) {
      const a = this.crew.get(id);
      if (a) a.cheerUntil = this.time + 3.2;
    }
  }

  /* ---- per-frame ---- */
  update(dt) {
    this.time += dt;
    if (this.walk) this.updateWalk(dt);
    for (const s of this.game.staff) {
      const a = this.crew.get(s.id);
      if (a) a.mood = s.motivation;
    }
    this.crew.update(dt, this.time, this.rnd);

    if (this.boss) {
      this.boss.faceTo(this.bossFaceYaw());
      this.boss.update(dt, this.time);
      if (this.boss.dead) this.clearBoss();
    }

    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life += dt;
      if (e.life > e.ttl) {
        if (e.el) e.el.remove();
        this.effects.splice(i, 1);
      }
    }
  }

  /* ---- DOM overlays ---- */
  drawOverlays(w, h) {
    const showFloor = this.floor;

    for (const { r, el } of this.roomEls) {
      if (r.floor !== showFloor) { el.style.display = 'none'; continue; }
      const p = cam.project(r.x, r.y, r.z, w, h);
      if (!p || p.z < -1 || p.z > 1) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
    }

    for (const a of this.crew.all()) {
      const tag = this.tags.get(a.id);
      const bub = this.bubbles.get(a.id);
      const visible = a.floor === showFloor;
      const p = visible ? cam.project(a.x, a.headY, a.z, w, h) : null;
      const on = p && p.z > -1 && p.z < 1;

      if (tag) {
        // The bubble replaces the name tag while someone is speaking, so the
        // two never stack on top of each other.
        if (!on || a.bubble) tag.style.display = 'none';
        else {
          tag.style.display = '';
          tag.textContent = a.name;
          tag.style.left = p.x + 'px';
          tag.style.top = p.y + 'px';
          tag.classList.toggle('busy', !!a.busy);
        }
      }
      if (bub) {
        if (!on || !a.bubble) bub.style.display = 'none';
        else {
          bub.style.display = '';
          bub.textContent = a.bubble.text;
          bub.className = 'bub' + (a.bubble.kind ? ' ' + a.bubble.kind : '');
          bub.style.left = p.x + 'px';
          bub.style.top = p.y + 'px';
        }
      }
    }

    for (const e of this.effects) {
      if (!e.el) {
        e.el = document.createElement('div');
        e.el.className = 'dmg' + (e.crit ? ' crit' : '') + (e.hurt ? ' hurt' : '')
          + (e.boss ? ' bossmsg' : '');
        const label = e.crit ? '번뜩임!' : (e.hurt ? '체력' : (e.stat ? STAT_LABEL[e.stat] : ''));
        e.el.innerHTML = `${e.text}${label && !e.boss ? `<span class="sk">${label}</span>` : ''}`;
        ov.appendChild(e.el);
      }
      const p = cam.project(e.x, e.y, e.z, w, h);
      if (!p || p.z < -1 || p.z > 1) { e.el.style.display = 'none'; continue; }
      e.el.style.display = '';
      e.el.style.left = p.x + 'px';
      e.el.style.top = p.y + 'px';
    }
  }

  /* ---- draw callback handed to the renderer ---- */
  draw(L, pass) {
    if (pass === 'glass') { renderer.drawMesh(L, this.gGlass, null); return; }
    renderer.drawMesh(L, this.gSolid, null);
    for (const a of this.crew.all()) renderer.drawMesh(L, a.rig, a.rig.world);
    if (this.boss) renderer.drawMesh(L, this.boss, this.boss.world);
  }
}

/* ══════════════════════════════════════ boot ══════════════════════════════ */

let renderer, cam, view, ui, game, tier = 'high', quality = TIERS.high;

async function boot() {
  bootStep('렌더러 준비');
  const gl = initGL(canvas);

  // Settings scale to the device rather than being fixed at "looks best on a
  // laptop": a phone GPU running the desktop tier drops to single figures.
  tier = detectTier(gl);
  quality = TIERS[tier];
  document.body.classList.toggle('touch', isTouch());
  document.body.dataset.tier = tier;

  const prefs = loadPrefs();
  renderer = new Renderer(canvas, {
    shadowSize: quality.shadowSize,
    bloomLevels: quality.bloomLevels,
    storey: STOREY,
    exposure: 1.06,
    bloomAmount: 0.05,
    bloomThreshold: 1.15,
    grain: quality.grain,
    aberration: quality.aberration,
    vignette: quality.vignette,
    // 기본이 'bright' 다. 실기기에서 예전 기본값은 밖에서 거의 안 보였다.
    brightness: prefs.brightness || 'bright',
  });
  cam = new OrbitCamera();
  if (isMobile()) {
    // A phone in landscape is a wide, short window. Looking down more steeply
    // fills it with floor plate instead of sky, and a slightly wider lens keeps
    // the whole storey in frame without pushing the camera so far back that the
    // staff become specks.
    cam.fov = 0.60;
    cam.el = 0.88;
    cam.goalDist = 82;
  }

  game = Game.load() || new Game();
  view = new View(game);
  await view.build();

  view.setFloor(0);
  cam.snap();

  view.stick = new Joystick(ov);
  view.setBrightness = (name) => {
    const applied = renderer.setBrightness(name);
    view.prefs.brightness = applied;
    savePrefs(view.prefs);
    return applied;
  };
  view.brightness = () => renderer.brightness;
  view.brightnessSteps = LIGHT_ORDER;

  // 저장된 게임을 이어서 열었는데 개발 중이었다면, 보스도 같이 돌아온다.
  if (game.project) view.ensureBoss(game.project);

  ui = new UI(game, view);
  window.__game = game;                 // console handles while balancing
  window.__staffMod = staffMod;         // tools/battle.mjs reads power/abilities here
  window.__view = view;
  window.__ui = ui;
  window.__renderer = renderer;
  window.__cam = cam;

  wirePointer();
  wireWalkKeys();
  suppressBrowserGestures(canvas);
  trackViewport(resize);

  $('boot').classList.add('gone');
  setTimeout(() => $('boot').remove(), 600);

  let last = performance.now();
  function frame(now) {
    // A 10fps floor rather than 20: below that the clamp turns a slow device
    // into visible slow motion, and walks that should take seconds take a minute.
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    tick(dt);
    view.frames++;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function resize() {
  if (!renderer) return;
  const vp = viewportSize();
  // Capping the device pixel ratio is the single biggest performance lever on a
  // phone: a 3x screen is nine times the fragments of a 1x one for a difference
  // most people cannot see at arm's length.
  const dpr = Math.min(window.devicePixelRatio || 1, quality.dprCap);
  const w = Math.max(1, Math.round(vp.w * dpr));
  const h = Math.max(1, Math.round(vp.h * dpr));
  if (canvas.width === w && canvas.height === h) return;
  canvas.width = w; canvas.height = h;
  renderer.resize(w, h);
}

function tick(dt) {
  view.update(dt);
  const vp = viewportSize();
  cam.update(dt, vp.w / Math.max(1, vp.h));

  // Hide every floor above the one being inspected, and the current floor's own
  // ceiling with it, so the dollhouse view can see in. The threshold sits just
  // above the wall tops: walls survive whole, the slab above them does not.
  //
  // 1인칭은 반대다: 안에서 보고 있으므로 천장이 있어야 방이 된다. 컷을
  // 한 층 위로 올려 지금 층의 천장은 남기고 위층만 잘라낸다.
  const floorY = view.walk
    ? view.floor * STOREY + STOREY - 0.2
    : view.floor * STOREY + BUILDING.wallH + 0.1;

  renderer.render({
    vp: cam.vp,
    eye: cam.eye,
    target: [cam.tx, cam.ty, cam.tz],
    wallCut: view.wallCut,
    floorY,
    time: view.time,
  }, (L, pass) => view.draw(L, pass));

  view.drawOverlays(vp.w, vp.h);
}

/* One pointer orbits. Two pinch to zoom and drag to pan. Pointer Events cover
   mouse, pen and touch with the same code, and pointer capture keeps a drag
   alive when the finger slides over the HUD. */
function wirePointer() {
  const pts = new Map();
  let pinch = 0, mid = null, moved = 0;
  const BOUNDS = { x0: -18, x1: 82, z0: -16, z1: 60 };

  const gather = () => {
    const a = [...pts.values()];
    if (a.length < 2) return null;
    const dx = a[0].x - a[1].x, dy = a[0].y - a[1].y;
    return { d: Math.hypot(dx, dy), x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 };
  };

  canvas.addEventListener('pointerdown', (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* already gone */ }
    // 1인칭에서 화면 왼쪽 아래를 누르면 그 자리에 조이스틱이 생긴다. 그
    // 포인터는 끝까지 스틱의 것이고, 나머지 포인터가 시점을 돌린다.
    if (view.walk && view.stick) {
      const vp = viewportSize();
      if (view.stick.claims(e.clientX, e.clientY, vp.w, vp.h)) {
        view.stick.begin(e.pointerId, e.clientX, e.clientY);
        firstGesture();
        return;
      }
    }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.classList.add('drag');
    moved = 0;
    const g = gather();
    if (g) { pinch = g.d; mid = g; }
    firstGesture();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (view.walk && view.stick && view.stick.move(e.pointerId, e.clientX, e.clientY)) return;
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    const nx = e.clientX, ny = e.clientY;
    moved += Math.abs(nx - prev.x) + Math.abs(ny - prev.y);
    if (pts.size === 1) {
      if (view.walk) cam.look(nx - prev.x, ny - prev.y);
      else cam.orbit(nx - prev.x, ny - prev.y);
    }
    pts.set(e.pointerId, { x: nx, y: ny });

    if (pts.size >= 2 && !view.walk) {
      const g = gather();
      if (g) {
        if (pinch > 0 && g.d > 0) cam.zoom((pinch - g.d) * 2.0);
        if (mid) cam.pan(g.x - mid.x, g.y - mid.y, BOUNDS);
        pinch = g.d; mid = g;
      }
    }
  });

  const release = (e) => {
    if (view.stick && view.stick.end(e.pointerId)) return;
    // A tap rather than a drag skips whatever cutscene is running.
    if (moved < 8 && pts.size === 1) view.skipMeeting();
    pts.delete(e.pointerId);
    if (pts.size < 2) { pinch = 0; mid = null; }
    if (!pts.size) canvas.classList.remove('drag');
    try {
      if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
    } catch (err) { /* ignore */ }
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!view.walk) cam.zoom(e.deltaY);
  }, { passive: false });
}

/* 데스크톱에서는 WASD 로 걷는다. 조이스틱과 같은 벡터로 들어가므로
   이동 코드는 하나뿐이다. */
function wireWalkKeys() {
  const map = { w: 'fwd', s: 'back', a: 'left', d: 'right', arrowup: 'fwd', arrowdown: 'back', arrowleft: 'left', arrowright: 'right' };
  const set = (e, on) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (k === 'f' && on) { view.toggleWalk(); ui.renderShell(); return; }
    if (!view.walk) return;
    const slot = map[k];
    if (!slot) return;
    e.preventDefault();
    view.keys[slot] = on;
  };
  window.addEventListener('keydown', (e) => set(e, true));
  window.addEventListener('keyup', (e) => set(e, false));
  window.addEventListener('blur', () => { view.keys = { fwd: false, back: false, left: false, right: false }; });
}

/* Browsers only grant fullscreen and orientation lock from inside a user
   gesture, and only once asked. Ask on the first interaction, then stop. */
let gestureUsed = false;
function firstGesture() {
  if (gestureUsed) return;
  gestureUsed = true;
  if (isTouch()) goFullscreen();
}
window.addEventListener('pointerdown', firstGesture, { once: true, capture: true });

boot().catch((err) => {
  console.error(err);
  const b = $('boot');
  if (b) {
    b.classList.remove('gone');
    b.innerHTML = `<div class="bt">실행할 수 없습니다</div>
      <div class="bs">${String(err && err.message || err)}</div>
      <div class="bs">이 게임은 WebGL2를 지원하는 브라우저가 필요합니다.</div>`;
  }
});
