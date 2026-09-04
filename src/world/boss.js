/* 아이디어 몬스터 — 개발 배틀의 보스.

   개발을 진행 바가 아니라 "싸움"으로 만들려면, 때리고 있는 대상이 화면에
   있어야 한다. 이 모듈은 장르마다 다른 실루엣의 덩어리를 절차적으로 만들고,
   사무실 한복판에 띄우고, 게임 이벤트(타격·크리티컬·페이즈 전환·격파)에
   맞춰 움직인다.

   본 구성 — uBones[] 슬롯을 그대로 쓴다:
     0  코어 (위치·회전·스케일. 정적 지오메트리의 모델 행렬이기도 하다)
     1  왕관/뿔 링 (코어와 반대로 돈다)
     2  위성 A   3  위성 B   4  위성 C
     5  오라 링 (페이즈가 오를수록 커지고 빨라진다)

   렌더 규약: flag 0 이므로 층 컷은 적용되고 벽 디더 컷은 적용되지 않는다.
   즉 다른 층을 보고 있으면 보스도 같이 사라진다 — 그게 맞다. */

import { MeshBuilder } from '../core/meshbuilder.js';
import { MAT, shade } from '../core/color.js';
import { m4, m4mul, m4trs } from '../core/math.js';
import { upload, disposeMesh } from '../core/gl.js';
import { clamp, angLerp } from '../core/math.js';

export const BOSS_BONES = 6;
const B_CORE = 0, B_CROWN = 1, B_SAT = 2, B_AURA = 5;

/* ---------- 지오메트리 ----------
   전부 한 번만 만들고 본으로 움직인다. 삼각형 수는 400 언저리로 잡았다:
   폰에서 매 프레임 그리는 물건이고, 실루엣과 색이 정보의 전부다. */
/* 눈이 몸통 밖으로 나와 있어야 얼굴이 보인다. 실루엣마다 표면이 있는
   위치가 달라서, 눈·입의 자리를 형태별로 따로 적어둔다. 예전에 한 값으로
   통일했더니 구형 보스는 눈이 몸 안에 파묻혀 그냥 덩어리로 보였다. */
const FACE = {
  cube: { y: 0.5, z: 1.78, sep: 0.85, r: 0.46, mouth: 1.6 },
  spike: { y: 0.35, z: 2.05, sep: 0.78, r: 0.42, mouth: 1.5 },
  orb: { y: 0.45, z: 2.18, sep: 0.80, r: 0.44, mouth: 1.6 },
  drone: { y: 1.05, z: 1.02, sep: 0.62, r: 0.34, mouth: 1.1 },
  ghost: { y: 0.95, z: 1.92, sep: 0.76, r: 0.44, mouth: 1.4 },
};

function buildBoss(shape, col, accent) {
  const m = new MeshBuilder();
  m.noSolid = true;                 // 보스는 길을 막지 않는다
  const dark = shade(col, 0.55);
  const light = shade(col, 1.35);

  /* ---- 코어 ---- */
  m.bone = B_CORE;
  m.mat = MAT.GLOSS;
  if (shape === 'cube') {
    // 맞물리지 않는 조각들: 어긋나게 쌓은 상자 무더기
    m.box(0, 0, 0, 3.4, 3.4, 3.4, col, light);
    m.boxY(0, 2.1, 0, 2.4, 1.6, 2.4, 0.6, dark, col);
    m.boxY(0.6, -1.9, -0.4, 2.0, 1.4, 2.0, -0.4, dark, col);
    m.boxY(-1.6, 0.9, 1.2, 1.3, 1.3, 1.3, 0.9, light);
    m.boxY(1.7, -0.6, 1.1, 1.1, 1.1, 1.1, -0.7, light);
  } else if (shape === 'spike') {
    m.ball(0, 0, 0, 2.0, 2.0, 2.0, col, 14, 8);
    // 가시: 코어에서 사방으로 뻗는 원뿔
    for (let i = 0; i < 10; i++) {
      const a = i * 0.6283, r = 1.7;
      const y = ((i % 3) - 1) * 1.15;
      m.cyl(Math.cos(a) * r, y, Math.sin(a) * r, 0.62, 1.5, dark, 5, accent);
    }
    m.ball(0, 2.3, 0, 1.0, 1.2, 1.0, dark, 10, 6);
  } else if (shape === 'drone') {
    m.boxY(0, 0, 0, 3.6, 1.5, 2.4, 0, col, light);
    m.box(0, 1.1, 0, 2.0, 0.9, 1.6, dark, col);
    for (const k of [-1, 1]) {
      m.boxY(k * 2.3, 0.2, 0, 1.6, 0.5, 0.7, 0, dark);
      m.cyl(k * 3.0, 0.5, 0, 0.9, 0.35, accent, 8);
    }
    m.mat = MAT.METAL;
    m.box(0, -1.1, 0, 2.2, 0.5, 1.4, '#8d939c');
    m.mat = MAT.GLOSS;
  } else if (shape === 'ghost') {
    m.ball(0, 0.4, 0, 2.1, 2.3, 1.9, col, 14, 8);
    m.ball(0, -1.6, 0, 1.5, 1.1, 1.4, shade(col, 0.8), 12, 6);
    m.ball(0, -2.7, 0.1, 0.9, 0.8, 0.9, shade(col, 0.62), 10, 5);
    m.ball(0, -3.5, 0.2, 0.5, 0.6, 0.5, shade(col, 0.45), 8, 4);
  } else {
    // orb: 매끈한 구 + 적도 띠
    m.ball(0, 0, 0, 2.2, 2.2, 2.2, col, 16, 9);
    m.mat = MAT.METAL;
    m.cyl(0, 0, 0, 2.45, 0.35, accent, 18);
    m.mat = MAT.GLOSS;
  }

  /* ---- 얼굴: 발광 재질. 블룸이 여기서 나온다 ---- */
  const F = FACE[shape] || FACE.orb;
  m.mat = MAT.EMIT;
  for (const k of [-1, 1]) {
    m.ball(k * F.sep, F.y, F.z, F.r, F.r * 0.74, F.r * 0.62, accent, 9, 6);
    // 눈동자: 흰 점 하나가 있으면 시선이 생긴다
    m.ball(k * F.sep, F.y, F.z + F.r * 0.34, F.r * 0.34, F.r * 0.30, F.r * 0.22, '#ffffff', 7, 5);
  }
  // 입: 얇게 빛나는 틈
  m.box(0, F.y - 0.95, F.z * 0.94, F.mouth, 0.18, 0.20, accent);
  m.mat = MAT.GLOSS;

  /* ---- 왕관: 코어 위에서 반대로 도는 파편 링 ---- */
  m.bone = B_CROWN;
  for (let i = 0; i < 6; i++) {
    const a = i * 1.0472;
    m.boxY(Math.cos(a) * 3.1, 0, Math.sin(a) * 3.1, 0.8, 1.5, 0.34, -a, i % 2 ? accent : light);
  }

  /* ---- 위성: 궤도를 도는 세 조각 ---- */
  for (let s = 0; s < 3; s++) {
    m.bone = B_SAT + s;
    m.boxY(0, 0, 0, 1.15, 1.15, 1.15, 0.5, s === 1 ? accent : light, col);
  }

  /* ---- 오라: 바닥에 깔리는 발광 링 ---- */
  m.bone = B_AURA;
  m.mat = MAT.EMIT;
  for (let i = 0; i < 14; i++) {
    const a = i * 0.4488;
    m.box(Math.cos(a) * 4.2, 0, Math.sin(a) * 4.2, 0.55, 0.14, 0.55, accent);
  }

  m.bone = 0; m.mat = 0;
  m.solids.length = 0;
  return m;
}

/* ---------- 보스 인스턴스 ---------- */
export class Boss {
  constructor(def) {
    this.def = def || {};
    const mesh = buildBoss(this.def.shape || 'orb', this.def.col || '#8a8a9a',
      this.def.accent || '#ffd66e');
    const h = upload(mesh);
    this.vao = h.vao; this.count = h.count; this.buffers = h.buffers;

    this.world = new Float32Array(BOSS_BONES * 16);
    this._m = [];
    for (let i = 0; i < BOSS_BONES; i++) this._m.push(m4());

    this.x = 0; this.y = 0; this.z = 0;
    this.yaw = 0; this.goalYaw = 0;
    this.t = 0;
    this.appear = 0;          // 0 → 1 등장 연출
    this.hitT = 0;            // 타격 반동
    this.rageT = 0;           // 페이즈 전환 섬광
    this.dying = 0;           // 격파 후 소멸
    this.dead = false;
    this.phase = 0;
    this.shake = 0;
    this.scale = 1;
  }

  setAnchor(x, y, z) { this.x = x; this.y = y; this.z = z; }

  /* 눈이 플레이어를 향하도록 코어를 천천히 돌린다. 카메라 방위각을 그대로
     받아서 쓰므로, 어느 각도에서 봐도 얼굴이 보인다. */
  faceTo(yaw) { this.goalYaw = yaw; }

  hit(strength = 1) { this.hitT = Math.min(1.2, this.hitT + 0.45 * strength); this.shake = Math.min(1, this.shake + 0.5 * strength); }
  rage(phase) { this.phase = phase || this.phase + 1; this.rageT = 1.4; this.shake = 1; }
  kill() { if (!this.dying) this.dying = 0.001; }

  update(dt, t) {
    this.t += dt;
    this.appear = Math.min(1, this.appear + dt * 1.6);
    this.hitT = Math.max(0, this.hitT - dt * 2.4);
    this.rageT = Math.max(0, this.rageT - dt * 1.1);
    this.shake = Math.max(0, this.shake - dt * 2.0);
    if (this.dying > 0) {
      this.dying = Math.min(1, this.dying + dt * 1.5);
      if (this.dying >= 1) this.dead = true;
    }
    this.yaw = angLerp(this.yaw, this.goalYaw, clamp(dt * 2.2, 0, 1));

    const spin = 1 + this.phase * 0.35 + this.rageT * 1.5;
    const bob = Math.sin(this.t * 1.25) * 0.55 + Math.sin(this.t * 2.7) * 0.16;
    // 등장은 아래에서 솟아오르며 커진다. 격파는 그 반대다.
    const grow = this.appear * this.appear * (3 - 2 * this.appear);
    const shrink = 1 - this.dying;
    const s = clamp(grow * shrink, 0, 1) * (1 + this.hitT * 0.16) * this.scale;
    const sx = Math.sin(this.t * 41) * this.shake * 0.45;
    const sz = Math.cos(this.t * 37) * this.shake * 0.45;

    const cy = this.y + bob + (1 - grow) * -4 + this.dying * 3.5;
    // 코어: 위치 · 방향 · 스케일
    m4trs(this._m[B_CORE], this.x + sx, cy, this.z + sz,
      this.yaw + Math.sin(this.t * 0.6) * 0.12, this.hitT * 0.22, 0);
    scaleInto(this._m[B_CORE], s);

    // 왕관: 코어와 반대 방향, 위쪽
    m4trs(this._m[B_CROWN], this.x + sx, cy + 2.6 * s, this.z + sz, -this.t * spin * 0.7, 0, 0);
    scaleInto(this._m[B_CROWN], s * (1 + this.rageT * 0.22));

    // 위성 셋: 서로 다른 반경과 높이의 궤도
    for (let i = 0; i < 3; i++) {
      const a = this.t * spin * (0.9 + i * 0.22) + i * 2.094;
      const r = (5.0 + i * 0.7) * s;
      const yy = cy + Math.sin(this.t * (1.1 + i * 0.3) + i) * 1.5;
      m4trs(this._m[B_SAT + i], this.x + Math.cos(a) * r, yy, this.z + Math.sin(a) * r, a, 0, 0);
      scaleInto(this._m[B_SAT + i], s * 0.9);
    }

    // 오라: 발밑에서 도는 링. 페이즈가 오를수록 커진다.
    m4trs(this._m[B_AURA], this.x, this.y - 3.2, this.z, this.t * (0.8 + this.phase * 0.5), 0, 0);
    scaleInto(this._m[B_AURA], s * (0.9 + this.phase * 0.16 + Math.sin(this.t * 3) * 0.04));

    for (let i = 0; i < BOSS_BONES; i++) this.world.set(this._m[i], i * 16);
  }

  dispose() { disposeMesh(this); }
}

/* 회전·이동이 이미 들어 있는 행렬의 3×3 부분에 균일 스케일을 곱한다.
   m4trs 에 스케일 인자가 없어서 여기서 따로 넣는다 — 스케일을 별도 행렬로
   곱하면 프레임마다 행렬 하나를 더 만들게 된다. */
function scaleInto(m, s) {
  for (let c = 0; c < 3; c++) {
    m[c * 4] *= s; m[c * 4 + 1] *= s; m[c * 4 + 2] *= s;
  }
  return m;
}
