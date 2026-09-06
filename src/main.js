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
import { loadKit } from './world/kit.js';
import { initSound } from './ui/sound.js';
import { FURNITURE_BY_ID, footprint } from './game/furniture.js';
import { Crew, Agent, ST, homeState } from './world/agents.js';
import { Boss, bossSpot, preloadMonster, monsterFor, monsterForStage, stageSetOf, tauntFor } from './world/boss.js';
import { buildArena, arenaSetFor, inArenaZone } from './world/arena.js';
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
    this.bossProject = null;    // 지금 서 있는 놈의 키
    this.bossWant = null;       // 지금 세우려는 놈의 키 (모델을 기다리는 중일 수 있다)
    this.bossLoading = false;
    this.bossFailAt = 0;        // 모델을 못 받은 시각. 잠깐 쉬었다 다시 본다
    this.bossFloor = 0;
    /* ---- 아레나 세트장 ----
       사무실에서 아주 멀리 떨어진 자리에 세트를 짓고, 아레나에 들어가면
       카메라와 보스가 통째로 그리로 간다. 사무실은 그동안 그리지 않는다 —
       거리로 가려지긴 하지만, 안 그리는 편이 확실하고 또 싸다. */
    this.arenaSet = null;           // { id, def, mesh, spot, camera, light }
    this.gArena = null;

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
    bootStep('가구 모델 읽는 중');
    /* 배치된 가구를 짓기 전에 키트가 와 있어야 한다. 실패하면 null 이 오고,
       그때는 키트 가구가 상점에서 통째로 빠진다.

       도시·자동차 팩도 같은 자리에서 기다린다 — buildOffice 안에서 창밖
       스카이라인을 세우기 때문이다. 셋을 나란히 받으므로 부팅이 한 번의
       왕복만큼만 길어지고, 어느 하나가 실패해도 나머지는 그대로 선다. */
    await Promise.all([loadKit('furniture'), loadKit('city'), loadKit('car')]);

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
          if (cls === 'nm') {
            el.textContent = s.name;
            // 이름표를 누르면 그 사람의 상세가 열린다. 사무실에 서 있는
            // 사람과 명단의 한 줄이 이어지는 유일한 자리다.
            el.onclick = (e) => { e.stopPropagation(); if (ui) ui.openStaff(s.id); };
          }
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
      if (this.arriving.has(s.id) && this.entrance) {
        /* A new hire comes in through the front doors and walks to their desk.

           두 걸음으로 나뉜다. `hired` 가 먼저 오고(그때는 아직 책상이 없다)
           정문에 세우기만 한 뒤, 곧이어 오는 `desks` 가 어디로 갈지를
           알려주면 그때 걷기 시작한다. `arriving` 은 그 사이를 지키는
           표식이라, 자리가 정해질 때까지 지우지 않는다 — 지워 버리면 바로
           아래의 '자리가 바뀌었으면 앉힌다' 가 그 사람을 의자에 순간이동
           시킨다. 그것이 신입이 늘 자기 자리에 뿅 하고 나타나던 이유였다. */
        if (fresh) {
          const e = this.entrance;
          a.placeAt(e.x, e.z, e.yaw, e.floor);
          a.state = ST.STAND;
          a.placed = true;
          a.say('오늘부터 잘 부탁드립니다!', 3.4);
        }
        if (d) {
          this.arriving.delete(s.id);
          setTimeout(() => {
            if (!this.crew.get(a.id)) return;
            a.goTo({ x: d.seatX, z: d.seatZ, yaw: d.yaw, floor: d.floor, state: homeState(d) },
              this.crew.navFor(a.floor));
          }, 1100);
        }
      } else if (d && (!a.placed || moved)) {
        // A newly seated person appears at their desk rather than walking in
        // from nowhere. Desks can also be picked up mid-game, so a reassignment
        // has to re-seat someone who is already placed — otherwise they carry
        // on typing at a desk that is back in the bag.
        a.sitAt({ x: d.seatX, z: d.seatZ, yaw: d.yaw, floor: d.floor, stand: d.stand });
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
    // 보스는 **아레나 안에만** 있다.
    //
    // 예전에는 개발에 착수하는 순간 사무실 복도 한복판(42.5, 29.5)에 몬스터가
    // 솟았다. 세트장으로 들어가는 문은 그 다음이라, 화면에는 "사무실에 오크가
    // 서 있다" 가 먼저 보였다 — 싸움터가 따로 있는데 사무실에도 있으니
    // 어느 쪽이 진짜인지 알 수 없었다. 이제 사무실에는 아무것도 서지 않는다.
    if (!project || !this.arena) { this.clearBoss(); return; }
    // 연전이므로 키는 프로젝트가 아니라 **프로젝트+스테이지**다. 예전처럼
    // 프로젝트 id 만 보면 두 번째 보스가 첫 번째 놈의 몸으로 나온다.
    const key = bossKey(project);
    /* 이미 그 놈이 서 있거나, **지금 불러오는 중**이면 아무것도 하지 않는다.

       `bossWant` 가 없던 동안 이 자리는 스테이지마다 세 번씩 돌았다. 모델이
       네트워크에서 오는 동안 `this.boss` 는 null 이고, playBattle 은 초당
       스무 번 여기를 지나가므로, 조건이 매번 참이 되어 spawnBoss 가 겹쳐
       떴다. 늦게 도착한 쪽이 앞의 것을 dispose 없이 덮어써서 SkinnedInstance
       가 스테이지마다 두 개씩 GPU 에 남았고, 세트장도 그만큼 다시 지어졌다. */
    if (this.bossWant === key && (this.boss || this.bossLoading)) return;
    /* 모델을 못 받았으면 잠깐 쉬었다 다시 시도한다. 쉬는 구간이 없으면
       파일이 깨졌거나 네트워크가 끊긴 동안 이 자리가 초당 스무 번씩
       fetch 를 던진다 — 전투는 그래도 돌지만 회선은 안 돈다. */
    if (this.bossFailAt && this.time - this.bossFailAt < 2.5) return;
    this.spawnBoss(project);
  }

  /* 지금 화면에 서 있어야 하는 놈의 이름표. 프로젝트가 없으면 아무도 아니다. */
  bossKeyNow() {
    const p = this.game.project;
    return this.arena && p ? bossKey(p) : null;
  }

  /* 모델은 네트워크에서 온다. 로딩 중에 프로젝트가 끝나거나 바뀌었을 수
     있으므로, 돌아왔을 때 아직 같은 프로젝트인지 확인하고 붙인다.
     .glb 가 끝내 오지 않아도 전투는 예전 그대로 돌아간다. */
  async spawnBoss(project) {
    this.clearBoss();
    if (!project) return;
    const def = monsterForStage(project);
    const want = bossKey(project);
    this.bossProject = want;
    this.bossWant = want;
    this.bossLoading = true;
    let model = null;
    try { model = await preloadMonster(def); } finally { if (this.bossWant === want) this.bossLoading = false; }
    /* 돌아왔을 때 세상이 그대로인지 확인한다. 모델은 네트워크에서 오므로
       그 사이에 스테이지가 넘어갔을 수도, 게임이 완성됐을 수도, 세트장에서
       나왔을 수도 있다. `this.arena` 까지 보는 이유가 여기 있다 — 예전에는
       사무실로 나온 뒤에 도착한 모델이 그대로 세워졌다. */
    if (!model) { this.bossFailAt = this.time; return; }
    if (this.bossWant !== want || this.game.project !== project || !this.arena) return;
    this.bossFailAt = 0;

    this.boss = new Boss(def, model);
    this.bossProject = want;
    this.boss.phase = project.phase || 0;
    this.boss.scale = 1 + (project.phase || 0) * 0.08;
    // 세트장은 몬스터가 아니라 **공정**의 것이다. 같은 칸이면 누가 서든 같은 무대다.
    this.useArenaSet(stageSetOf(project));
    const spot = this.bossSpot();
    this.boss.setAnchor(spot[0], spot[1], spot[2], this.bossFloor);
    this.boss.faceTo(this.bossFaceYaw());
    this.boss.yaw = this.boss.goalYaw;
    this.boss.say(tauntFor(def, this.rnd), 3.4);
    /* 무대는 공정이 정하고 몸은 제비뽑기가 정하므로, 둘의 조합마다 알맞은
       카메라 거리가 다르다. 서 있는 놈의 키에 맞춘다 (arenaDist 참고 —
       다가가기만 하고 물러나지는 않는다). */
    if (this.arena) cam.goalDist = arenaDist(this.arenaSet, def);
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
    this.bossWant = null;
    this.bossLoading = false;
    if (this.bossEl) this.bossEl.style.display = 'none';
  }

  /* 보스가 설 자리.

     아레나에 들어가 있으면 세트장의 한복판이다. 사무실 화면에서 보여 줄
     때(👾 보스 버튼, 개발 착수 직후의 컷)는 팀이 앉은 층의 고정 자리 —
     통로 교차점이 어느 층에서나 비어 있는 것이 보장된 유일한 바닥이다. */
  bossSpot() {
    this.bossFloor = this.floor;
    if (this.arenaSet) return this.arenaSet.spot;
    // 세트장이 아직 안 지어졌을 때의 대비책일 뿐이다. 사무실에 보스를 세우는
    // 경로는 이제 없다.
    const spot = bossSpot(this.floor);
    return [spot.x, spot.y, spot.z];
  }

  /* 세트장을 이 몬스터에 맞는 것으로 갈아 끼운다. 같은 세트면 아무것도
     하지 않는다 — 스테이지가 넘어갈 때마다 VBO 를 다시 올릴 이유가 없다. */
  useArenaSet(monsterId) {
    const want = arenaSetFor(monsterId).id;
    if (this.arenaSet && this.arenaSet.id === want) return this.arenaSet;
    const set = buildArena(want);
    bakeAO(set.mesh, 0.62, 1.3);
    disposeMesh(this.gArena);
    this.gArena = upload(splitGlass(set.mesh).solid);
    this.arenaSet = set;
    // 메시는 GPU 에 올라갔다. CPU 쪽 배열까지 붙들고 있을 이유는 없다.
    set.mesh = null;
    renderer.fitLight(set.light.center, set.light.radius);
    return set;
  }

  clearArenaSet() {
    disposeMesh(this.gArena);
    this.gArena = null;
    this.arenaSet = null;
  }

  /* 보스가 지금 화면 어디에 있나 (CSS 픽셀).

     아레나의 공격 연출은 DOM 층에서 돈다 — 직원의 몸이 세트장에 없기
     때문이다. 던진 것이 보스에게 **닿아야** 하므로, 3D 좌표를 화면
     좌표로 옮겨 주는 자리가 하나 필요하다. */
  bossScreen() {
    if (!this.boss) return null;
    const vp = viewportSize();
    const b = this.boss;
    const y = b.y + Math.max(1, b.headY - b.y) * 0.45;
    const p = cam.project(b.x, y, b.z, vp.w, vp.h);
    if (!p || p.z < -1 || p.z > 1) return null;
    return { x: p.x, y: p.y };
  }

  /* 눈이 카메라를 향하게. 궤도 모드에서는 방위각, 1인칭에서는 내 위치. */
  bossFaceYaw() {
    if (!this.boss) return 0;
    if (this.walk) return Math.atan2(cam.wx - this.boss.x, cam.wz - this.boss.z);
    return cam.az;
  }

  /* 보스를 화면에 잡아준다. 개발 착수와 페이즈 전환에서 부른다. */
  /* 성공하면 true. 👾 보스 버튼은 이 값을 보고 "아직 안 나타났습니다" 를
     띄울지 정한다 — 예전에는 아무것도 돌려주지 않아서, 보스를 제대로
     잡아 놓고도 매번 못 찾았다는 토스트가 떴다. */
  focusBoss(dist = 40) {
    if (!this.boss || this.walk) return false;
    // 아레나에서는 카메라가 이미 무대에 맞춰져 있다. 여기서 층을 따라가면
    // 사무실 좌표로 되돌아가 무대 밖을 비춘다.
    if (this.arena) { cam.lookAt(...this.arenaTarget()); return true; }
    if (this.bossFloor !== undefined && this.bossFloor !== this.floor) {
      this.setFloor(this.bossFloor);
      ui.renderFloors();
    }
    cam.lookAt(this.boss.x, this.boss.y - 1.5, this.boss.z);
    cam.goalDist = dist;
    cam.el = 0.42;
    return true;
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
    if (this.pickup) this.stopPickup();
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

  /* ---- 회수 모드 ----
     놓은 것을 다시 가방에 넣는 길은 원래 사무실 탭의 목록 하나뿐이었다.
     목록에서 "책상" 이 여섯 줄이면 화면의 어느 책상인지 알 수가 없고,
     그래서 잘못 놓은 가구를 그냥 두게 된다. 배치가 화면을 눌러서 하는
     일이므로 회수도 화면을 눌러서 해야 한다. */
  startPickup() {
    if (this.place) this.stopPlacing();
    this.pickup = true;
    document.body.classList.add('picking');
    this.buildZoneOverlay();
    return true;
  }

  stopPickup() {
    if (!this.pickup) return;
    this.pickup = false;
    document.body.classList.remove('picking');
    disposeMesh(this.gZones); this.gZones = null;
    if (ui) ui.renderPlaceBar();
  }

  /* 짚은 바닥 위에 서 있는 가구를 가방에 넣는다. 발자국 안을 먼저 보고,
     아무것도 없으면 근처에서 가장 가까운 것을 집는다 — 폰에서 작은 화분을
     정확히 짚기를 요구하면 그 모드는 안 쓰이게 된다. */
  pickAt(x, z) {
    const placed = this.game.company.placed.filter((p) => p.floor === this.floor);
    let best = null, bestD = Infinity;
    for (const p of placed) {
      const def = FURNITURE_BY_ID.get(p.id);
      if (!def) continue;
      const f = footprint(def, p.rot);
      const dx = Math.abs(p.x - x), dz = Math.abs(p.z - z);
      const inside = dx * 2 <= f.w && dz * 2 <= f.d;
      const d = inside ? -1 : Math.hypot(Math.max(0, dx - f.w / 2), Math.max(0, dz - f.d / 2));
      if (d < bestD && (inside || d < 2.2)) { bestD = d; best = { p, def }; }
    }
    if (!best) return { ok: false, why: '여기엔 가구가 없습니다' };
    const r = this.game.pickUpFurniture(best.p.uid);
    if (!r.ok) return { ok: false, why: '회수할 수 없습니다' };
    this.rebuildFurniture();
    this.game.save();
    return { ok: true, ko: best.def.ko };
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

  /* 반 칸씩 밀기. 드래그 없이도 자리를 맞출 수 있어야 한다 — 손가락 하나로
     반 칸을 조준하는 것은 폰에서 거의 불가능하고, 드래그가 어떤 이유로든
     안 먹는 기기에서는 이것이 유일한 길이 된다.

     방향은 **화면 기준**이다. 카메라를 돌려 놓고 '오른쪽' 을 눌렀는데 책상이
     화면 왼쪽으로 가면 그 버튼은 없느니만 못하다. m4look 의 기저에서
     화면 오른쪽은 월드 XZ 로 (cos az, -sin az), 화면 위쪽(화면 안쪽)은
     -(sin az, cos az) 다.

     그 방향을 그대로 더하면 안 된다 — movePlace 가 반 칸으로 스냅하므로,
     비스듬한 성분은 반올림에 먹혀 아무 일도 일어나지 않는 방향이 생긴다.
     그래서 화면 방향을 가장 가까운 월드 축으로 스냅한다. 45° 안쪽에서는
     여전히 "누른 쪽으로 간다" 가 성립하고, 한 번 누르면 반드시 반 칸이
     움직인다. */
  nudgePlace(u, v, step = 0.5) {
    const p = this.place;
    if (!p) return;
    const ca = Math.cos(cam.az), sa = Math.sin(cam.az);
    const wx = u * ca - v * sa;
    const wz = -u * sa - v * ca;
    const dx = Math.abs(wx) >= Math.abs(wz) ? Math.sign(wx) * step : 0;
    const dz = Math.abs(wz) > Math.abs(wx) ? Math.sign(wz) * step : 0;
    this.movePlace(p.x + dx, p.z + dz);
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
    // 회의는 사무실에서 한다. 세트장에 있는 채로 열면 카메라가 700 유닛
    // 밖의 좌표를 '돌아갈 자리' 로 붙들고, 회의가 끝나는 순간 화면이 빈다.
    // UI 가 먼저 나가 주는 것이 정상 경로지만, 규칙은 여기 한 줄로 둔다.
    if (this.arena) this.exitArena();
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

  /* ---- 첫 출근 ----
     게임의 첫 화면이다. 예전에는 이름을 적자마자 카메라가 도시 위에서
     시작하는 창립 영상이 돌았고, 플레이어는 자기 회사를 **처음부터 위에서**
     내려다봤다. 경영 화면으로는 맞지만 첫 순간으로는 아니다 — 사무실이
     남의 것처럼 보인다.

     그래서 한 장면을 앞에 붙인다. 사장은 건물 밖 보도에 1인칭으로 서 있고,
     화면에는 "여기가… 이제 내 사무실인가?" 한 줄이 뜬다. 앞으로 걸어서
     문턱을 넘는 순간 — 그 순간에만 — 화면이 바뀌고 창립 영상이 돈다.
     들어가는 동작을 플레이어가 직접 하기 때문에 그 다음에 오는 모든 화면이
     "내가 들어온 곳" 이 된다.

     통로는 firstperson.js 가 직사각형으로 잘라 준다. 밖에는 걸을 수 있는
     격자가 없어서 평소 충돌 규칙으로는 한 걸음도 못 뗀다. */
  playArrival() {
    const box = document.getElementById('fpIntro');
    const line = document.getElementById('fpIntroTx');
    const sub = document.getElementById('fpIntroSub');
    const doorX = (BUILDING.x0 + BUILDING.x1) / 2;      // 정문은 남쪽 벽 한가운데
    const wallZ = BUILDING.z1;

    if (this.arena) this.exitArena();
    this.setFloor(0);

    return new Promise((resolve) => {
      const timers = [];
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        for (const t of timers) clearTimeout(t);
        if (box) box.classList.remove('show');
        this.fp.exit();
        resolve();
      };

      // 브라우저가 3D 를 못 켜 준 경우까지 여기서 막지는 않는다. 다만 층이
      // 하나도 안 지어졌으면 걸어 들어갈 문도 없으므로 그냥 넘어간다.
      if (!box || !line || !this.crew) { resolve(); return; }

      this.fp.enterIntro({
        floor: 0,
        x: doorX, z: wallZ + 15.0, yaw: Math.PI,         // 보도에서 문을 마주보고 선다
        bounds: {
          // 정문 폭(29.5~36.5)에서 바깥 기둥(x=30)을 피한 통로.
          x0: doorX - 1.4, x1: doorX + 2.2,
          z0: wallZ - 4.0, z1: wallZ + 19.0,
          crossZ: wallZ - 1.6,                            // 이 선을 넘으면 안이다
        },
        onCross: finish,
      });

      box.classList.add('show');
      line.textContent = '여기가… 이제 내 사무실인가?';
      if (sub) sub.textContent = document.body.classList.contains('touch')
        ? '왼쪽 스틱으로 앞으로 — 문으로 들어가 보자'
        : 'W 로 앞으로 — 문으로 들어가 보자';

      // 한참 서 있으면 한 줄 더 민다. 조작을 못 찾은 사람에게 화면이
      // 아무 말도 안 하고 있는 시간이 제일 길게 느껴진다.
      timers.push(setTimeout(() => {
        if (!done) line.textContent = '문은 열려 있다. 들어가자.';
      }, 9000));
      // 그래도 못 들어오면 장면이 끝나지 않는다. 그 자리에서 데려다 놓는다.
      timers.push(setTimeout(finish, 26000));
    });
  }

  /* ---- 창립 영상 ----
     게임을 처음 켜면 이름을 적고, 그 다음에 이 장면이 돈다. 예전에는
     이름을 적자마자 지원금 팝업과 튜토리얼 카드가 동시에 떴고, 그러면
     플레이어가 만든 회사가 **글자로만** 존재했다 — 사무실은 뒤에 있는데
     한 번도 보지 못한 채 안내부터 읽게 된다.

     그래서 카메라가 도시에서 시작해 건물로 내려앉고, 빈 1층에 멈춘다.
     세 줄이 지나가는 동안 화면에 있는 것은 "아직 아무도 없는 사무실"
     하나뿐이고, 그것이 이 게임이 시작하는 자리다.

     건너뛰기 버튼은 없다. 9초는 한 번쯤 볼 만한 길이고, 버튼을 달면
     대부분은 그 버튼을 누르며 자기 회사가 세워지는 장면을 안 본다. */
  playFounding(name) {
    const cx = BUILDING.x1 / 2, cz = BUILDING.z1 / 2;
    const box = document.getElementById('cine');
    const line = document.getElementById('cineTx');
    const sub = document.getElementById('cineSub');
    if (!box || !line || !sub) return Promise.resolve();

    // 1인칭으로 서 있는 채로 카메라를 뺏으면 어지럽다. 그럴 일은 없지만
    // (창립은 첫 프레임이다) 규칙은 여기 한 줄로 둔다.
    if (this.fp && this.fp.on) this.fp.exit();
    if (this.arena) this.exitArena();

    const top = (this.floorCount - 1) * STOREY;
    return new Promise((resolve) => {
      const timers = [];
      let spin = null;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        for (const t of timers) clearTimeout(t);
        if (spin) clearInterval(spin);
        document.body.classList.remove('cine');
        box.classList.remove('show');
        this.setFloor(0);
        resolve();
      };

      const say = (at, text, small) => timers.push(setTimeout(() => {
        line.innerHTML = text;
        sub.innerHTML = small || '';
        box.classList.remove('beat');
        void box.offsetWidth;
        box.classList.add('beat');
      }, at));

      document.body.classList.add('cine');
      box.classList.add('show');
      line.innerHTML = '';
      sub.innerHTML = '';

      /* 1) 도시. 건물 꼭대기 너머로 멀리서 시작한다. */
      cam.lookAt(cx, top + 8, cz);
      cam.goalDist = 188;
      cam.el = 0.30;
      cam.az = 2.9;
      cam.snap();
      // 아주 천천히 돈다. 멈춰 있는 그림은 사진이지 영상이 아니다.
      spin = setInterval(() => { cam.az -= 0.0016; }, 16);

      say(300, '어느 도시의 작은 사무실 하나');

      /* 2) 건물로 내려앉는다. */
      timers.push(setTimeout(() => {
        cam.lookAt(cx, STOREY * 1.4, cz);
        cam.goalDist = 96;
        cam.el = 0.44;
      }, 2600));
      say(2900, `「${name}」`, '오늘, 문을 열었습니다');

      /* 3) 빈 1층. 책상도 사람도 없는 그 화면이 첫 과제다. */
      timers.push(setTimeout(() => {
        this.setFloor(0);
        cam.lookAt(cx, 6, cz);
        cam.goalDist = 48;
        cam.el = 0.36;
      }, 5400));
      say(5700, '직원 0명 · 책상 0개',
        '앉을 자리를 만드는 것부터가 사장의 일입니다');

      timers.push(setTimeout(finish, 9200));
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
    // 저장된 자리가 세트장 안이면 되돌리지 않는다 — 사무실에서 회의가
    // 끝났는데 카메라만 아레나로 날아가는 경우가 이것이었다.
    if (inArenaZone(c.x, c.z) && !this.arena) { this.setFloor(this.floor); return; }
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
    /* 이 묶음이 게임의 완성을 들고 있으면 새 보스를 세우지 않는다. 마지막
       놈이 쓰러지는 그 순간에도 여기는 한 번 더 도는데, 그때 세우면 이미
       끝난 판 위에 다음 놈을 부르게 된다 — 그 자리가 "다 잡았는데 갑자기
       보스가 다시 뜬다" 였다. */
    const ending = events.some((e) => e.kind === 'complete');
    if (!ending) this.ensureBoss(project);
    for (const ev of events) {
      if (ev.kind === 'hit' || ev.kind === 'crit') {
        const a = this.crew.get(ev.staffId);
        if (a) {
          a.reactWith(ev.kind === 'crit' ? 'idea' : 'type', ev.kind === 'crit' ? 1.5 : 0.7);
          if (ev.kind === 'crit') a.say(critLine(this.rnd), 2.0, 'idea');
        }
        // 아레나에서는 흔들기도 숫자도 DOM 연출 층(hud.js `_arenaHit`)이
        // 맡는다. 던진 것이 **닿는 순간**에 맞춰야 하는데, 여기서는 그
        // 타이밍을 알 수 없다 — 그래서 아레나에서는 이 자리가 비어 있다.
        if (this.arena) continue;
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
            ...this.teamFxAnchor(a),
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

  /* 팀이 맞았을 때 붉은 숫자가 뜰 자리.

     사무실에서는 맞은 사람 머리 위다. 아레나에서는 그 사람의 몸이 화면에
     없으므로 — 세트장은 사무실에서 700 유닛 떨어져 있다 — 무대의 앞쪽,
     카메라 쪽으로 당긴 자리에 띄운다. 파티 카드가 바로 아래에 있어서
     "우리가 맞았다" 로 읽힌다. */
  teamFxAnchor(agent) {
    if (!this.arena || !this.arenaSet) {
      return { x: agent.x, y: agent.floor * STOREY + 6.4, z: agent.z };
    }
    const s = this.arenaSet.spot;
    const f = 11 + this.rnd() * 3;
    return {
      x: s[0] + Math.sin(cam.az) * f + (this.rnd() - 0.5) * 9,
      y: s[1] + 3.2 + this.rnd() * 1.6,
      z: s[2] + Math.cos(cam.az) * f + (this.rnd() - 0.5) * 5,
    };
  }

  /* ══ 아레나 ══
     전용 세트장으로 들어간다. 사무실이 아니라 몬스터마다 다른 무대이고,
     스테이지가 넘어가면 무대도 같이 바뀐다. 순수 연출이다 — 규칙은
     game/project.js 안에서만 돈다. */
  enterArena(project) {
    const already = this.arena;
    this.arena = true;
    if (this.fp && this.fp.on) this.fp.exit();
    // 이미 세트장 안이면 '들어오기 전의 카메라' 를 다시 잡지 않는다. 다시
    // 잡으면 그 값이 세트장 좌표가 되고, 나갈 때 거기로 되돌아간다.
    if (!already && !inArenaZone(cam.gx, cam.gz)) {
      this._camBefore = {
        dist: cam.goalDist, el: cam.el, az: cam.az, cut: this.wallCut,
        gx: cam.gx, gy: cam.gy, gz: cam.gz, floor: this.floor,
      };
    }
    const set = this.useArenaSet(project ? stageSetOf(project) : 'cat');
    this.ensureBoss(project);
    // 보스 모델이 아직 안 왔더라도 무대는 이미 서 있다. 카메라를 무대에
    // 맞춰 두면 로딩 몇 프레임 동안 빈 사무실이 비치는 일이 없다.
    if (this.boss) this.boss.setAnchor(set.spot[0], set.spot[1], set.spot[2], this.floor);
    cam.goalDist = arenaDist(set, monsterForStage(project));
    cam.el = set.camera.el;
    cam.az = set.camera.az;
    this.wallCut = false;
    cam.lookAt(...this.arenaTarget());
    cam.snap();
  }

  /* 화면 아래 3분의 1은 파티 카드가 쓴다. 보스의 한복판을 화면 한복판에
     두면 그 밴드에 다리가 잘리므로, 시선을 조금 아래로 내려 보스를 위로
     밀어 올린다. 큰 놈일수록 더 내린다. */
  arenaTarget() {
    const b = this.boss;
    if (!b) {
      const s = this.arenaSet;
      if (s) return [s.spot[0], s.spot[1] + 4, s.spot[2]];
      return [BUILDING.x1 / 2, this.floor * STOREY + 6, BUILDING.z1 / 2];
    }
    const h = Math.max(1, b.headY - b.y);
    return [b.x, b.y + h * 0.28, b.z];
  }

  exitArena() {
    if (!this.arena) return;
    this.arena = false;
    this.clearArenaSet();
    // 층 카메라와 그림자 프러스텀을 사무실로 되돌린 **뒤에** 들어올 때의
    // 시점을 얹는다. 순서를 바꾸면 setFloor 의 lookAt 이 복원을 덮어쓴다.
    this.setFloor(this.floor);
    // 보스는 세트장과 함께 사라진다. 사무실로 데려오면 복도에 몬스터가 서고,
    // 아레나 좌표에 남겨 두면 보스 태그가 지평선 너머를 가리킨다.
    this.clearBoss();
    const b = this._camBefore;
    // 세트장 좌표가 저장돼 있으면 버린다. 그리로 되돌리면 사무실은 화면
    // 밖이고 세트장은 이미 지워진, 아무것도 없는 화면이 남는다. setFloor 가
    // 이미 층 기본 시점으로 맞춰 놓았으므로 그대로 두는 편이 옳다.
    if (b && !inArenaZone(b.gx, b.gz)) {
      cam.goalDist = b.dist; cam.el = b.el; cam.az = b.az; this.wallCut = b.cut;
      cam.lookAt(b.gx, b.gy, b.gz);
    }
    this._camBefore = null;
    this.camSaved = null;   // 회의가 붙들고 있던 '돌아갈 자리' 도 같이 버린다
    cam.snap();
  }

  celebrate(teamIds) {
    // 이 판은 끝났다. 죽는 모션은 그대로 두되 **다시 세울 대상에서 지운다** —
    // 그러지 않으면 죽음 연출이 끝나기 전에 ensureBoss 가 같은 키를 보고
    // 새 몸을 부른다.
    this.bossWant = null;
    this.bossLoading = false;
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

    /* ── 불변식 ──
       화면에 선 보스는 **지금 이 공정의 놈**이거나 아무도 아니다. 죽는
       중인 놈만 예외다 (쓰러지는 모션을 끝까지 보여줘야 하므로).

       규칙을 매 프레임 강제하는 편이, 보스를 세우고 지우는 열 몇 군데를
       하나씩 맞추는 것보다 싸고 확실하다. 어느 경로가 어긋나든 다음
       프레임에 제자리로 돌아온다. */
    if (this.boss && !this.boss.dying && this.bossProject !== this.bossKeyNow()) {
      this.clearBoss();
    }

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
    // 아레나에서는 사무실 쪽 라벨이 하나도 보이면 안 된다. 700 유닛 밖의
    // 점이라도 카메라 뒤가 아니면 투영은 되고, 그러면 세트장 위에 방 이름과
    // 직원 이름표가 떠 버린다.
    const showFloor = this.arena ? -1 : this.floor;

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
    // 아레나에서는 층이라는 개념이 없다. 세트장 위의 보스는 언제나 보인다.
    if (!b || (!this.arena && b.floor !== showFloor) || b.dying) { el.style.display = 'none'; return; }
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
    /* 아레나에서는 세트장만 그린다. 사무실은 700 유닛 밖이라 화면에 들어올
       일이 없지만, 안 그리는 편이 확실하고 프레임도 그만큼 싸다. */
    if (this.arena && this.gArena) {
      if (pass === 'glass') return;
      renderer.drawMesh(L, this.gArena, null);
      this.drawBoss(pass);
      return;
    }
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

    this.drawBoss(pass);
  }

  /* The monster runs through its own skinned program, so it goes last and
     hands the pass back before anything else draws. */
  drawBoss(pass) {
    if (!this.boss || !skinPass || !this.frameOpts) return;
    const p = this.game.project;
    const frac = p && p.hpMax ? p.hp / p.hpMax : 1;
    skinPass.begin(pass, this.frameOpts);
    skinPass.draw(this.boss.inst, this.boss.drawArgs(frac));
    skinPass.end(pass);
  }
}

/* ══════════════════════════════════════ boot ══════════════════════════════ */

/* 연전의 한 칸을 가리키는 이름표. 프로젝트 id 만으로는 두 번째 보스가
   첫 번째 놈의 몸으로 나온다. */
function bossKey(project) {
  return project ? project.id + ':' + (project.stage || 0) : null;
}

/* 이 무대에서 이 몸을 담는 카메라 거리.

   무대마다 '이 거리로 잡으면 알맞게 들어오는 키'(refHeight)가 적혀 있다.
   그 키의 놈이 서면 기본값 그대로고, 더 작은 놈이면 그만큼 다가간다.

   ── 왜 물러나지는 않는가
   세트장은 고리 모양이다. 브레인스토밍 광장은 반지름 22 에 화이트보드가
   둘러서 있고 27 에 연필 기둥이 선다. 기본 거리 21 은 그 안쪽에 카메라를
   두려고 고른 값이라, 큰 놈이 섰다고 뒤로 물리면 카메라가 화이트보드 밖으로
   나가고 화면이 통째로 판때기가 된다 (7.4 유닛짜리 외계 사양에서 실제로
   그랬다). 큰 놈은 거리 대신 **시선 높이**로 담는다 — arenaTarget 이 키에
   비례해 시선을 내려 몸을 위로 밀어 올린다.

   완전 비례가 아니라 절반만 따라가는 이유도 같다: 무대의 크기 자체가
   거리의 절반을 이미 정하고 있다. */
function arenaDist(set, def) {
  if (!set) return 30;
  const ref = set.refHeight || 5;
  const h = def && def.height ? def.height : ref;
  return set.camera.dist * clamp(0.55 + 0.45 * (h / ref), 0.72, 1.0);
}

let renderer, cam, view, ui, game, skinPass, tier = 'high', quality = TIERS.high;
// 실시간 스태미나 시계를 초에 한 번만 보게 하는 누적기.
let clockAcc = 0;

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

  // 저장된 게임을 이어서 열었어도 사무실에는 보스가 서지 않는다. 전투 화면에
  // 들어가는 순간 세트장과 함께 지어진다.

  ui = new UI(game, view);
  view.cam = cam;
  wireFirstPerson();

  // A fresh studio is asked for a name and handed its grant; a loaded one that
  // was mid-project gets its monster back, so reopening the tab does not leave
  // the battle bar counting down an idea with no body.
  ui.openingFlow();

  window.__game = game;                 // console handles while balancing
  window.__staffMod = staffMod;         // tools/battle.mjs reads power/abilities here
  window.__view = view;
  window.__ui = ui;
  window.__renderer = renderer;
  window.__cam = cam;

  wirePointer();
  wireCamPad();
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

  /* ---------- 그래픽이 죽었을 때 ----------
     화면이 통째로 흰색(정확히는 body 의 #c8cbcf)이 되고 UI 만 살아 있는
     증상의 원인은 둘 중 하나다: 프레임 루프가 예외로 끊겼거나, 브라우저가
     WebGL 컨텍스트를 회수했거나. 둘 다 rAF 가 다시 걸리지 않으므로 그
     상태가 **영구히** 남는다 — 게임을 다 만들어도 흰 화면인 이유가 이것이다.

     그래서 루프는 무슨 일이 있어도 다음 프레임을 예약하고, 컨텍스트가
     날아가면 저장하고 다시 불러온다. 흰 화면으로 남겨 두는 것보다 2초짜리
     재시작이 언제나 낫다. */
  let lostShown = false;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    if (lostShown) return;
    lostShown = true;
    try { game.save(); } catch (err) { /* 저장이 안 돼도 재시작은 해야 한다 */ }
    const box = document.createElement('div');
    box.id = 'glLost';
    box.innerHTML = '<div class="glc card"><b>그래픽을 다시 불러옵니다…</b>'
      + '<span>진행 상황은 저장됐습니다.</span></div>';
    document.body.appendChild(box);
    setTimeout(() => location.reload(), 1200);
  }, false);

  let last = performance.now();
  let loopErr = 0;
  function frame(now) {
    // A 10fps floor rather than 20: below that the clamp turns a slow device
    // into visible slow motion, and walks that should take seconds take a minute.
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    try {
      tick(dt);
      loopErr = 0;
    } catch (e) {
      // 한 프레임의 예외로 게임 전체가 멈추면 안 된다. 처음 몇 번만 찍고
      // 넘어간다 — 콘솔을 초당 60줄로 채우는 것은 진단이 아니라 소음이다.
      if (loopErr < 3) console.error('frame failed', e);
      loopErr += 1;
    }
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
  if (ui) { ui.tickBattle(dt); ui.tickSales(dt); }
  /* 실시간 스태미나. 계산은 벽시계로 하므로 프레임마다 불러도 결과가 같고,
     탭이 백그라운드에 있었거나 앱을 껐다 켠 만큼도 한 번에 들어온다. */
  if (game) {
    clockAcc += dt;
    if (clockAcc > 1) {
      clockAcc = 0;
      if (game.tickClock() > 0) game.save();
      if (ui) ui.renderHUD();
    }
  }
  view.update(dt);
  // 조이스틱은 카메라를 갱신하기 **전에** 읽는다. 뒤에서 읽으면 입력이
  // 한 프레임씩 늦게 반영돼 스틱이 미끄럽게 느껴지지 않는다.
  if (view.camTick) view.camTick(dt);
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
  // 아레나에는 '위층' 이 없다. 층 자르기를 그대로 두면 세트장의 벽과 비석이
  // 사무실 층고를 기준으로 위쪽부터 녹아 사라진다.
  const floorY = view.arena
    ? 9999
    : (walking
      ? (view.fp.floor + 1) * STOREY + 0.35
      : view.floor * STOREY + BUILDING.wallH + 0.1);

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

/* ══════════════════════════ 카메라 조이스틱 ══════════════════════════

   캔버스를 끌어서 카메라를 돌리는 조작은 두 가지 이유로 불편하다. 첫째,
   가로로 든 폰에서는 화면 대부분이 이미 무언가를 하고 있어서 "빈 바닥" 을
   찾아 짚어야 한다. 둘째, 배치 모드에서는 그 드래그를 가구가 가져간다.

   그래서 카메라에 자기 조작계를 준다. 스틱 하나가 회전(⟳)과 이동(✥) 을
   번갈아 맡고, 버튼 둘이 확대·축소를 맡는다. 속도는 프레임이 아니라 초에
   비례하므로 60fps 든 30fps 든 같은 만큼 돈다. */
const CAM_PAN_BOUNDS = { x0: -18, x1: 82, z0: -16, z1: 60 };
const CAM_MODES = [
  { id: 'orbit', icon: '⟳', ko: '회전' },
  { id: 'pan', icon: '✥', ko: '이동' },
];

function wireCamPad() {
  const pad = $('campad');
  const stick = $('camStick');
  if (!pad || !stick) return;
  const knob = stick.querySelector('.cknob');
  const label = stick.querySelector('.ck');
  const modeBtn = $('camMode');

  let mode = view.prefs.camMode === 'pan' ? 1 : 0;
  let vx = 0, vy = 0, zoomDir = 0, id = null;

  const paint = () => {
    if (modeBtn) modeBtn.textContent = CAM_MODES[mode].icon;
    if (label) label.textContent = CAM_MODES[mode].ko;
  };
  paint();

  /* 조이스틱을 켜고 끄는 것은 설정이다. 데스크톱에서는 드래그가 이미
     편하므로 필요 없다는 사람이 있고, 폰에서는 반대다. */
  view.setCamPad = (on) => {
    view.prefs.camPad = !!on;
    savePrefs(view.prefs);
    document.body.classList.toggle('campad', !!on);
    if (!on) { vx = 0; vy = 0; zoomDir = 0; if (knob) knob.style.transform = ''; }
    return view.prefs.camPad;
  };
  view.camPadOn = () => document.body.classList.contains('campad');
  // 기본값은 켜짐. 처음 만나는 사람에게 조작계가 보이는 편이 낫다.
  view.setCamPad(view.prefs.camPad === undefined ? true : view.prefs.camPad);

  const set = (e) => {
    const r = stick.getBoundingClientRect();
    const half = r.width / 2;
    let dx = (e.clientX - (r.left + half)) / half;
    let dy = (e.clientY - (r.top + r.height / 2)) / half;
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    // 아주 작은 흔들림은 무시한다. 엄지를 얹어 둔 것만으로 화면이 흐르면
    // 조이스틱이 아니라 고장 난 것처럼 느껴진다.
    const dead = 0.14;
    const scale = (v) => (Math.abs(v) < dead ? 0 : (v - Math.sign(v) * dead) / (1 - dead));
    vx = scale(dx); vy = scale(dy);
    if (knob) knob.style.transform = `translate(${dx * half * 0.55}px, ${dy * half * 0.55}px)`;
  };
  const clear = () => { id = null; vx = 0; vy = 0; if (knob) knob.style.transform = ''; };

  stick.addEventListener('pointerdown', (e) => {
    id = e.pointerId;
    try { stick.setPointerCapture(id); } catch (err) { /* ignore */ }
    set(e);
    e.preventDefault();
    firstGesture();
  });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
  for (const t of ['pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture']) {
    stick.addEventListener(t, (e) => { if (e.pointerId === id) clear(); });
  }

  if (modeBtn) {
    modeBtn.onclick = () => {
      mode = (mode + 1) % CAM_MODES.length;
      view.prefs.camMode = CAM_MODES[mode].id;
      savePrefs(view.prefs);
      paint();
    };
  }
  // 확대·축소는 누르고 있는 동안 계속 든다. 한 번에 한 칸씩이면 끝에서
  // 끝까지 가는 데 스무 번을 눌러야 한다.
  for (const [btnId, dir] of [['camIn', -1], ['camOut', 1]]) {
    const b = $(btnId);
    if (!b) continue;
    const down = (e) => {
      zoomDir = dir;
      try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      e.preventDefault();
    };
    const up = () => { zoomDir = 0; };
    b.addEventListener('pointerdown', down);
    for (const t of ['pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture']) {
      b.addEventListener(t, up);
    }
  }

  view.camTick = (dt) => {
    if (cam.fp) return;
    if (zoomDir) cam.zoom(zoomDir * 720 * dt);
    if (!vx && !vy) return;
    if (CAM_MODES[mode].id === 'pan') {
      // cam.pan 은 "바닥을 손가락으로 잡아 끈다" 는 뜻이라 두 손가락 드래그에
      // 맞춰져 있다. 조이스틱은 반대다 — 오른쪽으로 밀면 카메라가 오른쪽으로
      // 가야 한다. 부호를 여기서 뒤집는다.
      cam.pan(-vx * 620 * dt, -vy * 620 * dt, CAM_PAN_BOUNDS);
    } else {
      // orbit() 은 픽셀 델타를 받는다. 초당 회전량을 픽셀로 환산해 넘긴다.
      //
      // 가로도 세로처럼 부호를 뒤집는다. 세로는 이미 "위로 밀면 카메라가
      // 위로" 였는데 가로만 "오른쪽으로 밀면 건물이 오른쪽으로 돈다"(드래그
      // 감각)여서, 한 스틱 안에서 두 축이 서로 반대로 움직이고 있었다.
      cam.orbit(-vx * 300 * dt, -vy * 260 * dt);
    }
  };
}

/* One pointer orbits. Two pinch to zoom and drag to pan. Pointer Events cover
   mouse, pen and touch with the same code, and pointer capture keeps a drag
   alive when the finger slides over the HUD.

   ── 배치 모드는 캔버스를 통째로 가져간다 ──
   예전에는 "손가락 하나면 가구, 둘이면 카메라" 였다. 그럴듯하지만 실기기
   에서는 무너진다: 가로로 든 폰에서 반대쪽 엄지나 손바닥이 화면에 닿는
   순간 접점이 둘이 되고, 책상을 끌던 손가락이 카메라 팬으로 바뀐다.
   플레이어에게는 "책상을 움직이려는데 화면이 움직인다" 로 보인다 — 실제로
   그 제보를 받았다.

   그래서 배치 중에는 캔버스의 어떤 제스처도 카메라를 건드리지 않는다.
   카메라는 화면 오른쪽 아래의 조이스틱이 맡는다. 손가락 수와 상관없이
   결과가 하나뿐이라 흔들릴 여지가 없다. */
function wirePointer() {
  const pts = new Map();
  let pinch = 0, mid = null, moved = 0;
  // 배치 드래그를 쥐고 있는 포인터와, 잡은 순간의 손가락↔가구 어긋남.
  let placeId = null, placeOff = null;
  const BOUNDS = { x0: -18, x1: 82, z0: -16, z1: 60 };

  const gather = () => {
    const a = [...pts.values()];
    if (a.length < 2) return null;
    const dx = a[0].x - a[1].x, dy = a[0].y - a[1].y;
    return { d: Math.hypot(dx, dy), x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 };
  };

  /* 화면 좌표 → 지금 보고 있는 층의 바닥 좌표. */
  const floorHit = (e) => {
    const vp = viewportSize();
    return cam.hitPlane(e.clientX, e.clientY, vp.w, vp.h, view.floor * STOREY + 0.05);
  };

  /* 잡는다. 짚은 곳과 가구 중심의 차이를 기억해 두면, 가구가 손가락 밑으로
     순간이동하지 않고 잡은 그대로 따라온다 — 반 칸 단위로 미세하게 맞출 때
     이것이 있고 없고가 크게 다르다. 단, 가구에서 멀리 떨어진 바닥을 짚으면
     그건 "저기로 옮겨라" 라는 뜻이므로 어긋남을 버린다. */
  const grabPlace = (e) => {
    if (!view.place) return false;
    placeId = e.pointerId;
    const hit = floorHit(e);
    if (!hit) { placeOff = null; return true; }
    const dx = view.place.x - hit[0], dz = view.place.z - hit[2];
    placeOff = Math.hypot(dx, dz) <= 6 ? [dx, dz] : null;
    if (!placeOff) view.movePlace(hit[0], hit[2]);
    return true;
  };

  const dragPlace = (e) => {
    if (!view.place) return false;
    const hit = floorHit(e);
    if (hit) view.movePlace(hit[0] + (placeOff ? placeOff[0] : 0), hit[2] + (placeOff ? placeOff[1] : 0));
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
    /* 배치 중에는 첫 손가락이 가구를 쥔다. 그 뒤에 몇 개가 더 닿든 카메라는
       움직이지 않고, 나중에 닿은 손가락이 드래그를 빼앗지도 않는다.

       다만 쥔 손가락을 **잃어버리는** 경우가 실제로 있다. 브라우저가
       제스처를 가로채면 pointerup 이 오지 않고, 그러면 placeId 가 유령
       포인터에 붙박여 그 뒤로는 아무리 끌어도 가구가 안 움직인다. 지금
       화면에 손가락이 하나뿐이면 이전 주인은 확실히 사라진 것이므로,
       그 손가락이 다시 쥔다. */
    if (view.place) {
      if (placeId === null || pts.size === 1) grabPlace(e);
      firstGesture();
      return;
    }
    const g = gather();
    if (g) { pinch = g.d; mid = g; }
    firstGesture();
  });

  canvas.addEventListener('pointermove', (e) => {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    const nx = e.clientX, ny = e.clientY;
    moved += Math.abs(nx - prev.x) + Math.abs(ny - prev.y);

    pts.set(e.pointerId, { x: nx, y: ny });
    if (view.fp.on) { view.fp.moveLook(e.pointerId, nx, ny); return; }
    if (view.place) {
      // 쥐고 있는 손가락만 가구를 옮긴다. 나머지는 아무 일도 하지 않는다 —
      // 특히 카메라를 건드리지 않는다.
      if (e.pointerId === placeId) dragPlace(e);
      return;
    }
    if (pts.size === 1) cam.orbit(nx - prev.x, ny - prev.y);

    if (pts.size >= 2) {
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
    if (e.pointerId === placeId) { placeId = null; placeOff = null; }
    /* 회수 모드: 짚은 자리의 가구를 가방에 넣는다. 끌었으면 카메라를 돌린
       것이므로 아무 일도 하지 않는다. */
    if (view.pickup && moved < 8 && pts.size === 1) {
      const hit = floorHit(e);
      if (hit) {
        const r = view.pickAt(hit[0], hit[2]);
        if (ui) {
          ui.toast(r.ok ? `${r.ko} 회수 — 가방으로` : r.why, r.ok ? 'good' : 'bad');
          ui.renderPlaceBar();
          ui.renderPanel();
        }
      }
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
  // 손가락이 캡처 밖에서 사라지는 경우(브라우저가 제스처를 가로챈 뒤 등)가
  // 실제로 있다. 남아 있는 유령 접점 하나면 다음 드래그가 통째로 팬이 된다.
  canvas.addEventListener('lostpointercapture', (e) => {
    if (e.pointerId === placeId) { placeId = null; placeOff = null; }
    pts.delete(e.pointerId);
    if (pts.size < 2) { pinch = 0; mid = null; }
    if (!pts.size) canvas.classList.remove('drag');
  });

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

/* WASD 배선이 여기 한 벌 더 있었다. 1인칭이 `ui/firstperson.js` 로 옮겨간
   뒤로 `view.keys` 라는 객체는 존재하지 않는데, 걷는 중에 W 를 누르면
   이 함수가 그 없는 객체에 값을 쓰려다 매번 예외를 던졌다 — 화면에는
   아무 표시도 안 나고 콘솔에만 남는 종류다. 키 입력은 wirePointer 안의
   keydown 한 곳이 전부 맡는다(F 토글 · E 상호작용 · Esc · fp.key).

   function wireWalkKeys() 는 그래서 없앴다. */

/* Browsers only grant fullscreen and orientation lock from inside a user
   gesture, and only once asked. Ask on the first interaction, then stop. */
let gestureUsed = false;
function firstGesture() {
  // 오디오 컨텍스트는 **제스처 안에서만** 열린다. 이 자리를 놓치면 브라우저가
  // 정지 상태로 만들어 놓고 그 뒤로는 영영 안 울린다. gestureUsed 보다 앞에
  // 두는 이유는, 첫 제스처가 이미 지나간 뒤에 들어온 터치도 컨텍스트를
  // 되살릴 수 있어야 하기 때문이다 (탭을 오래 두면 suspended 로 돌아간다).
  initSound();
  if (gestureUsed) return;
  gestureUsed = true;
  if (isTouch()) goFullscreen();
}
window.addEventListener('pointerdown', firstGesture, { capture: true });

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
