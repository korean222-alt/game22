/* 1인칭 시점 — walk the office yourself.

   The dollhouse view is how you MANAGE the company; this is how you visit it.
   Everything the studio owns already exists in world space — desks, the meeting
   room, the pantry, the people — so a first-person camera costs almost nothing
   and turns the office from a readout into a place. Standing next to a
   programmer who is grinding on a build and telling them they are doing well is
   a different feeling from clicking a row in a list, and it is the same +1
   motivation either way.

   Collision reuses the floor's NavGrid: the same solids that stop a staffer
   walking through a desk stop the player. Nothing here touches game rules —
   an interaction is reported to `onInteract` and the caller decides. */

import { clamp } from '../core/math.js';

const EYE = 5.4;          // ~1.7 m at this world scale (a desk top is 2.42)
const SPEED = 12.0;
const RUN = 19.0;
const RADIUS = 0.9;
const REACH = 5.0;
const LOOK = 0.0042;

const FORWARD_KEYS = ['w', 'arrowup'];
const BACK_KEYS = ['s', 'arrowdown'];
const LEFT_KEYS = ['a', 'arrowleft'];
const RIGHT_KEYS = ['d', 'arrowright'];

export class FirstPerson {
  constructor(view) {
    this.view = view;
    this.on = false;
    this.floor = 0;
    this.x = 33; this.z = 39; this.yaw = Math.PI; this.pitch = -0.06;
    this.keys = new Set();
    this.stick = { id: null, dx: 0, dy: 0 };
    this.look = { id: null, px: 0, py: 0 };
    this.bob = 0;
    this.focus = null;             // what the action button would act on
    this.onInteract = null;        // (target) => string | void
    this.onToggle = null;
    this.say = null;               // { text, left }
  }

  /* ---- entering and leaving ---- */
  enter(floor) {
    if (this.on) return;
    const v = this.view;
    this.floor = floor ?? v.floor;
    const e = v.entrance;
    let sx, sz;
    if (e && this.floor === e.floor) { sx = e.x; sz = e.z - 3.0; this.yaw = Math.PI; }
    else { const m = v.crew.meetingOn(this.floor); sx = m ? m.door.x : 33; sz = m ? m.door.z + 4 : 22; this.yaw = Math.PI; }
    const spot = this.findSpawn(sx, sz);
    this.x = spot[0]; this.z = spot[1];
    this.pitch = -0.06;
    this.on = true;
    this.keys.clear();
    this.stick.id = null; this.stick.dx = 0; this.stick.dy = 0;
    this.look.id = null;
    document.body.classList.add('fp');
    if (this.onToggle) this.onToggle(true);
  }

  exit() {
    if (!this.on) return;
    this.on = false;
    this.keys.clear();
    this.stick.id = null; this.stick.dx = 0; this.stick.dy = 0;
    this.look.id = null;
    this.focus = null;
    this.say = null;
    document.body.classList.remove('fp');
    if (this.onToggle) this.onToggle(false);
  }

  toggle() { if (this.on) this.exit(); else this.enter(); }

  /* The floor rail still works while walking: you take the lift. */
  setFloor(f) {
    if (!this.on) return;
    this.floor = f;
    const m = this.view.crew.meetingOn(f);
    const sx = m ? m.door.x : 33, sz = m ? m.door.z + 4 : 22;
    const spot = this.findSpawn(sx, sz);
    this.x = spot[0]; this.z = spot[1];
  }

  /* Spiral out from a wanted point until a body actually fits. A hard-coded
     spawn eventually lands inside a desk when the floor plan changes; this
     cannot. */
  findSpawn(x, z) {
    const nav = this.view.crew.navFor(this.floor);
    if (!nav || nav.circleClear(x, z, RADIUS)) return [x, z];
    for (let r = 1; r <= 30; r++) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (nav.circleClear(px, pz, RADIUS)) return [px, pz];
      }
    }
    return [x, z];
  }

  /* ---- input ---- */
  key(e, down) {
    const k = e.key.toLowerCase();
    if (down) this.keys.add(k); else this.keys.delete(k);
  }

  startLook(id, x, y) { this.look.id = id; this.look.px = x; this.look.py = y; }

  moveLook(id, x, y) {
    if (this.look.id !== id) return false;
    this.yaw -= (x - this.look.px) * LOOK;
    this.pitch = clamp(this.pitch - (y - this.look.py) * LOOK, -1.15, 1.05);
    this.look.px = x; this.look.py = y;
    return true;
  }

  endLook(id) { if (this.look.id === id) this.look.id = null; }

  /* The virtual stick is a DOM control, so it hands us a -1..1 vector. */
  setStick(dx, dy) { this.stick.dx = dx; this.stick.dy = dy; }

  /* ---- per frame ---- */
  update(dt) {
    if (!this.on) return;
    const has = (list) => list.some((k) => this.keys.has(k));
    let mx = 0, mz = 0;
    if (has(FORWARD_KEYS)) mz += 1;
    if (has(BACK_KEYS)) mz -= 1;
    if (has(RIGHT_KEYS)) mx += 1;
    if (has(LEFT_KEYS)) mx -= 1;
    mx += this.stick.dx;
    mz -= this.stick.dy;                         // screen up is forward
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }

    if (len > 0.02) {
      const spd = (this.keys.has('shift') ? RUN : SPEED) * dt;
      // 화면 오른쪽은 (-cos yaw, sin yaw) 다. render/camera.js 의 주석이 적어
      // 둔 그대로이고, 여기서만 부호가 뒤집혀 있었다 — 그래서 스틱을 오른쪽으로
      // 밀면 왼쪽으로 걸었고, 대각선으로 밀면 엉뚱한 데로 갔다.
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
      this.moveBy((fx * mz + rx * mx) * spd, (fz * mz + rz * mx) * spd);
      this.bob += len * spd * 0.55;
    } else {
      this.bob += dt * 0.6;
    }

    if (this.say) { this.say.left -= dt; if (this.say.left <= 0) this.say = null; }
    this.focus = this.findFocus();

    const cam = this.view.cam;
    if (cam) {
      cam.fp = cam.fp || {};
      cam.fp.x = this.x;
      cam.fp.y = this.floor * this.view.storey + EYE + Math.sin(this.bob * 2.1) * 0.09;
      cam.fp.z = this.z;
      cam.fp.yaw = this.yaw;
      cam.fp.pitch = this.pitch;
    }
  }

  /* Slide along a wall rather than sticking to it: try the full step, then each
     axis on its own. Without the fallback every corner is a trap.

     The epsilon matters. Walking due north makes dx about 1e-16, and a step of
     1e-16 is trivially "clear" — so the fallback would claim the move as an
     x-slide, return, and never try the z axis at all. Walking straight at an
     open corridor then moved nowhere. An axis has to be a real axis to count. */
  moveBy(dx, dz) {
    const nav = this.view.crew.navFor(this.floor);
    const clear = (x, z) => !nav || nav.circleClear(x, z, RADIUS);
    if (clear(this.x + dx, this.z + dz)) { this.x += dx; this.z += dz; return; }
    const EPS = 1e-3;
    if (Math.abs(dx) > EPS && clear(this.x + dx, this.z)) { this.x += dx; return; }
    if (Math.abs(dz) > EPS && clear(this.x, this.z + dz)) { this.z += dz; }
  }

  /* What the action button would act on: whoever or whatever is nearest, in
     front, and within arm's reach. People win ties — they are the reason to be
     down here in the first place. */
  findFocus() {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const score = (x, z) => {
      const dx = x - this.x, dz = z - this.z;
      const d = Math.hypot(dx, dz);
      if (d > REACH || d < 0.001) return -1;
      const facing = (dx * fx + dz * fz) / d;
      return facing < 0.15 ? -1 : d;
    };
    let best = null, bd = Infinity;
    for (const a of this.view.crew.all()) {
      if (a.floor !== this.floor) continue;
      const d = score(a.x, a.z);
      if (d < 0 || d >= bd) continue;
      bd = d; best = { kind: 'staff', id: a.id, name: a.name, agent: a };
    }
    if (best) return best;
    for (const s of this.view.crew.spots || []) {
      if (s.floor !== this.floor) continue;
      const d = score(s.x, s.z);
      if (d < 0 || d >= bd) continue;
      bd = d; best = { kind: 'spot', spot: s, name: SPOT_KO[s.kind] || s.kind };
    }
    if (best) return best;
    const m = this.view.crew.meetingOn(this.floor);
    if (m && m.floor === this.floor) {
      const d = score(m.center[0], m.center[2]);
      if (d >= 0) return { kind: 'meeting', name: '회의실 화이트보드' };
    }
    return null;
  }

  interact() {
    if (!this.on || !this.focus) return null;
    const line = this.onInteract ? this.onInteract(this.focus) : null;
    if (line) this.say = { text: line, left: 3.2 };
    return line;
  }
}

export const SPOT_KO = {
  coffee: '커피 머신', water: '정수기', sofa: '휴게실 소파', table: '휴게실 테이블',
  window: '창가 바 자리', printer: '복합기', locker: '사물함',
};
