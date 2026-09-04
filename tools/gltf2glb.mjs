#!/usr/bin/env node
/* gltf2glb — pack a Blender-exported .gltf (embedded base64 buffer) into a
   single .glb, dropping the animations the game never plays.

   The monster packs ship fourteen clips each; the battle uses five. Base64 is
   also a third larger than the bytes it carries. Together those two facts are
   the difference between a 1.3 MB download per monster and roughly 200 KB,
   which on a phone is the difference between a boss that appears and one that
   arrives after the fight.

   Usage:  node tools/gltf2glb.mjs <in.gltf> <out.glb> [keep,clip,names]
   With no keep list every animation survives. */

import { readFileSync, writeFileSync } from 'node:fs';

const [, , inPath, outPath, keepArg] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node tools/gltf2glb.mjs <in.gltf> <out.glb> [Idle,Death,...]');
  process.exit(1);
}
const keep = keepArg ? new Set(keepArg.split(',').map((s) => s.trim())) : null;

const g = JSON.parse(readFileSync(inPath, 'utf8'));

/* ---- source buffers ---- */
const srcBuffers = g.buffers.map((b) => {
  if (!b.uri) throw new Error('GLB input is not supported; expected embedded or external buffers');
  const m = /^data:[^;]*;base64,(.*)$/.exec(b.uri);
  if (m) return Buffer.from(m[1], 'base64');
  return readFileSync(new URL(b.uri, `file://${process.cwd()}/${inPath}`));
});

/* ---- 1. drop unwanted animations ---- */
if (keep) {
  const before = g.animations ? g.animations.length : 0;
  g.animations = (g.animations || []).filter((a) => keep.has(a.name));
  const got = new Set(g.animations.map((a) => a.name));
  for (const want of keep) if (!got.has(want)) console.warn(`  ! clip not found: ${want}`);
  console.log(`  animations ${before} -> ${g.animations.length}`);
}

/* ---- 2. mark every accessor still referenced ---- */
const usedAcc = new Set();
const useAcc = (i) => { if (i !== undefined && i !== null) usedAcc.add(i); };
for (const mesh of g.meshes || []) {
  for (const p of mesh.primitives || []) {
    for (const a of Object.values(p.attributes || {})) useAcc(a);
    useAcc(p.indices);
    for (const t of p.targets || []) for (const a of Object.values(t)) useAcc(a);
  }
}
for (const s of g.skins || []) useAcc(s.inverseBindMatrices);
for (const a of g.animations || []) for (const s of a.samplers || []) { useAcc(s.input); useAcc(s.output); }

/* ---- 3. rebuild accessors, bufferViews and the binary blob together ----
   Every surviving accessor gets its own tightly packed bufferView. Blender's
   exporter already writes non-interleaved views, so copying accessor by
   accessor loses nothing and drops whatever the pruned clips were holding. */
const outBin = [];
let binLen = 0;
const newViews = [];
const pushBytes = (buf, stride) => {
  // Accessor component types are 1/2/4 bytes; 4-byte alignment satisfies all.
  while (binLen % 4) { outBin.push(Buffer.alloc(1)); binLen += 1; }
  const off = binLen;
  outBin.push(buf);
  binLen += buf.length;
  const v = { buffer: 0, byteOffset: off, byteLength: buf.length };
  if (stride) v.byteStride = stride;
  newViews.push(v);
  return newViews.length - 1;
};

const COMP_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const NUM_COMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

const accMap = new Map();
const newAccessors = [];
for (const [i, acc] of (g.accessors || []).entries()) {
  if (!usedAcc.has(i)) continue;
  const elem = COMP_SIZE[acc.componentType] * NUM_COMP[acc.type];
  const out = Buffer.alloc(elem * acc.count);
  if (acc.bufferView !== undefined) {
    const bv = g.bufferViews[acc.bufferView];
    const src = srcBuffers[bv.buffer || 0];
    const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const stride = bv.byteStride || elem;
    for (let k = 0; k < acc.count; k++) src.copy(out, k * elem, base + k * stride, base + k * stride + elem);
  }
  const copy = { ...acc };
  delete copy.sparse;                 // sparse storage is already resolved above
  copy.byteOffset = 0;
  copy.bufferView = pushBytes(out, 0);
  accMap.set(i, newAccessors.length);
  newAccessors.push(copy);
}

/* Images keep their own view: PNG bytes are opaque and copied whole. */
for (const img of g.images || []) {
  if (img.bufferView === undefined) continue;
  const bv = g.bufferViews[img.bufferView];
  const src = srcBuffers[bv.buffer || 0];
  const off = bv.byteOffset || 0;
  img.bufferView = pushBytes(src.subarray(off, off + bv.byteLength), 0);
  delete img.uri;
}

/* ---- 4. repoint every accessor reference ---- */
const remap = (i) => (i === undefined || i === null ? i : accMap.get(i));
for (const mesh of g.meshes || []) {
  for (const p of mesh.primitives || []) {
    for (const k of Object.keys(p.attributes || {})) p.attributes[k] = remap(p.attributes[k]);
    if (p.indices !== undefined) p.indices = remap(p.indices);
    for (const t of p.targets || []) for (const k of Object.keys(t)) t[k] = remap(t[k]);
  }
}
for (const s of g.skins || []) if (s.inverseBindMatrices !== undefined) s.inverseBindMatrices = remap(s.inverseBindMatrices);
for (const a of g.animations || []) for (const s of a.samplers || []) { s.input = remap(s.input); s.output = remap(s.output); }

g.accessors = newAccessors;
g.bufferViews = newViews;
g.buffers = [{ byteLength: binLen }];

/* ---- 5. emit the container ---- */
const bin = Buffer.concat(outBin, binLen);
const binPad = (4 - (bin.length % 4)) % 4;
const json = Buffer.from(JSON.stringify(g), 'utf8');
const jsonPad = (4 - (json.length % 4)) % 4;

const chunks = [];
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);       // 'glTF'
header.writeUInt32LE(2, 4);
const total = 12 + 8 + json.length + jsonPad + 8 + bin.length + binPad;
header.writeUInt32LE(total, 8);
chunks.push(header);

const jh = Buffer.alloc(8);
jh.writeUInt32LE(json.length + jsonPad, 0);
jh.writeUInt32LE(0x4e4f534a, 4);           // 'JSON'
chunks.push(jh, json, Buffer.alloc(jsonPad, 0x20));

const bh = Buffer.alloc(8);
bh.writeUInt32LE(bin.length + binPad, 0);
bh.writeUInt32LE(0x004e4942, 4);           // 'BIN\0'
chunks.push(bh, bin, Buffer.alloc(binPad, 0));

writeFileSync(outPath, Buffer.concat(chunks, total));
const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log(`  ${inPath} ${kb(readFileSync(inPath).length)} -> ${outPath} ${kb(total)}  (json ${kb(json.length)}, bin ${kb(bin.length)})`);
