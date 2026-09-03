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
import { Renderer } from './render/renderer.js';
import { OrbitCamera } from './render/camera.js';
import { Rig } from './char/rig.js';
import './world/palette.js';                  // registers the hex -> material map
import { buildOffice, BUILDING, FLOOR_PLANS, STOREY } from './world/office.js';
import { Crew, Agent, ST } from './world/agents.js';
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

  /* ---- camera / floor ---- */
  setFloor(f) {
    this.floor = clamp(f, 0, this.floorCount - 1);
    cam.lookAt(BUILDING.x1 / 2, this.floor * STOREY + 6, BUILDING.z1 / 2);
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
    for (const ev of events) {
      if (ev.kind !== 'hit' && ev.kind !== 'crit') continue;
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
        e.el.className = 'dmg' + (e.crit ? ' crit' : '');
        const label = e.crit ? '번뜩임!' : (e.stat ? STAT_LABEL[e.stat] : '');
        e.el.innerHTML = `${e.text}${label ? `<span class="sk">${label}</span>` : ''}`;
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
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.classList.add('drag');
    moved = 0;
    const g = gather();
    if (g) { pinch = g.d; mid = g; }
    firstGesture();
  });

  canvas.addEventListener('pointermove', (e) => {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    const nx = e.clientX, ny = e.clientY;
    moved += Math.abs(nx - prev.x) + Math.abs(ny - prev.y);
    if (pts.size === 1) cam.orbit(nx - prev.x, ny - prev.y);
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
