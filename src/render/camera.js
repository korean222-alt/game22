/* The camera. Two modes share one object so everything downstream — the
   renderer's wall cut, the DOM label projection, desk picking — keeps working
   without knowing which mode is on.

   orbit  dollhouse view of the tower. The target is a point on the floor being
          inspected; azimuth and elevation orbit it and the wheel dollies in.
   walk   first person, standing on a floor. The joystick drives `walkMove()`
          and a drag drives `look()`.

   FACING CONVENTION (the same one the rigs use, on purpose)
     yaw y  ->  forward = (sin y, cos y) in world XZ.
     Screen-right is therefore (-cos y, sin y): with m4look's basis, looking
     down +Z puts world -X on the right of the screen. Getting this backwards
     is what makes a virtual stick feel like it is fighting you, so both
     vectors are derived here, once, and nowhere else. */

import { m4, m4mul, m4inv, m4persp, m4look, clamp, lerp } from '../core/math.js';

export class OrbitCamera {
  constructor() {
    this.tx = 0; this.ty = 5; this.tz = 0;
    this.gx = 0; this.gy = 5; this.gz = 0;      // goal, for damped follow
    this.dist = 86; this.goalDist = 86;
    this.az = 2.42; this.el = 0.72;
    this.minEl = 0.10; this.maxEl = 1.42;
    this.minD = 14; this.maxD = 190;
    this.fov = 0.56;

    this.vp = m4(); this.proj = m4(); this.view = m4(); this.inv = m4();
    this.eye = [0, 0, 0];

    /* ---- walk mode ---- */
    this.mode = 'orbit';
    this.wx = 30; this.wy = 5.2; this.wz = 30;
    this.wyaw = 0; this.wpitch = -0.05;
    this.eyeHeight = 5.2;
    this.walkFov = 1.02;          // wide: a phone screen held at arm's length
    this.bobT = 0; this.bobAmp = 0;
  }

  /* Unit forward and screen-right vectors for the current walk yaw. */
  forward() { return [Math.sin(this.wyaw), Math.cos(this.wyaw)]; }
  right() { return [-Math.cos(this.wyaw), Math.sin(this.wyaw)]; }

  setWalk(x, y, z, yaw) {
    this.wx = x; this.wy = y; this.wz = z;
    if (yaw !== undefined) this.wyaw = yaw;
  }

  /* A joystick vector in SCREEN space (x right, y down, already clamped to the
     unit disc) turned into a world-space step. Up on the stick is forward, and
     forward is where you are looking — anything else reads as broken. */
  walkVector(jx, jy) {
    const f = this.forward(), r = this.right();
    return [f[0] * -jy + r[0] * jx, f[1] * -jy + r[1] * jx];
  }

  /* Drag to look. Dragging right turns the view right, which means the yaw
     that produced `forward` has to DECREASE — see the facing note above. */
  look(dx, dy) {
    this.wyaw -= dx * 0.0055;
    this.wpitch = clamp(this.wpitch - dy * 0.0042, -1.15, 1.05);
  }

  lookAt(x, y, z) { this.gx = x; this.gy = y; this.gz = z; }
  snap() { this.tx = this.gx; this.ty = this.gy; this.tz = this.gz; this.dist = this.goalDist; }

  orbit(dx, dy) {
    this.az -= dx * 0.006;
    this.el = clamp(this.el + dy * 0.005, this.minEl, this.maxEl);
  }

  zoom(delta) {
    this.goalDist = clamp(this.goalDist * (1 + delta * 0.0013), this.minD, this.maxD);
  }

  /* Two-finger drag: grab the floor and slide it. The screen-space right and
     up vectors are derived from the azimuth, so panning stays aligned with the
     view however the camera has been orbited. Bounds keep the office on
     screen — losing the building behind you on a phone is unrecoverable. */
  pan(dx, dy, bounds) {
    const s = this.dist * 0.0017;
    const ca = Math.cos(this.az), sa = Math.sin(this.az);
    this.gx += (-dx * ca - dy * sa) * s;
    this.gz += (dx * sa - dy * ca) * s;
    if (bounds) {
      this.gx = clamp(this.gx, bounds.x0, bounds.x1);
      this.gz = clamp(this.gz, bounds.z0, bounds.z1);
    }
  }

  update(dt, asp) {
    if (this.mode === 'walk') return this._updateWalk(dt, asp);
    // Frame-rate independent damping: the 1-exp form keeps the same feel at
    // 30fps and 144fps, which a raw lerp(a,b,0.1) does not.
    const k = 1 - Math.exp(-dt * 9);
    this.tx = lerp(this.tx, this.gx, k);
    this.ty = lerp(this.ty, this.gy, k);
    this.tz = lerp(this.tz, this.gz, k);
    this.dist = lerp(this.dist, this.goalDist, k);

    const e = this.eye;
    const ce = Math.cos(this.el), se = Math.sin(this.el);
    e[0] = this.tx + ce * Math.sin(this.az) * this.dist;
    e[1] = this.ty + se * this.dist;
    e[2] = this.tz + ce * Math.cos(this.az) * this.dist;

    m4look(this.view, e[0], e[1], e[2], this.tx, this.ty, this.tz, 0, 1, 0);
    m4persp(this.proj, this.fov, asp, 0.5, 1200);
    m4mul(this.vp, this.proj, this.view);
    m4inv(this.inv, this.vp);
  }

  _updateWalk(dt, asp) {
    // A head bob tied to how fast you are actually moving. Without it walking
    // across a static room reads as sliding, and the bob is the cheapest thing
    // that says "you are a person in this office".
    this.bobT += dt * 9.0 * this.bobAmp;
    const bob = Math.sin(this.bobT) * 0.10 * this.bobAmp;
    const e = this.eye;
    e[0] = this.wx; e[1] = this.wy + bob; e[2] = this.wz;

    const cp = Math.cos(this.wpitch), sp = Math.sin(this.wpitch);
    const f = this.forward();
    this.tx = e[0] + f[0] * cp * 10;
    this.ty = e[1] + sp * 10;
    this.tz = e[2] + f[1] * cp * 10;
    this.gx = this.tx; this.gy = this.ty; this.gz = this.tz;

    m4look(this.view, e[0], e[1], e[2], this.tx, this.ty, this.tz, 0, 1, 0);
    m4persp(this.proj, this.walkFov, asp, 0.22, 1200);
    m4mul(this.vp, this.proj, this.view);
    m4inv(this.inv, this.vp);
  }

  /* World point -> CSS pixel coordinates, for DOM labels sitting over the canvas. */
  project(x, y, z, w, h) {
    const m = this.vp;
    const px = m[0] * x + m[4] * y + m[8] * z + m[12];
    const py = m[1] * x + m[5] * y + m[9] * z + m[13];
    const pz = m[2] * x + m[6] * y + m[10] * z + m[14];
    const pw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (pw <= 0.001) return null;
    return { x: (px / pw * 0.5 + 0.5) * w, y: (1 - (py / pw * 0.5 + 0.5)) * h, z: pz / pw, w: pw };
  }

  /* Screen ray, for picking a desk by clicking it. */
  ray(sx, sy, w, h) {
    const ndcX = (sx / w) * 2 - 1, ndcY = 1 - (sy / h) * 2;
    const m = this.inv;
    const un = (x, y, z) => {
      const px = m[0] * x + m[4] * y + m[8] * z + m[12];
      const py = m[1] * x + m[5] * y + m[9] * z + m[13];
      const pz = m[2] * x + m[6] * y + m[10] * z + m[14];
      const pw = m[3] * x + m[7] * y + m[11] * z + m[15];
      return [px / pw, py / pw, pz / pw];
    };
    const a = un(ndcX, ndcY, -1), b = un(ndcX, ndcY, 1);
    let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    return { o: a, d: [dx / l, dy / l, dz / l] };
  }

  /* Where a screen ray meets a horizontal plane — the floor slab under the cursor. */
  hitPlane(sx, sy, w, h, planeY) {
    const r = this.ray(sx, sy, w, h);
    if (Math.abs(r.d[1]) < 1e-6) return null;
    const t = (planeY - r.o[1]) / r.d[1];
    if (t < 0) return null;
    return [r.o[0] + r.d[0] * t, planeY, r.o[2] + r.d[2] * t];
  }
}
