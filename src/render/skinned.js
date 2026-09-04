/* Skinned glTF characters — the boss monsters.

   One `SkinnedModel` per .glb (shared geometry and texture, loaded once), and
   one `SkinnedInstance` per creature on screen (its own animation clock and
   joint texture). That split matters: three monster types are loaded across a
   career but only ever one is fighting, and a second instance of the same
   species must not re-upload 300 KB of vertices.

   The joint matrices live in an RGBA32F texture read with texelFetch rather
   than a uniform array. A 43-joint orc needs 43 mat4s; the WebGL2 floor for
   vertex uniform vectors is 256, which those alone would consume, and a phone
   driver reporting exactly the minimum is not a hypothetical. */

import { getGL, program, uniforms } from '../core/gl.js';
import { m4 } from '../core/math.js';
import { VS_SKIN, FS_SKIN, FS_SKIN_DEPTH } from './shaders.js';
import { loadGLB, Skeleton } from '../core/gltf.js';

let _prog = null;

/* The two programs are process-wide: they compile once and every monster in
   the game draws through them. */
function progs() {
  if (_prog) return _prog;
  const color = program(VS_SKIN, FS_SKIN);
  const depth = program(VS_SKIN, FS_SKIN_DEPTH);
  const names = [
    'uVP', 'uLightVP', 'uModel', 'uJoints', 'uSkinned', 'uFloorY', 'uAlbedo',
    'uSun', 'uSunCol', 'uSkyCol', 'uGndCol', 'uHorizCol', 'uFogCol', 'uEye',
    'uAmb', 'uFogFar', 'uTime', 'uExposure', 'uSTexel', 'uShadow', 'uTint', 'uEmis', 'uAlpha',
  ];
  _prog = { color, depth, LC: uniforms(color, names), LD: uniforms(depth, names) };
  return _prog;
}

/* ---------- the shared asset ---------- */
export class SkinnedModel {
  constructor(data, gpu) {
    this.data = data;
    this.prims = gpu.prims;
    this.tex = gpu.tex;
    this.jointCount = data.skin ? data.skin.joints.length : 0;
    this.clips = new Map(data.animations.map((a) => [a.name, a]));
    // Where the model's own root sits and how tall it is, so the game can put
    // a health bar over its head without hard-coding a number per species.
    this.bounds = gpu.bounds;
  }

  static async load(url) {
    const data = await loadGLB(url);
    const gl = getGL();

    const prims = [];
    let minY = Infinity, maxY = -Infinity, radius = 0;
    for (const p of data.prims) {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const buffers = [];
      const buf = (loc, arr, size) => {
        const b = gl.createBuffer();
        buffers.push(b);
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      };
      buf(0, p.pos, 3);
      buf(1, p.nrm, 3);
      buf(2, p.uv, 2);
      buf(3, p.joints, 4);
      buf(4, p.weights, 4);
      const ib = gl.createBuffer();
      buffers.push(ib);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, p.idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      prims.push({ vao, count: p.idx.length, buffers });

      for (let i = 0; i < p.pos.length; i += 3) {
        const y = p.pos[i + 1];
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        const r = Math.hypot(p.pos[i], p.pos[i + 2]);
        if (r > radius) radius = r;
      }
    }

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // A single opaque texel until the PNG decodes, so a monster that appears
    // before its atlas does is a flat silhouette rather than a black hole.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([180, 180, 185, 255]));
    if (data.image) {
      const src = typeof data.image === 'string' ? data.image : URL.createObjectURL(data.image);
      try {
        const bmp = await createImageBitmap(await (await fetch(src)).blob());
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        bmp.close();
      } catch (e) {
        console.warn('monster atlas failed to decode', e);
      } finally {
        if (typeof data.image !== 'string') URL.revokeObjectURL(src);
      }
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    return new SkinnedModel(data, {
      prims, tex,
      bounds: { minY: minY === Infinity ? 0 : minY, maxY: maxY === -Infinity ? 2 : maxY, radius },
    });
  }

  dispose() {
    const gl = getGL();
    for (const p of this.prims) {
      for (const b of p.buffers) gl.deleteBuffer(b);
      gl.deleteVertexArray(p.vao);
    }
    gl.deleteTexture(this.tex);
    this.prims = [];
  }
}

/* ---------- one creature ---------- */
export class SkinnedInstance {
  constructor(model) {
    this.model = model;
    this.skel = new Skeleton(model.data);
    this.jointRows = Math.max(1, model.jointCount);
    const gl = getGL();
    this.jointTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.jointTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 4, this.jointRows, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.model4 = m4();
    this.clip = null;
    this.time = 0;
    this.loop = true;
    this.speed = 1;
    this.done = false;
    this.next = null;              // clip to fall back to when a one-shot ends
    this.scale = 1;
    this.dirty = true;
  }

  /* Start a clip. A one-shot (`loop:false`) returns to `next` — or to whatever
     was playing — so an attack or a flinch never leaves the monster frozen. */
  play(name, { loop = true, speed = 1, next = null } = {}) {
    const clip = this.model.clips.get(name);
    if (!clip) return false;
    if (this.clip === clip && loop && this.loop) return true;
    this.clip = clip;
    this.time = 0;
    this.loop = loop;
    this.speed = speed;
    this.next = next;
    this.done = false;
    this.dirty = true;
    return true;
  }

  playing(name) { return !!this.clip && this.clip.name === name; }

  update(dt) {
    if (!this.clip) return;
    this.time += dt * this.speed;
    const d = this.clip.duration || 1;
    if (this.time > d) {
      if (this.loop) this.time %= d;
      else {
        this.time = d;
        if (!this.done) {
          this.done = true;
          if (this.next) { const n = this.next; this.next = null; this.play(n); }
        }
      }
    }
    this.dirty = true;
  }

  /* The pose maths lives in core/gltf.js so it can be exercised without a GPU;
     this side only decides when to run it and gets the result to the card. */
  _upload() {
    this.skel.sample(this.clip, this.time);
    const data = this.skel.solve();
    const gl = getGL();
    gl.bindTexture(gl.TEXTURE_2D, this.jointTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 4, this.jointRows, gl.RGBA, gl.FLOAT, data);
  }

  /* Place the creature: world position, facing, uniform scale. */
  setTransform(x, y, z, yaw, scale) {
    const c = Math.cos(yaw) * scale, s = Math.sin(yaw) * scale;
    const M = this.model4;
    M[0] = c; M[1] = 0; M[2] = -s; M[3] = 0;
    M[4] = 0; M[5] = scale; M[6] = 0; M[7] = 0;
    M[8] = s; M[9] = 0; M[10] = c; M[11] = 0;
    M[12] = x; M[13] = y; M[14] = z; M[15] = 1;
    this.scale = scale;
  }

  dispose() { getGL().deleteTexture(this.jointTex); }
}

/* ---------- drawing ----------
   Called from the same `draw(L, pass)` callback the office uses, so a monster
   casts into the shadow map and is cut away by the floor selector on exactly
   the same terms as the furniture around it. */
export class SkinnedPass {
  constructor(renderer) { this.r = renderer; this.P = progs(); }

  /* env is the renderer; opts carries the frame's camera and cut state. */
  begin(pass, opts) {
    const gl = getGL(), r = this.r;
    const color = pass === 'color';
    const prog = color ? this.P.color : this.P.depth;
    const L = color ? this.P.LC : this.P.LD;
    gl.useProgram(prog);
    gl.uniformMatrix4fv(L.uVP, false, color ? opts.vp : r.lightVP);
    gl.uniformMatrix4fv(L.uLightVP, false, r.lightVP);
    gl.uniform1f(L.uFloorY, opts.floorY ?? 9999);
    gl.uniform1i(L.uAlbedo, 3);
    if (color) {
      gl.uniform3fv(L.uSun, r.sun);
      gl.uniform3fv(L.uSunCol, r.sunColor);
      gl.uniform3fv(L.uSkyCol, r.skyColor);
      gl.uniform3fv(L.uGndCol, r.groundColor);
      gl.uniform3fv(L.uHorizCol, r.horizonColor);
      gl.uniform3fv(L.uFogCol, r.fogColor);
      gl.uniform3fv(L.uEye, opts.eye);
      gl.uniform1f(L.uAmb, r.ambient);
      gl.uniform1f(L.uFogFar, r.fogFar);
      gl.uniform1f(L.uExposure, r.exposure);
      gl.uniform1f(L.uTime, opts.time || 0);
      gl.uniform2f(L.uSTexel, 1 / r.shadowSize, 1 / r.shadowSize);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, r.smTex);
      gl.uniform1i(L.uShadow, 0);
    }
    this._L = L;
    this._color = color;
    return L;
  }

  /* Hand the pass back to the office shader. Uniform state is per-program, so
     anything the caller draws after a monster — glass, another rig — would
     otherwise be issued against the skinned program with none of its uniforms
     set, and vanish. */
  end(pass) {
    const gl = getGL();
    gl.useProgram(pass === 'color' ? this.r.pScene : this.r.pDepth);
  }

  draw(inst, { tint = [1, 1, 1], emis = 0, alpha = 1 } = {}) {
    if (!inst || !inst.model.prims.length) return;
    const gl = getGL(), L = this._L;
    if (inst.dirty) { inst._upload(); inst.dirty = false; }
    gl.uniformMatrix4fv(L.uModel, false, inst.model4);
    gl.uniform1f(L.uSkinned, inst.model.jointCount ? 1 : 0);
    if (this._color) {
      gl.uniform3f(L.uTint, tint[0], tint[1], tint[2]);
      gl.uniform1f(L.uEmis, emis);
      gl.uniform1f(L.uAlpha, alpha);
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, inst.jointTex);
    gl.uniform1i(L.uJoints, 1);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, inst.model.tex);
    for (const p of inst.model.prims) {
      gl.bindVertexArray(p.vao);
      gl.drawElements(gl.TRIANGLES, p.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }
}
