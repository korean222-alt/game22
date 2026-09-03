/* Pose library.

   A bone rotated by pitch t points along (0, -cos t, -sin t): t = -1.5 is
   roughly horizontal and forward, t = 0 is straight down. Every pose is a
   pure function of (time, seed) so staff at neighbouring desks never fall
   into lockstep. */

import { clamp } from '../core/math.js';
import { SEAT_HIP } from './rig.js';

const THIGH_SIT = -1.48;

/* Pick a knee angle that actually puts the sole on the floor for this build,
   rather than a constant that only works for one body height. */
export function sitKnee(D) {
  const drop = SEAT_HIP - 0.29 * D.h - Math.abs(Math.cos(THIGH_SIT)) * D.thigh;
  const phi = Math.acos(clamp(drop / D.shin, -1, 1));
  return -phi - THIGH_SIT;
}

/* Typing at a desk. `busy` speeds the hands up — used while a project is in
   development, so a working floor visibly reads as working. */
export function poseSit(t, seed, busy, D) {
  const k = sitKnee(D);
  const a = busy ? Math.sin(t * 8.5 + seed) * 0.10 : Math.sin(t * 1.3 + seed) * 0.015;
  const b = busy ? Math.sin(t * 8.5 + seed + 2.0) * 0.10 : Math.sin(t * 1.3 + seed + 1) * 0.015;
  return {
    hipPitch: 0.03, spine: -0.05 + Math.sin(t * 1.05 + seed) * 0.02, chest: 0.09,
    headPitch: 0.17 + Math.sin(t * 0.65 + seed) * 0.04, headYaw: Math.sin(t * 0.3 + seed) * 0.24,
    // An elbow past -PI/2 angles the forearm forward AND up, so the hands come
    // to rest just above the desktop instead of inside it.
    armLPitch: -0.56, armLRoll: 0.24, elbowL: -1.19 + a, wristL: 0.20,
    armRPitch: -0.56, armRRoll: -0.24, elbowR: -1.19 + b, wristR: 0.20,
    hipL: THIGH_SIT, kneeL: k, ankleL: 0.16,
    hipR: THIGH_SIT, kneeR: k, ankleR: 0.16,
  };
}

export function poseSitBack(t, seed, D) {
  const k = sitKnee(D);
  return {
    hipPitch: -0.10, spine: -0.14 + Math.sin(t * 0.95 + seed) * 0.025, chest: 0.03,
    headPitch: -0.02, headYaw: Math.sin(t * 0.38 + seed) * 0.38,
    armLPitch: -0.34, armLRoll: 0.40, elbowL: -1.02, wristL: 0.05,
    armRPitch: -0.34, armRRoll: -0.40, elbowR: -1.02, wristR: 0.05,
    hipL: THIGH_SIT + 0.06, kneeL: k - 0.06, ankleL: 0.18,
    hipR: THIGH_SIT + 0.06, kneeR: k - 0.06, ankleR: 0.18,
  };
}

export function poseStand(t, seed) {
  const s = Math.sin(t * 1.1 + seed), w = Math.sin(t * 0.45 + seed * 1.7);
  return {
    hipPitch: 0, hipRoll: Math.sin(t * 0.5 + seed) * 0.02, spine: 0.012 * s, chest: 0.015,
    headPitch: 0.02, headYaw: w * 0.5, headRoll: Math.sin(t * 0.37 + seed) * 0.03,
    armLPitch: 0.05 + s * 0.045, armLRoll: 0.06, elbowL: -0.22, wristL: 0,
    armRPitch: 0.05 - s * 0.045, armRRoll: -0.06, elbowR: -0.22, wristR: 0,
    hipL: 0.02, kneeL: -0.04, ankleL: 0.02, hipR: -0.02, kneeR: -0.04, ankleR: 0.02,
  };
}

export function poseTalk(t, seed) {
  const g = Math.sin(t * 2.2 + seed), g2 = Math.sin(t * 1.6 + seed + 2.1);
  return {
    hipPitch: 0, spine: 0.02 * g, chest: 0.025, spineYaw: g2 * 0.05,
    headPitch: 0.03 + g * 0.05, headYaw: g2 * 0.36, headRoll: g * 0.04,
    armLPitch: -0.42 + g * 0.26, armLRoll: 0.30, elbowL: -0.95 + g * 0.34, wristL: 0.08,
    armRPitch: -0.36 - g2 * 0.24, armRRoll: -0.30, elbowR: -0.88 - g2 * 0.30, wristR: 0.08,
    hipL: 0.03, kneeL: -0.05, ankleL: 0.02, hipR: -0.03, kneeR: -0.05, ankleR: 0.02,
  };
}

export function poseWalk(ph, t, seed) {
  const s = Math.sin(ph), c = Math.cos(ph);
  return {
    hipPitch: 0.05, spine: 0.02, chest: 0.02, hipRoll: s * 0.028, spineYaw: -s * 0.11,
    headPitch: 0.03, headYaw: Math.sin(t * 0.55 + seed) * 0.12,
    armLPitch: -s * 0.58, armLRoll: 0.10, elbowL: -0.30 - Math.max(0, -s) * 0.45, wristL: 0,
    armRPitch: s * 0.58, armRRoll: -0.10, elbowR: -0.30 - Math.max(0, s) * 0.45, wristR: 0,
    hipL: s * 0.62, kneeL: -Math.max(0, -c) * 0.88 - 0.05, ankleL: 0.12 + s * 0.14,
    hipR: -s * 0.62, kneeR: -Math.max(0, c) * 0.88 - 0.05, ankleR: 0.12 - s * 0.14,
    bob: Math.abs(Math.sin(ph * 2)) * 0.07,
  };
}

/* Both arms thrown up. Fired when a development battle lands a critical hit,
   which is the moment the whole 3D layer exists to sell. */
export function poseCheer(t, seed) {
  const p = Math.sin(t * 9 + seed);
  return {
    hipPitch: -0.06, spine: -0.10, chest: -0.06,
    headPitch: -0.22, headYaw: p * 0.10,
    armLPitch: -2.55 + p * 0.16, armLRoll: 0.55, elbowL: -0.32, wristL: 0,
    armRPitch: -2.55 - p * 0.16, armRRoll: -0.55, elbowR: -0.32, wristR: 0,
    hipL: 0.05, kneeL: -0.10, ankleL: 0.04, hipR: -0.05, kneeR: -0.10, ankleR: 0.04,
    bob: Math.max(0, p) * 0.22,
  };
}

/* Slumped over the desk: what an exhausted or demotivated staffer looks like. */
export function poseSlump(t, seed, D) {
  const k = sitKnee(D);
  return {
    hipPitch: 0.16, spine: 0.30 + Math.sin(t * 0.7 + seed) * 0.02, chest: 0.22,
    headPitch: 0.55, headYaw: Math.sin(t * 0.22 + seed) * 0.10, headRoll: 0.12,
    armLPitch: -0.92, armLRoll: 0.34, elbowL: -0.70, wristL: 0.10,
    armRPitch: -0.92, armRRoll: -0.34, elbowR: -0.70, wristR: 0.10,
    hipL: THIGH_SIT, kneeL: k, ankleL: 0.16,
    hipR: THIGH_SIT, kneeR: k, ankleR: 0.16,
  };
}

/* Overlay a reaction on top of whatever pose is running, so a staffer can react
   without losing the sit/walk cycle underneath. */
export function applyReact(pose, react, t) {
  if (!react) return pose;
  const k = Math.min(1, react.life / 0.25) * Math.min(1, react.left / 0.35);
  if (k <= 0) return pose;
  const p = { ...pose };
  if (react.kind === 'idea') {
    p.headPitch = (p.headPitch || 0) - 0.30 * k;
    p.armRPitch = (p.armRPitch || 0) - 1.55 * k;
    p.elbowR = (p.elbowR || 0) - 0.45 * k;
  } else if (react.kind === 'nod') {
    p.headPitch = (p.headPitch || 0) + Math.sin(t * 11) * 0.22 * k;
  } else if (react.kind === 'shake') {
    p.headYaw = (p.headYaw || 0) + Math.sin(t * 10) * 0.34 * k;
  } else if (react.kind === 'type') {
    p.elbowL = (p.elbowL || 0) + Math.sin(t * 22) * 0.10 * k;
    p.elbowR = (p.elbowR || 0) + Math.sin(t * 22 + 1.7) * 0.10 * k;
  }
  return p;
}
