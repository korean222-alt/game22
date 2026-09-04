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
  // Stair treads and the like are in `softs`: they shade, they just do not block.
  const S = mb.allSolids ? mb.allSolids() : mb.solids;
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
  /* `area` is the walkable rectangle {x0,z0,x1,z1}. Pass it. Deriving the
     bounds from the solids instead sweeps in every distant scenery block, and
     the size clamp below then silently rescales the grid so cells no longer
     map to the world positions the caller thinks they do — which looks exactly
     like "pathfinding is broken" and is very hard to see from the outside. */
  constructor(mb, y0, y1, cell = 0.5, dilate = 2, area = null) {
    const S = mb.solids;
    const bb = area
      ? { min: [area.x0, 0, area.z0], max: [area.x1, 0, area.z1] }
      : boundsOf(S, 4);
    this.cell = cell;
    this.min = [bb.min[0], bb.min[2]];
    const wantX = Math.ceil((bb.max[0] - bb.min[0]) / cell);
    const wantZ = Math.ceil((bb.max[2] - bb.min[2]) / cell);
    if (wantX > 900 || wantZ > 900) {
      throw new Error(`NavGrid area too large: ${wantX}x${wantZ} cells. Pass a tighter area.`);
    }
    this.DX = Math.max(1, wantX);
    this.DZ = Math.max(1, wantZ);

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

  _cell(x, z) {
    return [Math.floor((x - this.min[0]) / this.cell), Math.floor((z - this.min[1]) / this.cell)];
  }

  _world(gx, gz) {
    return [this.min[0] + (gx + 0.5) * this.cell, this.min[1] + (gz + 0.5) * this.cell];
  }

  _free(gx, gz) {
    if (gx < 0 || gz < 0 || gx >= this.DX || gz >= this.DZ) return false;
    return this.dilated[gx * this.DZ + gz] === 0;
  }

  /* A desk seat sits inside the dilated obstacle that is the chair, so both
     ends of a walk usually start blocked. Spiral out to the nearest cell a
     body actually fits in and path between those instead. */
  nearestFree(gx, gz, maxR = 14) {
    if (this._free(gx, gz)) return [gx, gz];
    for (let r = 1; r <= maxR; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;   // ring only
          if (this._free(gx + dx, gz + dz)) return [gx + dx, gz + dz];
        }
      }
    }
    return null;
  }

  /* A* over the dilated grid, then string-pulled against the same grid so the
     result is a handful of corners rather than a staircase of half-unit steps.
     Returns world-space [x,z] pairs, or null when there is no route. */
  path(x0, z0, x1, z1, budget = 9000) {
    const a = this.nearestFree(...this._cell(x0, z0));
    const b = this.nearestFree(...this._cell(x1, z1));
    if (!a || !b) return null;
    const DZ = this.DZ;
    const startI = a[0] * DZ + a[1], goalI = b[0] * DZ + b[1];
    if (startI === goalI) return [[x1, z1]];

    const H = (i) => {
      const gx = (i / DZ) | 0, gz = i % DZ;
      const dx = Math.abs(gx - b[0]), dz = Math.abs(gz - b[1]);
      // octile distance: the admissible heuristic for 8-way movement
      return (dx + dz) + (1.41421356 - 2) * Math.min(dx, dz);
    };

    const gScore = new Map([[startI, 0]]);
    const came = new Map();
    // Binary heap keyed on f; small enough that an array-based heap is ample.
    const heap = [[H(startI), startI]];
    const push = (f, i) => {
      heap.push([f, i]);
      let c = heap.length - 1;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (heap[p][0] <= heap[c][0]) break;
        [heap[p], heap[c]] = [heap[c], heap[p]]; c = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let p = 0;
        for (;;) {
          const l = p * 2 + 1, r = l + 1;
          let m = p;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === p) break;
          [heap[m], heap[p]] = [heap[p], heap[m]]; p = m;
        }
      }
      return top;
    };

    const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
                [1, 1, 1.41421356], [1, -1, 1.41421356], [-1, 1, 1.41421356], [-1, -1, 1.41421356]];
    let visited = 0, found = false;
    while (heap.length && visited++ < budget) {
      const [, cur] = pop();
      if (cur === goalI) { found = true; break; }
      const cg = gScore.get(cur);
      const gx = (cur / DZ) | 0, gz = cur % DZ;
      for (const [dx, dz, w] of NB) {
        const nx = gx + dx, nz = gz + dz;
        if (!this._free(nx, nz)) continue;
        // Do not cut a diagonal through a corner a body could not pass.
        if (dx && dz && (!this._free(gx + dx, gz) || !this._free(gx, gz + dz))) continue;
        const ni = nx * DZ + nz;
        const ng = cg + w;
        if (gScore.has(ni) && gScore.get(ni) <= ng) continue;
        gScore.set(ni, ng);
        came.set(ni, cur);
        push(ng + H(ni), ni);
      }
    }
    if (!found) return null;

    const cells = [];
    for (let i = goalI; i !== undefined; i = came.get(i)) {
      cells.push(i);
      if (i === startI) break;
    }
    cells.reverse();

    const pts = cells.map((i) => this._world((i / DZ) | 0, i % DZ));
    pts.push([x1, z1]);

    // String-pull: keep only the corners the straight-line test cannot skip.
    const out = [];
    let anchor = [x0, z0];
    let i = 0;
    while (i < pts.length) {
      let far = i;
      for (let j = pts.length - 1; j > i; j--) {
        if (this.segClear(anchor[0], anchor[1], pts[j][0], pts[j][1])) { far = j; break; }
      }
      out.push(pts[far]);
      anchor = pts[far];
      if (far === pts.length - 1) break;
      i = far + 1;
    }
    return out;
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
