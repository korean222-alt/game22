/* The frame graph.

     shadow depth  ->  HDR scene  ->  bright pass  ->  bloom down/up chain
                                  \                          /
                                   ----> composite (ACES) ---->  FXAA  -> canvas

   Everything before the composite lives in linear light. That is the whole
   point of the HDR target: a monitor at 2.6x white or sunlight through a window
   stays above 1.0 until the tonemapper decides what to do with it, which is
   what makes the bloom read as light rather than as a blurred white smear. */

import { getGL, program, uniforms, caps } from '../core/gl.js';
import { m4, m4mul, m4ortho, m4look } from '../core/math.js';
import {
  VS_COMMON, FS_SCENE, FS_DEPTH, VS_POST, FS_BRIGHT, FS_DOWN, FS_UP, FS_COMPOSITE, FS_FXAA, NB,
} from './shaders.js';

const SCENE_UNIFORMS = [
  'uVP', 'uLightVP', 'uSun', 'uSunCol', 'uSkyCol', 'uGndCol', 'uHorizCol', 'uFogCol',
  'uAmb', 'uFogFar', 'uHL', 'uShadow', 'uSTexel', 'uEyeXZ', 'uTgtXZ', 'uCut', 'uFloorY',
  'uStorey', 'uEye', 'uRes', 'uGlassMode', 'uTime', 'uExposure', 'uFill',
];

/* 밝기 프리셋. 하나의 손잡이가 세 값을 같이 움직인다 — 노출만 올리면 하이라이트가
   타고, 앰비언트만 올리면 대비가 사라진다. 셋을 같이 올려야 "밝다"가 된다.
   기본값이 `normal` 이 아니라 `bright` 인 이유는 실기기 테스트 때문이다:
   폰 화면을 밖에서 보면 예전 기본값은 거의 검게 보였다. */
export const LIGHT_PRESETS = {
  dim: { exposure: 1.00, ambient: 0.44, fill: 0.085, vignette: 1.00 },
  normal: { exposure: 1.16, ambient: 0.58, fill: 0.17, vignette: 0.80 },
  bright: { exposure: 1.34, ambient: 0.74, fill: 0.30, vignette: 0.55 },
  max: { exposure: 1.52, ambient: 0.92, fill: 0.46, vignette: 0.30 },
};
export const LIGHT_ORDER = ['dim', 'normal', 'bright', 'max'];

const BLOOM_LEVELS_DEFAULT = 5;

export class Renderer {
  constructor(canvas, opts = {}) {
    const gl = this.gl = getGL();
    this.canvas = canvas;
    this.shadowSize = opts.shadowSize || 2048;
    // Fewer mips means a tighter bloom skirt but a materially cheaper frame,
    // which is the trade a phone GPU wants.
    this.bloomLevels = opts.bloomLevels || BLOOM_LEVELS_DEFAULT;
    this.storey = opts.storey || 13;

    this.pScene = program(VS_COMMON, FS_SCENE);
    this.pDepth = program(VS_COMMON, FS_DEPTH);
    this.LS = uniforms(this.pScene, SCENE_UNIFORMS);
    this.LD = uniforms(this.pDepth, SCENE_UNIFORMS);
    this.LS.uBones = gl.getUniformLocation(this.pScene, 'uBones[0]');
    this.LD.uBones = gl.getUniformLocation(this.pDepth, 'uBones[0]');

    this.pBright = program(VS_POST, FS_BRIGHT);
    this.pDown = program(VS_POST, FS_DOWN);
    this.pUp = program(VS_POST, FS_UP);
    this.pComp = program(VS_POST, FS_COMPOSITE);
    this.pFxaa = program(VS_POST, FS_FXAA);
    this.LBright = uniforms(this.pBright, ['uTex', 'uTexel', 'uThreshold', 'uKnee']);
    this.LDown = uniforms(this.pDown, ['uTex', 'uTexel']);
    this.LUp = uniforms(this.pUp, ['uTex', 'uTexel', 'uRadius']);
    this.LComp = uniforms(this.pComp, ['uHDR', 'uBloom', 'uTexel', 'uBloomAmt', 'uTime', 'uGrain', 'uVignette', 'uAberr']);
    this.LFxaa = uniforms(this.pFxaa, ['uTex', 'uTexel']);

    this.postVao = gl.createVertexArray();

    // Grading knobs. Exposure is the one worth touching per scene.
    this.exposure = opts.exposure ?? 0.95;
    this.bloomAmount = opts.bloomAmount ?? 0.055;
    this.bloomThreshold = opts.bloomThreshold ?? 1.05;
    this.bloomKnee = opts.bloomKnee ?? 0.6;
    this.grain = opts.grain ?? 0.012;
    this.vignette = opts.vignette ?? 0.34;
    this.aberration = opts.aberration ?? 0.9;

    this._initShadow();
    this.targets = { w: 0, h: 0 };
    this.identity = m4();

    // Lighting environment, in linear light. Values above 1 are intentional.
    this.sun = new Float32Array([-0.42, -0.82, -0.39]);
    this.sunColor = new Float32Array([1.52, 1.34, 1.08]);
    this.skyColor = new Float32Array([0.34, 0.44, 0.62]);
    this.groundColor = new Float32Array([0.13, 0.12, 0.11]);
    this.horizonColor = new Float32Array([0.52, 0.50, 0.47]);
    this.fogColor = new Float32Array([0.60, 0.63, 0.68]);
    this.ambient = 0.44;
    this.fill = 0.085;
    this.fogFar = 260;
    this.vignetteBase = this.vignette;
    this.setBrightness(opts.brightness || 'bright');

    this.lightVP = m4(); this._lView = m4(); this._lProj = m4();
    this.lightTarget = [0, 0, 0];
    this.lightRadius = 60;
    this.fitLight();
  }

  /* The player-facing 밝기 setting. Everything it touches is a grading value,
     so it is safe to change at any time — no target is reallocated. */
  setBrightness(name) {
    const p = LIGHT_PRESETS[name] || LIGHT_PRESETS.bright;
    this.brightness = LIGHT_PRESETS[name] ? name : 'bright';
    this.exposure = p.exposure;
    this.ambient = p.ambient;
    this.fill = p.fill;
    this.vignette = this.vignetteBase * p.vignette;
    return this.brightness;
  }

  _initShadow() {
    const gl = this.gl, S = this.shadowSize;
    this.smTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.smTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, S, S, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // COMPARE_REF_TO_TEXTURE turns each sampler2DShadow tap into a hardware
    // depth comparison, so the 12-tap Poisson kernel costs 12 filtered lookups
    // rather than 12 lookups plus 12 comparisons.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LESS);
    this.smFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.smFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.smTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  _mkTarget(w, h, float) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const useFloat = float && caps().colorFloat;
    gl.texImage2D(gl.TEXTURE_2D, 0, useFloat ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA,
      useFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    // Half-float linear filtering needs OES_texture_float_linear on some
    // drivers; without it the bloom chain must fall back to nearest.
    const lin = (!useFloat || caps().floatLinear) ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, lin);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, lin);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  }

  _freeTarget(t) {
    if (!t) return;
    const gl = this.gl;
    gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo);
  }

  resize(w, h) {
    const T = this.targets;
    if (T.w === w && T.h === h) return;
    const gl = this.gl;
    this._freeTarget(T.hdr); this._freeTarget(T.ldr);
    if (T.depth) gl.deleteRenderbuffer(T.depth);
    if (T.bloom) for (const b of T.bloom) this._freeTarget(b);

    T.w = w; T.h = h;
    T.hdr = this._mkTarget(w, h, true);
    T.ldr = this._mkTarget(w, h, false);
    T.depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, T.depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.hdr.fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, T.depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    T.bloom = [];
    let bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
    for (let i = 0; i < this.bloomLevels && bw > 4 && bh > 4; i++) {
      T.bloom.push(this._mkTarget(bw, bh, true));
      bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
    }
  }

  /* Fit the shadow frustum around the area actually being looked at. A tight
     ortho box is worth far more resolution than a bigger shadow map. */
  fitLight(center = this.lightTarget, radius = this.lightRadius) {
    this.lightTarget = center; this.lightRadius = radius;
    const D = radius * 3.0;
    const [cx, cy, cz] = center;
    m4look(this._lView,
      cx - this.sun[0] * D, cy - this.sun[1] * D, cz - this.sun[2] * D,
      cx, cy, cz, 0, 1, 0);
    m4ortho(this._lProj, -radius, radius, -radius, radius, 1, D * 2.2);
    m4mul(this.lightVP, this._lProj, this._lView);
  }

  _setCommon(L, opts) {
    const gl = this.gl;
    gl.uniformMatrix4fv(L.uLightVP, false, this.lightVP);
    gl.uniform2f(L.uEyeXZ, opts.eye[0], opts.eye[2]);
    gl.uniform2f(L.uTgtXZ, opts.target[0], opts.target[2]);
    gl.uniform1f(L.uCut, opts.wallCut ? 1 : 0);
    gl.uniform1f(L.uFloorY, opts.floorY ?? 9999);
    gl.uniform1f(L.uStorey, this.storey);
  }

  _setScene(opts) {
    const gl = this.gl, L = this.LS;
    gl.useProgram(this.pScene);
    gl.uniformMatrix4fv(L.uVP, false, opts.vp);
    gl.uniform3fv(L.uSun, this.sun);
    gl.uniform3fv(L.uSunCol, this.sunColor);
    gl.uniform3fv(L.uSkyCol, this.skyColor);
    gl.uniform3fv(L.uGndCol, this.groundColor);
    gl.uniform3fv(L.uHorizCol, this.horizonColor);
    gl.uniform3fv(L.uFogCol, this.fogColor);
    gl.uniform1f(L.uAmb, this.ambient);
    gl.uniform1f(L.uFill, this.fill);
    gl.uniform1f(L.uFogFar, this.fogFar);
    gl.uniform1f(L.uExposure, this.exposure);
    gl.uniform1f(L.uTime, opts.time);
    gl.uniform3fv(L.uEye, opts.eye);
    gl.uniform2f(L.uRes, this.targets.w, this.targets.h);
    gl.uniform2f(L.uSTexel, 1 / this.shadowSize, 1 / this.shadowSize);
    gl.uniform1f(L.uGlassMode, 0);
    gl.uniform1f(L.uHL, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.smTex);
    gl.uniform1i(L.uShadow, 0);
    this._setCommon(L, opts);
  }

  drawMesh(L, mesh, bones) {
    if (!mesh || !mesh.count) return;
    const gl = this.gl;
    gl.uniformMatrix4fv(L.uBones, false, bones || this.identity);
    gl.bindVertexArray(mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  }

  /* `draw(L, pass)` is supplied by the caller and issues every drawMesh for a
     pass. It runs twice — once into the shadow map, once into the HDR target —
     so geometry and cut rules can never drift apart between the two. */
  render(opts, draw) {
    const gl = this.gl;
    const T = this.targets;

    // ---- 1. shadow depth ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.smFbo);
    gl.viewport(0, 0, this.shadowSize, this.shadowSize);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT);           // front-face culling hides peter-panning
    gl.useProgram(this.pDepth);
    gl.uniformMatrix4fv(this.LD.uVP, false, this.lightVP);
    this._setCommon(this.LD, opts);
    draw(this.LD, 'shadow');

    // ---- 2. HDR scene ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.hdr.fbo);
    gl.viewport(0, 0, T.w, T.h);
    gl.cullFace(gl.BACK);
    gl.clearColor(this.fogColor[0], this.fogColor[1], this.fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this._setScene(opts);
    draw(this.LS, 'color');

    // Glass last: blended, depth-tested but not depth-written, so what is
    // behind a window still shows through it.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.uniform1f(this.LS.uGlassMode, 1);
    draw(this.LS, 'glass');
    gl.uniform1f(this.LS.uGlassMode, 0);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // ---- 3-5. bloom + resolve ----
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.postVao);
    this._bloom();
    this._composite(opts.time);
    this._fxaa();
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
  }

  _blit(prog, target) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, target ? target.w : this.canvas.width, target ? target.h : this.canvas.height);
    gl.useProgram(prog);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  _bind(unit, tex, loc) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  }

  _bloom() {
    const gl = this.gl, T = this.targets, mips = T.bloom;
    if (!mips.length) return;

    gl.useProgram(this.pBright);
    this._bind(1, T.hdr.tex, this.LBright.uTex);
    gl.uniform2f(this.LBright.uTexel, 1 / T.w, 1 / T.h);
    gl.uniform1f(this.LBright.uThreshold, this.bloomThreshold);
    gl.uniform1f(this.LBright.uKnee, this.bloomKnee);
    this._blit(this.pBright, mips[0]);

    for (let i = 1; i < mips.length; i++) {
      gl.useProgram(this.pDown);
      this._bind(1, mips[i - 1].tex, this.LDown.uTex);
      gl.uniform2f(this.LDown.uTexel, 1 / mips[i - 1].w, 1 / mips[i - 1].h);
      this._blit(this.pDown, mips[i]);
    }

    // Additive upsample: each coarser level tents onto the one above it, which
    // is what gives bloom its wide soft skirt without a huge blur kernel.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = mips.length - 1; i > 0; i--) {
      gl.useProgram(this.pUp);
      this._bind(1, mips[i].tex, this.LUp.uTex);
      gl.uniform2f(this.LUp.uTexel, 1 / mips[i].w, 1 / mips[i].h);
      gl.uniform1f(this.LUp.uRadius, 1.35);
      this._blit(this.pUp, mips[i - 1]);
    }
    gl.disable(gl.BLEND);
  }

  _composite(time) {
    const gl = this.gl, T = this.targets;
    gl.useProgram(this.pComp);
    this._bind(1, T.hdr.tex, this.LComp.uHDR);
    this._bind(2, T.bloom.length ? T.bloom[0].tex : T.hdr.tex, this.LComp.uBloom);
    gl.uniform2f(this.LComp.uTexel, 1 / T.w, 1 / T.h);
    gl.uniform1f(this.LComp.uBloomAmt, T.bloom.length ? this.bloomAmount : 0);
    gl.uniform1f(this.LComp.uTime, time);
    gl.uniform1f(this.LComp.uGrain, this.grain);
    gl.uniform1f(this.LComp.uVignette, this.vignette);
    gl.uniform1f(this.LComp.uAberr, this.aberration * 0.004);
    this._blit(this.pComp, T.ldr);
  }

  _fxaa() {
    const gl = this.gl, T = this.targets;
    gl.useProgram(this.pFxaa);
    this._bind(1, T.ldr.tex, this.LFxaa.uTex);
    gl.uniform2f(this.LFxaa.uTexel, 1 / T.w, 1 / T.h);
    this._blit(this.pFxaa, null);
  }
}

export { NB };
