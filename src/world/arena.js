/* 보스 아레나의 세트장.

   예전에는 보스가 **사무실 안**, 층 도면이 통로로 비워 둔 교차점에 섰다.
   어느 층에서나 비어 있는 것이 보장된 유일한 바닥이라는 이유였는데, 화면에
   나오는 그림은 "복도 한복판에 오크가 서 있다" 였다. 규칙상 안전한 자리가
   연출상 엉뚱한 자리였던 것이다.

   그래서 싸움을 사무실 밖으로 꺼냈다. 몬스터마다 자기 세트장이 있고,
   개발에 착수하면 화면이 통째로 그 세트장으로 바뀐다. 세트는 사무실에서
   아주 멀리(ARENA_ORIGIN) 지어진다 — 좌표가 겹치지 않으므로 어느 쪽도
   상대를 알 필요가 없고, 카메라가 어디를 보느냐가 곧 어느 장면이냐가 된다.

   여기 있는 것은 지오메트리뿐이다. 규칙도, 카메라 조작도, 몬스터도 모른다.
   `buildArena(id)` 는 메시와 "보스는 여기 서고 카메라는 이렇게 본다" 를
   함께 돌려주고, main.js 가 그것을 쓴다. */

import { MeshBuilder } from '../core/meshbuilder.js';
import { MAT } from '../core/color.js';
import { mulberry32 } from '../core/math.js';
import { P } from './palette.js';

/* 사무실은 (0..64, 0..44) 에 있고 주변 스카이라인이 (32,22) 에서 반경
   230 까지 흩어져 있다. 그 어느 것과도 겹치지 않는 자리. */
export const ARENA_ORIGIN = { x: 520, z: 520 };

/* 이 좌표가 세트장 안인가. 카메라를 되돌리는 자리들이 이걸 물어본다 —
   사무실을 그리는 중에 세트장 좌표로 돌아가면 화면에 아무것도 남지 않고,
   그 빈 화면은 "게임이 죽었다" 와 구분되지 않는다. */
export function inArenaZone(x, z) {
  return Math.abs(x - ARENA_ORIGIN.x) < 300 && Math.abs(z - ARENA_ORIGIN.z) < 300;
}

const TAU = Math.PI * 2;

/* ---------- 공통 조각 ---------- */

/* 세트 전체가 SITE(플래그 4) 다. 벽 자르기도 층 자르기도 통과시키지
   않는다 — 아레나에는 '위층' 이라는 개념이 없고, 낮은 각도에서 앞벽이
   녹아 사라지면 세트장이 무너진 것처럼 보인다. */
const SITE = 4;

/* 바닥판. 지평선까지 채워서 하늘색 배경이 발밑으로 새지 않게 한다. */
function groundPlate(m, ox, oz, col, size = 300) {
  m.flag = SITE; m.noSolid = true;
  m.box(ox, -0.6, oz, size, 1.2, size, col);
  m.noSolid = false; m.flag = 0;
}

/* 원형 무대. 층이 진 원판이라 정면에서도 옆에서도 '단' 으로 읽힌다. */
function dais(m, ox, oz, r, h, col, topCol, seg = 28) {
  m.flag = SITE; m.noNav = true;
  m.mat = MAT.DEF;
  m.cyl(ox, h / 2, oz, r, h, col, seg, topCol || col);
  m.cyl(ox, h + 0.12, oz, r * 0.86, 0.24, topCol || col, seg);
  m.noNav = false; m.flag = 0; m.mat = 0;
}

/* 무대 테두리의 빛. 세트장의 윤곽을 어둠 속에서도 잡아 준다. */
function rimLights(m, ox, oz, r, y, col, n = 24) {
  m.flag = SITE; m.noSolid = true; m.mat = MAT.EMIT;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    m.box(ox + Math.cos(a) * r, y, oz + Math.sin(a) * r, 1.1, 0.22, 1.1, col);
  }
  m.mat = 0; m.noSolid = false; m.flag = 0;
}

/* 세트를 둘러싸는 벽. 하늘이 한 조각도 보이지 않게 하는 것이 목적이다 —
   보이는 순간 '멀리 떨어진 빈 땅' 이 되고, 세트장이 아니게 된다. */
function backdrop(m, ox, oz, r, h, col, seg = 18, panelGap = 0.06) {
  m.flag = SITE; m.noNav = true;
  const step = TAU / seg;
  const w = 2 * r * Math.tan(step / 2) * (1 - panelGap);
  for (let i = 0; i < seg; i++) {
    const a = i * step;
    m.boxY(ox + Math.cos(a) * r, h / 2, oz + Math.sin(a) * r, w, h, 1.4, -a, col);
  }
  m.noNav = false; m.flag = 0;
}

/* ---------- 1번 · 아이디어 냥이 : 브레인스토밍 광장 ----------
   작고 만만해 보이는 놈이니 세트도 밝고 가볍다. 화이트보드로 둘러싸인
   원형 광장, 사방에 붙은 포스트잇, 천장에서 내려온 전구. */
function buildIdeaPlaza(m, ox, oz) {
  const rnd = mulberry32(0x1DEA);
  groundPlate(m, ox, oz, P.carpetWarm);
  backdrop(m, ox, oz, 32, 26, P.wallCool, 18);
  dais(m, ox, oz, 12, 1.1, P.lam, P.woodFloor);
  rimLights(m, ox, oz, 11.5, 1.3, '#7fd8ff', 20);

  // 둘러선 화이트보드. 안쪽을 보게 세워서 회의실 벽처럼 읽힌다.
  m.flag = SITE; m.noNav = true;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + 0.31;
    const bx = ox + Math.cos(a) * 22, bz = oz + Math.sin(a) * 22;
    m.mat = MAT.METAL;
    m.boxY(bx, 1.6, bz, 0.5, 3.2, 8.4, -a, P.frame);
    m.mat = MAT.BOARD;
    m.boxY(bx, 7.4, bz, 0.5, 8.4, 11.0, -a, P.paper);
    m.mat = MAT.METAL;
    m.boxY(bx, 11.9, bz, 0.7, 0.5, 11.4, -a, P.frame);
    // 보드 위의 조명 바. 해를 등진 보드는 그냥 두면 시커먼 판이 된다.
    m.mat = MAT.EMIT; m.noSolid = true;
    m.boxY(bx - Math.cos(a) * 0.9, 12.6, bz - Math.sin(a) * 0.9, 0.5, 0.34, 10.0, -a, '#fff0d0');
    m.noSolid = false;
    // 보드에 붙은 포스트잇. 색이 섞여야 '회의가 지나간 자리' 로 보인다.
    m.mat = MAT.PAPER;
    const notes = ['#f2d75c', '#8fd98f', '#f2a2b8', '#8fc8f2'];
    for (let k = 0; k < 7; k++) {
      // 보드의 **안쪽** 면에 붙인다. 바깥 면은 아무도 볼 일이 없다.
      const u = (rnd() - 0.5) * 8.4, v = 4.4 + rnd() * 5.6;
      m.boxY(bx - Math.cos(a) * 0.35 + Math.sin(a) * u, v,
        bz - Math.sin(a) * 0.35 - Math.cos(a) * u,
        0.16, 1.25, 1.25, -a, notes[k % notes.length]);
    }
  }

  /* 연필 기둥. 무대 **밖**, 화이트보드보다 안쪽에 세운다 — 무대 위에 두면
     카메라와 보스 사이에 서서 시야를 막는다(실제로 그랬다). */
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    const px = ox + Math.cos(a) * 27, pz = oz + Math.sin(a) * 27;
    m.mat = MAT.WOOD;
    m.cyl(px, 7.0, pz, 0.9, 14.0, P.gold, 8);
    m.mat = MAT.DEF;
    m.cyl(px, 14.7, pz, 0.62, 1.5, '#e8dcc0', 8);
    m.mat = MAT.EMIT;
    m.noSolid = true;
    m.ball(px, 15.8, pz, 0.6, 0.6, 0.6, '#ffd98a', 8, 5);
    m.noSolid = false;
  }
  // 굴러다니는 종이 뭉치. 무대 가장자리에만 둬서 싸울 자리는 비운다.
  m.mat = MAT.PAPER;
  for (let i = 0; i < 9; i++) {
    const a = rnd() * TAU, r = 6 + rnd() * 5;
    m.noSolid = true;
    m.ball(ox + Math.cos(a) * r, 1.4, oz + Math.sin(a) * r, 0.5, 0.44, 0.5, P.paper, 7, 4);
    m.noSolid = false;
  }
  m.mat = 0; m.noNav = false; m.flag = 0;
}

/* ---------- 2번 · 난제 오크 : 난제의 작업장 ----------
   기획서대로는 절대 안 되는 그 부분. 공사가 멈춘 현장처럼 생겼다 —
   비계, 자재 더미, 노란 경고 띠, 아직 안 꺼진 경광등. */
function buildProblemYard(m, ox, oz) {
  const rnd = mulberry32(0x0FC);
  groundPlate(m, ox, oz, P.asphalt);
  backdrop(m, ox, oz, 40, 30, P.steelDk, 16);

  // 콘크리트 슬래브 무대. 원형이 아니라 각진 판이라 현장처럼 읽힌다.
  m.flag = SITE; m.noNav = true;
  m.mat = MAT.DEF;
  m.box(ox, 0.6, oz, 44, 1.2, 40, P.slab);
  // 경고 띠: 노랑과 검정이 번갈아 도는 테두리.
  m.noSolid = true;
  for (let i = 0; i < 44; i++) {
    const t = i / 44, col = i % 2 ? '#e8c23a' : '#26282c';
    m.box(ox - 22 + t * 44 + 0.5, 1.24, oz - 20.4, 1.0, 0.12, 1.4, col);
    m.box(ox - 22 + t * 44 + 0.5, 1.24, oz + 20.4, 1.0, 0.12, 1.4, col);
  }
  for (let i = 0; i < 40; i++) {
    const t = i / 40, col = i % 2 ? '#e8c23a' : '#26282c';
    m.box(ox - 22.4, 1.24, oz - 20 + t * 40 + 0.5, 1.4, 0.12, 1.0, col);
    m.box(ox + 22.4, 1.24, oz - 20 + t * 40 + 0.5, 1.4, 0.12, 1.0, col);
  }
  m.noSolid = false;

  // 비계 — 세트장의 벽을 대신하는 구조물. 양옆에 3단으로 세운다.
  m.mat = MAT.METAL;
  for (const sx of [-1, 1]) {
    const bx = ox + sx * 26;
    for (let lv = 0; lv < 3; lv++) {
      const y = 3.4 + lv * 5.2;
      m.box(bx, y, oz, 0.55, 0.55, 34, P.steel);           // 가로대
      m.box(bx + sx * 2.6, y, oz, 0.55, 0.55, 34, P.steel);
      m.noSolid = true;
      m.box(bx + sx * 1.3, y + 0.5, oz, 3.4, 0.4, 34, P.oakDk);   // 발판
      m.noSolid = false;
    }
    for (let i = -2; i <= 2; i++) {
      m.box(bx, 9.0, oz + i * 8, 0.5, 18, 0.5, P.steelDk);
      m.box(bx + sx * 2.6, 9.0, oz + i * 8, 0.5, 18, 0.5, P.steelDk);
    }
  }

  // 자재 더미와 서류 상자. 무대 가장자리에만 둬서 싸울 자리는 비워 둔다.
  for (let i = 0; i < 10; i++) {
    const a = rnd() * TAU, r = 13 + rnd() * 6;
    const px = ox + Math.cos(a) * r, pz = oz + Math.sin(a) * r;
    const h = 1.6 + rnd() * 2.4;
    m.mat = rnd() > 0.5 ? MAT.WOOD : MAT.DEF;
    m.boxY(px, 1.2 + h / 2, pz, 2.6, h, 3.4, rnd() * TAU, rnd() > 0.5 ? P.walnutDk : P.charcoal);
  }
  m.mat = MAT.PAPER;
  for (let i = 0; i < 6; i++) {
    const a = rnd() * TAU, r = 10 + rnd() * 8;
    m.boxY(ox + Math.cos(a) * r, 1.5, oz + Math.sin(a) * r, 2.4, 0.5, 3.0, rnd() * TAU, P.paper);
  }

  // 경광등. 붉은 점이 몇 개 돌아야 '멈춘 현장' 이 된다.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.9;
    const px = ox + Math.cos(a) * 21.5, pz = oz + Math.sin(a) * 21.5;
    m.mat = MAT.METAL;
    m.cyl(px, 3.4, pz, 0.32, 4.4, P.steelDk, 6);
    m.mat = MAT.EMIT;
    m.noSolid = true;
    m.ball(px, 6.0, pz, 0.75, 0.85, 0.75, '#ff6a4a', 8, 5);
    m.noSolid = false;
  }
  m.mat = 0; m.noNav = false; m.flag = 0;
}

/* ---------- 3번 · 마감 데몬 : 마감의 제단 ----------
   마감이 다가올수록 커지는 놈. 검은 돌 제단, 갈라진 틈에서 새어 나오는
   붉은 빛, 둘러선 달력 비석, 그리고 꺼지지 않는 화로. */
function buildDeadlineAltar(m, ox, oz) {
  const rnd = mulberry32(0xDEAD);
  groundPlate(m, ox, oz, '#1b1a1e');
  backdrop(m, ox, oz, 42, 34, '#2a2530', 20);
  dais(m, ox, oz, 23, 2.0, '#2e2a30', '#3a3138', 8);

  m.flag = SITE; m.noNav = true;

  // 제단을 가르는 균열. 방사형으로 뻗은 얇은 발광 띠.
  m.mat = MAT.EMIT; m.noSolid = true;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + 0.13;
    for (let k = 2; k < 11; k++) {
      const r = k * 2.0 + rnd() * 0.6;
      m.boxY(ox + Math.cos(a) * r, 2.16, oz + Math.sin(a) * r,
        0.5 + rnd() * 0.4, 0.10, 2.2, -a, '#ff4a2a');
    }
  }
  m.noSolid = false;

  // 달력 비석. 마감일이 새겨진 돌이라는 설정이라, 붉은 숫자 띠가 박혀 있다.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + Math.PI / 8;
    const bx = ox + Math.cos(a) * 32, bz = oz + Math.sin(a) * 32;
    const h = 15 + rnd() * 7;
    m.mat = MAT.DEF;
    m.boxY(bx, h / 2, bz, 7.0, h, 2.2, -a, '#332c36');
    m.mat = MAT.EMIT;
    m.noSolid = true;
    for (let k = 0; k < 4; k++) {
      m.boxY(bx + Math.cos(a) * -1.3, h - 3.0 - k * 2.6, bz + Math.sin(a) * -1.3,
        4.6 - k * 0.4, 0.9, 0.4, -a, k === 0 ? '#ff3a2a' : '#7a2418');
    }
    m.noSolid = false;
  }

  // 화로 넷. 무대 모서리에서 위로 빛을 던진다.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    const px = ox + Math.cos(a) * 16.5, pz = oz + Math.sin(a) * 16.5;
    m.mat = MAT.METAL;
    m.cyl(px, 3.2, pz, 0.7, 3.6, P.steelDk, 8);
    m.cyl(px, 5.2, pz, 1.3, 1.0, '#4a4048', 8);
    m.mat = MAT.EMIT;
    m.noSolid = true;
    m.ball(px, 6.0, pz, 1.0, 1.2, 1.0, '#ff9a3a', 9, 6);
    m.noSolid = false;
  }

  // 뒤로 물러선 기둥들. 세트에 깊이를 준다.
  m.mat = MAT.DEF;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + 0.31;
    m.cyl(ox + Math.cos(a) * 39, 12, oz + Math.sin(a) * 39, 2.2, 24, '#241f28', 8);
  }
  m.mat = 0; m.noNav = false; m.flag = 0;
}

/* ---------- 4번 · 버그 무리 : QA 실 ----------
   마지막 공정. 앞의 셋과 달리 여기는 **우리 사무실 안**이다 — 밤늦게
   모니터만 켜져 있는 QA 실. 빌드가 돌아가는 화면이 벽처럼 둘러서 있고,
   바닥에는 재현 절차가 적힌 종이가 깔려 있다. 세트가 작고 밝은 이유는
   이 보스가 약하기 때문이다: 무대의 크기가 곧 상대의 크기다. */
function buildQaLab(m, ox, oz) {
  const rnd = mulberry32(0xB009);
  groundPlate(m, ox, oz, '#2f343c');
  backdrop(m, ox, oz, 34, 26, '#59616e', 20);
  dais(m, ox, oz, 12, 0.9, '#3d434c', '#49505a');
  rimLights(m, ox, oz, 11.6, 1.1, '#7dff9a', 20);

  m.flag = SITE; m.noNav = true;

  /* 둘러선 모니터 벽. 두 단으로 쌓아서 '검증실' 로 읽히게 한다. 화면은
     발광이라 어두운 세트에서 이 놈의 윤곽을 잡아 주는 조명도 겸한다.

     반지름은 카메라가 서는 자리(수평 27)보다 **밖**이어야 한다. 20 이던
     동안에는 카메라가 모니터 줄 한복판에 앉아서, 화면에는 보스 대신
     검은 판이 가득 찼다. */
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU + 0.26;
    const bx = ox + Math.cos(a) * 26, bz = oz + Math.sin(a) * 26;
    m.mat = MAT.METAL;
    m.boxY(bx, 3.0, bz, 1.0, 6.0, 9.0, -a, P.steelDk);
    for (let k = 0; k < 2; k++) {
      m.mat = MAT.DEF;
      m.boxY(bx, 7.4 + k * 4.6, bz, 0.7, 4.0, 8.2, -a, P.charcoal);
      m.mat = MAT.EMIT;
      m.noSolid = true;
      // 초록 로그가 흐르는 화면. 한 줄씩 밝기를 달리해서 글자처럼 보인다.
      for (let r2 = 0; r2 < 5; r2++) {
        const w = 2.2 + rnd() * 5.0;
        m.boxY(bx - Math.cos(a) * 0.42, 8.8 + k * 4.6 - r2 * 0.72,
          bz - Math.sin(a) * 0.42, 0.14, 0.34, w, -a,
          r2 === 0 ? '#8dffb0' : (rnd() < 0.25 ? '#ff7a6a' : '#3f8f5c'));
      }
      m.noSolid = false;
    }
  }

  // 재현 절차가 적힌 종이. 무대 가장자리에만 흩어 둔다.
  m.mat = MAT.PAPER;
  m.noSolid = true;
  for (let i = 0; i < 16; i++) {
    const a = rnd() * TAU, r = 7 + rnd() * 4.5;
    m.boxY(ox + Math.cos(a) * r, 1.02, oz + Math.sin(a) * r, 1.6, 0.06, 2.1, rnd() * TAU, P.paper);
  }
  m.noSolid = false;

  /* 천장 형광등은 놓지 않는다. 무대 위를 가로지르는 판은 그림자를 통째로
     떨어뜨려서, 세트가 새까맣게 나온다 — 실제로 그렇게 나왔다. 밝기는
     둘러선 모니터 화면 스물여덟 장과 무대 테두리의 발광이 맡는다.

     대신 바닥에 빛 띠를 깐다. 위가 아니라 아래에서 올라오는 빛이라
     그림자를 만들지 않고, 심야의 검증실이라는 인상에도 맞는다. */
  m.mat = MAT.EMIT;
  m.noSolid = true;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + 0.15;
    for (let k = 3; k < 9; k++) {
      const r = 12.5 + k * 1.9;
      m.boxY(ox + Math.cos(a) * r, 0.06, oz + Math.sin(a) * r, 0.7, 0.12, 2.6, -a, '#4fe08a');
    }
  }
  m.noSolid = false;
  m.mat = 0; m.noNav = false; m.flag = 0;
}

/* ---------- 세트 목록 ----------
   `id` 는 몬스터 id 와 같다. 몬스터가 늘면 여기에 한 줄 늘리면 된다. */
export const ARENA_SETS = [
  {
    id: 'cat',
    ko: '브레인스토밍 광장',
    sub: '아이디어가 처음 튀어나오는 자리',
    build: buildIdeaPlaza,
    camera: { az: 2.42, el: 0.33, dist: 21 },
    // 이 거리로 잡을 때 화면에 알맞게 들어오는 몬스터의 키. 다른 종이
    // 서면 그 비율만큼 카메라가 물러난다 (main.js 의 arenaDist).
    refHeight: 4.2,
    lightRadius: 34,
  },
  {
    id: 'orc',
    ko: '난제의 작업장',
    sub: '기획서대로는 안 되는 그 부분',
    build: buildProblemYard,
    camera: { az: 2.10, el: 0.36, dist: 40 },
    refHeight: 7.6,
    lightRadius: 46,
  },
  {
    id: 'demon',
    ko: '마감의 제단',
    sub: '일정은 이미 늦었다',
    build: buildDeadlineAltar,
    camera: { az: 2.66, el: 0.42, dist: 32 },
    refHeight: 9.4,
    lightRadius: 50,
  },
  {
    id: 'bug',
    ko: '심야의 QA 실',
    sub: '재현 절차는 적혀 있다',
    build: buildQaLab,
    camera: { az: 2.38, el: 0.48, dist: 30 },
    refHeight: 3.4,
    lightRadius: 40,
  },
];

export const ARENA_BY_ID = new Map(ARENA_SETS.map((s) => [s.id, s]));

export function arenaSetFor(monsterId) {
  return ARENA_BY_ID.get(monsterId) || ARENA_SETS[0];
}

/* 세트 하나를 짓는다. 반환값은 그리는 데 필요한 전부다: 메시, 보스가 설
   자리, 카메라의 기본 시점, 그림자 프러스텀의 중심과 반경. */
export function buildArena(monsterId) {
  const def = arenaSetFor(monsterId);
  const { x: ox, z: oz } = ARENA_ORIGIN;
  const m = new MeshBuilder();
  def.build(m, ox, oz);
  return {
    id: def.id,
    def,
    mesh: m,
    spot: [ox, ({ orc: 1.2, demon: 2.0, bug: 0.95 })[def.id] ?? 1.1, oz],
    camera: { ...def.camera },
    refHeight: def.refHeight || 5,
    light: { center: [ox, 7, oz], radius: def.lightRadius },
  };
}
