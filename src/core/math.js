/* mat4 / scalar helpers — column-major, WebGL memory layout.
   Every m4* function writes into `o` and returns it, so callers can keep
   matrices in preallocated storage and never allocate inside the frame loop.
   Never alias `o` with an input: m4mul reads a and b after writing o[0]. */

export function m4() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; }

export function m4id(o) {
  o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0;
  o[4] = 0; o[5] = 1; o[6] = 0; o[7] = 0;
  o[8] = 0; o[9] = 0; o[10] = 1; o[11] = 0;
  o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
  return o;
}

/* o = a * b */
export function m4mul(o, a, b) {
  const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5], a6 = a[6], a7 = a[7],
    a8 = a[8], a9 = a[9], aA = a[10], aB = a[11], aC = a[12], aD = a[13], aE = a[14], aF = a[15];
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    o[c * 4] = a0 * b0 + a4 * b1 + a8 * b2 + aC * b3;
    o[c * 4 + 1] = a1 * b0 + a5 * b1 + a9 * b2 + aD * b3;
    o[c * 4 + 2] = a2 * b0 + a6 * b1 + aA * b2 + aE * b3;
    o[c * 4 + 3] = a3 * b0 + a7 * b1 + aB * b2 + aF * b3;
  }
  return o;
}

export function m4persp(o, fovy, asp, n, f) {
  const t = 1 / Math.tan(fovy / 2), nf = 1 / (n - f);
  o[0] = t / asp; o[1] = 0; o[2] = 0; o[3] = 0;
  o[4] = 0; o[5] = t; o[6] = 0; o[7] = 0;
  o[8] = 0; o[9] = 0; o[10] = (f + n) * nf; o[11] = -1;
  o[12] = 0; o[13] = 0; o[14] = 2 * f * n * nf; o[15] = 0;
  return o;
}

export function m4ortho(o, l, r, b, t, n, f) {
  const lr = 1 / (l - r), bt = 1 / (b - t), nf = 1 / (n - f);
  o[0] = -2 * lr; o[1] = 0; o[2] = 0; o[3] = 0;
  o[4] = 0; o[5] = -2 * bt; o[6] = 0; o[7] = 0;
  o[8] = 0; o[9] = 0; o[10] = 2 * nf; o[11] = 0;
  o[12] = (l + r) * lr; o[13] = (t + b) * bt; o[14] = (f + n) * nf; o[15] = 1;
  return o;
}

export function m4look(o, ex, ey, ez, cx, cy, cz, ux, uy, uz) {
  let zx = ex - cx, zy = ey - cy, zz = ez - cz;
  const zl = Math.hypot(zx, zy, zz) || 1; zx /= zl; zy /= zl; zz /= zl;
  let xx = uy * zz - uz * zy, xy = uz * zx - ux * zz, xz = ux * zy - uy * zx;
  const xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
  o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
  o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
  o[12] = -(xx * ex + xy * ey + xz * ez);
  o[13] = -(yx * ex + yy * ey + yz * ez);
  o[14] = -(zx * ex + zy * ey + zz * ez);
  o[15] = 1;
  return o;
}

export function m4inv(o, m) {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7],
    a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10,
    b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12,
    b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30,
    b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let d = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!d) return m4id(o);
  d = 1 / d;
  o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * d; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * d;
  o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * d; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * d;
  o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * d; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * d;
  o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * d; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * d;
  o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * d; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * d;
  o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * d; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * d;
  o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * d; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * d;
  o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * d; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * d;
  return o;
}

/* local bone transform: T * Ry * Rx * Rz */
export function m4trs(o, x, y, z, ry, rx, rz) {
  const cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx),
    cz = Math.cos(rz || 0), sz = Math.sin(rz || 0);
  o[0] = cy * cz + sy * sx * sz; o[1] = cx * sz; o[2] = -sy * cz + cy * sx * sz; o[3] = 0;
  o[4] = -cy * sz + sy * sx * cz; o[5] = cx * cz; o[6] = sy * sz + cy * sx * cz; o[7] = 0;
  o[8] = sy * cx; o[9] = -sx; o[10] = cy * cx; o[11] = 0;
  o[12] = x; o[13] = y; o[14] = z; o[15] = 1;
  return o;
}

export function rot2(lx, lz, r) { const c = Math.cos(r), s = Math.sin(r); return [lx * c + lz * s, -lx * s + lz * c]; }
export function wpt(x, z, r, lx, lz) { const p = rot2(lx, lz, r); return [x + p[0], z + p[1]]; }
export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function angLerp(a, b, t) { const d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI; return a + d * t; }

/* deterministic hash-based RNG so a seed always reproduces the same office */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Compose a glTF node transform: T * R(quat) * S. glTF stores rotation as a
   quaternion, which the pose rig never needed — m4trs above takes Euler angles
   and cannot express one. */
export function m4trsQ(o, t, q, s) {
  const [x, y, z, w] = q, [sx, sy, sz] = s;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  o[0] = (1 - (yy + zz)) * sx; o[1] = (xy + wz) * sx; o[2] = (xz - wy) * sx; o[3] = 0;
  o[4] = (xy - wz) * sy; o[5] = (1 - (xx + zz)) * sy; o[6] = (yz + wx) * sy; o[7] = 0;
  o[8] = (xz + wy) * sz; o[9] = (yz - wx) * sz; o[10] = (1 - (xx + yy)) * sz; o[11] = 0;
  o[12] = t[0]; o[13] = t[1]; o[14] = t[2]; o[15] = 1;
  return o;
}

/* Shortest-arc quaternion slerp, writing into `o`. Falls back to nlerp when the
   two are nearly parallel, where sin(theta) stops being a usable divisor. */
export function qslerp(o, a, b, t) {
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  let d = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (d < 0) { d = -d; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let s0 = 1 - t, s1 = t;
  if (d < 0.9995) {
    const th = Math.acos(Math.min(1, d)), st = Math.sin(th);
    s0 = Math.sin((1 - t) * th) / st;
    s1 = Math.sin(t * th) / st;
  }
  o[0] = a[0] * s0 + bx * s1; o[1] = a[1] * s0 + by * s1;
  o[2] = a[2] * s0 + bz * s1; o[3] = a[3] * s0 + bw * s1;
  const l = Math.hypot(o[0], o[1], o[2], o[3]) || 1;
  o[0] /= l; o[1] /= l; o[2] /= l; o[3] /= l;
  return o;
}
