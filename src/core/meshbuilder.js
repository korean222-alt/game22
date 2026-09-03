/* MeshBuilder — an immediate-mode geometry accumulator.

   Every primitive appends triangles into flat arrays that upload() turns into
   one VAO. Each vertex carries:
     p   position
     n   normal (smooth on curved primitives, faceted on boxes)
     c   sRGB colour, converted to linear in the vertex shader
     a   baked ambient occlusion, filled in later by bakeAO()
     f   flag: 0 opaque/uncuttable, 1 cuttable wall, 2 glass, 3 never-cut, 4+ floor id
     b   bone index into uBones[]; static geometry uses bone 0 (the model matrix)
     m   (material id, u, v)

   Boxes and cylinders also record their AABB in `solids`, which is what the AO
   bake voxelises and what the walkable-space grid is built from. One geometry
   pass therefore produces lighting and collision for free. */

import { hex2rgb, matOf, MAT } from './color.js';

export function MeshBuilder() {
  this.p = []; this.n = []; this.c = []; this.a = []; this.f = []; this.b = []; this.m = [];
  this.solids = [];
  this.flag = 0;      // current flag applied to new vertices
  this.bone = 0;      // current bone index
  this.mat = 0;       // 0 = derive material from colour, else force this one
  this.noSolid = false; // when true, geometry draws but never blocks a walker
}
const MB = MeshBuilder.prototype;

MB._pushMat = function (col) {
  const mt = this.mat || matOf(col);
  this.m.push(mt, 0, 0, mt, 0, 0, mt, 0, 0);
};

MB.tri = function (ax, ay, az, bx, by, bz, cx, cy, cz, col) {
  this._pushMat(col);
  const c = hex2rgb(col);
  const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  this.p.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  this.n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  this.c.push(c[0], c[1], c[2], c[0], c[1], c[2], c[0], c[1], c[2]);
  this.a.push(1, 1, 1);
  this.f.push(this.flag, this.flag, this.flag);
  this.b.push(this.bone, this.bone, this.bone);
  return this;
};

MB.triN = function (ax, ay, az, na, bx, by, bz, nb, cx, cy, cz, nc, col) {
  this._pushMat(col);
  const c = hex2rgb(col);
  this.p.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  this.n.push(na[0], na[1], na[2], nb[0], nb[1], nb[2], nc[0], nc[1], nc[2]);
  this.c.push(c[0], c[1], c[2], c[0], c[1], c[2], c[0], c[1], c[2]);
  this.a.push(1, 1, 1);
  this.f.push(this.flag, this.flag, this.flag);
  this.b.push(this.bone, this.bone, this.bone);
  return this;
};

/* triangle with an explicit material and texture coordinates: screens, boards */
MB.triUV = function (ax, ay, az, bx, by, bz, cx, cy, cz, col, mat, u0, v0, u1, v1, u2, v2) {
  const c = hex2rgb(col);
  const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  this.p.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  this.n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  this.c.push(c[0], c[1], c[2], c[0], c[1], c[2], c[0], c[1], c[2]);
  this.a.push(1, 1, 1);
  this.f.push(this.flag, this.flag, this.flag);
  this.b.push(this.bone, this.bone, this.bone);
  this.m.push(mat, u0, v0, mat, u1, v1, mat, u2, v2);
  return this;
};

/* p0..p3 counter-clockwise from the front; uv runs (0,0) at p0 to (1,1) at p2 */
MB.quadUV = function (p0, p1, p2, p3, col, mat) {
  this.triUV(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], col, mat, 0, 0, 1, 0, 1, 1);
  this.triUV(p0[0], p0[1], p0[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2], col, mat, 0, 0, 1, 1, 0, 1);
  return this;
};

MB.quadN = function (p0, n0, p1, n1, p2, n2, p3, n3, col) {
  this.triN(p0[0], p0[1], p0[2], n0, p1[0], p1[1], p1[2], n1, p2[0], p2[1], p2[2], n2, col);
  this.triN(p0[0], p0[1], p0[2], n0, p2[0], p2[1], p2[2], n2, p3[0], p3[1], p3[2], n3, col);
  return this;
};

MB.quad = function (p0, p1, p2, p3, col) {
  this.tri(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], col);
  this.tri(p0[0], p0[1], p0[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2], col);
  return this;
};

MB.solid = function (x0, y0, z0, x1, y1, z1) {
  if (this.noSolid) return;
  this.solids.push(x0, y0, z0, x1, y1, z1);
};

/* axis-aligned box, centre + full extents */
MB.box = function (cx, cy, cz, w, h, d, col, top) {
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2,
    z0 = cz - d / 2, z1 = cz + d / 2, t = top || col;
  this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], t);
  this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], col);
  this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col);
  this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], col);
  this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], col);
  this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], col);
  this.solid(x0, y0, z0, x1, y1, z1);
  return this;
};

/* box rotated about Y through its own centre */
MB.boxY = function (cx, cy, cz, w, h, d, ry, col, top) {
  if (!ry) return this.box(cx, cy, cz, w, h, d, col, top);
  const c = Math.cos(ry), s = Math.sin(ry), hw = w / 2, hd = d / 2,
    y0 = cy - h / 2, y1 = cy + h / 2, t = top || col;
  const R = (lx, lz) => [cx + lx * c + lz * s, cz - lx * s + lz * c];
  const a = R(-hw, -hd), b = R(hw, -hd), e = R(hw, hd), f = R(-hw, hd);
  this.quad([a[0], y1, a[1]], [b[0], y1, b[1]], [e[0], y1, e[1]], [f[0], y1, f[1]], t);
  this.quad([a[0], y0, a[1]], [f[0], y0, f[1]], [e[0], y0, e[1]], [b[0], y0, b[1]], col);
  this.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], col);
  this.quad([b[0], y0, b[1]], [e[0], y0, e[1]], [e[0], y1, e[1]], [b[0], y1, b[1]], col);
  this.quad([e[0], y0, e[1]], [f[0], y0, f[1]], [f[0], y1, f[1]], [e[0], y1, e[1]], col);
  this.quad([f[0], y0, f[1]], [a[0], y0, a[1]], [a[0], y1, a[1]], [f[0], y1, f[1]], col);
  const mx = Math.abs(hw * c) + Math.abs(hd * s), mz = Math.abs(hw * s) + Math.abs(hd * c);
  this.solid(cx - mx, y0, cz - mz, cx + mx, y1, cz + mz);
  return this;
};

MB.cyl = function (cx, cy, cz, r, h, col, seg, top) {
  seg = seg || 10;
  const y0 = cy - h / 2, y1 = cy + h / 2, t = top || col, pts = [];
  for (let i = 0; i < seg; i++) {
    const a = i / seg * 6.2831853;
    pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  for (let i = 0; i < seg; i++) {
    const p0 = pts[i], p1 = pts[(i + 1) % seg];
    this.quad([p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]], col);
    this.tri(cx, y1, cz, p0[0], y1, p0[1], p1[0], y1, p1[1], t);
    this.tri(cx, y0, cz, p1[0], y0, p1[1], p0[0], y0, p0[1], col);
  }
  this.solid(cx - r, y0, cz - r, cx + r, y1, cz + r);
  return this;
};

/* tapered prism down the local -Y axis, smooth radial normals: limbs */
MB.limb = function (len, r0, r1, seg, col, squashX, squashZ) {
  return this.limbT(len, r0, r1, seg, col, squashX, squashZ, 0, 0, 0, 0);
};

/* same taper drawn UP the local +Y axis: torso segments */
MB.limbUp = function (len, r0, r1, seg, col, squashX, squashZ) {
  seg = seg || 8; squashX = squashX || 1; squashZ = squashZ || 1;
  const ring0 = [], ring1 = [], nrm = [];
  for (let i = 0; i < seg; i++) {
    const a = i / seg * 6.2831853, ca = Math.cos(a), sa = Math.sin(a);
    ring0.push([ca * r0 * squashX, 0, sa * r0 * squashZ]);
    ring1.push([ca * r1 * squashX, len, sa * r1 * squashZ]);
    const nl = Math.hypot(ca / squashX, sa / squashZ) || 1;
    nrm.push([ca / squashX / nl, 0, sa / squashZ / nl]);
  }
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    this.quadN(ring0[j], nrm[j], ring0[i], nrm[i], ring1[i], nrm[i], ring1[j], nrm[j], col);
  }
  for (let i = 1; i < seg - 1; i++) {
    this.tri(ring0[0][0], 0, ring0[0][2], ring0[i][0], 0, ring0[i][2], ring0[i + 1][0], 0, ring0[i + 1][2], col);
    this.tri(ring1[0][0], len, ring1[0][2], ring1[i + 1][0], len, ring1[i + 1][2], ring1[i][0], len, ring1[i][2], col);
  }
  return this;
};

/* limb hanging down -Y at an offset and tilted about X: fingers, cuffs, thumbs */
MB.limbT = function (len, r0, r1, seg, col, squashX, squashZ, ox, oy, oz, rx) {
  seg = seg || 8; squashX = squashX || 1; squashZ = squashZ || 1;
  ox = ox || 0; oy = oy || 0; oz = oz || 0; rx = rx || 0;
  const cr = Math.cos(rx), sr = Math.sin(rx);
  const T = (p) => [p[0] + ox, p[1] * cr - p[2] * sr + oy, p[1] * sr + p[2] * cr + oz];
  const TN = (v) => [v[0], v[1] * cr - v[2] * sr, v[1] * sr + v[2] * cr];
  const ring0 = [], ring1 = [], nrm = [];
  for (let i = 0; i < seg; i++) {
    const a = i / seg * 6.2831853, ca = Math.cos(a), sa = Math.sin(a);
    ring0.push(T([ca * r0 * squashX, 0, sa * r0 * squashZ]));
    ring1.push(T([ca * r1 * squashX, -len, sa * r1 * squashZ]));
    const nl = Math.hypot(ca / squashX, sa / squashZ) || 1;
    nrm.push(TN([ca / squashX / nl, 0, sa / squashZ / nl]));
  }
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    this.quadN(ring0[i], nrm[i], ring0[j], nrm[j], ring1[j], nrm[j], ring1[i], nrm[i], col);
  }
  for (let i = 1; i < seg - 1; i++) {
    this.tri(ring0[0][0], ring0[0][1], ring0[0][2], ring0[i + 1][0], ring0[i + 1][1], ring0[i + 1][2],
      ring0[i][0], ring0[i][1], ring0[i][2], col);
    this.tri(ring1[0][0], ring1[0][1], ring1[0][2], ring1[i][0], ring1[i][1], ring1[i][2],
      ring1[i + 1][0], ring1[i + 1][1], ring1[i + 1][2], col);
  }
  return this;
};

/* ellipsoid with smooth per-vertex normals: heads, shoulders, hair, foliage */
MB.ball = function (cx, cy, cz, rx, ry, rz, col, seg, ring) {
  seg = seg || 10; ring = ring || 6;
  const pts = [], nms = [];
  const nrmAt = (px, py, pz) => {
    const nx = (px - cx) / (rx * rx), ny = (py - cy) / (ry * ry), nz = (pz - cz) / (rz * rz);
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  };
  for (let j = 0; j <= ring; j++) {
    const ph = j / ring * Math.PI, sp = Math.sin(ph), cp = Math.cos(ph), row = [], nro = [];
    for (let i = 0; i < seg; i++) {
      const th = i / seg * 6.2831853;
      const px = cx + Math.cos(th) * sp * rx, py = cy + cp * ry, pz = cz + Math.sin(th) * sp * rz;
      row.push([px, py, pz]); nro.push(nrmAt(px, py, pz));
    }
    pts.push(row); nms.push(nro);
  }
  for (let j = 0; j < ring; j++) for (let i = 0; i < seg; i++) {
    const i2 = (i + 1) % seg;
    const A = pts[j][i], Bp = pts[j][i2], C = pts[j + 1][i2], D = pts[j + 1][i];
    const nA = nms[j][i], nB = nms[j][i2], nC = nms[j + 1][i2], nD = nms[j + 1][i];
    if (j === 0) this.triN(A[0], A[1], A[2], nA, C[0], C[1], C[2], nC, D[0], D[1], D[2], nD, col);
    else if (j === ring - 1) this.triN(A[0], A[1], A[2], nA, Bp[0], Bp[1], Bp[2], nB, D[0], D[1], D[2], nD, col);
    else this.quadN(A, nA, Bp, nB, C, nC, D, nD, col);
  }
  this.solid(cx - rx, cy - ry, cz - rz, cx + rx, cy + ry, cz + rz);
  return this;
};

MB.count = function () { return this.p.length / 3; };

/* Merge another builder in, offsetting nothing — used to assemble a floor from
   independently generated rooms. Solids come along so AO and nav stay correct. */
MB.append = function (other) {
  for (const k of ['p', 'n', 'c', 'a', 'f', 'b', 'm', 'solids']) {
    const src = other[k], dst = this[k];
    for (let i = 0; i < src.length; i++) dst.push(src[i]);
  }
  return this;
};

/* Split glass (flag 2) into its own mesh so it can be drawn last, blended,
   with depth writes off. */
export function splitGlass(mb) {
  const mk = () => ({ p: [], n: [], c: [], a: [], f: [], b: [], m: [], count() { return this.p.length / 3; } });
  const A = mk(), G = mk();
  const tris = mb.p.length / 9;
  for (let t = 0; t < tris; t++) {
    const o = t * 9, fo = t * 3;
    const dst = (mb.f[fo] > 1.5 && mb.f[fo] < 2.5) ? G : A;
    for (let k = 0; k < 9; k++) {
      dst.p.push(mb.p[o + k]); dst.n.push(mb.n[o + k]);
      dst.c.push(mb.c[o + k]); dst.m.push(mb.m[o + k]);
    }
    for (let k = 0; k < 3; k++) {
      dst.a.push(mb.a[fo + k]); dst.f.push(mb.f[fo + k]); dst.b.push(mb.b[fo + k]);
    }
  }
  return { solid: A, glass: G };
}

export { MAT };
