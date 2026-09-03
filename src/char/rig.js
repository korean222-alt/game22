/* Character rig: skeleton, skinned mesh, solve.

   One VBO per person. Every vertex carries a bone index, so a whole figure
   draws in a single call with uBones[] holding the resolved world matrices.

   SKELETON CONVENTION
     Torso bones stack UPWARD (+Y) from the hips and their geometry is drawn
     with limbUp(). Arm and leg bones hang DOWNWARD (-Y) and use limb().
     A bone's local origin is its joint; children offset to the far end. */

import { MeshBuilder } from '../core/meshbuilder.js';
import { MAT, shade, mixc } from '../core/color.js';
import { m4, m4mul, m4trs } from '../core/math.js';
import { upload } from '../core/gl.js';

export const B_HIP = 0, B_SPINE = 1, B_CHEST = 2, B_HEAD = 3,
  B_UAL = 4, B_FAL = 5, B_HDL = 6, B_UAR = 7, B_FAR = 8, B_HDR = 9,
  B_THL = 10, B_SHL = 11, B_FTL = 12, B_THR = 13, B_SHR = 14, B_FTR = 15;
export const BONE_N = 16;
const BONE_PARENT = [-1, B_HIP, B_SPINE, B_CHEST, B_CHEST, B_UAL, B_FAL, B_CHEST, B_UAR, B_FAR,
  B_HIP, B_THL, B_SHL, B_HIP, B_THR, B_SHR];

export const SEAT_HIP = 1.78;   // hip height when seated (a chair pan tops out at 1.46)

export function dims(s) {
  const h = s.height || 1, b = s.build || 1;
  const thigh = 1.45 * h, shin = 1.38 * h;
  return {
    h, b,
    thigh, shin, foot: 0.82 * h,
    hipY: thigh + shin + 0.28 * h,      // stand so the soles land on the floor
    pelvis: 0.15 * h, spine: 0.70 * h, chest: 0.80 * h, neck: 0.34 * h, headR: 0.41 * h,
    shoulder: 0.70 * b * h * (s.shoulders || 1), hipW: 0.40 * b * h,
    uArm: 1.10 * h, fArm: 1.00 * h, hand: 0.46 * h,
    torsoW: 1.02 * b * h, torsoD: 0.60 * b * h,
    armR: 0.185 * b * h, legR: 0.25 * b * h,
  };
}

export function buildBody(s) {
  const D = dims(s), m = new MeshBuilder();
  const shirt = s.shirt, pants = s.pants || '#3a3b42', skin = s.skin, shoe = s.shoe || '#26221d';
  const outer = s.jacket || s.cardigan || shirt;
  const sqT = D.torsoD / D.torsoW;
  const h = D.h, R = D.headR;
  const eyeCol = s.eyeCol || '#4a5a6a', hair = s.hairCol || '#3a2a1c';

  /* ---- pelvis ---- */
  m.bone = B_HIP; m.mat = MAT.CLOTH;
  if (s.skirt) {
    const skl = (s.skirtLen || 0.95) * h;
    m.limbUp(D.pelvis, D.torsoW * 0.48, D.torsoW * 0.47, 10, s.skirt, 1, sqT);
    m.limb(skl, D.torsoW * 0.5, D.torsoW * 0.68, 10, s.skirt, 1, sqT * 1.05);
  } else {
    m.limbUp(D.pelvis, D.torsoW * 0.48, D.torsoW * 0.47, 10, pants, 1, sqT);
    m.limb(0.30 * h, D.torsoW * 0.48, D.torsoW * 0.42, 10, pants, 1, sqT);
    m.mat = MAT.DEF;
    m.limbUp(0.14 * h, D.torsoW * 0.5, D.torsoW * 0.5, 10, '#241d15', 1, sqT);   // belt
    m.mat = MAT.METAL;
    m.box(0, 0.07 * h, D.torsoD * 0.5, 0.16 * h, 0.1 * h, 0.05, '#c3c6cb');      // buckle
  }

  /* ---- spine + chest ---- */
  m.bone = B_SPINE; m.mat = MAT.CLOTH;
  m.limbUp(D.spine, D.torsoW * 0.47, D.torsoW * 0.51, 9, shirt, 1, sqT);
  if (s.belly) {
    m.ball(0, D.spine * 0.50, D.torsoD * 0.14, D.torsoW * 0.50, D.spine * 0.72,
      D.torsoD * (0.44 + 0.34 * s.belly), shirt, 12, 6);
  }
  m.bone = B_CHEST; m.mat = MAT.CLOTH;
  m.limbUp(D.chest, D.torsoW * 0.51, D.torsoW * 0.55, 9, shirt, 1, sqT);
  m.ball(0, D.chest * 0.94, 0, D.shoulder * 0.99, D.chest * 0.44, D.torsoD * 0.98, shirt, 12, 6);
  if (s.tie) {
    m.box(0, D.chest * 0.44, D.torsoD * 0.50, 0.16 * D.b * h, D.chest * 0.94, 0.05, s.tie);
    m.box(0, D.chest * 0.02, D.torsoD * 0.51, 0.22 * D.b * h, 0.2 * h, 0.05, s.tie);
    m.box(0, D.chest * 0.94, D.torsoD * 0.505, 0.2 * D.b * h, 0.15 * h, 0.06, shade(s.tie, 0.8));
  } else if (s.lanyard) {
    m.box(0, D.chest * 0.55, D.torsoD * 0.48, 0.09, D.chest * 0.9, 0.04, s.lanyardCol || '#2f4d7a');
    m.mat = MAT.GLOSS;
    m.box(0, D.chest * 0.06, D.torsoD * 0.52, 0.30 * h, 0.42 * h, 0.03, '#f2f0e6');  // badge
    m.mat = MAT.CLOTH;
  } else if (!s.jacket && !s.vest && !s.cardigan && !s.hoodie) {
    m.box(0, D.chest * 0.50, D.torsoD * 0.525, 0.10 * h, D.chest * 1.0, 0.03, shade(shirt, 0.93));
    for (let bi = 0; bi < 3; bi++) {
      m.box(0, D.chest * (0.25 + bi * 0.28), D.torsoD * 0.545, 0.05, 0.05, 0.03, shade(shirt, 0.7));
    }
  }
  if (s.hoodie) {
    // hood bunched at the back of the neck
    m.ball(0, D.chest * 0.92, -D.torsoD * 0.55, D.torsoW * 0.46, D.chest * 0.30, D.torsoD * 0.42, s.hoodie, 10, 5);
    m.box(0, D.chest * 0.48, D.torsoD * 0.50, 0.06 * h, D.chest * 0.9, 0.03, shade(s.hoodie, 0.86));
    m.box(0, D.chest * 0.16, D.torsoD * 0.50, D.torsoW * 0.62, 0.30 * h, 0.05, shade(s.hoodie, 0.94)); // pocket
  }
  if (s.vest) m.limbUp(D.chest * 0.94, D.torsoW * 0.53, D.torsoW * 0.57, 9, s.vest, 1, sqT);
  if (s.jacket) {
    for (const k of [-1, 1]) {
      m.box(k * D.torsoW * 0.40, D.chest * 0.46, D.torsoD * 0.42, D.torsoW * 0.34, D.chest * 1.05, 0.15, s.jacket);
      m.box(k * D.torsoW * 0.22, D.chest * 0.62, D.torsoD * 0.53, 0.17 * h, D.chest * 0.72, 0.045, shade(s.jacket, 0.86));
    }
    m.box(0, D.chest * 0.46, -D.torsoD * 0.48, D.torsoW * 1.04, D.chest * 1.05, 0.15, s.jacket);
  }
  if (s.cardigan) {
    for (const k of [-1, 1]) {
      m.box(k * D.torsoW * 0.46, D.chest * 0.42, 0, 0.15, D.chest * 1.15, D.torsoD * 1.85, s.cardigan);
    }
  }
  if (s.collar !== false && !s.hoodie) {
    m.box(0, D.chest * 0.95, D.torsoD * 0.36, D.torsoW * 0.58, 0.18 * h, D.torsoD * 0.5,
      s.collarCol || shade(shirt, 1.07));
  }

  /* ---- head ---- */
  m.bone = B_HEAD; m.mat = MAT.SKIN;
  m.limb(D.neck * 0.85, 0.17 * h, 0.19 * h, 9, skin);
  const hy = R * 0.86, jaw = s.jaw || 1;
  m.ball(0, hy, 0, R * 0.86, R * 1.00, R * 0.90, skin, 16, 9);                          // cranium
  m.ball(0, hy - R * 0.40, R * 0.10, R * 0.74 * jaw, R * 0.64, R * 0.80, skin, 12, 6);  // jaw
  m.ball(0, hy * 0.90, R * 0.80, 0.10 * h, 0.13 * h, 0.11 * h, skin, 8, 5);             // nose
  for (const k of [-1, 1]) m.ball(k * R * 0.86, hy, -R * 0.05, 0.09 * h, 0.15 * h, 0.10 * h, skin, 6, 4);
  const ex = R * 0.34, ey = hy * 1.03, ez = R * 0.78;
  for (const k of [-1, 1]) {
    m.mat = MAT.GLOSS;
    m.ball(k * ex, ey, ez, 0.088 * h, 0.064 * h, 0.060 * h, '#f4f2ec', 10, 6);
    m.ball(k * ex, ey, ez + 0.036 * h, 0.048 * h, 0.048 * h, 0.028 * h, eyeCol, 9, 5);
    m.ball(k * ex, ey, ez + 0.058 * h, 0.024 * h, 0.024 * h, 0.018 * h, '#141418', 7, 4);
    m.mat = MAT.SKIN;
    m.box(k * ex, ey + 0.046 * h, ez + 0.012 * h, 0.19 * h, 0.045 * h, 0.055 * h, shade(skin, 0.97));
    m.mat = MAT.HAIR;
    m.box(k * R * 0.34, hy * 1.21, R * 0.80, 0.12 * h, 0.04 * h, 0.045, hair);
  }
  m.mat = MAT.DEF;
  const lip = '#9a6553', my = hy * 0.53, mz = R * 0.84;
  m.box(0, my, mz, 0.075 * h, 0.032 * h, 0.03, lip);
  for (const k of [-1, 1]) m.box(k * 0.062 * h, my + 0.011 * h, mz - 0.012, 0.05 * h, 0.028 * h, 0.03, lip);

  m.mat = MAT.HAIR;
  switch (s.hair) {
    case 'short':
      m.ball(0, hy + R * 0.30, -0.02, R * 0.90, R * 0.80, R * 0.93, hair, 12, 6);
      m.box(0, hy + R * 0.46, R * 0.42, R * 1.42, R * 0.34, R * 0.60, hair);
      break;
    case 'crop':
      m.ball(0, hy + R * 0.34, -0.03, R * 0.88, R * 0.72, R * 0.90, hair, 12, 6);
      break;
    case 'curly':
      m.ball(0, hy + R * 0.30, -0.03, R * 1.00, R * 0.84, R * 1.00, hair, 12, 6);
      for (let ci = 0; ci < 7; ci++) {
        const ca = ci / 7 * 6.2831853;
        m.ball(Math.cos(ca) * R * 0.78, hy + R * 0.34, Math.sin(ca) * R * 0.78, 0.19 * h, 0.17 * h, 0.19 * h, hair, 7, 4);
      }
      break;
    case 'long':
      m.ball(0, hy + R * 0.30, -0.03, R * 0.93, R * 0.80, R * 0.95, hair, 12, 6);
      m.box(0, hy - R * 0.55, -R * 0.84, R * 1.66, R * 1.85, R * 0.5, hair);
      for (const k of [-1, 1]) m.box(k * R * 0.90, hy - R * 0.2, 0, R * 0.26, R * 1.4, R * 1.2, hair);
      break;
    case 'bob':
      m.ball(0, hy + R * 0.30, -0.03, R * 0.94, R * 0.80, R * 0.96, hair, 12, 6);
      m.box(0, hy - R * 0.30, -R * 0.82, R * 1.70, R * 1.20, R * 0.46, hair);
      for (const k of [-1, 1]) m.box(k * R * 0.92, hy - R * 0.16, 0, R * 0.25, R * 1.15, R * 1.28, hair);
      break;
    case 'pony':
      m.ball(0, hy + R * 0.30, -0.03, R * 0.92, R * 0.80, R * 0.94, hair, 12, 6);
      m.ball(0, hy - R * 0.10, -R * 1.10, R * 0.42, R * 0.52, R * 0.44, hair, 9, 5);
      m.ball(0, hy - R * 0.95, -R * 1.22, R * 0.32, R * 0.60, R * 0.34, hair, 9, 5);
      break;
    case 'bun':
      m.ball(0, hy + R * 0.30, -0.03, R * 0.92, R * 0.78, R * 0.94, hair, 12, 6);
      m.ball(0, hy + R * 0.78, -R * 0.34, R * 0.42, R * 0.40, R * 0.42, hair, 9, 5);
      break;
    case 'balding':
      m.box(0, hy + R * 0.18, R * 0.44, R * 1.38, R * 0.42, R * 0.66, hair);
      for (const k of [-1, 1]) m.ball(k * R * 0.78, hy + R * 0.02, -R * 0.14, R * 0.28, R * 0.40, R * 0.72, hair, 7, 5);
      break;
    default: break;
  }
  if (s.beard) m.ball(0, hy - R * 0.42, R * 0.48, R * 0.72, R * 0.42, R * 0.58, s.beardCol || hair, 10, 5);
  if (s.mustache) m.box(0, hy - R * 0.22, R * 0.82, R * 0.58, 0.11 * h, 0.09, s.beardCol || hair);
  m.mat = MAT.DEF;
  if (s.glasses) {
    m.mat = MAT.GLOSS;
    for (const k of [-1, 1]) {
      m.box(k * R * 0.40, hy * 0.99, R * 0.80, R * 0.50, R * 0.32, 0.05, '#26262a');
      m.box(k * R * 0.78, hy * 0.99, R * 0.34, 0.05, 0.05, R * 0.85, '#26262a');
    }
    m.box(0, hy * 0.99, R * 0.80, R * 0.28, 0.05, 0.05, '#26262a');
    m.mat = MAT.DEF;
  }
  if (s.headset) {
    m.mat = MAT.DEF;
    for (const k of [-1, 1]) m.ball(k * R * 0.95, hy, -R * 0.05, 0.13 * h, 0.20 * h, 0.15 * h, '#2a2c32', 8, 5);
    m.box(0, hy + R * 0.95, -R * 0.08, R * 1.9, 0.10 * h, 0.14 * h, '#2a2c32');
    m.box(R * 0.72, hy * 0.72, R * 0.52, 0.5 * R, 0.06 * h, 0.06 * h, '#2a2c32');   // boom mic
  }

  /* ---- arms ---- */
  for (const ids of [[B_UAL, B_FAL, B_HDL, -1], [B_UAR, B_FAR, B_HDR, 1]]) {
    const side = ids[3];
    m.bone = ids[0]; m.mat = MAT.CLOTH;
    if (s.shortSleeve) {
      m.limb(D.uArm * 0.52, D.armR * 1.08, D.armR * 0.98, 9, outer);
      m.mat = MAT.SKIN;
      m.limbT(D.uArm * 0.50, D.armR * 0.95, D.armR * 0.88, 9, skin, 1, 1, 0, -D.uArm * 0.50, 0, 0);
    } else {
      m.limb(D.uArm, D.armR * 1.08, D.armR * 0.92, 9, outer);
    }
    m.bone = ids[1];
    if (s.shortSleeve) { m.mat = MAT.SKIN; m.limb(D.fArm, D.armR * 0.90, D.armR * 0.76, 9, skin); }
    else {
      m.mat = MAT.CLOTH;
      m.limb(D.fArm, D.armR * 0.90, D.armR * 0.76, 9, s.cuff || shirt);
      m.limbT(0.16 * h, D.armR * 0.86, D.armR * 0.84, 9, shade(s.cuff || shirt, 1.04), 1, 1,
        0, -(D.fArm - 0.16 * h), 0, 0);
    }
    if (s.watch && side < 0) {
      m.mat = MAT.DEF;
      m.box(0, -(D.fArm - 0.16 * h), 0, D.armR * 1.95, 0.13 * h, D.armR * 1.95, '#2a2620');
      m.mat = MAT.SCREEN;
      m.box(0, -(D.fArm - 0.16 * h), D.armR * 0.95, 0.14 * h, 0.1 * h, 0.04, '#3ba0d8');
    }
    m.bone = ids[2]; m.mat = MAT.SKIN;
    m.limb(D.hand * 0.60, D.armR * 0.84, D.armR * 0.74, 7, skin, 1.15, 0.72);
    for (let fi = 0; fi < 4; fi++) {
      const fx = (fi - 1.5) * D.armR * 0.46, fl = D.hand * (0.46 - 0.05 * Math.abs(fi - 1.5));
      m.limbT(fl, D.armR * 0.20, D.armR * 0.15, 6, skin, 1, 1, fx, -D.hand * 0.56, D.armR * 0.08, -0.42 - 0.1 * fi);
    }
    m.limbT(D.hand * 0.44, D.armR * 0.25, D.armR * 0.18, 6, skin, 1, 1,
      -side * D.armR * 0.82, -D.hand * 0.12, D.armR * 0.22, -0.95);
  }

  /* ---- legs ---- */
  const legCol = s.skirt ? mixc(skin, '#c8b49e', 0.35) : pants;
  for (const ids of [[B_THL, B_SHL, B_FTL], [B_THR, B_SHR, B_FTR]]) {
    m.mat = MAT.CLOTH;
    m.bone = ids[0]; m.limb(D.thigh, D.legR * 1.10, D.legR * 0.90, 10, legCol);
    m.bone = ids[1]; m.limb(D.shin, D.legR * 0.88, D.legR * 0.64, 10, s.skirt ? legCol : (s.sock || pants));
    m.bone = ids[2]; m.mat = MAT.DEF;
    if (s.heels) {
      m.box(0, -0.10 * h, D.foot * 0.28, D.legR * 1.3, 0.2 * h, D.foot * 0.92, shoe);
      m.box(0, -0.2 * h, -D.foot * 0.12, D.legR * 0.6, 0.24 * h, 0.22 * h, shoe);
    } else {
      m.box(0, -0.14 * h, D.foot * 0.14, D.legR * 1.5, 0.30 * h, D.foot * 0.74, shoe);
      m.ball(0, -0.13 * h, D.foot * 0.50, D.legR * 0.78, 0.15 * h, D.foot * 0.44, shoe, 9, 5);
      m.box(0, -0.05 * h, D.foot * 0.02, D.legR * 1.62, 0.22 * h, D.foot * 0.5, shoe);
      m.box(0, -0.265 * h, D.foot * 0.20, D.legR * 1.56, 0.05 * h, D.foot * 0.98, '#1a1714');
    }
  }

  m.bone = 0; m.mat = MAT.DEF;
  // A body is never scenery for the nav grid: its own AABBs would block it.
  m.solids.length = 0;
  return { mesh: m, D };
}

export class Rig {
  constructor(spec) {
    const built = buildBody(spec);
    this.D = built.D;
    const h = upload(built.mesh);
    this.vao = h.vao; this.count = h.count; this.buffers = h.buffers;
    this.bones = []; this.local = [];
    this.world = new Float32Array(BONE_N * 16);
    for (let i = 0; i < BONE_N; i++) { this.local.push(m4()); this.bones.push(m4()); }
  }

  solve(rx, ry, rz, yaw, p) {
    const D = this.D, L = this.local;
    m4trs(L[B_HIP], rx, ry, rz, yaw, p.hipPitch || 0, p.hipRoll || 0);
    m4trs(L[B_SPINE], 0, D.pelvis, 0, p.spineYaw || 0, p.spine || 0, 0);
    m4trs(L[B_CHEST], 0, D.spine, 0, 0, p.chest || 0, 0);
    m4trs(L[B_HEAD], 0, D.chest + D.neck * 0.72, 0, p.headYaw || 0, p.headPitch || 0, p.headRoll || 0);
    m4trs(L[B_UAL], -D.shoulder, D.chest * 0.88, 0, p.armLYaw || 0, p.armLPitch || 0, (p.armLRoll || 0) + 0.13);
    m4trs(L[B_FAL], 0, -D.uArm, 0, 0, p.elbowL || 0, 0);
    m4trs(L[B_HDL], 0, -D.fArm, 0, 0, p.wristL || 0, 0);
    m4trs(L[B_UAR], D.shoulder, D.chest * 0.88, 0, p.armRYaw || 0, p.armRPitch || 0, (p.armRRoll || 0) - 0.13);
    m4trs(L[B_FAR], 0, -D.uArm, 0, 0, p.elbowR || 0, 0);
    m4trs(L[B_HDR], 0, -D.fArm, 0, 0, p.wristR || 0, 0);
    m4trs(L[B_THL], -D.hipW, -0.06, 0, 0, p.hipL || 0, 0.035);
    m4trs(L[B_SHL], 0, -D.thigh, 0, 0, p.kneeL || 0, 0);
    m4trs(L[B_FTL], 0, -D.shin, 0, 0, p.ankleL || 0, 0);
    m4trs(L[B_THR], D.hipW, -0.06, 0, 0, p.hipR || 0, -0.035);
    m4trs(L[B_SHR], 0, -D.thigh, 0, 0, p.kneeR || 0, 0);
    m4trs(L[B_FTR], 0, -D.shin, 0, 0, p.ankleR || 0, 0);
    for (let i = 0; i < BONE_N; i++) {
      const par = BONE_PARENT[i];
      if (par < 0) this.bones[i].set(L[i]);
      else m4mul(this.bones[i], this.bones[par], L[i]);
      this.world.set(this.bones[i], i * 16);
    }
  }
}
