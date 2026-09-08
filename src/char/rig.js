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
import { P } from '../world/palette.js';

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
  const shirt = s.hoodie || s.shirt, pants = s.pants || '#3a3b42', skin = s.skin, shoe = s.shoe || '#26221d';
  const outer = s.jacket || s.cardigan || shirt;
  const sqT = D.torsoD / D.torsoW;
  const h = D.h, R = D.headR;
  const eyeCol = s.eyeCol || '#4a5a6a', hair = s.hairCol || '#3a2a1c';
  // Profiles preserve the sixteen existing joints and animation lengths. Only
  // the silhouette changes: a forearm has a muscle belly and a narrow wrist,
  // rather than the constant taper of a toy's straight tube.
  const profile = (len, radius, rings, col, sx = 1, sz = 1) => {
    for (let i = 1; i < rings.length; i++) {
      const a = rings[i - 1], b = rings[i];
      m.limbT((b[0] - a[0]) * len, a[1] * radius, b[1] * radius, 12, col,
        sx, sz, 0, -a[0] * len, 0, 0);
    }
  };

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
  m.limbUp(D.spine, D.torsoW * 0.45, D.torsoW * 0.51, 16, shirt, 1, sqT);
  if (s.belly) {
    m.ball(0, D.spine * 0.50, D.torsoD * 0.14, D.torsoW * 0.50, D.spine * 0.72,
      D.torsoD * (0.44 + 0.34 * s.belly), shirt, 12, 6);
  }
  m.bone = B_CHEST; m.mat = MAT.CLOTH;
  m.limbUp(D.chest * 0.88, D.torsoW * 0.51, D.torsoW * 0.54, 16, shirt, 1, sqT);
  // The old shoulder ellipsoid used almost the full torso DEPTH as a radius:
  // it doubled the chest thickness and swallowed collars, ties and the neck.
  m.ball(0, D.chest * 0.82, 0, D.shoulder * 1.05, D.chest * 0.27,
    D.torsoD * 0.49, shirt, 20, 8);
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
    // Folded cloth has a pointed edge, not the rounded volume of a button.
    // Use the builder's triangle path so all seven attributes remain paired.
    const cc = s.collarCol || shade(shirt, 1.07), cy = D.chest * 0.98;
    m.tri(-0.29 * h, cy, D.torsoD * 0.39, -0.17 * h, cy - 0.22 * h, D.torsoD * 0.58,
      -0.045 * h, cy, D.torsoD * 0.43, cc);
    m.tri(0.045 * h, cy, D.torsoD * 0.43, 0.17 * h, cy - 0.22 * h, D.torsoD * 0.58,
      0.29 * h, cy, D.torsoD * 0.39, cc);
  }

  /* ---- head ---- */
  m.bone = B_HEAD; m.mat = MAT.SKIN;
  m.limb(D.neck * 0.85, 0.145 * h, 0.18 * h, 14, skin);
  const hy = R * 0.86, jaw = s.jaw || 1;
  m.ball(0, hy, -R * 0.04, R * 0.84, R, R * 0.82, skin, 24, 14);                        // cranium
  m.ball(0, hy - R * 0.39, R * 0.11, R * 0.67 * jaw, R * 0.55, R * 0.69, skin, 20, 10); // jaw and chin
  // Bridge, tip and alae read as a nose in profile without the old spherical
  // button. Small warm recesses provide depth without a texture asset.
  m.ball(0, hy + R * 0.04, R * 0.76, 0.042 * h, 0.102 * h, 0.049 * h, skin, 12, 8);
  m.ball(0, hy - R * 0.19, R * 0.89, 0.058 * h, 0.041 * h, 0.067 * h, skin, 14, 8);
  for (const k of [-1, 1]) {
    m.ball(k * 0.047 * h, hy - R * 0.22, R * 0.83, 0.032 * h, 0.031 * h, 0.040 * h, skin, 10, 6);
    m.ball(k * 0.038 * h, hy - R * 0.27, R * 0.88, 0.016 * h, 0.010 * h, 0.018 * h, shade(skin, 0.62), 8, 4);
    m.ball(k * R * 0.84, hy - R * 0.03, -R * 0.05, 0.052 * h, 0.098 * h, 0.058 * h, skin, 12, 7);
    m.ball(k * R * 0.88, hy - R * 0.02, 0.016 * h, 0.027 * h, 0.057 * h, 0.015 * h, shade(skin, 0.81), 10, 6);
  }
  const ex = R * 0.34, ey = hy + R * 0.08, ez = R * 0.73;
  for (const k of [-1, 1]) {
    m.mat = MAT.GLOSS;
    m.ball(k * ex, ey, ez, 0.070 * h, 0.037 * h, 0.032 * h, P.eyeWhite, 14, 8);
    m.ball(k * ex, ey, ez + 0.025 * h, 0.029 * h, 0.030 * h, 0.010 * h, eyeCol, 12, 7);
    m.ball(k * ex, ey, ez + 0.032 * h, 0.013 * h, 0.015 * h, 0.005 * h, P.pupil, 10, 6);
    m.mat = MAT.SKIN;
    m.ball(k * ex, ey + 0.038 * h, ez, 0.081 * h, 0.018 * h, 0.027 * h, skin, 12, 6);
    m.ball(k * ex, ey - 0.036 * h, ez - 0.002 * h, 0.073 * h, 0.013 * h, 0.022 * h, shade(skin, 0.97), 12, 6);
    m.mat = MAT.HAIR;
    m.ball(k * ex, ey + 0.078 * h, ez - 0.014 * h, 0.082 * h, 0.014 * h, 0.024 * h, hair, 12, 5);
  }
  m.mat = MAT.SKIN;
  const lip = mixc(skin, P.lip, 0.46), my = hy - R * 0.43, mz = R * 0.76;
  m.ball(0, my + 0.010 * h, mz, 0.082 * h, 0.016 * h, 0.025 * h, lip, 14, 6);
  m.ball(0, my - 0.015 * h, mz, 0.077 * h, 0.019 * h, 0.029 * h, lip, 14, 6);
  m.ball(0, my - 0.001 * h, mz + 0.023 * h, 0.067 * h, 0.004 * h, 0.006 * h, shade(lip, 0.67), 12, 4);

  m.mat = MAT.HAIR;
  // Keep the crown above the brow. The old full hair ellipsoid intersected
  // both eyes, and its box fringe made every haircut a solid helmet.
  const crown = (width = 0.90, height = 0.53) => {
    m.ball(0, hy + R * 0.55, -R * 0.16, R * width, R * height, R * 0.85, hair, 20, 10);
    for (const k of [-1, 1]) {
      m.ball(k * R * 0.73, hy + R * 0.22, -R * 0.25,
        R * 0.19, R * 0.43, R * 0.58, hair, 12, 7);
    }
  };
  switch (s.hair) {
    case 'short':
      crown();
      m.ball(-R * 0.16, hy + R * 0.72, R * 0.39, R * 0.68, R * 0.25, R * 0.36, hair, 20, 8);
      m.ball(R * 0.47, hy + R * 0.59, R * 0.34, R * 0.29, R * 0.30, R * 0.35, hair, 14, 8);
      break;
    case 'crop':
      crown(0.87, 0.47);
      break;
    case 'curly':
      crown(0.93, 0.60);
      for (let ci = 0; ci < 11; ci++) {
        const ca = ci / 11 * Math.PI * 2;
        m.ball(Math.cos(ca) * R * 0.73, hy + R * (0.60 + 0.06 * Math.sin(ca * 3)),
          Math.sin(ca) * R * 0.66 - R * 0.12, R * 0.26, R * 0.27, R * 0.25,
          ci % 3 ? hair : shade(hair, 1.09), 9, 6);
      }
      break;
    case 'long':
      crown(0.94);
      m.ball(0, hy - R * 0.48, -R * 0.70, R * 0.85, R * 1.10, R * 0.38, hair, 18, 10);
      for (const k of [-1, 1]) m.ball(k * R * 0.80, hy - R * 0.25, -R * 0.16,
        R * 0.24, R * 0.86, R * 0.45, hair, 14, 8);
      break;
    case 'bob':
      crown(0.95);
      m.ball(0, hy - R * 0.14, -R * 0.70, R * 0.83, R * 0.75, R * 0.37, hair, 18, 9);
      for (const k of [-1, 1]) m.ball(k * R * 0.81, hy - R * 0.10, -R * 0.14,
        R * 0.25, R * 0.66, R * 0.48, hair, 14, 8);
      break;
    case 'pony':
      crown();
      m.ball(0, hy + R * 0.12, -R * 0.94, R * 0.27, R * 0.38, R * 0.34, hair, 14, 8);
      m.ball(0, hy - R * 0.57, -R * 1.07, R * 0.25, R * 0.64, R * 0.27, hair, 14, 8);
      break;
    case 'bun':
      crown();
      m.ball(0, hy + R * 0.79, -R * 0.55, R * 0.36, R * 0.35, R * 0.36, hair, 16, 9);
      break;
    case 'balding':
      m.ball(0, hy + R * 0.03, -R * 0.71, R * 0.70, R * 0.58, R * 0.22, hair, 16, 8);
      for (const k of [-1, 1]) m.ball(k * R * 0.78, hy + R * 0.03, -R * 0.20,
        R * 0.16, R * 0.40, R * 0.53, hair, 12, 7);
      break;
    default: break;
  }
  if (s.beard) {
    m.ball(0, hy - R * 0.70, R * 0.40, R * 0.53, R * 0.24, R * 0.41, s.beardCol || hair, 16, 8);
    for (const k of [-1, 1]) m.ball(k * R * 0.55, hy - R * 0.38, R * 0.35,
      R * 0.18, R * 0.40, R * 0.28, s.beardCol || hair, 12, 7);
  }
  if (s.mustache) for (const k of [-1, 1]) m.ball(k * R * 0.14, hy - R * 0.32, R * 0.79,
    R * 0.18, R * 0.055, R * 0.06, s.beardCol || hair, 10, 5);
  m.mat = MAT.DEF;
  if (s.glasses) {
    m.mat = MAT.METAL;
    for (const k of [-1, 1]) {
      // Open frames leave the eyes visible; solid dark lens boxes hid them.
      const gx = k * ex, gz = ez + 0.053 * h;
      for (const y of [-0.057, 0.057]) m.box(gx, ey + y * h, gz, 0.191 * h, 0.014 * h, 0.018 * h, P.charcoal);
      for (const x of [-0.090, 0.090]) m.box(gx + x * h, ey, gz, 0.014 * h, 0.114 * h, 0.018 * h, P.charcoal);
      m.box(k * (ex + 0.095 * h), ey + 0.014 * h, gz - R * 0.43,
        0.014 * h, 0.018 * h, R * 0.86, P.charcoal);
    }
    m.box(0, ey + 0.013 * h, ez + 0.053 * h, (2 * ex - 0.18 * h), 0.014 * h, 0.020 * h, P.charcoal);
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
    m.ball(0, -D.uArm * 0.08, 0, D.armR * 1.10, D.armR * 1.24, D.armR * 1.03, outer, 12, 7);
    if (s.shortSleeve) {
      m.limb(D.uArm * 0.52, D.armR * 1.08, D.armR * 0.98, 9, outer);
      m.mat = MAT.SKIN;
      m.limbT(D.uArm * 0.50, D.armR * 0.95, D.armR * 0.88, 9, skin, 1, 1, 0, -D.uArm * 0.50, 0, 0);
    } else {
      profile(D.uArm, D.armR, [[0, 1.05], [0.28, 1.12], [0.67, 1.01], [1, 0.86]], outer);
    }
    m.bone = ids[1];
    if (s.shortSleeve) {
      m.mat = MAT.SKIN;
      profile(D.fArm, D.armR, [[0, 0.87], [0.24, 0.96], [0.65, 0.73], [1, 0.56]], skin, 1, 0.93);
    }
    else {
      m.mat = MAT.CLOTH;
      profile(D.fArm, D.armR, [[0, 0.89], [0.23, 0.99], [0.7, 0.81], [1, 0.69]], s.cuff || outer);
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
    m.ball(0, -D.hand * 0.20, 0, D.armR * 0.85, D.hand * 0.32, D.armR * 0.55, skin, 12, 7);
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
    m.bone = ids[0];
    profile(D.thigh, D.legR, [[0, 1.13], [0.20, 1.17], [0.60, 1.02], [1, 0.80]], legCol, 1, 1.06);
    m.bone = ids[1];
    m.ball(0, 0, 0, D.legR * 0.79, D.legR * 0.83, D.legR * 0.83, legCol, 12, 7);
    profile(D.shin, D.legR, [[0, 0.78], [0.29, 0.93], [0.64, 0.76], [1, 0.57]],
      s.skirt ? legCol : (s.sock || pants), 1, 1.03);
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
