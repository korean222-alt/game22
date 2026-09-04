/* Boot, the frame loop, and the bridge between the simulation and the 3D view.

   Responsibilities are deliberately narrow: this file owns nothing about game
   rules and nothing about shading. It builds the world once, keeps one Agent
   per staffer, and translates game events into things you can watch happen in
   the office — a team walking to the meeting room, damage numbers over a desk,
   someone getting up for coffee. */

import { initGL, upload, disposeMesh } from './core/gl.js';
import { MeshBuilder, splitGlass } from './core/meshbuilder.js';
import { bakeAO, NavGrid } from './core/bake.js';
import { clamp, mulberry32 } from './core/math.js';
import { Renderer, LIGHT_ORDER } from './render/renderer.js';
import { SkinnedPass } from './render/skinned.js';
import { OrbitCamera } from './render/camera.js';
import { Rig } from './char/rig.js';
import './world/palette.js';                  // registers the hex -> material map
import { buildOffice, BUILDING, FLOOR_PLANS, STOREY, placeZones, inPlaceZone } from './world/office.js';
import { buildPlaced, buildGhost } from './world/placed.js';
import { FURNITURE_BY_ID } from './game/furniture.js';
import { Crew, Agent, ST } from './world/agents.js';
import { Boss, bossSpot, preloadMonster, monsterFor, monsterForStage, tauntFor } from './world/boss.js';
import { Game } from './game/state.js';
import { addMotivation } from './game/staff.js';
import * as staffMod from './game/staff.js';
import { FirstPerson, SPOT_KO } from './ui/firstperson.js';
import { meetingScript, critLine, idleLine } from './game/dialogue.js';
import { UI } from './ui/hud.js';
import {
  TIERS, detectTier, isTouch, isMobile, viewportSize, trackViewport,
  suppressBrowserGestures, goFullscreen, shouldShowInstallGuide, wireInstallGuide,
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

/* What someone says on their way out. Picked by id so the same person always
   leaves the same way. */
const BYE_LINES = [
  '그동안 감사했습니다!',
  '다들 건강하세요.',
  '좋은 회사였어요. 진심으로요.',
  '다음에 또 뵙겠습니다.',
  '짐은 다 챙겼습니다. 안녕히 계세요.',
];

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
    this.boss = null;               // the idea currently being fought
    this.arena = false;             // 보스 아레나 카메라가 켜져 있는가
    this.bossEl = null;
    this.bossProject = null;
    this.bossFloor = 0;

    /* ---- 가구 배치 ---- */
    this.place = null;              // the piece being positioned, if any
    this.gPlaced = null; this.gGhost = null; this.gZones = null;
    this.frameOpts = null;          // last frame's camera/cut state, for the skin pass

    /* ---- 1인칭 ---- */
    this.entrance = null;
    this.cam = null;                // set once the camera exists, for first person
    this.storey = STOREY;
    this.fp = new FirstPerson(this);
    this.prefs = loadPrefs();
    // Ids the office is still animating even though the game has already
    // dropped them from the roster, so syncAgents does not delete a body that
    // is halfway to the door.
    this.leaving = new Set();
    this.arriving = new Set();
  }

  /* ---- world ---- */
  async build() {
    bootStep('사무실 배치');
    await nextFrame();
    const built = buildOffice(Math.max(1, this.floorCount));
    this.desks = built.desks;
    this.rooms = built.rooms;
    this.entrance = built.entrance;

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
    this.navArea = { x0: BUILDING.x0 - 2, z0: BUILDING.z0 - 2, x1: BUILDING.x1 + 2, z1: BUILDING.z1 + 2 };
    // Two grids per storey. `navBase` knows only the building and never
    // changes, so a placement can be tested against walls without being
    // rejected by the furniture already standing there — including the piece
    // being moved. `navs` adds the furniture and is what people walk on.
    this.officeSolids = built.mesh.solids;
    this.navBase = [];
    for (let f = 0; f < built.floors; f++) {
      this.navBase.push(this.gridFor(f, built.mesh.solids));
      await nextFrame();
    }
    this.meetings = built.meetings;
    this.spots = built.spots;

    bootStep('GPU 업로드');
    await nextFrame();
    const split = splitGlass(built.mesh);
    disposeMesh(this.gSolid); disposeMesh(this.gGlass);
    this.gSolid = upload(split.solid);
    this.gGlass = upload(split.glass);

    this.buildRoomLabels();
    this.rebuildFurniture();
  }

  gridFor(floor, solids) {
    return new NavGrid({ solids }, floor * STOREY + 1.0, floor * STOREY + 5.5, 0.5, 1, this.navArea);
  }

  /* ---- placed furniture ----
     Rebuilt whole rather than patched. It is a few hundred triangles, so
     throwing the mesh away and making a new one is cheaper than reasoning
     about incremental updates — and it means the desks the staff system sees,
     the mesh on screen and the grid people walk on can never disagree. */
  rebuildFurniture() {
    const built = buildPlaced(this.game.company.placed);
    this.desks = built.desks;
    disposeMesh(this.gPlaced);
    this.gPlaced = built.mesh.count() ? upload(splitGlass(built.mesh).solid) : null;

    // Solids carry world Y and buildPlaced already lifted them onto their
    // storey, so each floor's grid filters by its own Y window and the combined
    // list can be shared. With nothing placed, the unchanged base grid is
    // reused rather than rebuilt.
    const furn = built.mesh.solids;
    const all = furn.length ? this.officeSolids.concat(furn) : null;
    const navs = [];
    for (let f = 0; f < this.floorCount; f++) {
      navs.push(all ? this.gridFor(f, all) : this.navBase[f]);
    }
    this.crew.setWorld({ navs, meetings: this.meetings, spots: this.spots });

    this.game.assignDesks(this.desks);
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
      // Someone walking out of the building is no longer on the roster but is
      // still on screen; dropOut() disposes them when they reach the door.
      if (live.has(a.id) || this.leaving.has(a.id)) continue;
      this.dropAgent(a);
    }

    for (const s of this.game.staff) {
      let a = this.crew.get(s.id);
      const fresh = !a;
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
      const moved = (a.home ? a.home.id : null) !== (d ? d.id : null);
      a.home = d;
      if (fresh && this.arriving.has(s.id) && this.entrance) {
        // A new hire comes in through the front doors and walks to their desk.
        this.arriving.delete(s.id);
        const e = this.entrance;
        a.placeAt(e.x, e.z, e.yaw, e.floor);
        a.state = ST.STAND;
        a.placed = true;
        a.say('오늘부터 잘 부탁드립니다!', 3.4);
        if (d) {
          setTimeout(() => {
            if (!this.crew.get(a.id)) return;
            a.goTo({ x: d.seatX, z: d.seatZ, yaw: d.yaw, floor: d.floor, state: ST.SIT },
              this.crew.navFor(a.floor));
          }, 1100);
        }
      } else if (d && (!a.placed || moved)) {
        // A newly seated person appears at their desk rather than walking in
        // from nowhere. Desks can also be picked up mid-game, so a reassignment
        // has to re-seat someone who is already placed — otherwise they carry
        // on typing at a desk that is back in the bag.
        a.sitAt({ x: d.seatX, z: d.seatZ, yaw: d.yaw, floor: d.floor });
        a.placed = true;
      } else if (!d && (!a.placed || moved)) {
        // Nowhere to sit: stand in the ground-floor lobby, which is the one
        // place guaranteed to exist and be walkable.
        a.placeAt(30 + (s.id % 5) * 2.4, 24, Math.PI, 0);
        a.state = ST.STAND;
        a.placed = true;
      }
    }
  }

  dropAgent(a) {
    disposeMesh(a.rig);
    this.crew.remove(a.id);
    this.leaving.delete(a.id);
    for (const map of [this.tags, this.bubbles]) {
      const el = map.get(a.id);
      if (el) { el.remove(); map.delete(a.id); }
    }
  }

  /* A hire is announced before the roster event, so the id is waiting when
     syncAgents builds the body. */
  walkIn(staff) {
    if (!staff) return;
    this.arriving.add(staff.id);
    this.syncAgents();
    const a = this.crew.get(staff.id);
    if (a && this.entrance && this.floor !== this.entrance.floor) {
      this.setFloor(this.entrance.floor);
      if (ui) ui.renderFloors();
    }
  }

  /* Someone who has left says goodbye, walks to the front doors and goes.
     Deleting the body where it sat left a ghost typing at an empty desk, which
     is the one thing a simulated office must never do. */
  walkOut(staff) {
    const a = staff && this.crew.get(staff.id);
    if (!a) return;
    const e = this.entrance;
    this.leaving.add(a.id);
    a.busy = false;
    a.home = null;
    a.cheerUntil = 0;
    a.seatTarget = null;
    a.say(BYE_LINES[a.id % BYE_LINES.length], 4.0);

    const gone = () => {
      if (e) { a.placeAt(e.outX, e.outZ, 0, e.floor); a.state = ST.STAND; }
      setTimeout(() => this.dropAgent(a), 1500);
    };
    if (!e) { gone(); return; }
    if (a.floor !== e.floor) {
      // Down the lift, off screen, and out through the lobby.
      a.floor = e.floor;
      a.placeAt(31.5, 14.5, Math.PI, e.floor);
      a.state = ST.STAND;
    }
    if (this.floor !== e.floor) { this.setFloor(e.floor); if (ui) ui.renderFloors(); }
    setTimeout(() => {
      if (!this.crew.get(a.id)) return;
      a.goTo({ x: e.x, z: e.z, yaw: 0, floor: e.floor, state: ST.STAND },
        this.crew.navFor(e.floor), gone);
    }, 900);
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
    // 3연전이므로 키는 프로젝트가 아니라 **프로젝트+스테이지**다. 예전처럼
    // 프로젝트 id 만 보면 두 번째 보스가 첫 번째 놈의 몸으로 나온다.
    const key = project.id + ':' + (project.stage || 0);
    if (this.boss && !this.boss.dead && this.bossProject === key) return;
    this.spawnBoss(project);
  }

  /* 모델은 네트워크에서 온다. 로딩 중에 프로젝트가 끝나거나 바뀌었을 수
     있으므로, 돌아왔을 때 아직 같은 프로젝트인지 확인하고 붙인다.
     .glb 가 끝내 오지 않아도 전투는 예전 그대로 돌아간다. */
  async spawnBoss(project) {
    this.clearBoss();
    if (!project) return;
    const def = monsterForStage(project);
    const want = project.id + ':' + (project.stage || 0);
    this.bossProject = want;
    const model = await preloadMonster(def);
    if (!model || this.bossProject !== want || this.game.project !== project) return;

    this.boss = new Boss(def, model);
    this.boss.phase = project.phase || 0;
    this.boss.scale = 1 + (project.phase || 0) * 0.08;
    const spot = this.bossSpot(project);
    this.boss.setAnchor(spot[0], spot[1], spot[2], this.bossFloor);
    this.boss.faceTo(this.bossFaceYaw());
    this.boss.yaw = this.boss.goalYaw;
    this.boss.say(tauntFor(def, this.rnd), 3.4);
    if (!this.bossEl) {
      this.bossEl = document.createElement('div');
      this.bossEl.className = 'bosstag';
      ov.appendChild(this.bossEl);
    }
    return this.boss;
  }

  clearBoss() {
    if (this.boss) this.boss.dispose();
    this.boss = null;
    this.bossProject = null;
    if (this.bossEl) this.bossEl.style.display = 'none';
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
    // 팀이 앉은 층에, 그 층의 고정 아레나 자리로. 무게중심을 쓰면 데몬이
    // 자기를 때리는 책상 위에 서게 된다 — 통로 교차점이 어느 층에서나
    // 비어 있는 것이 보장된 유일한 바닥이다.
    this.bossFloor = floor;
    const spot = bossSpot(floor);
    return [spot.x, spot.y, spot.z];
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

  /* ---- camera / floor ---- */
  setFloor(f) {
    this.floor = clamp(f, 0, this.floorCount - 1);
    cam.lookAt(BUILDING.x1 / 2, this.floor * STOREY + 6, BUILDING.z1 / 2);
    renderer.fitLight([BUILDING.x1 / 2, this.floor * STOREY + 5, BUILDING.z1 / 2], 62);
    // The piece being placed belongs to whichever storey is being looked at, so
    // changing floors mid-placement moves it rather than stranding it below.
    if (this.place) { this.buildZoneOverlay(); this.refreshGhost(); }
    // The floor rail keeps working while walking around: you take the lift.
    if (this.fp && this.fp.on && this.fp.floor !== this.floor) this.fp.setFloor(this.floor);
  }

  stepFloor(d) {
    this.setFloor(this.floor + d);
    ui.renderFloors();
  }

  toggleCut() { this.wallCut = !this.wallCut; }

  /* ---- 배치 모드 ----
     A mode rather than drag-and-drop: on a phone there is no hover, and one
     finger already means "orbit the camera". While placing, one finger moves
     the ghost and two still work the camera, so nothing is lost. */
  startPlacing(uid) {
    const item = this.game.bag.find((b) => b.uid === uid);
    if (!item) return false;
    const def = FURNITURE_BY_ID.get(item.id);
    if (!def) return false;
    // Open in the middle of the first bay on this floor, so the piece is on
    // screen and legal before the player has moved anything.
    const zone = placeZones(this.floor)[0];
    this.place = {
      uid, id: item.id, def, rot: 0,
      x: Math.round((zone.x0 + zone.x1) / 2 * 2) / 2,
      z: Math.round((zone.z0 + zone.z1) / 2 * 2) / 2,
      valid: false,
    };
    document.body.classList.add('placing');
    this.refreshGhost();
    return true;
  }

  stopPlacing() {
    this.place = null;
    disposeMesh(this.gGhost); this.gGhost = null;
    disposeMesh(this.gZones); this.gZones = null;
    document.body.classList.remove('placing');
    // The toolbar belongs to the UI, but leaving it on screen after the mode
    // ends is a lie about what tapping the floor will do — so leaving the mode
    // always takes it down, whoever ended it.
    if (ui) ui.renderPlaceBar();
  }

  movePlace(x, z) {
    if (!this.place) return;
    // Half-unit snapping: fine enough to line desks up by eye, coarse enough
    // that a shaky finger does not produce a desk at x = 12.037.
    this.place.x = Math.round(x * 2) / 2;
    this.place.z = Math.round(z * 2) / 2;
    this.refreshGhost();
  }

  rotatePlace() {
    if (!this.place) return;
    this.place.rot = (this.place.rot + 1) & 3;
    this.refreshGhost();
  }

  /* Does a footprint clear the building's own walls and fittings? Sampled on
     the base grid at half-unit steps — the same resolution the grid is built
     at, so a gap it reports is a gap that exists. */
  clearOfWalls(floor, x, z, w, d) {
    const nav = this.navBase[floor];
    if (!nav) return true;
    const nx = Math.max(2, Math.ceil(w / 0.5)), nz = Math.max(2, Math.ceil(d / 0.5));
    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j <= nz; j++) {
        const px = x - w / 2 + (w * i) / nx;
        const pz = z - d / 2 + (d * j) / nz;
        if (!nav.isClearRaw(px, pz)) return false;
      }
    }
    return true;
  }

  placeChecks() {
    return {
      zoneOk: (floor, x, z, w, d) => inPlaceZone(floor, x, z, w, d),
      clearOfWalls: (floor, x, z, w, d) => this.clearOfWalls(floor, x, z, w, d),
    };
  }

  refreshGhost() {
    const p = this.place;
    disposeMesh(this.gGhost); this.gGhost = null;
    if (!p) return;
    const chk = this.game.canPlace(p.uid, this.floor, p.x, p.z, p.rot, this.placeChecks());
    p.valid = chk.ok;
    p.why = chk.why || '';
    if (ui) ui.renderPlaceBar();
    const mb = buildGhost(p.id, this.floor, p.x, p.z, p.rot);
    if (mb) {
      // Recolour rather than draw a separate marker: the ghost IS the piece, so
      // a red one is unmistakably this desk not fitting, not a generic error.
      const col = p.valid ? [0.42, 0.86, 0.62] : [0.95, 0.34, 0.30];
      for (let i = 0; i < mb.c.length; i += 3) { mb.c[i] = col[0]; mb.c[i + 1] = col[1]; mb.c[i + 2] = col[2]; }
      for (let i = 0; i < mb.f.length; i++) mb.f[i] = 2;      // draw in the blended pass
      this.gGhost = upload(mb);
    }
    if (!this.gZones) this.buildZoneOverlay();
  }

  /* A translucent floor patch over every bay on this storey, so "where may this
     go" is answerable at a glance instead of by trial and error. */
  buildZoneOverlay() {
    disposeMesh(this.gZones);
    const mb = new MeshBuilder();
    mb.noSolid = true;
    mb.flag = 2;
    const y = this.floor * STOREY + 0.06;
    for (const r of placeZones(this.floor)) {
      mb.quad([r.x0, y, r.z1], [r.x1, y, r.z1], [r.x1, y, r.z0], [r.x0, y, r.z0], '#3f7fd0');
    }
    this.gZones = mb.count() ? upload(mb) : null;
  }

  commitPlace() {
    const p = this.place;
    if (!p) return { ok: false };
    const r = this.game.placeFurniture(p.uid, this.floor, p.x, p.z, p.rot, this.placeChecks());
    if (!r.ok) return r;
    this.stopPlacing();
    this.rebuildFurniture();
    return r;
  }

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
    // Not while the player is walking around: hijacking the camera out of a
    // first-person view is disorienting, and the team is right there anyway.
    if (this.fp && this.fp.on) return Promise.resolve();
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

  /* ══════════════════════ 1인칭 ══════════════════════
     두 갈래가 각자 1인칭을 만들었다. 남긴 쪽은 `ui/firstperson.js` — 카메라
     바깥에 있어서 궤도 카메라가 걷기를 알 필요가 없고, 조이스틱도 자기
     DOM 을 쓴다. 여기 있던 조이스틱·walk 카메라 구현은 그래서 걷어냈다.
     `walk` 는 그 시절 호출부가 아직 읽는 이름이라 별칭으로 남긴다. */
  get walk() { return this.fp.on; }
  toggleWalk() { this.fp.toggle(); }
  enterWalk() { this.fp.enter(this.floor); }
  exitWalk() { this.fp.exit(); }

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
        if (a) {
          a.reactWith(ev.kind === 'crit' ? 'idea' : 'type', ev.kind === 'crit' ? 1.5 : 0.7);
          if (ev.kind === 'crit') a.say(critLine(this.rnd), 2.0, 'idea');
        }
        if (this.boss) this.boss.hit(ev.kind === 'crit' ? 1.2 : 0.45);
        // 데미지 숫자는 맞은 쪽 — 보스 위로 뜬다. 때린 사람 위에 뜨면
        // 누가 맞고 있는지가 화면에서 사라진다.
        const src = this.boss
          ? { x: this.boss.x + (this.rnd() - 0.5) * 5, y: this.boss.y + 1.5 + this.rnd() * 2.6, z: this.boss.z + (this.rnd() - 0.5) * 4 }
          : (a ? { x: a.x, y: a.floor * STOREY + 6.4, z: a.z } : { x: 0, y: 6, z: 0 });
        this.effects.push({
          ...src, text: ev.damage, crit: ev.kind === 'crit',
          stat: ev.stat, life: 0, ttl: ev.kind === 'crit' ? 1.25 : 0.85, el: null,
        });
      } else if (ev.kind === 'boss') {
        // 반격: 보스가 부풀었다가 팀원들 머리 위로 붉은 숫자가 뜬다.
        if (this.boss) { this.boss.attack(this.rnd); this.boss.rage(this.boss.phase); }
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
      } else if (ev.kind === 'stageClear') {
        // 한 마리가 쓰러진다. 다음 놈은 카드를 고른 뒤에 선다.
        if (this.boss) {
          this.effects.push({
            x: this.boss.x, y: this.boss.headY + 1.4, z: this.boss.z,
            text: ev.name + ' 격파!', boss: true, life: 0, ttl: 2.4, el: null,
          });
          this.boss.kill();
        }
        for (const id of project.team) {
          const a = this.crew.get(id);
          if (a) a.cheerUntil = this.time + 2.6;
        }
      } else if (ev.kind === 'stageStart') {
        // 새 보스. ensureBoss 가 스테이지를 키에 넣으므로 다른 몸으로 선다.
        this.ensureBoss(project);
        this.focusBoss(this.arena ? 34 : 38);
      } else if (ev.kind === 'down') {
        const a = this.crew.get(ev.staffId);
        if (a) { a.reactWith('shock', 2.4); a.say('더는 못 하겠어…', 2.6); }
      }
    }
    if (project.hp <= 0 && this.boss && !events.some((e) => e.kind === 'stageClear')) this.boss.kill();
  }

  /* ══ 아레나 ══
     보스를 화면 가운데에 놓고 낮은 각도에서 본다. 벽 자르기를 끄면 사무실이
     통째로 보이지만, 낮은 각도에서는 앞벽이 시야를 막는다 — 그래서 켠 채로
     둔다. 순수 카메라 연출이고 규칙은 건드리지 않는다. */
  enterArena(project) {
    this.arena = true;
    this.ensureBoss(project);
    if (this.fp && this.fp.on) this.fp.exit();
    if (this.bossFloor !== undefined && this.bossFloor !== this.floor) this.setFloor(this.bossFloor);
    this._camBefore = { dist: cam.goalDist, el: cam.el, az: cam.az, cut: this.wallCut };
    // 각도가 낮을수록 액션 RPG 처럼 보이지만, 눈이 층 안으로 들어가면 앞벽과
    // 책상이 화면의 대부분을 검게 덮는다. 벽 윗선 위로 올라오는 각도가
    // 이 사무실에서 보스를 실제로 볼 수 있는 가장 낮은 각도다.
    cam.goalDist = 30;
    cam.el = 0.52;
    this.wallCut = true;
    if (this.boss) cam.lookAt(...this.arenaTarget());
  }

  /* 화면 아래 3분의 1은 파티 카드가 쓴다. 보스의 한복판을 화면 한복판에
     두면 그 밴드에 다리가 잘리므로, 시선을 조금 아래로 내려 보스를 위로
     밀어 올린다. 큰 놈일수록 더 내린다. */
  arenaTarget() {
    const b = this.boss;
    if (!b) return [BUILDING.x1 / 2, this.floor * STOREY + 6, BUILDING.z1 / 2];
    const h = Math.max(1, b.headY - b.y);
    return [b.x, b.y + h * 0.28, b.z];
  }

  exitArena() {
    if (!this.arena) return;
    this.arena = false;
    const b = this._camBefore;
    if (b) { cam.goalDist = b.dist; cam.el = b.el; this.wallCut = b.cut; }
    this._camBefore = null;
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
    this.fp.update(dt);
    for (const s of this.game.staff) {
      const a = this.crew.get(s.id);
      if (a) a.mood = s.motivation;
    }
    this.crew.update(dt, this.time, this.rnd);

    if (this.boss) {
      this.boss.faceTo(this.bossFaceYaw());
      this.boss.update(dt);
      // 아레나에서는 카메라가 보스를 놓지 않는다. 아주 느리게 돌아서
      // 정지 화면처럼 보이지 않게만 한다.
      if (this.arena) {
        cam.lookAt(...this.arenaTarget());
        cam.az += dt * 0.055;
      }
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

    this.drawBossTag(w, h, showFloor);

    for (const e of this.effects) {
      if (!e.el) {
        e.el = document.createElement('div');
        e.el.className = 'dmg' + (e.crit ? ' crit' : '') + (e.hurt ? ' hurt' : '')
          + (e.boss ? ' bossmsg' : '') + (e.big ? ' big' : '');
        const label = e.crit ? '번뜩임!' : (e.hurt ? '체력' : (e.stat ? STAT_LABEL[e.stat] : ''));
        const txt = typeof e.text === 'number' ? Math.round(e.text).toLocaleString('ko-KR') : e.text;
        e.el.innerHTML = `${txt}${label && !e.boss ? `<span class="sk">${label}</span>` : ''}`;
        ov.appendChild(e.el);
      }
      const p = cam.project(e.x, e.y, e.z, w, h);
      if (!p || p.z < -1 || p.z > 1) { e.el.style.display = 'none'; continue; }
      e.el.style.display = '';
      e.el.style.left = p.x + 'px';
      e.el.style.top = p.y + 'px';
    }
  }

  /* The monster's name plate and health bar, in the DOM like every other label
     so it stays crisp and readable at any distance. */
  drawBossTag(w, h, showFloor) {
    const el = this.bossEl;
    if (!el) return;
    const b = this.boss, p = this.game.project;
    if (!b || b.floor !== showFloor || b.dying) { el.style.display = 'none'; return; }
    const pt = cam.project(b.x, b.headY, b.z, w, h);
    if (!pt || pt.z < -1 || pt.z > 1) { el.style.display = 'none'; return; }
    const frac = p && p.hpMax ? Math.max(0, p.hp / p.hpMax) : 1;
    el.style.display = '';
    el.style.left = pt.x + 'px';
    el.style.top = pt.y + 'px';
    el.innerHTML =
      `<div class="bn">${b.def.ko}</div>
       <div class="bbar"><i style="width:${(frac * 100).toFixed(1)}%"></i></div>
       ${b.bubble ? `<div class="btaunt">${b.bubble.text}</div>` : ''}`;
  }

  /* ---- draw callback handed to the renderer ---- */
  draw(L, pass) {
    if (pass === 'glass') {
      renderer.drawMesh(L, this.gGlass, null);
      // The zone patches and the ghost ride the blended pass: they are meant to
      // be seen through, and it saves a program of their own.
      renderer.drawMesh(L, this.gZones, null);
      renderer.drawMesh(L, this.gGhost, null);
      return;
    }
    renderer.drawMesh(L, this.gSolid, null);
    renderer.drawMesh(L, this.gPlaced, null);
    for (const a of this.crew.all()) renderer.drawMesh(L, a.rig, a.rig.world);

    // The monster runs through its own skinned program, so it goes last and
    // hands the pass back before anything else draws.
    if (this.boss && skinPass && this.frameOpts) {
      const p = this.game.project;
      const frac = p && p.hpMax ? p.hp / p.hpMax : 1;
      skinPass.begin(pass, this.frameOpts);
      skinPass.draw(this.boss.inst, this.boss.drawArgs(frac));
      skinPass.end(pass);
    }
  }
}

/* ══════════════════════════════════════ boot ══════════════════════════════ */

let renderer, cam, view, ui, game, skinPass, tier = 'high', quality = TIERS.high;

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
  skinPass = new SkinnedPass(renderer);
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
  view.cam = cam;
  wireFirstPerson();

  // A fresh studio is asked for a name and handed its grant; a loaded one that
  // was mid-project gets its monster back, so reopening the tab does not leave
  // the battle bar counting down an idea with no body.
  ui.openingFlow();
  if (game.project) view.spawnBoss(game.project);

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

  // On a phone the game really wants to be an installed app, so the first
  // visit says how. Shown after boot rather than before it, so the office is
  // already behind the card and the wait does not read as a second loading
  // screen.
  //
  // 창업 팝업보다 뒤로 미룬다. 첫 방문에는 둘이 같은 순간에 뜨고, 안내 카드가
  // 이름 입력 모달을 통째로 덮어 버려서 게임을 시작할 수가 없었다.
  if (shouldShowInstallGuide()) {
    if (game.company.founded) wireInstallGuide($('a2hs'));
    else ui.onFounded = () => wireInstallGuide($('a2hs'));
  }

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
  // 전투의 시계는 화면의 시계와 같다. 따로 돌리면 탭이 백그라운드로 갔을 때
  // 보이지 않는 곳에서 전투만 흘러간다.
  if (ui) ui.tickBattle(dt);
  view.update(dt);
  const vp = viewportSize();
  cam.update(dt, vp.w / Math.max(1, vp.h));

  // Hide every floor above the one being inspected, and the current floor's own
  // ceiling with it, so the dollhouse view can see in. The threshold sits just
  // above the wall tops: walls survive whole, the slab above them does not.
  //
  // Standing inside the room is the opposite case: the ceiling and its lights
  // are half of what makes it read as an office, so the cut moves up a storey
  // and only the floors ABOVE this one come off.
  const walking = view.fp && view.fp.on;
  const floorY = walking
    ? (view.fp.floor + 1) * STOREY + 0.35
    : view.floor * STOREY + BUILDING.wallH + 0.1;

  // Stashed rather than passed through: the draw callback only receives the
  // uniform block and the pass name, and the skinned program needs the camera.
  const opts = {
    vp: cam.vp,
    eye: cam.eye,
    target: [cam.tx, cam.ty, cam.tz],
    wallCut: view.wallCut && !walking,
    floorY,
    time: view.time,
  };
  view.frameOpts = opts;
  renderer.render(opts, (L, pass) => view.draw(L, pass));

  view.drawOverlays(vp.w, vp.h);
  if (view.fpTick) view.fpTick();
}

/* ══════════════════════════════════ 1인칭 ═══════════════════════════════════

   The controller in ui/firstperson.js owns movement and collision and knows no
   game rules; this is where walking around meets the company. Encouraging
   someone is a real action with a real cost model — once per person per week,
   so it is a routine you keep rather than a button you spam. */

const FP_STAFF_LINES = [
  '{name} 씨, 잘 하고 있어요.',
  '{name} 씨, 오늘 컨디션 좋아 보이네요.',
  '{name} 씨, 이번 건 기대하고 있습니다.',
  '{name} 씨, 무리하지 말고 갑시다.',
];
const FP_SPOT_LINES = {
  coffee: '커피 향이 좋다. 오후 회의는 이걸로 버틴다.',
  water: '정수기 옆이 늘 제일 시끄럽다. 좋은 뜻으로.',
  sofa: '누가 여기서 낮잠을 잤군.',
  table: '점심 메뉴 이야기가 아직 끝나지 않은 모양이다.',
  window: '창밖으로 도시가 보인다. 여기서 시작했지.',
  printer: '아무도 종이를 채워 넣지 않는다.',
  locker: '사물함에 누군가의 우산이 반년째 걸려 있다.',
};

function wireFirstPerson() {
  const fp = view.fp;
  const stick = $('fpStick');
  const knob = stick ? stick.querySelector('.knob') : null;
  const prompt = $('fpPrompt');
  const sayEl = $('fpSay');
  const act = $('fpAct');

  fp.onToggle = (on) => {
    if (!on) { cam.fp = null; cam.snap(); view.setFloor(view.floor); }
    else { cam.fp = { x: fp.x, y: 0, z: fp.z, yaw: fp.yaw, pitch: fp.pitch }; }
    ui.renderFloors();
  };

  /* Encouragement is capped per person per week: the week counter is the
     company's own clock, so the limit survives a save and cannot be farmed by
     walking in circles. */
  fp.onInteract = (t) => {
    const c = game.company;
    const wk = `${c.year}-${c.month}-${c.week}`;
    if (t.kind === 'staff') {
      const s = game.staff.find((x) => x.id === t.id);
      if (!s) return null;
      if (s.pepTalk === wk) return `${s.name} 씨는 이번 주에 이미 이야기를 나눴다.`;
      // Already maxed out: say so and do NOT spend the week's one visit, so a
      // wasted walk across the office is never the player's fault.
      if (s.motivation >= game.info().motivationCap) {
        return `${s.name} 씨는 이미 의욕이 최고조다.`;
      }
      s.pepTalk = wk;
      // 일벌레 only takes 0.4 of a point, so report what actually moved.
      const gain = addMotivation(s, 1, c.rank);
      t.agent.say('감사합니다, 사장님!', 2.6);
      t.agent.reactWith('idea', 1.0);
      game.emit('staff', null);
      game.save();
      const line = FP_STAFF_LINES[s.id % FP_STAFF_LINES.length].replace('{name}', s.name);
      return `${line}  (의욕 +${gain})`;
    }
    if (t.kind === 'spot') return FP_SPOT_LINES[t.spot.kind] || SPOT_KO[t.spot.kind] || '';
    if (t.kind === 'meeting') {
      const p = game.project;
      return p
        ? `「${p.title}」 진행 중 — 남은 HP ${Math.round(p.hp).toLocaleString('ko-KR')}`
        : '화이트보드는 비어 있다. 새 기획서를 뽑을 때가 됐다.';
    }
    return null;
  };

  const btn = $('fpBtn');
  if (btn) { btn.onclick = () => fp.toggle(); btn.style.touchAction = 'manipulation'; }
  const ex = $('fpExit');
  if (ex) { ex.onclick = () => fp.exit(); ex.style.touchAction = 'manipulation'; }
  if (act) act.onclick = () => fp.interact();

  if (stick) {
    let id = null;
    const set = (e) => {
      const r = stick.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const half = r.width / 2;
      let dx = (e.clientX - cx) / half, dy = (e.clientY - cy) / half;
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      fp.setStick(dx, dy);
      if (knob) knob.style.transform = `translate(${dx * half * 0.55}px, ${dy * half * 0.55}px)`;
    };
    const clear = () => {
      id = null;
      fp.setStick(0, 0);
      if (knob) knob.style.transform = '';
    };
    stick.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      try { stick.setPointerCapture(id); } catch (err) { /* ignore */ }
      set(e);
      e.preventDefault();
    });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
    for (const t of ['pointerup', 'pointercancel', 'pointerleave']) {
      stick.addEventListener(t, (e) => { if (e.pointerId === id) clear(); });
    }
  }

  // The prompt, the action button and the subtitle are cheap enough to refresh
  // every frame and always right, which a change-driven update would not be.
  view.fpTick = () => {
    if (!fp.on) return;
    const f = fp.focus;
    if (prompt) {
      prompt.classList.toggle('on', !!f);
      if (f) prompt.textContent = f.kind === 'staff' ? `${f.name} — 격려하기` : f.name;
    }
    if (act) {
      act.disabled = !f;
      act.textContent = f && f.kind === 'staff' ? '격려하기' : '살펴보기';
    }
    if (sayEl) {
      sayEl.classList.toggle('on', !!fp.say);
      if (fp.say) sayEl.textContent = fp.say.text;
    }
  };
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

  /* While placing, one finger drags the piece across the floor instead of
     orbiting. Two fingers still zoom and pan, so the camera is never locked
     out — which matters, because judging a desk's position needs to be able to
     look at it from another angle. */
  const dragPlace = (e) => {
    if (!view.place) return false;
    const vp = viewportSize();
    const hit = cam.hitPlane(e.clientX, e.clientY, vp.w, vp.h, view.floor * STOREY + 0.05);
    if (hit) view.movePlace(hit[0], hit[2]);
    return true;
  };

  canvas.addEventListener('pointerdown', (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* already gone */ }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.classList.add('drag');
    moved = 0;
    // Walking: a drag on the canvas turns your head. The stick is its own DOM
    // control, so the two can never be confused for one another.
    if (view.fp.on) { view.fp.startLook(e.pointerId, e.clientX, e.clientY); firstGesture(); return; }
    const g = gather();
    if (g) { pinch = g.d; mid = g; }
    if (pts.size === 1) dragPlace(e);
    firstGesture();
  });

  canvas.addEventListener('pointermove', (e) => {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    const nx = e.clientX, ny = e.clientY;
    moved += Math.abs(nx - prev.x) + Math.abs(ny - prev.y);

    pts.set(e.pointerId, { x: nx, y: ny });
    if (view.fp.on) { view.fp.moveLook(e.pointerId, nx, ny); return; }
    // Placement mode claims one finger before the camera does: while a piece is
    // in hand, dragging moves it. Two fingers still zoom and pan.
    if (pts.size === 1 && !dragPlace(e)) cam.orbit(nx - prev.x, ny - prev.y);

    if (pts.size >= 2 && !view.fp.on) {
      const g = gather();
      if (g) {
        if (pinch > 0 && g.d > 0) cam.zoom((pinch - g.d) * 2.0);
        if (mid) cam.pan(g.x - mid.x, g.y - mid.y, BOUNDS);
        pinch = g.d; mid = g;
      }
    }
  });

  const release = (e) => {
    if (view.fp.on) {
      view.fp.endLook(e.pointerId);
      // A tap with nothing dragged reaches for whatever you are looking at.
      if (moved < 8) view.fp.interact();
      pts.delete(e.pointerId);
      if (!pts.size) canvas.classList.remove('drag');
      return;
    }
    // A tap rather than a drag skips whatever cutscene is running.
    if (moved < 8 && pts.size === 1 && !view.place) view.skipMeeting();
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
    if (view.fp.on) return;
    cam.zoom(e.deltaY);
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (k === 'f') { e.preventDefault(); view.fp.toggle(); return; }
    if (!view.fp.on) return;
    if (k === 'e') { e.preventDefault(); view.fp.interact(); return; }
    if (k === 'escape') { view.fp.exit(); return; }
    view.fp.key(e, true);
  });
  window.addEventListener('keyup', (e) => { if (view.fp.on) view.fp.key(e, false); });
  window.addEventListener('blur', () => view.fp.keys.clear());
}

/* 데스크톱에서는 WASD 로 걷는다. 조이스틱과 같은 벡터로 들어가므로
   이동 코드는 하나뿐이다. */
function wireWalkKeys() {
  const map = { w: 'fwd', s: 'back', a: 'left', d: 'right', arrowup: 'fwd', arrowdown: 'back', arrowleft: 'left', arrowright: 'right' };
  const set = (e, on) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (k === 'f' && on) { view.fp.toggle(); return; }
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
