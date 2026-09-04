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

    /* First person is a MODE of this camera rather than a second camera, so
       everything downstream — the projection helpers the DOM overlay uses, the
       ray picker, the renderer's uniform block — keeps working untouched. When
       `fp` is set it is { x, y, z, yaw, pitch } in world space.

       Two branches built a walk mode independently. This one won because the
       rest of the camera did not have to learn about it; the other's helpers
       (`forward`, `walkVector`, `look`) are kept below because the joystick
       reads them, and they now operate on `fp`. */
    this.fp = null;
    this.fpFov = 1.15;
  }

  /* ---- walk helpers, driven by whatever is holding the stick ---- */
  get wx() { return this.fp ? this.fp.x : this.tx; }
  get wy() { return this.fp ? this.fp.y : this.ty; }
  get wz() { return this.fp ? this.fp.z : this.tz; }
  get wyaw() { return this.fp ? this.fp.yaw : this.az; }

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
    if (this.fp) { this._updateFP(asp); return; }
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

  /* Eye and focus are the same point in first person, which is exactly what
     switches the wall cut off: the shader needs an eye-to-target direction to
     dissolve along, and a zero-length one means "cut nothing". Standing inside
     the office, that is the behaviour you want — the walls are the room. The
     near plane has to come in too, or a desk you are leaning over clips away. */
  _updateFP(asp) {
    const f = this.fp;
    const e = this.eye;
    e[0] = f.x; e[1] = f.y; e[2] = f.z;
    this.tx = f.x; this.ty = f.y; this.tz = f.z;
    this.gx = f.x; this.gy = f.y; this.gz = f.z;
    const cp = Math.cos(f.pitch);
    m4look(this.view, e[0], e[1], e[2],
      f.x + Math.sin(f.yaw) * cp, f.y + Math.sin(f.pitch), f.z + Math.cos(f.yaw) * cp,
      0, 1, 0);
    m4persp(this.proj, this.fpFov, asp, 0.16, 1200);
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
