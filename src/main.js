/* Boot, the frame loop, and the bridge between the simulation and the 3D view.

   Responsibilities are deliberately narrow: this file owns nothing about game
   rules and nothing about shading. It builds the world once, keeps one Rig per
   staffer, decides which pose each is in this frame, and translates game events
   into things you can see happening in the office. */

import { initGL, upload, disposeMesh } from './core/gl.js';
import { splitGlass } from './core/meshbuilder.js';
import { bakeAO, NavGrid } from './core/bake.js';
import { clamp, mulberry32 } from './core/math.js';
import { Renderer } from './render/renderer.js';
import { OrbitCamera } from './render/camera.js';
import { Rig, BONE_N, SEAT_HIP } from './char/rig.js';
import {
  poseSit, poseSitBack, poseStand, poseWalk, poseCheer, poseSlump, applyReact,
} from './char/poses.js';
import './world/palette.js';                  // registers the hex -> material map
import { buildOffice, BUILDING, FLOOR_PLANS, STOREY } from './world/office.js';
import { Game } from './game/state.js';
import { UI } from './ui/hud.js';

const $ = (id) => document.getElementById(id);
const canvas = $('gl');
const ov = $('ov');

function bootStep(t) { $('bootStep').textContent = t; }
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

/* ══════════════════════════════════════ view ══════════════════════════════ */

class View {
  constructor(game) {
    this.game = game;
    this.floor = 0;
    this.floorCount = game.company.floors;
    this.wallCut = true;
    this.time = 0;
    this.rigs = new Map();          // staffId -> {rig, seed, react, state}
    this.tags = new Map();          // staffId -> DOM label
    this.roomEls = [];
    this.effects = [];              // floating damage numbers
    this.working = new Set();       // staff currently in a development battle
    this.focused = null;
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
    this.nav = new NavGrid(built.mesh, 1.0, 5.5, 0.5, 2);

    bootStep('GPU 업로드');
    await nextFrame();
    const split = splitGlass(built.mesh);
    disposeMesh(this.gSolid); disposeMesh(this.gGlass);
    this.gSolid = upload(split.solid);
    this.gGlass = upload(split.glass);

    this.game.assignDesks(this.desks);
    this.buildRoomLabels();
    this.syncRigs();
  }

  /* Floors unlock with company rank, which changes the geometry, so the world
     is rebuilt rather than patched. It happens at most four times a run. */
  async setFloorCount(n) {
    if (n <= this.floorCount) return;
    this.floorCount = n;
    await this.build();
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
  syncRigs() {
    const live = new Set(this.game.staff.map((s) => s.id));
    for (const [id, entry] of this.rigs) {
      if (!live.has(id)) {
        disposeMesh(entry.rig);
        this.rigs.delete(id);
        const t = this.tags.get(id);
        if (t) { t.remove(); this.tags.delete(id); }
      }
    }
    for (const s of this.game.staff) {
      if (this.rigs.has(s.id)) continue;
      const rig = new Rig(s.look);
      this.rigs.set(s.id, { rig, seed: (s.id * 2.399) % 6.28, react: null, state: 'sit' });
      const tag = document.createElement('div');
      tag.className = 'nm';
      tag.textContent = s.name;
      ov.appendChild(tag);
      this.tags.set(s.id, tag);
    }
  }

  deskOf(staffer) {
    if (!this.desks || !staffer.deskId) return null;
    return this.desks.find((d) => d.id === staffer.deskId) || null;
  }

  /* ---- camera / floor ---- */
  setFloor(f) {
    this.floor = clamp(f, 0, this.floorCount - 1);
    cam.lookAt(BUILDING.x1 / 2, this.floor * STOREY + 4.5, BUILDING.z1 / 2);
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
    const s = this.game.staff.find((x) => x.id === id);
    const d = s && this.deskOf(s);
    if (!d) return;
    if (d.floor !== this.floor) { this.setFloor(d.floor); ui.renderFloors(); }
    cam.lookAt(d.seatX, d.floor * STOREY + 4.5, d.seatZ);
    cam.goalDist = Math.min(cam.goalDist, 28);
  }

  /* ---- effects driven by game events ---- */
  startWork(teamIds) {
    this.working = new Set(teamIds);
    const first = this.game.staff.find((s) => teamIds.includes(s.id));
    const d = first && this.deskOf(first);
    if (d && d.floor !== this.floor) { this.setFloor(d.floor); ui.renderFloors(); }
  }

  playBattle({ project, events }) {
    this.working = new Set(project.team);
    for (const ev of events) {
      if (ev.kind !== 'hit' && ev.kind !== 'crit') continue;
      const s = this.game.staff.find((x) => x.id === ev.staffId);
      const entry = this.rigs.get(ev.staffId);
      if (!s || !entry) continue;
      entry.react = { kind: ev.kind === 'crit' ? 'idea' : 'type', life: 0, left: ev.kind === 'crit' ? 1.5 : 0.7 };
      const d = this.deskOf(s);
      if (d) {
        this.effects.push({
          x: d.seatX, y: d.floor * STOREY + 6.4, z: d.seatZ,
          text: ev.damage, crit: ev.kind === 'crit',
          stat: ev.stat, life: 0, ttl: 1.15, el: null,
        });
      }
    }
  }

  celebrate(teamIds) {
    this.working = new Set();
    for (const id of teamIds || []) {
      const entry = this.rigs.get(id);
      if (entry) entry.cheerUntil = this.time + 3.2;
    }
  }

  /* ---- per-frame ---- */
  update(dt) {
    this.time += dt;
    const t = this.time;

    for (const s of this.game.staff) {
      const entry = this.rigs.get(s.id);
      if (!entry) continue;
      const d = this.deskOf(s);
      const busy = this.working.has(s.id);

      if (entry.react) {
        entry.react.life += dt;
        entry.react.left -= dt;
        if (entry.react.left <= 0) entry.react = null;
      }

      let pose, hipY, yaw, x, z;
      if (d) {
        x = d.seatX; z = d.seatZ;
        yaw = d.ry + Math.PI;                    // face the desk, not away from it
        hipY = d.floor * STOREY + SEAT_HIP;
        if (entry.cheerUntil && t < entry.cheerUntil) {
          pose = poseCheer(t, entry.seed);
          hipY = d.floor * STOREY + entry.rig.D.hipY;
          // step back from the desk so the raised arms clear the monitor
          x += Math.sin(yaw) * 1.1; z += Math.cos(yaw) * 1.1;
        } else if (s.motivation <= 1) {
          pose = poseSlump(t, entry.seed, entry.rig.D);
        } else if (busy) {
          pose = poseSit(t, entry.seed, true, entry.rig.D);
        } else if (((s.id * 7 + Math.floor(t / 9)) % 5) === 0) {
          pose = poseSitBack(t, entry.seed, entry.rig.D);
        } else {
          pose = poseSit(t, entry.seed, false, entry.rig.D);
        }
      } else {
        // No desk: stand near the lobby so a staffer is never invisible.
        const i = s.id % 6;
        x = 20 + i * 2.6; z = 20;
        yaw = Math.PI; hipY = entry.rig.D.hipY;
        pose = poseStand(t, entry.seed);
      }

      pose = applyReact(pose, entry.react, t);
      if (pose.bob) hipY += pose.bob;
      entry.rig.solve(x, hipY, z, yaw, pose);
      entry.wx = x; entry.wz = z;
      entry.wy = hipY + entry.rig.D.pelvis + entry.rig.D.spine + entry.rig.D.chest + entry.rig.D.neck + entry.rig.D.headR * 1.7;
      entry.floor = d ? d.floor : 0;
      entry.busy = busy;
    }

    // floating damage numbers
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

    for (const s of this.game.staff) {
      const entry = this.rigs.get(s.id);
      const tag = this.tags.get(s.id);
      if (!entry || !tag) continue;
      if (entry.floor !== showFloor) { tag.style.display = 'none'; continue; }
      const p = cam.project(entry.wx, entry.wy, entry.wz, w, h);
      if (!p || p.z < -1 || p.z > 1) { tag.style.display = 'none'; continue; }
      tag.style.display = '';
      tag.style.left = p.x + 'px';
      tag.style.top = p.y + 'px';
      tag.classList.toggle('busy', !!entry.busy);
      tag.classList.toggle('sel', this.focused === s.id);
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
    if (pass === 'glass') {
      renderer.drawMesh(L, this.gGlass, null);
      return;
    }
    renderer.drawMesh(L, this.gSolid, null);
    for (const [, entry] of this.rigs) {
      renderer.drawMesh(L, entry.rig, entry.rig.world);
    }
  }
}

const STAT_LABEL = {
  craze: '화제성', usability: '조작성', impact: '임팩트',
  social: '소셜', retention: '지속성',
};

/* ══════════════════════════════════════ boot ══════════════════════════════ */

let renderer, cam, view, ui, game;

async function boot() {
  bootStep('렌더러 준비');
  initGL(canvas);
  renderer = new Renderer(canvas, {
    shadowSize: 2048,
    storey: STOREY,
    exposure: 1.06,
    bloomAmount: 0.05,
    bloomThreshold: 1.15,
  });
  cam = new OrbitCamera();

  game = Game.load() || new Game();
  view = new View(game);
  await view.build();

  view.setFloor(0);
  cam.snap();

  ui = new UI(game, view);
  window.__game = game;                 // a console handle while balancing
  window.__view = view;
  window.__renderer = renderer;
  window.__cam = cam;

  wirePointer();
  resize();
  window.addEventListener('resize', resize);

  $('boot').classList.add('gone');
  setTimeout(() => $('boot').remove(), 600);

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    tick(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  canvas.width = w; canvas.height = h;
  renderer.resize(w, h);
}

function tick(dt) {
  view.update(dt);
  cam.update(dt, canvas.clientWidth / Math.max(1, canvas.clientHeight));

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

  view.drawOverlays(canvas.clientWidth, canvas.clientHeight);
}

function wirePointer() {
  let down = false, lx = 0, ly = 0;
  canvas.addEventListener('pointerdown', (e) => {
    down = true; lx = e.clientX; ly = e.clientY;
    canvas.classList.add('drag');
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!down) return;
    cam.orbit(e.clientX - lx, e.clientY - ly);
    lx = e.clientX; ly = e.clientY;
  });
  const up = (e) => {
    down = false;
    canvas.classList.remove('drag');
    if (e.pointerId !== undefined && canvas.hasPointerCapture?.(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.zoom(e.deltaY);
  }, { passive: false });
}

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
