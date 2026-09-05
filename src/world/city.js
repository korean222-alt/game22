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
   같은 모델 네 종으로 여섯 대를 세우므로, 색까지 같으면 복사한 티가 난다.
   택시는 자기 노란색이 있으므로 그대로 둔다. */
const BODY = '#6c6c84';
const CARS = [
  { id: 'sedan', paint: '#b8483a' },
  { id: 'van', paint: '#d8d8dc' },
  { id: 'taxi', paint: null },
  { id: 'truck', paint: '#41628c' },
  { id: 'sedan', paint: '#2b3648' },
  { id: 'van', paint: '#527f52' },
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
  let n = 0;
  for (const lane of [{ z: 70, ry: Math.PI / 2 }, { z: 86, ry: -Math.PI / 2 }]) {
    for (let k = 0; k < 3; k++) {
      const car = CARS[n % CARS.length];
      n += 1;
      const x = -34 + k * 44 + (lane.ry > 0 ? 0 : 20) + rnd() * 10;
      kitPut(m, car.id, x, lane.z + (rnd() - 0.5) * 3, lane.ry, {
        s: 1.25, solid: false,
        swap: car.paint ? { [BODY]: car.paint } : undefined,
      });
    }
  }
  return true;
}
