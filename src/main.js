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
import { Renderer } from './render/renderer.js';
import { SkinnedPass } from './render/skinned.js';
import { OrbitCamera } from './render/camera.js';
import { Rig } from './char/rig.js';
import './world/palette.js';                  // registers the hex -> material map
import { buildOffice, BUILDING, FLOOR_PLANS, STOREY, placeZones, inPlaceZone } from './world/office.js';
import { buildPlaced, buildGhost } from './world/placed.js';
import { FURNITURE_BY_ID } from './game/furniture.js';
import { Crew, Agent, ST } from './world/agents.js';
import { Boss, bossSpot, preloadMonster, monsterFor, tauntFor } from './world/boss.js';
import { Game } from './game/state.js';
import { meetingScript, critLine, idleLine } from './game/dialogue.js';
import { UI } from './ui/hud.js';
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
    this.boss = null;               // the idea currently being fought
    this.bossEl = null;
    this.place = null;              // the piece being positioned, if any
    this.gPlaced = null; this.gGhost = null; this.gZones = null;
    this.frameOpts = null;          // last frame's camera/cut state, for the skin pass
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
      const moved = (a.home ? a.home.id : null) !== (d ? d.id : null);
      a.home = d;
      // A newly hired or newly seated person appears at their desk rather than
      // walking in from nowhere. Desks can now also be picked up mid-game, so
      // a reassignment has to re-seat someone who is already placed — otherwise
      // they carry on typing at a desk that is back in the bag.
      if (d && (!a.placed || moved)) {
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

  deskOf(staffer) {
    if (!this.desks || !staffer.deskId) return null;
    return this.desks.find((d) => d.id === staffer.deskId) || null;
  }

  /* ---- camera / floor ---- */
  setFloor(f) {
    this.floor = clamp(f, 0, this.floorCount - 1);
    cam.lookAt(BUILDING.x1 / 2, this.floor * STOREY + 6, BUILDING.z1 / 2);
    renderer.fitLight([BUILDING.x1 / 2, this.floor * STOREY + 5, BUILDING.z1 / 2], 62);
    // The piece being placed belongs to whichever storey is being looked at, so
    // changing floors mid-placement moves it rather than stranding it below.
    if (this.place) { this.buildZoneOverlay(); this.refreshGhost(); }
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

  /* ---- the boss ----
     The idea being fought gets a body. Which species depends on the project's
     HP, so a feature-phone puzzle and a console cross-release do not look like
     the same job. Loading is asynchronous and entirely optional: if the .glb
     never arrives the battle plays exactly as it did before. */
  async spawnBoss(project) {
    this.clearBoss();
    if (!project) return;
    const def = monsterFor(project);
    this._bossWanted = project.id;
    const model = await preloadMonster(def);
    // The player may have finished or abandoned the project while it loaded.
    if (!model || this._bossWanted !== project.id || !this.game.project) return;
    const floor = this.teamFloor(project);
    this.boss = new Boss(def, model, bossSpot(floor));
    this.boss.say(tauntFor(def, this.rnd), 3.4);
    if (!this.bossEl) {
      this.bossEl = document.createElement('div');
      this.bossEl.className = 'bosstag';
      ov.appendChild(this.bossEl);
    }
    return this.boss;
  }

  clearBoss() {
    this._bossWanted = null;
    if (this.boss) { this.boss.dispose(); this.boss = null; }
    if (this.bossEl) { this.bossEl.style.display = 'none'; }
  }

  /* The storey most of the team sits on, so the fight happens where the people
     are rather than always on the ground floor. */
  teamFloor(project) {
    const tally = new Map();
    for (const id of (project && project.team) || []) {
      const a = this.crew.get(id);
      if (!a) continue;
      tally.set(a.floor, (tally.get(a.floor) || 0) + 1);
    }
    let best = this.floor, n = -1;
    for (const [f, c] of tally) if (c > n) { n = c; best = f; }
    return Math.min(best, this.floorCount - 1);
  }

  focusBoss() {
    if (!this.boss) return false;
    if (this.boss.floor !== this.floor) { this.setFloor(this.boss.floor); ui.renderFloors(); }
    cam.lookAt(this.boss.x, this.boss.floor * STOREY + this.boss.def.height * 0.55, this.boss.z);
    cam.goalDist = Math.min(cam.goalDist, 42);
    return true;
  }

  /* ---- effects driven by game events ---- */
  startWork(teamIds) {
    const set = new Set(teamIds);
    for (const a of this.crew.all()) a.busy = set.has(a.id);
  }

  playBattle({ project, events }) {
    this.startWork(project.team);
    let total = 0, anyCrit = false;
    for (const ev of events) {
      if (ev.kind !== 'hit' && ev.kind !== 'crit') continue;
      total += ev.damage;
      if (ev.kind === 'crit') anyCrit = true;
      const a = this.crew.get(ev.staffId);
      if (!a) continue;
      a.reactWith(ev.kind === 'crit' ? 'idea' : 'type', ev.kind === 'crit' ? 1.5 : 0.7);
      if (ev.kind === 'crit') a.say(critLine(this.rnd), 2.0, 'idea');
      this.effects.push({
        x: a.x, y: a.floor * STOREY + 6.4, z: a.z,
        text: ev.damage, crit: ev.kind === 'crit',
        stat: ev.stat, life: 0, ttl: 1.15, el: null,
      });
    }

    if (this.boss && total > 0) {
      this.boss.react(this.rnd);
      // Every few turns the idea swings back. It changes no number — the fight
      // is still one-sided by design — but it stops the monster reading as a
      // punching bag halfway through a twenty-turn project.
      if (project.turn % 4 === 0) setTimeout(() => { if (this.boss) this.boss.attack(this.rnd); }, 900);
      this.effects.push({
        x: this.boss.x, y: this.boss.headY + 1.2, z: this.boss.z,
        text: total, crit: anyCrit, stat: null, boss: true,
        life: 0, ttl: 1.5, el: null,
      });
    }
    if (project.hp <= 0 && this.boss) this.boss.kill();
  }

  celebrate(teamIds) {
    for (const a of this.crew.all()) a.busy = false;
    for (const id of teamIds || []) {
      const a = this.crew.get(id);
      if (a) a.cheerUntil = this.time + 3.2;
    }
  }

  /* ---- per-frame ---- */
  update(dt) {
    this.time += dt;
    for (const s of this.game.staff) {
      const a = this.crew.get(s.id);
      if (a) a.mood = s.motivation;
    }
    this.crew.update(dt, this.time, this.rnd);

    if (this.boss) {
      this.boss.update(dt);
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
        e.el.className = 'dmg' + (e.crit ? ' crit' : '') + (e.boss ? ' big' : '');
        const label = e.boss ? '' : (e.crit ? '번뜩임!' : (e.stat ? STAT_LABEL[e.stat] : ''));
        e.el.innerHTML = `${e.boss ? '-' : ''}${Math.round(e.text).toLocaleString('ko-KR')}${label ? `<span class="sk">${label}</span>` : ''}`;
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

  ui = new UI(game, view);
  // A fresh studio is asked for a name and handed its grant; a loaded one that
  // was mid-project gets its monster back, so reopening the tab does not leave
  // the battle bar counting down an idea with no body.
  ui.openingFlow();
  if (game.project) view.spawnBoss(game.project);

  window.__game = game;                 // console handles while balancing
  window.__view = view;
  window.__ui = ui;
  window.__renderer = renderer;
  window.__cam = cam;

  wirePointer();
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
  const floorY = view.floor * STOREY + BUILDING.wallH + 0.1;

  // Stashed rather than passed through: the draw callback only receives the
  // uniform block and the pass name, and the skinned program needs the camera.
  const opts = {
    vp: cam.vp,
    eye: cam.eye,
    target: [cam.tx, cam.ty, cam.tz],
    wallCut: view.wallCut,
    floorY,
    time: view.time,
  };
  view.frameOpts = opts;
  renderer.render(opts, (L, pass) => view.draw(L, pass));

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
    if (pts.size === 1 && !dragPlace(e)) cam.orbit(nx - prev.x, ny - prev.y);
    pts.set(e.pointerId, { x: nx, y: ny });

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
    cam.zoom(e.deltaY);
  }, { passive: false });
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
