#!/usr/bin/env node
/* Boss-monster asset check, with no browser and no GPU.

   The skinning maths lives in core/gltf.js precisely so it can be run here: a
   broken accessor stride or a mis-ordered node tree produces NaN joint
   matrices, and finding that out on a phone with a black screen is the
   expensive way. Run it after regenerating the .glb files.

     node tools/monster.mjs */

import { readFileSync } from 'node:fs';
import { loadGLB, Skeleton } from '../src/core/gltf.js';
import { MONSTERS } from '../src/game/monsters.js';

/* loadGLB fetches; in Node point fetch at the filesystem. */
globalThis.fetch = async (url) => {
  const buf = readFileSync(new URL(url, import.meta.url).pathname.replace('/tools/', '/'));
  return {
    ok: true, status: 200,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
};

let fails = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${msg}`); if (!cond) fails++; };

for (const def of MONSTERS) {
  console.log(`\n── ${def.ko} (${def.id}) — ${def.file}`);
  const m = await loadGLB('../' + def.file);

  ok(m.prims.length > 0, `${m.prims.length} primitive(s)`);
  ok(!!m.skin, `skin with ${m.skin ? m.skin.joints.length : 0} joints`);
  ok(!!m.image, 'atlas texture present');

  const names = m.animations.map((a) => a.name);
  console.log(`      clips: ${names.join(', ')}`);
  for (const want of [def.idle, def.hit, def.death, def.attack]) {
    ok(names.includes(want), `clip "${want}" present`);
  }

  // Every joint index a vertex references must exist, or the shader reads
  // outside the joint texture and the mesh explodes to the origin.
  const maxJ = m.skin ? m.skin.joints.length - 1 : 0;
  let bad = 0, worst = 0;
  for (const p of m.prims) {
    for (let i = 0; i < p.joints.length; i++) {
      if (p.joints[i] > maxJ || p.joints[i] < 0) bad++;
      if (p.joints[i] > worst) worst = p.joints[i];
    }
  }
  ok(bad === 0, `joint indices in range (max used ${worst} of ${maxJ})`);

  let badW = 0;
  for (const p of m.prims) {
    for (let i = 0; i < p.weights.length; i += 4) {
      const s = p.weights[i] + p.weights[i + 1] + p.weights[i + 2] + p.weights[i + 3];
      if (Math.abs(s - 1) > 1e-3) badW++;
    }
  }
  ok(badW === 0, 'skin weights normalised');

  // Step each clip and confirm the joint matrices stay finite and the model
  // actually moves — a silently frozen skeleton looks like a loading bug.
  const skel = new Skeleton(m);
  for (const clip of m.animations) {
    let nan = 0, motion = 0;
    let prev = null;
    for (let k = 0; k <= 12; k++) {
      const t = (clip.duration || 1) * (k / 12);
      skel.sample(clip, t);
      const d = skel.solve();
      for (let i = 0; i < d.length; i++) if (!Number.isFinite(d[i])) nan++;
      if (prev) for (let i = 0; i < d.length; i++) motion += Math.abs(d[i] - prev[i]);
      prev = Float32Array.from(d);
    }
    ok(nan === 0 && motion > 0.01,
      `"${clip.name}" ${clip.duration.toFixed(2)}s · ${clip.channels.length} channels · movement ${motion.toFixed(1)}`);
  }

  // The battle scales every species to a common on-screen height, so the
  // model's own height has to be measurable.
  let minY = Infinity, maxY = -Infinity;
  for (const p of m.prims) {
    for (let i = 1; i < p.pos.length; i += 3) {
      if (p.pos[i] < minY) minY = p.pos[i];
      if (p.pos[i] > maxY) maxY = p.pos[i];
    }
  }
  const h = maxY - minY;
  ok(h > 0.1 && h < 100, `model height ${h.toFixed(2)} → scale ${(def.height / h).toFixed(2)} for ${def.height} units`);
}

console.log(fails ? `\n${fails} check(s) failed` : '\nall monster assets ok');
process.exit(fails ? 1 : 0);
