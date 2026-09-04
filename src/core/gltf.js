/* A small GLB reader — just enough of glTF 2.0 for the monster pack.

   Scope is deliberate. The office is procedural and needs none of this; the
   only external assets in the game are the boss monsters, and they are all the
   same shape: one skin, one atlas texture, a handful of clips, non-interleaved
   attributes written by Blender's exporter. So this reads exactly that and
   throws on anything else rather than growing into a general loader nobody
   maintains.

   What comes back is plain typed arrays plus a node tree. Nothing here touches
   WebGL — `render/skinned.js` owns the GPU side, the same way `game/` owns the
   rules and knows nothing about either. */

import { m4, m4mul, m4trsQ, qslerp } from './math.js';

const MAGIC = 0x46546c67;      // 'glTF'
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const COMP = {
  5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
  5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array,
};
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

/* glTF stores normalised integers for weights and UVs when the exporter feels
   like it. Reading them back as floats once here means the shader never has to
   care which encoding a particular file happened to use. */
const NORM_DIV = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

function readAccessor(g, bin, index) {
  const acc = g.accessors[index];
  const n = NCOMP[acc.type];
  const Ctor = COMP[acc.componentType];
  const out = new Ctor(acc.count * n);
  if (acc.bufferView !== undefined) {
    const bv = g.bufferViews[acc.bufferView];
    const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const elemBytes = Ctor.BYTES_PER_ELEMENT * n;
    const stride = bv.byteStride || elemBytes;
    if (stride === elemBytes) {
      // Tightly packed: one view over the whole run.
      out.set(new Ctor(bin.buffer, bin.byteOffset + base, acc.count * n));
    } else {
      for (let i = 0; i < acc.count; i++) {
        out.set(new Ctor(bin.buffer, bin.byteOffset + base + i * stride, n), i * n);
      }
    }
  }
  return out;
}

/* An accessor read as Float32, un-normalising integer encodings on the way. */
function readFloats(g, bin, index) {
  const acc = g.accessors[index];
  const raw = readAccessor(g, bin, index);
  if (raw instanceof Float32Array) return raw;
  const div = acc.normalized ? NORM_DIV[acc.componentType] : 0;
  const out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = div ? raw[i] / div : raw[i];
  return out;
}

function parseContainer(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== MAGIC) {
    // A plain .gltf with an embedded base64 buffer also works; it is what the
    // exporter produces before tools/gltf2glb.mjs packs it.
    const g = JSON.parse(new TextDecoder().decode(buf));
    const uri = g.buffers && g.buffers[0] && g.buffers[0].uri;
    const m = uri && /^data:[^;]*;base64,(.*)$/.exec(uri);
    if (!m) throw new Error('gltf: no GLB magic and no embedded buffer');
    const s = atob(m[1]);
    const bin = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bin[i] = s.charCodeAt(i);
    return { g, bin };
  }
  let off = 12, json = null, bin = null;
  while (off + 8 <= buf.byteLength) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const start = off + 8;
    if (type === CHUNK_JSON) json = new TextDecoder().decode(new Uint8Array(buf, start, len));
    else if (type === CHUNK_BIN) bin = new Uint8Array(buf, start, len);
    off = start + len + ((4 - (len % 4)) % 4);
  }
  if (!json) throw new Error('gltf: no JSON chunk');
  return { g: JSON.parse(json), bin: bin || new Uint8Array(0) };
}

/* ---- animation ----
   Channels are kept as flat arrays keyed by node, which is the shape the
   sampler wants at 60fps: find the keyframe pair, lerp, write. Cubic spline
   interpolation is not used by these clips and is read as linear if it ever
   appears — visibly wrong beats a crash on an unknown file. */
function parseAnimations(g, bin) {
  const out = [];
  for (const a of g.animations || []) {
    const channels = [];
    let duration = 0;
    for (const ch of a.channels || []) {
      const smp = a.samplers[ch.sampler];
      if (!smp || ch.target.node === undefined) continue;
      const times = readFloats(g, bin, smp.input);
      const values = readFloats(g, bin, smp.output);
      const path = ch.target.path;
      if (path !== 'translation' && path !== 'rotation' && path !== 'scale') continue;
      const stride = path === 'rotation' ? 4 : 3;
      channels.push({
        node: ch.target.node, path, times, values, stride,
        step: smp.interpolation === 'STEP',
      });
      if (times.length) duration = Math.max(duration, times[times.length - 1]);
    }
    out.push({ name: a.name || `clip${out.length}`, duration, channels });
  }
  return out;
}

/* ---- the pose solver ----
   Pure maths over the parsed node tree: sample a clip into per-node TRS,
   resolve the hierarchy, and write skinning matrices. It lives here rather
   than beside the GPU code so the boss animation can be stepped and checked in
   Node, the same way the balance simulation runs without a browser. */
export class Skeleton {
  constructor(data) {
    this.data = data;
    const n = data.nodes.length;
    this.trs = data.nodes.map((nd) => ({ t: nd.t.slice(), r: nd.r.slice(), s: nd.s.slice() }));
    this.local = Array.from({ length: n }, () => m4());
    this.world = Array.from({ length: n }, () => m4());
    this.parent = new Int32Array(n).fill(-1);
    for (const [i, nd] of data.nodes.entries()) for (const c of nd.children) this.parent[c] = i;
    this.jointCount = data.skin ? data.skin.joints.length : 0;
    this.jointData = new Float32Array(Math.max(1, this.jointCount) * 16);
    this._scratch = m4();
    this._solved = new Uint8Array(n);
    this._stack = [];
  }

  /* Write a clip's value at time `t` into the node TRS list. Channels are
     sorted by time, so a bisect finds the bracketing pair without the cursor
     state a linear scan would need — and without desyncing after a seek. */
  sample(clip, t) {
    if (!clip) return;
    for (const ch of clip.channels) {
      const times = ch.times, n = times.length;
      if (!n) continue;
      const dst = this.trs[ch.node];
      if (!dst) continue;
      let i = 0;
      if (t <= times[0]) i = 0;
      else if (t >= times[n - 1]) i = n - 1;
      else {
        let lo = 0, hi = n - 1;
        while (lo + 1 < hi) {
          const mid = (lo + hi) >> 1;
          if (times[mid] <= t) lo = mid; else hi = mid;
        }
        i = lo;
      }
      const j = Math.min(n - 1, i + 1);
      const t0 = times[i], t1 = times[j];
      const u = (ch.step || t1 <= t0) ? 0 : Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
      if (ch.path === 'rotation') {
        qslerp(dst.r,
          [V4(ch.values, i, 0), V4(ch.values, i, 1), V4(ch.values, i, 2), V4(ch.values, i, 3)],
          [V4(ch.values, j, 0), V4(ch.values, j, 1), V4(ch.values, j, 2), V4(ch.values, j, 3)], u);
      } else {
        const arr = ch.path === 'translation' ? dst.t : dst.s;
        const S = ch.stride, V = ch.values;
        for (let k = 0; k < S; k++) arr[k] = V[i * S + k] + (V[j * S + k] - V[i * S + k]) * u;
      }
    }
  }

  /* Resolve node world matrices and fill `jointData`. glTF does not promise
     nodes appear before their children, so each one walks up to the root
     rather than trusting array order. */
  solve() {
    const nodes = this.data.nodes;
    for (let i = 0; i < nodes.length; i++) {
      const nd = nodes[i], tr = this.trs[i];
      if (nd.matrix) this.local[i].set(nd.matrix);
      else m4trsQ(this.local[i], tr.t, tr.r, tr.s);
    }
    const solved = this._solved.fill(0), stack = this._stack;
    for (let i = 0; i < nodes.length; i++) {
      if (solved[i]) continue;
      stack.length = 0;
      let c = i;
      while (c >= 0 && !solved[c]) { stack.push(c); c = this.parent[c]; }
      for (let k = stack.length - 1; k >= 0; k--) {
        const node = stack[k], par = this.parent[node];
        if (par < 0) this.world[node].set(this.local[node]);
        else m4mul(this.world[node], this.world[par], this.local[node]);
        solved[node] = 1;
      }
    }
    const skin = this.data.skin;
    if (!skin) return this.jointData;
    for (let k = 0; k < skin.joints.length; k++) {
      const jw = this.world[skin.joints[k]];
      if (skin.ibm) {
        m4mul(this._scratch, jw, skin.ibm.subarray(k * 16, k * 16 + 16));
        this.jointData.set(this._scratch, k * 16);
      } else this.jointData.set(jw, k * 16);
    }
    return this.jointData;
  }
}

const V4 = (a, i, k) => a[i * 4 + k];

/* ---- entry point ---- */
export async function loadGLB(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`gltf: ${res.status} ${url}`);
  const { g, bin } = parseContainer(await res.arrayBuffer());

  /* nodes: rest-pose TRS plus children */
  const nodes = (g.nodes || []).map((n) => ({
    name: n.name || '',
    children: n.children || [],
    t: n.translation ? n.translation.slice() : [0, 0, 0],
    r: n.rotation ? n.rotation.slice() : [0, 0, 0, 1],
    s: n.scale ? n.scale.slice() : [1, 1, 1],
    mesh: n.mesh,
    skin: n.skin,
    matrix: n.matrix ? Float32Array.from(n.matrix) : null,
  }));
  const sceneIdx = g.scene || 0;
  const roots = (g.scenes && g.scenes[sceneIdx] && g.scenes[sceneIdx].nodes) || [0];

  /* skin: the joint list and its inverse bind matrices */
  let skin = null;
  const skinDef = (g.skins || [])[0];
  if (skinDef) {
    skin = {
      joints: skinDef.joints.slice(),
      ibm: skinDef.inverseBindMatrices !== undefined
        ? readFloats(g, bin, skinDef.inverseBindMatrices)
        : null,
      skeleton: skinDef.skeleton,
    };
  }

  /* primitives: every skinned mesh in the file, flattened.
     The packs split a character across two meshes (body + weapon) sharing one
     atlas, so drawing them as one buffer is both correct and cheaper. */
  const prims = [];
  for (const [mi, mesh] of (g.meshes || []).entries()) {
    for (const p of mesh.primitives || []) {
      if (p.mode !== undefined && p.mode !== 4) continue;      // triangles only
      const A = p.attributes || {};
      if (A.POSITION === undefined) continue;
      const pos = readFloats(g, bin, A.POSITION);
      const count = pos.length / 3;
      const nrm = A.NORMAL !== undefined ? readFloats(g, bin, A.NORMAL) : new Float32Array(count * 3);
      const uv = A.TEXCOORD_0 !== undefined ? readFloats(g, bin, A.TEXCOORD_0) : new Float32Array(count * 2);
      // Joint indices stay integral; weights are normalised so the four of them
      // sum to one even when the exporter rounded.
      const jRaw = A.JOINTS_0 !== undefined ? readAccessor(g, bin, A.JOINTS_0) : null;
      const joints = new Float32Array(count * 4);
      if (jRaw) for (let i = 0; i < joints.length; i++) joints[i] = jRaw[i];
      const weights = new Float32Array(count * 4);
      if (A.WEIGHTS_0 !== undefined) {
        const w = readFloats(g, bin, A.WEIGHTS_0);
        for (let i = 0; i < count; i++) {
          const s = w[i * 4] + w[i * 4 + 1] + w[i * 4 + 2] + w[i * 4 + 3] || 1;
          for (let k = 0; k < 4; k++) weights[i * 4 + k] = w[i * 4 + k] / s;
        }
      } else {
        for (let i = 0; i < count; i++) weights[i * 4] = 1;
      }
      let idx;
      if (p.indices !== undefined) {
        const raw = readAccessor(g, bin, p.indices);
        idx = raw instanceof Uint32Array ? raw : Uint32Array.from(raw);
      } else {
        idx = new Uint32Array(count);
        for (let i = 0; i < count; i++) idx[i] = i;
      }
      prims.push({ meshIndex: mi, pos, nrm, uv, joints, weights, idx, count });
    }
  }

  /* the base colour texture, as bytes the caller turns into an ImageBitmap */
  let image = null;
  const tex = (g.textures || [])[0];
  const imgDef = tex !== undefined ? (g.images || [])[tex.source] : (g.images || [])[0];
  if (imgDef) {
    if (imgDef.bufferView !== undefined) {
      const bv = g.bufferViews[imgDef.bufferView];
      const off = bv.byteOffset || 0;
      image = new Blob([bin.slice(off, off + bv.byteLength)],
        { type: imgDef.mimeType || 'image/png' });
    } else if (imgDef.uri) {
      image = imgDef.uri;              // a data: or relative URL the caller fetches
    }
  }

  return { nodes, roots, skin, prims, image, animations: parseAnimations(g, bin), json: g };
}
