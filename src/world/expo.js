/* 게임덱스 — 부스를 차리는 자리.

   예전에는 이 행사가 버튼 세 개였다. 예산을 고르면 팝업이 방문자 수를
   말해 주고 끝. 그런데 이 게임에서 만든 것을 **바깥 사람이 만지는** 장면은
   여기밖에 없다. 그 장면이 숫자 한 줄로 지나가면, 부스를 크게 차릴 이유가
   가계부 위에만 남는다.

   그래서 전시장을 하나 짓는다. 사무실에서도 세트장에서도 멀리 떨어진
   자리(EXPO_ORIGIN)에 홀을 세우고, 우리 부스와 남의 부스를 나란히 놓고,
   입구에서 사람이 걸어 들어온다. 카메라가 어디를 보느냐가 곧 어느 장면이냐는
   arena 와 같은 방식이다 — 좌표가 안 겹치므로 어느 쪽도 상대를 모른다.

   예산은 부스의 **크기와 개수**로 나타난다. 전단지만 돌리면 부스가 없고
   입구에 접이식 탁자 하나가 서고, 부스를 내면 시연대 두 대짜리 부스가 서고,
   최대 규모면 무대와 대형 스크린과 배너 기둥이 선다. 무엇을 샀는지가
   화면에 그대로 보여야 그 선택이 판단이 된다.

   여기 있는 것은 지오메트리뿐이다. 규칙도 카메라 조작도 모른다. */

import { MeshBuilder } from '../core/meshbuilder.js';
import { MAT } from '../core/color.js';
import { mulberry32 } from '../core/math.js';
import { P } from './palette.js';

/* 사무실은 (0..64, 0..44), 세트장은 (520, 520), 스카이라인은 (32,22) 반경
   230. 그 어느 것과도 겹치지 않는 자리. */
export const EXPO_ORIGIN = { x: -520, z: 520 };

export function inExpoZone(x, z) {
  return Math.abs(x - EXPO_ORIGIN.x) < 300 && Math.abs(z - EXPO_ORIGIN.z) < 300;
}

const TAU = Math.PI * 2;
/* 전시장 전체가 SITE(플래그 4) 다. 벽 자르기도 층 자르기도 통과시키지
   않는다 — 여기에는 '위층' 이라는 개념이 없다. */
const SITE = 4;

/* 로컬 → 월드. props 와 같은 약속이다: +Z 가 앞(입구 쪽). */
const at = (ox, oz, ry) => (lx, lz) => [
  ox + lx * Math.cos(ry) + lz * Math.sin(ry),
  oz - lx * Math.sin(ry) + lz * Math.cos(ry),
];

/* ---------- 홀 ---------- */

/* 홀의 반지름. 카메라가 이 안쪽에 서야 한다 — 밖에 서면 화면이 벽으로
   가득 찬다. 가장 먼 시점(대형 부스)이 중심에서 52 쯤이므로 넉넉히 둔다. */
const HALL_R = 96;

function hall(m, ox, oz) {
  m.flag = SITE; m.noSolid = true;
  // 바닥. 전시장 카펫은 짙은 남색이라 부스의 조명이 뜬다.
  m.box(ox, -0.6, oz, 400, 1.2, 400, '#2b3040');
  m.noSolid = false;
  m.noNav = true;

  // 통로 카펫. 입구에서 우리 부스까지 한 줄로 깔린다 — 눈이 갈 곳을 정해 준다.
  m.mat = MAT.CARPET;
  m.box(ox, 0.03, oz + 22, 26, 0.06, 92, '#7a3f4a');
  m.mat = 0;

  // 둘러싼 벽. 하늘이 한 조각도 안 보여야 '실내' 가 된다.
  const seg = 24, r = HALL_R, step = TAU / seg;
  const w = 2 * r * Math.tan(step / 2) * 0.98;
  for (let i = 0; i < seg; i++) {
    const a = i * step;
    m.boxY(ox + Math.cos(a) * r, 17, oz + Math.sin(a) * r, w, 34, 1.6, -a, '#394054');
  }

  /* 천장 트러스와 조명. 판을 통째로 덮으면 그림자가 홀을 새까맣게 만들므로
     — 실제로 QA 실에서 그랬다 — 격자만 걸고 빛은 발광 막대가 낸다. */
  m.mat = MAT.METAL;
  for (let i = -4; i <= 4; i++) {
    m.box(ox + i * 20, 28.5, oz + 10, 0.7, 0.7, 170, '#4e5566');
  }
  for (let j = -3; j <= 4; j++) {
    m.box(ox, 28.5, oz + j * 20, 170, 0.7, 0.7, '#4e5566');
  }
  m.mat = MAT.EMIT; m.noSolid = true;
  for (let i = -3; i <= 3; i++) {
    for (let j = -2; j <= 3; j++) {
      m.box(ox + i * 20, 27.6, oz + j * 20, 4.0, 0.4, 4.0, '#fff0cf');
    }
  }
  m.noSolid = false;
  m.mat = 0; m.noNav = false; m.flag = 0;
}

/* 입구 게이트. 여기서 사람이 들어온다. 카메라보다 뒤(+Z)에 서므로 화면을
   가리지 않고, 사람들은 화면 뒤에서 걸어 들어와 앞으로 지나간다. */
function gate(m, ox, oz) {
  const R = at(ox, oz, 0);
  m.flag = SITE; m.noNav = true;
  m.mat = MAT.METAL;
  for (const k of [-1, 1]) {
    const p = R(k * 15, 68);
    m.box(p[0], 8, p[1], 2.2, 16, 2.2, '#4a5164');
  }
  m.box(ox, 16.6, oz + 68, 32, 2.8, 2.2, '#3f4658');
  m.mat = MAT.EMIT; m.noSolid = true;
  m.box(ox, 16.6, oz + 66.8, 27, 1.8, 0.3, '#ffd479');
  m.noSolid = false;
  m.mat = 0; m.noNav = false; m.flag = 0;
}

/* 배너 기둥 하나. 세로로 긴 천에 색 띠가 들어간다. */
function bannerPole(m, x, z, ry, col, h = 14) {
  m.flag = SITE; m.noNav = true;
  m.mat = MAT.METAL;
  m.boxY(x, h / 2, z, 0.5, h, 0.5, ry, '#575e70');
  /* 천은 **넓은 면이 앞(+Z)** 을 보게 걸고, 기둥보다 한 뼘 앞에 건다.
     로컬 X 가 폭, 로컬 Z 가 두께다 — 반대로 걸면 옆에서만 보이는 배너가
     되어 정면에서는 선 하나로 남고, 기둥과 같은 자리에 걸면 배너 한복판에
     쇠기둥이 세로로 지나간다. */
  const R = at(x, z, ry);
  const p = R(0, 0.42);
  m.mat = MAT.CLOTH;
  m.boxY(p[0], h * 0.66, p[1], 3.4, h * 0.62, 0.16, ry, col);
  m.mat = MAT.EMIT; m.noSolid = true;
  const q = R(0, 0.53);
  m.boxY(q[0], h * 0.86, q[1], 3.0, 1.0, 0.14, ry, '#fff4d8');
  m.boxY(q[0], h * 0.5, q[1], 2.6, 0.6, 0.14, ry, '#ffffff');
  m.noSolid = false;
  m.mat = 0; m.noNav = false; m.flag = 0;
}

/* 시연대. 스크린 한 장과 그 앞의 스탠드. 사람이 그 앞에 선다. */
function demoStation(m, x, z, ry, tint) {
  const R = at(x, z, ry);
  m.flag = SITE; m.noNav = true;
  m.mat = MAT.WOOD;
  m.boxY(x, 1.6, z, 3.2, 3.2, 2.0, ry, P.lamDk);          // 받침대
  m.mat = MAT.METAL;
  m.boxY(x, 4.4, z, 0.4, 2.6, 0.4, ry, '#5c6373');        // 기둥
  m.boxY(x, 3.3, z, 3.0, 0.3, 0.28, ry, '#5c6373');       // 가로대
  /* 화면. 넓은 면이 앞(+Z)을 봐야 한다 — 폭은 로컬 X, 두께는 로컬 Z.
     발광이라 홀이 어두워도 부스에 빛이 고인다. */
  m.mat = MAT.EMIT; m.noSolid = true;
  const sc = R(0, 0.14);
  m.boxY(sc[0], 6.6, sc[1], 5.2, 3.2, 0.2, ry, tint || '#7fd8ff');
  // 화면 속의 무언가 — 가로 띠 몇 줄이면 '게임이 돌고 있다' 로 읽힌다.
  for (let i = 0; i < 3; i++) {
    const p = R((i - 1) * 1.3, 0.26);
    m.boxY(p[0], 6.0 + i * 0.9, p[1], 3.2 - i * 0.7, 0.5, 0.1, ry, i === 1 ? '#ffffff' : '#cfe9ff');
  }
  m.noSolid = false;
  m.mat = 0; m.noNav = false; m.flag = 0;
}

/* 부스 하나. `scale` 이 크기를, `mine` 이 색을 정한다. */
function booth(m, ox, oz, ry, opts = {}) {
  const w = opts.w || 16, d = opts.d || 11;
  const mine = !!opts.mine;
  const wall = mine ? '#2f5f8a' : '#4a4f60';
  const trim = mine ? '#e8b055' : '#6a7183';
  const R = at(ox, oz, ry);
  m.flag = SITE; m.noNav = true;

  // 부스 바닥판. 한 뼘 높은 단이라 통로와 구분된다.
  m.mat = MAT.CARPET;
  m.boxY(ox, 0.2, oz, w, 0.4, d, ry, mine ? '#3a5f7d' : '#3c414f');
  m.mat = 0;

  // 뒷벽. 여기에 회사 이름이 붙는다 (DOM 라벨이 얹힌다).
  const bk = R(0, -d / 2);
  m.mat = MAT.WALL;
  m.boxY(bk[0], 6.5, bk[1], w, 13, 0.6, ry, wall);
  m.mat = MAT.EMIT; m.noSolid = true;
  // 뒷벽 위의 띠 조명과, 벽 한가운데의 큰 화면.
  m.boxY(R(0, -d / 2 + 0.45)[0], 12.4, R(0, -d / 2 + 0.45)[1], w - 1.2, 0.5, 0.2, ry, trim);
  if (opts.screen !== false) {
    const sc = R(0, -d / 2 + 0.5);
    m.boxY(sc[0], 7.6, sc[1], w * 0.56, 5.6, 0.2, ry, mine ? '#8fe0ff' : '#9aa6bd');
  }
  m.noSolid = false;

  // 옆벽 두 장.
  m.mat = MAT.WALL;
  for (const k of [-1, 1]) {
    const sd = R(k * (w / 2), -d * 0.18);
    m.boxY(sd[0], 5.6, sd[1], 0.5, 11.2, d * 0.62, ry, wall);
  }

  // 접수대. 부스의 얼굴이다 — 사람이 여기 서서 안내한다.
  m.mat = MAT.WOOD;
  const ct = R(0, d / 2 - 1.6);
  m.boxY(ct[0], 1.7, ct[1], w * 0.5, 3.4, 1.6, ry, P.lam);
  m.mat = MAT.GLOSS;
  m.boxY(ct[0], 3.5, ct[1], w * 0.5 + 0.3, 0.2, 1.9, ry, trim);
  m.mat = 0;

  // 시연대. 큰 부스일수록 많다.
  const n = opts.demos === undefined ? 2 : opts.demos;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : (i / (n - 1) - 0.5) * (w - 6);
    const p = R(t, -d * 0.1);
    demoStation(m, p[0], p[1], ry, mine ? '#7fd8ff' : '#93a3bb');
  }

  // 바닥 조명 띠. 단의 가장자리를 따라 돈다.
  m.mat = MAT.EMIT; m.noSolid = true;
  for (let i = 0; i < 14; i++) {
    const t = (i / 13 - 0.5) * (w - 1);
    const a2 = R(t, d / 2 - 0.2);
    m.boxY(a2[0], 0.46, a2[1], 0.8, 0.12, 0.5, ry, trim);
  }
  m.noSolid = false;
  m.mat = 0; m.noNav = false; m.flag = 0;
}

/* 관객용 의자 몇 줄. 무대 앞에만 깐다. */
function seating(m, ox, oz, ry, rows, cols) {
  const R = at(ox, oz, ry);
  m.flag = SITE; m.noNav = true;
  m.mat = MAT.FABRIC;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = R((c - (cols - 1) / 2) * 2.4, r * 2.6);
      m.boxY(p[0], 1.0, p[1], 1.5, 0.4, 1.5, ry, r % 2 ? '#3f4759' : '#464f63');
      m.boxY(R((c - (cols - 1) / 2) * 2.4, r * 2.6 - 0.7)[0], 1.8,
        R((c - (cols - 1) / 2) * 2.4, r * 2.6 - 0.7)[1], 1.5, 1.6, 0.25, ry, '#3a4254');
    }
  }
  m.mat = 0; m.noNav = false; m.flag = 0;
}

/* 무대. 최대 규모에서만 선다. */
function stage(m, ox, oz, ry) {
  const R = at(ox, oz, ry);
  m.flag = SITE; m.noNav = true;
  m.mat = MAT.WOOD;
  m.boxY(ox, 1.1, oz, 26, 2.2, 12, ry, '#4a3a2c');
  m.mat = MAT.WALL;
  m.boxY(R(0, -6)[0], 9, R(0, -6)[1], 26, 16, 0.6, ry, '#2b3346');
  m.mat = MAT.EMIT; m.noSolid = true;
  m.boxY(R(0, -5.6)[0], 10.4, R(0, -5.6)[1], 20, 8.4, 0.2, ry, '#8fe0ff');
  // 무대 조명 여섯 대.
  for (let i = 0; i < 6; i++) {
    const p = R((i - 2.5) * 4.4, 5.4);
    m.boxY(p[0], 15.6, p[1], 1.0, 1.0, 1.0, ry, '#ffe9b8');
  }
  m.noSolid = false;
  m.mat = 0; m.noNav = false; m.flag = 0;
}

/* 전단지 탁자. 예산이 0 일 때 우리가 가진 전부다. */
function flyerTable(m, ox, oz, ry) {
  const R = at(ox, oz, ry);
  m.flag = SITE; m.noNav = true;
  m.mat = MAT.WOOD;
  m.boxY(ox, 1.5, oz, 5.0, 0.3, 2.2, ry, P.lam);
  m.mat = MAT.METAL;
  for (const s of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const p = R(s[0] * 2.1, s[1] * 0.8);
    m.box(p[0], 0.75, p[1], 0.2, 1.5, 0.2, '#5c6373');
  }
  m.mat = MAT.PAPER;
  for (let i = 0; i < 5; i++) {
    const p = R((i - 2) * 0.9, 0);
    m.boxY(p[0], 1.72, p[1], 0.8, 0.12, 1.1, ry + 0.1 * i, P.paper);
  }
  m.mat = 0; m.noNav = false; m.flag = 0;
}

/* ---------- 예산별 무대 구성 ----------
   같은 홀에 우리 부스만 달라진다. 무엇을 샀는지가 화면에 그대로 보이는 것이
   이 표의 유일한 일이다.

   카메라는 셋 다 +Z 쪽에서 −Z 를 본다 (az 0). 그래서 입구(+Z)는 카메라
   **뒤**에 서고, 관람객은 화면 뒤에서 걸어 들어와 앞으로 지나가 부스 앞에
   모인다. 거리는 홀 반지름(96)보다 한참 안쪽이라 어느 각도에서도 벽 밖으로
   나가지 않는다 — 아레나에서 딱 그 실수를 했었다. */
export const EXPO_STAGES = {
  small: {
    ko: '입구 전단지 자리', boothW: 0, boothZ: 4,
    camera: { az: 0.0, el: 0.28, dist: 30 }, lookY: 5, crowd: 8,
  },
  mid: {
    ko: '한 칸짜리 부스', boothW: 16, boothZ: -2,
    camera: { az: 0.0, el: 0.30, dist: 41 }, lookY: 6, crowd: 14,
  },
  big: {
    ko: '무대까지 딸린 대형 부스', boothW: 28, boothZ: -6,
    camera: { az: 0.0, el: 0.33, dist: 54 }, lookY: 8, crowd: 20,
  },
};

/* 전시장을 짓는다. 반환값은 그리는 데 필요한 전부다: 메시, 우리 부스의
   자리, 카메라의 기본 시점, 그림자 프러스텀, 사람이 걸어다닐 지점들. */
export function buildExpoHall(planId = 'mid') {
  const def = EXPO_STAGES[planId] || EXPO_STAGES.mid;
  const { x: ox, z: oz } = EXPO_ORIGIN;
  const m = new MeshBuilder();
  const rnd = mulberry32(0xE7C0);

  hall(m, ox, oz);
  gate(m, ox, oz);

  /* 남의 부스. 우리 것보다 작고 어둡게, 통로 양옆으로 늘어선다. 업계의
     행사라는 것이 화면에 있어야 우리 부스가 '그중 하나' 로 읽힌다. */
  const side = planId === 'big' ? 42 : 32;
  for (const k of [-1, 1]) {
    for (const rz of [-16, 2, 20, 38]) {
      booth(m, ox + k * side, oz + rz, k < 0 ? Math.PI / 2 : -Math.PI / 2,
        { w: 13, d: 9, mine: false, demos: 1 });
    }
  }

  // 우리 부스. 홀 한복판, 카메라 정면.
  const bz = oz + def.boothZ;
  const boothD = planId === 'big' ? 14 : 11;
  if (planId === 'small') {
    flyerTable(m, ox, bz, 0);
    bannerPole(m, ox - 4.6, bz + 1.4, 0, '#e8b055', 11);
    bannerPole(m, ox + 4.6, bz + 1.4, 0, '#c2354a', 11);
  } else {
    booth(m, ox, bz, 0, {
      w: def.boothW, d: boothD, mine: true,
      demos: planId === 'big' ? 4 : 2,
    });
    const px = def.boothW / 2 + 3;
    for (const k of [-1, 1]) bannerPole(m, ox + k * px, bz + boothD / 2 + 1, 0, '#e8b055', planId === 'big' ? 17 : 13);
    if (planId === 'big') {
      // 무대와 관객석. 부스 옆에 붙어서 화면을 채우되 부스를 가리지 않는다.
      stage(m, ox - 34, bz + 6, Math.PI / 2);
      seating(m, ox - 20, bz + 6, Math.PI / 2, 3, 7);
      for (const k of [-1, 1]) bannerPole(m, ox + k * px, bz - boothD / 2 + 1, 0, '#c2354a', 17);
    }
  }

  /* 사람이 설 자리. 부스 앞에 반원으로 흩어 두고, 통로에도 몇 개 둔다.
     걷는 격자를 따로 만들지 않는 이유는, 여기서는 아무도 벽을 만나지 않기
     때문이다 — 목적지가 전부 열린 바닥이다. */
  const front = bz + boothD / 2 + (planId === 'small' ? 3 : 4);
  const span = planId === 'big' ? 17 : planId === 'small' ? 7 : 11;
  const spots = [];
  for (let i = 0; i < 18; i++) {
    const t = (i / 17 - 0.5) * 2;
    spots.push({
      x: ox + t * span + (rnd() - 0.5) * 3,
      z: front + Math.abs(t) * 5 + rnd() * 6,
    });
  }
  // 통로를 지나가는 사람들. 부스에만 다 붙어 있으면 홀이 텅 비어 보인다.
  for (let i = 0; i < 10; i++) {
    spots.push({ x: ox + (rnd() - 0.5) * 52, z: oz + 20 + rnd() * 30 });
  }

  return {
    id: planId,
    def,
    mesh: m,
    origin: { x: ox, z: oz },
    /* 간판이 걸리는 자리 — 뒷벽 꼭대기(13) 바로 위. 더 올리면 화면 맨 위의
       행사 이름과 겹치고, 더 내리면 뒷벽의 금색 띠에 글자가 잠긴다. */
    booth: { x: ox, z: bz - (planId === 'small' ? 0 : boothD / 2 - 0.6), y: planId === 'small' ? 4.4 : 13.6 },
    entrance: { x: ox, z: oz + 62 },
    spots,
    camera: { ...def.camera },
    look: [ox, def.lookY, bz + boothD / 2],
    light: { center: [ox, 9, bz + 6], radius: 88 },
    crowd: def.crowd,
  };
}
