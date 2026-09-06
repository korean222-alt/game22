/* 아이디어 몬스터 — 개발 배틀의 보스.

   개발을 진행 바가 아니라 "싸움"으로 만들려면, 때리고 있는 대상이 화면에
   있어야 한다. 이 모듈은 사무실 한복판에 실제 3D 캐릭터를 띄우고, 게임
   이벤트(타격·크리티컬·페이즈 전환·격파)에 맞춰 움직인다.

   두 갈래가 여기서 합쳐졌다. 전투 규칙(페이즈·약점·반격)은 절차적 덩어리
   보스를 상대로 쓰였고, 모델은 나중에 들어온 Quaternius 캐릭터 팩이다.
   남은 일은 후자를 전자의 API 로 감싸는 것이었다 — `setAnchor` / `faceTo` /
   `hit` / `rage` / `kill` 은 그대로고, 그 안에서 도는 것이 스킨드 glTF 다.

   규칙은 하나도 모른다. 데미지도 주지 않는다. game/project.js 가 내보내는
   이벤트를 몸짓으로 바꾸는 것이 전부다. */

import { SkinnedModel, SkinnedInstance } from '../render/skinned.js';
import { MONSTERS, MONSTER_BY_ID, monsterFor, monsterForStage, tauntFor } from '../game/monsters.js';
import { clamp, angLerp } from '../core/math.js';
import { STOREY } from './props.js';

/* 종족당 모델 하나. 한 경력에 세 종을 넘게 볼 일이 없고, 프로젝트마다
   400KB 를 다시 파싱하면 플레이어가 그 멈춤을 느낀다. */
const cache = new Map();

export function preloadMonster(def) {
  if (!def) return Promise.resolve(null);
  // 파일로 캐시한다. 버그 무리는 냥이와 같은 리그를 쓰므로, id 로 캐시하면
  // 같은 400KB 를 한 번 더 파싱한다 — 크기는 def.height 가 따로 정한다.
  const key = def.file;
  let job = cache.get(key);
  if (!job) {
    job = SkinnedModel.load(def.file).catch((e) => {
      console.warn('monster load failed', def.file, e);
      cache.delete(key);             // 네트워크가 흔들렸다면 다음에 다시
      return null;
    });
    cache.set(key, job);
  }
  return job;
}

const HIT_FLASH = 0.28;

export class Boss {
  constructor(def, model) {
    this.def = def;
    this.model = model;
    this.inst = new SkinnedInstance(model);
    // 종마다 모델 크기가 달라서, 실제 높이를 재서 원하는 월드 높이로 맞춘다.
    // 종별 스케일 상수를 손으로 적으면 팩을 바꿀 때마다 틀린다.
    this.baseScale = def.height / Math.max(0.01, model.bounds.maxY - model.bounds.minY);
    this.modelMinY = model.bounds.minY;

    this.x = 0; this.y = 0; this.z = 0;      // y 는 발이 닿는 월드 높이
    this.yaw = 0; this.goalYaw = 0;
    this.floor = 0;
    this.t = 0;
    this.appear = 0;          // 0 → 1 등장
    this.flash = 0;           // 피격 섬광
    this.rageT = 0;           // 페이즈 전환 섬광
    this.dying = false;
    this.dead = false;
    this.fade = 1;
    this.deadFor = 0;
    this.phase = 0;
    this.scale = 1;           // 페이즈 배율. baseScale 과 곱해진다
    this.bubble = null;
    this.inst.play(def.idle, { loop: true });
  }

  /* 발이 닿는 지점. */
  setAnchor(x, y, z, floor) {
    this.x = x; this.y = y; this.z = z;
    if (floor !== undefined) this.floor = floor;
  }

  /* 눈이 플레이어를 향하도록 천천히 돈다. 어느 각도에서 봐도 얼굴이 보인다. */
  faceTo(yaw) { this.goalYaw = yaw; }

  get headY() { return this.y + this.def.height * this.scale * 1.06; }

  say(text, secs = 2.6) { this.bubble = { text, left: secs }; }

  /* 한 턴이 들어갔다. strength 는 크리티컬이면 크다. */
  hit(strength = 1) {
    if (this.dying) return;
    this.flash = Math.min(1, this.flash + HIT_FLASH * (0.6 + strength));
    this.inst.play(this.def.hit, { loop: false, next: this.def.idle });
  }

  /* 예전 이름. 랜덤을 받으면 가끔 도발까지 한다. */
  react(rnd) {
    this.hit(1);
    if (rnd && rnd() > 0.72) this.say(tauntFor(this.def, rnd), 2.4);
  }

  /* 페이즈 전환 — 보스가 성을 낸다. 반격 모션 + 섬광. */
  rage(phase, rnd) {
    if (this.dying) return;
    this.phase = phase === undefined ? this.phase + 1 : phase;
    this.rageT = 1.4;
    this.inst.play(this.def.attack, { loop: false, next: this.def.idle });
    if (rnd) this.say(tauntFor(this.def, rnd), 2.6);
  }

  attack(rnd) { this.rage(this.phase, rnd); }

  kill() {
    if (this.dying) return;
    this.dying = true;
    this.bubble = null;
    this.deadFor = 0;
    this.inst.play(this.def.death, { loop: false });
  }

  update(dt) {
    this.t += dt;
    this.inst.update(dt);
    this.appear = Math.min(1, this.appear + dt * 1.6);
    this.flash = Math.max(0, this.flash - dt * 3.2);
    this.rageT = Math.max(0, this.rageT - dt * 1.1);
    this.yaw = angLerp(this.yaw, this.goalYaw, clamp(dt * 2.2, 0, 1));

    if (this.bubble) {
      this.bubble.left -= dt;
      if (this.bubble.left <= 0) this.bubble = null;
    }
    if (this.dying) {
      this.deadFor += dt;
      // 사망 모션의 마지막 프레임을 한 박자 붙들었다가 녹아 사라진다.
      if (this.deadFor > 1.2) this.fade = Math.max(0, this.fade - dt * 1.1);
      if (this.fade <= 0) this.dead = true;
    }

    // 등장은 아래에서 솟아오른다.
    const grow = this.appear * this.appear * (3 - 2 * this.appear);
    const s = this.baseScale * this.scale * (1 + this.rageT * 0.06);
    const sink = (1 - grow) * -3.0;
    this.inst.setTransform(this.x, this.y - this.modelMinY * s + sink, this.z, this.yaw, s);
  }

  /* 그리기 색: 평소 흰색, 맞은 프레임은 붉게, HP 가 줄수록 림 글로우가 오른다. */
  drawArgs(hpFrac) {
    const f = Math.min(1, this.flash / HIT_FLASH);
    const r = this.rageT;
    const tint = [1 + f * 1.6 + r * 0.5, 1 - f * 0.45 - r * 0.15, 1 - f * 0.5 - r * 0.2];
    const emis = ((1 - clamp(hpFrac, 0, 1)) * 0.55 + r * 0.5) * this.fade;
    return { tint, emis, alpha: this.fade * (0.35 + 0.65 * this.appear) };
  }

  dispose() { this.inst.dispose(); }
}

/* 층 도면이 통로로 비워둔 두 축이 만나는 지점 — 어떤 층에서도, 플레이어가
   무엇을 사서 어디에 놓았든 비어 있는 것이 보장된 유일한 바닥이다.
   9 유닛짜리 데몬이 서려면 그만큼은 필요하다. */
export const BOSS_SPOT = { x: 42.5, z: 29.5, yaw: 2.33 };

export function bossSpot(floor) {
  const f = Math.max(0, floor | 0);
  return { ...BOSS_SPOT, floor: f, y: f * STOREY };
}

export { MONSTERS, MONSTER_BY_ID, monsterFor, monsterForStage, tauntFor };
