/* The boss monster in the room.

   A thin state machine over one SkinnedInstance. It owns no game rules: the
   simulation still decides damage, and this only turns the events it emits into
   something you can watch — a flinch per turn, a red flash, a taunt when the
   idea hits back, and a death that plays out before the body fades.

   Where it stands is not arbitrary. Every floor plan reserves two circulation
   lanes — the east spine and the middle cross corridor — and their crossing is
   the only patch of floor guaranteed clear on all five storeys, whatever the
   player has bought or placed. A nine-unit demon needs about that much room. */

import { SkinnedModel, SkinnedInstance } from '../render/skinned.js';
import { MONSTERS, MONSTER_BY_ID, monsterFor, tauntFor } from '../game/monsters.js';
import { STOREY } from './props.js';

/* One model per species, loaded on demand and kept: a career sees each of the
   three at most once per project, and re-parsing 400 KB per project is a stall
   the player would feel. */
const cache = new Map();

export function preloadMonster(def) {
  if (!def) return Promise.resolve(null);
  let job = cache.get(def.id);
  if (!job) {
    job = SkinnedModel.load(def.file).catch((e) => {
      console.warn('monster load failed', def.file, e);
      cache.delete(def.id);          // a flaky network gets another chance
      return null;
    });
    cache.set(def.id, job);
  }
  return job;
}

const HIT_FLASH = 0.28;

export class Boss {
  constructor(def, model, spot) {
    this.def = def;
    this.model = model;
    this.inst = new SkinnedInstance(model);
    this.scale = def.height / Math.max(0.01, model.bounds.maxY - model.bounds.minY);
    this.x = spot.x; this.z = spot.z; this.yaw = spot.yaw; this.floor = spot.floor;
    this.baseY = spot.floor * STOREY - model.bounds.minY * this.scale;
    this.headY = spot.floor * STOREY + def.height * 1.06;
    this.flash = 0;
    this.dying = false;
    this.dead = false;
    this.fade = 1;
    this.bubble = null;
    this.spawn = 0;                  // 0..1 rise-in, so it does not just pop
    this.inst.play(def.idle, { loop: true });
    this.inst.setTransform(this.x, this.baseY, this.z, this.yaw, this.scale);
  }

  say(text, secs = 2.6) { this.bubble = { text, left: secs }; }

  /* One development turn landed. */
  react(rnd) {
    if (this.dying) return;
    this.flash = HIT_FLASH;
    this.inst.play(this.def.hit, { loop: false, next: this.def.idle });
    // Every so often the idea hits back. It costs the player nothing — the
    // battle maths is untouched — but a boss that only ever flinches stops
    // reading as an opponent after the third turn.
    if (rnd && rnd() > 0.72) this.say(tauntFor(this.def, rnd), 2.4);
  }

  attack(rnd) {
    if (this.dying) return;
    this.inst.play(this.def.attack, { loop: false, next: this.def.idle });
    if (rnd) this.say(tauntFor(this.def, rnd), 2.6);
  }

  kill() {
    if (this.dying) return;
    this.dying = true;
    this.bubble = null;
    this.inst.play(this.def.death, { loop: false });
    this.deadFor = 0;
  }

  update(dt) {
    this.inst.update(dt);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt);
    if (this.bubble) {
      this.bubble.left -= dt;
      if (this.bubble.left <= 0) this.bubble = null;
    }
    if (this.spawn < 1) {
      this.spawn = Math.min(1, this.spawn + dt * 1.6);
      this.inst.setTransform(this.x, this.baseY, this.z, this.yaw, this.scale * (0.55 + 0.45 * this.spawn));
    }
    if (this.dying) {
      this.deadFor += dt;
      // Hold the last frame of the death clip for a beat, then dissolve.
      if (this.deadFor > 1.2) this.fade = Math.max(0, this.fade - dt * 1.1);
      if (this.fade <= 0) this.dead = true;
    }
  }

  /* Colour the draw: white normally, hot red on the frame it was hit, and a
     rising rim glow as the idea's health drains — the visual "almost there". */
  drawArgs(hpFrac) {
    const f = this.flash / HIT_FLASH;
    const tint = [1 + f * 1.6, 1 - f * 0.45, 1 - f * 0.5];
    const emis = (1 - Math.max(0, Math.min(1, hpFrac))) * 0.55 * this.fade;
    return { tint, emis, alpha: this.fade * (0.35 + 0.65 * this.spawn) };
  }

  dispose() { this.inst.dispose(); }
}

/* The arena: where the east spine (x 40-44.5) meets the cross corridor
   (z 27.5-31.5). Both are reserved as walkways on every floor plan, so nothing
   the office generator or the player places can ever be standing here.

   The facing points at where the camera starts, so the monster is looking at
   you the moment it appears rather than showing you its back. */
export const BOSS_SPOT = { x: 42.5, z: 29.5, yaw: 2.33 };

export function bossSpot(floor) {
  return { ...BOSS_SPOT, floor: Math.max(0, floor | 0) };
}

export { MONSTERS, MONSTER_BY_ID, monsterFor, tauntFor };
