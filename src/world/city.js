/* 창밖의 도시.

   사옥 둘레에 이웃 건물과 길 위의 차를 세운다. 순수 장식이다 — 걷기 격자도
   배치 구역도 이 파일을 모른다.

   ── 왜 저폴리 팩인가
   Kenney City Kit 은 같은 건물을 두 벌로 싣고 온다: 제대로 만든 `building-*`
   (한 채 2,200~10,500 삼각형) 과 실루엣용 `low-detail-building-*` (124~756).
   창밖 200 유닛 밖의 실루엣에 만 단위 삼각형을 쓰는 것은 폰에서 그대로
   프레임이므로, 기본은 저폴리 쪽이고 길 건너 두 채만 제대로 된 모델이다.
   차 여섯 대까지 합쳐 2만 5천 삼각형 — 사무실을 다섯 층까지 올려도 표가
   나지 않는 양이다.

   ── 톤
   팩의 건물은 아주 밝은 라벤더 회색이라, 이 게임의 밝은 조명 아래에서는
   전부 흰 덩어리로 날아간다. 그래서 이웃마다 다른 `tint` 를 준다: 가까울수록
   진하고 멀수록 옅게. 대기원근이 붙으면서 도시가 평면이 아니라 깊이를 가진
   것으로 읽힌다.

   ── 좌표
   사옥은 x 0..66 · z 0..46 이고, 길은 z 78 을 따라 X 방향으로 흐른다
   (office.js 의 buildSite 참고). 그래서 이웃은 **길을 비우고** 둘러선다.
   그러지 않으면 길 한가운데 건물이 서고, 1인칭으로 로비에서 내다보는 유일한
   트인 방향이 막힌다. */

import { mulberry32 } from '../core/math.js';
import { kitPut, kitReady } from './kit.js';
import { P } from './palette.js';

/* 사옥 한가운데. 이웃은 이 점을 둘러선다. */
const CX = 32, CZ = 22;
/* 길의 중심선과 반폭. buildSite 의 아스팔트 상자와 같은 값이어야 한다. */
const ROAD_Z = 78, ROAD_HALF = 23;

/* 저폴리 이웃들. 전부 20×20 바닥에 높이만 다르다. */
const TOWERS = [
  'low-detail-building-a', 'low-detail-building-b', 'low-detail-building-c',
  'low-detail-building-d', 'low-detail-building-e', 'low-detail-building-f',
  'low-detail-building-g', 'low-detail-building-i', 'low-detail-building-j',
  'low-detail-building-k', 'low-detail-building-l', 'low-detail-building-m',
];
/* 낮고 넓은 것들. 전부 탑이면 도시가 아니라 묘비밭이 된다. */
const BLOCKS = ['low-detail-building-wide-a', 'low-detail-building-wide-b', 'low-detail-building-n'];

/* 길 위의 차. `paint` 는 팩의 차체 색(#6c6c84)을 바꿔 칠할 색이다 —
   같은 모델이 여러 번 서므로 색까지 같으면 복사한 티가 난다. 택시·경찰차·
   구급차는 자기 도색이 있으므로 그대로 둔다. */
const BODY = '#6c6c84';
/* 길 위를 달리는 것들. 같은 모델을 색만 바꿔 여섯 대 세우던 시절에는 그게
   여섯 대가 아니라 한 대가 여섯 번 보이는 것이었다 — 창밖의 직선 도로는
   그 반복을 정확히 들킨다. 이제 아홉 종이라 줄을 세워도 반복이 안 보인다.
   경찰차·구급차는 제 색이 있으므로 칠하지 않는다. */
const CARS = [
  { id: 'sedan', paint: '#b8483a' },
  { id: 'van', paint: '#d8d8dc' },
  { id: 'taxi', paint: null },
  { id: 'truck', paint: '#41628c' },
  { id: 'suv', paint: '#2b3648' },
  { id: 'hatchback-sports', paint: '#e0a83c' },
  { id: 'police', paint: null },
  { id: 'delivery', paint: '#8a5a3c' },
  { id: 'sedan', paint: '#527f52' },
  { id: 'van', paint: '#5a4a6a' },
  { id: 'ambulance', paint: null },
  { id: 'suv', paint: '#a8b0b8' },
];
/* 갓길에 세워 둔 것들. 달리는 것과 달리 방향이 제각각이라 도시가 정지
   화면이 아니라 '지금 사람이 사는 곳' 으로 읽힌다. */
const PARKED = [
  { id: 'sedan', paint: '#6a7a8c' },
  { id: 'hatchback-sports', paint: '#b8483a' },
  { id: 'van', paint: '#c8c4b8' },
  { id: 'suv', paint: '#3c4a3c' },
  { id: 'truck', paint: '#8a7a4a' },
  { id: 'taxi', paint: null },
  { id: 'sedan', paint: '#2e3138' },
  { id: 'delivery', paint: '#4a6a8a' },
];

/* 이 자리가 길 위인가. 길 위에는 건물을 세우지 않는다. */
const onRoad = (z) => Math.abs(z - ROAD_Z) < ROAD_HALF + 11;

/* 거리에 따른 톤. 가까운 것은 진하고 먼 것은 옅다. */
const tintFor = (r) => 0.92 - Math.min(0.28, (r - 90) / 700);

/* 도시를 짓는다. 키트가 아직 안 왔으면 false 를 돌려주고, 부르는 쪽이
   예전의 절차적 상자 스카이라인으로 되돌아간다 — 첫 실행에서 네트워크가
   느리다고 창밖이 빈 회색 판이 되면 안 된다. */
export function buildCity(m) {
  if (!kitReady('city')) return false;
  const rnd = mulberry32(90210);

  // ── 길 건너 한 줄 ──
  // 창에서 가장 가깝고 가장 많이 보이는 줄이다. 사옥과 나란히 세워야
  // 도시가 격자로 읽힌다.
  for (let x = -52; x <= 124; x += 25) {
    const wide = rnd() < 0.34;
    const id = wide ? BLOCKS[Math.floor(rnd() * BLOCKS.length)]
      : TOWERS[Math.floor(rnd() * TOWERS.length)];
    const s = wide ? 0.75 + rnd() * 0.3 : 0.42 + rnd() * 0.35;
    /* 길 북쪽 갓길(z 101)에서 한참 물러선다. 바짝 붙여 놓으면 카메라를
       돌리는 동안 이웃이 사옥과 카메라 사이에 들어와 화면을 막는다 —
       SITE 플래그는 벽 자르기의 예외라 녹지도 않는다. */
    kitPut(m, id, x + (rnd() - 0.5) * 6, 128 + rnd() * 18, 0,
      { s, solid: false, tint: 0.80 + rnd() * 0.10 });
  }

  // ── 길 건너 랜드마크 두 채 ──
  // 여기만 제대로 된 모델을 쓴다. 하나는 낮은 상가, 하나는 탑 — 실루엣에
  // 높이 차이가 있어야 도시가 평평해 보이지 않는다.
  kitPut(m, 'building-c', -12, 126, 0, { s: 0.9, solid: false, tint: 0.86 });
  kitPut(m, 'building-skyscraper-a', 104, 152, 0, { s: 0.78, solid: false, tint: 0.82 });

  // ── 둘레 ──
  // 사옥을 둘러싼 고리. 길 쪽은 비운다.
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2 + rnd() * 0.22;
    // 광장(가로 260)의 바깥에서 시작한다. 안쪽에 서면 우리 마당에 남의
    // 건물이 들어선 것처럼 보인다.
    const r = 148 + rnd() * 118;
    const bx = CX + Math.cos(a) * r;
    const bz = CZ + Math.sin(a) * r;
    if (onRoad(bz) && bx > -110 && bx < 180) continue;
    const tall = rnd() < 0.72;
    const id = tall ? TOWERS[Math.floor(rnd() * TOWERS.length)]
      : BLOCKS[Math.floor(rnd() * BLOCKS.length)];
    // 멀수록 크게. 지평선 쪽이 낮으면 도시가 접시처럼 보인다.
    const s = (tall ? 0.5 : 0.8) + (r / 260) * 0.7 + rnd() * 0.3;
    kitPut(m, id, bx, bz, 0, { s, solid: false, tint: tintFor(r) * (0.94 + rnd() * 0.12) });
  }

  // ── 길 위의 차 ──
  // 두 차선. 남쪽 차선(z 70)은 +X, 북쪽 차선(z 86)은 −X 를 향한다.
  // ry=0 이 로컬 +Z → 월드 +Z 이므로, +X 를 보게 하려면 ry = +PI/2 다.
  //
  // 세 대씩 여섯 대이던 것을 차선마다 일곱 대로 늘렸다. 여섯 대는 200 유닛
  // 짜리 길에서 33 유닛에 한 대라, 창밖이 '도로' 가 아니라 '차 몇 대가 있는
  // 공터' 였다. 간격을 좁히되 완전히 고르게 두지는 않는다 — 실제 도로는
  // 늘 어딘가가 밀려 있다.
  let n = 0;
  for (const lane of [{ z: 70, ry: Math.PI / 2 }, { z: 86, ry: -Math.PI / 2 }]) {
    for (let k = 0; k < 7; k++) {
      const car = CARS[n % CARS.length];
      n += 1;
      const x = -70 + k * 27 + (lane.ry > 0 ? 0 : 13) + rnd() * 9;
      kitPut(m, car.id, x, lane.z + (rnd() - 0.5) * 2.4, lane.ry, {
        s: 1.25, solid: false,
        swap: car.paint ? { [BODY]: car.paint } : undefined,
      });
    }
  }

  // ── 갓길에 세워 둔 차 ──
  // 우리 쪽 인도(z 53) 앞에 나란히 선다. 달리는 차와 같은 방향이라
  // 주차한 것으로 읽히고, 로비 유리 바로 밖이라 가장 크게 보인다.
  for (let k = 0; k < PARKED.length; k++) {
    const car = PARKED[k];
    const x = -34 + k * 27 + rnd() * 6;
    if (x > 12 && x < 58) continue;              // 정문과 횡단보도 앞은 비운다
    // 연석(z 54.6) 바로 안쪽. 인도 위에 세우면 차가 보도블록을 밟고 서 있다.
    kitPut(m, car.id, x, 59 + (rnd() - 0.5) * 1.6, Math.PI / 2 + (rnd() - 0.5) * 0.06, {
      s: 1.25, solid: false,
      swap: car.paint ? { [BODY]: car.paint } : undefined,
    });
  }

  buildStreet(m, rnd);
  return true;
}

/* ══════════════════════ 길바닥 ══════════════════════

   아스팔트 상자 하나가 '도로' 였다. 위에서 보면 회색 띠 하나라, 차가 그
   위에 놓여 있을 뿐 달리는 길로는 안 보였다. 도로가 도로로 읽히는 데 필요한
   것은 폭이 아니라 **선과 가장자리**다: 가운데 노란 선, 차선 사이의 흰
   점선, 양쪽 연석, 그 위의 인도, 인도 위의 가로등과 신호등.

   전부 납작한 상자다. 삼각형 몇 백 개로 창밖이 도시가 된다. */
function buildStreet(m, rnd) {
  const Z = ROAD_Z;
  const X0 = -110, X1 = 180;
  /* 부르는 쪽(buildSite)이 팩 건물 때문에 머티리얼을 WALL 로 눌러 놓았다.
     여기서는 색이 재질을 정해야 한다 — 가로등 머리는 발광이고 기둥은 금속인데
     둘 다 벽이 되면 밤낮으로 같은 회색 막대다. 나갈 때 원래대로 돌려놓는다.

     `noSolid` 는 건드리지 않는다. 창밖의 것은 하나도 충돌체가 아니고(첫
     출근에서 사장이 보도를 걷는다), 여기서 켰다가 끄면 그 규칙이 이 함수
     안에서만 조용히 깨진다. */
  const prevMat = m.mat;
  m.mat = 0;

  // ── 인도 ──
  // 길 양쪽. 아스팔트(반폭 23)보다 한 뼘 높다.
  for (const z of [Z - 30, Z + 30]) {
    m.box((X0 + X1) / 2, -0.1, z, X1 - X0, 1.1, 14, P.curb);
  }
  // 연석 — 인도와 아스팔트가 만나는 선. 여기 그림자가 지면서 도로에 깊이가 생긴다.
  for (const z of [Z - 23.4, Z + 23.4]) {
    m.box((X0 + X1) / 2, 0.1, z, X1 - X0, 1.4, 1.6, P.extTrim);
  }

  // ── 가운데 노란 선 ──
  m.box((X0 + X1) / 2, 0.02, Z - 0.7, X1 - X0, 0.12, 0.7, P.laneY);
  m.box((X0 + X1) / 2, 0.02, Z + 0.7, X1 - X0, 0.12, 0.7, P.laneY);

  // ── 차선 점선 ──
  // 8 유닛 긋고 7 유닛 쉰다. 자동차 한 대(10 유닛)와 비슷한 간격이라
  // 차가 지나가는 속도를 눈이 짐작할 수 있는 눈금이 된다.
  for (const z of [Z - 11.5, Z + 11.5]) {
    for (let x = X0; x < X1; x += 15) {
      m.box(x + 4, 0.02, z, 8, 0.12, 0.6, P.lane);
    }
  }

  // ── 횡단보도 ──
  // 정문 바로 앞. 로비에서 내다보면 사람이 건널 자리가 보인다.
  for (let i = 0; i < 9; i++) {
    m.box(20 + i * 3.4, 0.03, Z, 2.0, 0.14, 45, P.walkStripe);
  }

  // ── 가로등 ──
  // 인도 안쪽 줄. 기둥 하나에 팔 하나, 그 끝에 발광 머리.
  for (let x = -84; x <= 168; x += 42) {
    for (const [z, dir] of [[Z - 27, 1], [Z + 27, -1]]) {
      m.box(x, 7.4, z, 0.9, 15, 0.9, P.pole);
      m.box(x, 14.6, z + dir * 2.4, 0.7, 0.7, 5.2, P.pole);
      m.box(x, 14.1, z + dir * 4.8, 2.4, 0.9, 1.6, P.lampHead);
    }
  }

  // ── 신호등 ──
  // 횡단보도 양쪽에 하나씩. 세 알이 세로로 붙는다.
  for (const [x, z] of [[17, Z - 26], [44, Z + 26]]) {
    m.box(x, 6.0, z, 0.8, 12, 0.8, P.pole);
    m.box(x, 12.6, z, 1.9, 5.2, 1.4, P.charcoal);
    m.box(x, 14.2, z + 0.75, 1.1, 1.1, 0.3, P.signRed);
    m.box(x, 12.6, z + 0.75, 1.1, 1.1, 0.3, P.signAmber);
    m.box(x, 11.0, z + 0.75, 1.1, 1.1, 0.3, P.signGreen);
  }

  // ── 버스 정류장 ──
  // 지붕 하나와 벤치 하나. 길 건너 인도에 선다.
  const bx = 96, bz = Z + 28;
  m.box(bx, 5.6, bz, 0.7, 11, 0.7, P.pole);
  m.box(bx + 11, 5.6, bz, 0.7, 11, 0.7, P.pole);
  m.box(bx + 5.5, 11.4, bz, 13, 0.7, 6.4, P.busStop);
  m.box(bx + 5.5, 2.2, bz - 1.4, 11, 0.6, 2.2, P.oak);

  // ── 가로수와 화단 ──
  // 인도 바깥 줄. 가로등과 어긋나게 세워야 줄이 두 겹으로 보인다.
  for (let x = -66; x <= 162; x += 42) {
    for (const z of [Z - 33, Z + 33]) {
      const h = 9 + rnd() * 4;
      m.box(x, h / 2, z, 1.1, h, 1.1, P.trunk);
      m.box(x, h + 2.6, z, 7.5 + rnd() * 2, 6.2, 7.5 + rnd() * 2, P.hedge);
    }
  }
  m.mat = prevMat;
}
