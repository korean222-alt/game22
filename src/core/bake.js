/* Offline bakes driven by the AABBs a MeshBuilder recorded while drawing.

   bakeAO      cone-samples a voxelised occupancy grid per vertex and writes the
               result into mb.a. This is what gives corners, desk undersides and
               shelf interiors their contact darkening — the single biggest
               readability win in an interior scene.

   NavGrid     the same solids projected to 2D between knee and head height,
               dilated by the walker's body radius. A clear centre line in the
               dilated grid means a clear BODY, so "does this path clip a desk"
               is answerable rather than eyeballed.

   Both size themselves to the geometry instead of assuming fixed world bounds,
   so a taller office tower needs no constant tweaking. */

import { clamp } from './math.js';

function boundsOf(solids, pad) {
  if (!solids.length) return { min: [-1, -1, -1], max: [1, 1, 1] };
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < solids.length; i += 6) {
    if (solids[i] < x0) x0 = solids[i];
    if (solids[i + 1] < y0) y0 = solids[i + 1];
    if (solids[i + 2] < z0) z0 = solids[i + 2];
    if (solids[i + 3] > x1) x1 = solids[i + 3];
    if (solids[i + 4] > y1) y1 = solids[i + 4];
    if (solids[i + 5] > z1) z1 = solids[i + 5];
  }
  return { min: [x0 - pad, y0 - pad, z0 - pad], max: [x1 + pad, y1 + pad, z1 + pad] };
}

export function bakeAO(mb, strength = 0.72, cell = 1.0) {
  const S = mb.solids;
  if (!S.length || !mb.p.length) return;

  const bb = boundsOf(S, 2);
  const DX = Math.max(1, Math.min(320, Math.ceil((bb.max[0] - bb.min[0]) / cell)));
  const DY = Math.max(1, Math.min(160, Math.ceil((bb.max[1] - bb.min[1]) / cell)));
  const DZ = Math.max(1, Math.min(320, Math.ceil((bb.max[2] - bb.min[2]) / cell)));
  const grid = new Uint8Array(DX * DY * DZ);
  const [mx, my, mz] = bb.min;

  for (let i = 0; i < S.length; i += 6) {
    const x0 = Math.max(0, Math.floor((S[i] - mx) / cell)), x1 = Math.min(DX - 1, Math.floor((S[i + 3] - mx) / cell));
    const y0 = Math.max(0, Math.floor((S[i + 1] - my) / cell)), y1 = Math.min(DY - 1, Math.floor((S[i + 4] - my) / cell));
    const z0 = Math.max(0, Math.floor((S[i + 2] - mz) / cell)), z1 = Math.min(DZ - 1, Math.floor((S[i + 5] - mz) / cell));
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const base = (x * DY + y) * DZ;
      for (let z = z0; z <= z1; z++) grid[base + z] = 1;
    }
  }

  const occ = (px, py, pz) => {
    const x = ((px - mx) / cell) | 0, y = ((py - my) / cell) | 0, z = ((pz - mz) / cell) | 0;
    if (x < 0 || y < 0 || z < 0 || x >= DX || y >= DY || z >= DZ) return 0;
    return grid[(x * DY + y) * DZ + z];
  };

  // Cosine-ish hemisphere directions via a golden-angle spiral: 9 rays give a
  // smooth enough falloff at a fraction of the cost of a proper hemisphere.
  const DIRS = [];
  for (let k = 0; k < 9; k++) {
    const u = (k + 0.5) / 9, ph = Math.acos(1 - u * 0.82), th = k * 2.39996;
    DIRS.push([Math.cos(th) * Math.sin(ph), Math.cos(ph), Math.sin(th) * Math.sin(ph)]);
  }
  const STEPS = [1.3, 2.6, 4.4, 6.6], W = [0.40, 0.29, 0.19, 0.12];

  // Vertices that share a position bucket and a dominant normal axis get the
  // same answer, so one cache entry serves the whole seam.
  const cache = new Map();
  const P = mb.p, N = mb.n, A = mb.a, nv = P.length / 3;
  for (let i = 0; i < nv; i++) {
    const px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
    const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
    let key = ((((px - mx) * 4) | 0) * 4001 + (((py - my) * 4) | 0)) * 4001 + (((pz - mz) * 4) | 0);
    key = key * 27 + ((nx > 0.5 ? 1 : nx < -0.5 ? 2 : 0) * 9
      + (ny > 0.5 ? 1 : ny < -0.5 ? 2 : 0) * 3
      + (nz > 0.5 ? 1 : nz < -0.5 ? 2 : 0));
    let v = cache.get(key);
    if (v === undefined) {
      // Build a basis around the normal so samples stay in the visible hemisphere.
      const ax = Math.abs(ny) < 0.9 ? 0 : 1, tx = ax ? 1 : 0, ty = 0, tz = ax ? 0 : 1;
      let bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
      const bl = Math.hypot(bx, by, bz) || 1; bx /= bl; by /= bl; bz /= bl;
      const cx2 = ny * bz - nz * by, cy2 = nz * bx - nx * bz, cz2 = nx * by - ny * bx;
      let o = 0;
      for (let k = 0; k < DIRS.length; k++) {
        const d = DIRS[k];
        const dx = bx * d[0] + nx * d[1] + cx2 * d[2];
        const dy = by * d[0] + ny * d[1] + cy2 * d[2];
        const dz = bz * d[0] + nz * d[1] + cz2 * d[2];
        for (let s = 0; s < STEPS.length; s++) {
          const t = STEPS[s];
          if (occ(px + nx * 0.55 + dx * t, py + ny * 0.55 + dy * t, pz + nz * 0.55 + dz * t)) { o += W[s]; break; }
        }
      }
      v = clamp(1 - (o / DIRS.length) * strength * 3.1, 0.30, 1);
      cache.set(key, v);
    }
    A[i] = v;
  }
}

/* Walkable space. `raw` is true occupancy; `dilated` has obstacles grown by the
   walker radius so a clear point means a clear body. */
export class NavGrid {
  constructor(mb, y0, y1, cell = 0.5, dilate = 2) {
    const S = mb.solids;
    const bb = boundsOf(S, 4);
    this.cell = cell;
    this.min = [bb.min[0], bb.min[2]];
    this.DX = Math.max(1, Math.min(600, Math.ceil((bb.max[0] - bb.min[0]) / cell)));
    this.DZ = Math.max(1, Math.min(600, Math.ceil((bb.max[2] - bb.min[2]) / cell)));

    const raw = new Uint8Array(this.DX * this.DZ);
    for (let i = 0; i < S.length; i += 6) {
      if (S[i + 4] <= y0 || S[i + 1] >= y1) continue;      // no overlap in Y
      const x0 = Math.max(0, Math.floor((S[i] - this.min[0]) / cell));
      const x1 = Math.min(this.DX - 1, Math.floor((S[i + 3] - this.min[0]) / cell));
      const z0 = Math.max(0, Math.floor((S[i + 2] - this.min[1]) / cell));
      const z1 = Math.min(this.DZ - 1, Math.floor((S[i + 5] - this.min[1]) / cell));
      for (let x = x0; x <= x1; x++) {
        const base = x * this.DZ;
        for (let z = z0; z <= z1; z++) raw[base + z] = 1;
      }
    }
    this.raw = raw;

    if (dilate > 0) {
      const out = new Uint8Array(this.DX * this.DZ);
      for (let gx = 0; gx < this.DX; gx++) for (let gz = 0; gz < this.DZ; gz++) {
        if (!raw[gx * this.DZ + gz]) continue;
        const ax = Math.max(0, gx - dilate), bx = Math.min(this.DX - 1, gx + dilate);
        const az = Math.max(0, gz - dilate), bz = Math.min(this.DZ - 1, gz + dilate);
        for (let px = ax; px <= bx; px++) for (let pz = az; pz <= bz; pz++) out[px * this.DZ + pz] = 1;
      }
      this.dilated = out;
    } else this.dilated = raw;
  }

  _at(g, x, z) {
    const gx = Math.floor((x - this.min[0]) / this.cell), gz = Math.floor((z - this.min[1]) / this.cell);
    if (gx < 0 || gz < 0 || gx >= this.DX || gz >= this.DZ) return false;
    return g[gx * this.DZ + gz] === 0;
  }

  isClearRaw(x, z) { return this._at(this.raw, x, z); }
  isClear(x, z) { return this._at(this.dilated, x, z); }

  /* a body of radius r fits here: centre plus 8 rim samples against raw */
  circleClear(x, z, r) {
    if (!this.isClearRaw(x, z)) return false;
    for (let i = 0; i < 8; i++) {
      const a = i * 0.7853982;
      if (!this.isClearRaw(x + Math.cos(a) * r, z + Math.sin(a) * r)) return false;
    }
    return true;
  }

  /* is the straight walk A->B clear? trimEnd ignores the last few feet, which
     is the chair the walker is about to sit in. */
  segClear(x0, z0, x1, z1, trimEnd = 0, trimStart = 0) {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    if (len < 0.001) return this.isClear(x0, z0);
    const a = trimStart / len, b = 1 - trimEnd / len;
    const steps = Math.max(2, Math.ceil(len / 0.4));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (t < a || t > b) continue;
      if (!this.isClear(x0 + dx * t, z0 + dz * t)) return false;
    }
    return true;
  }
}
