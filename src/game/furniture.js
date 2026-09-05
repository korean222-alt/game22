/* Furniture: the catalogue, what each piece does, and where it may stand.

   The office used to arrive furnished. It no longer does — a studio now starts
   with bare floor plate and a startup grant, and every desk in the building is
   one the player bought and put somewhere. That turns the office from scenery
   into the first real spending decision: a desk is what lets you hire, so the
   opening move is always "how many people can I seat, and with what left over".

   Two numbers per piece carry the whole system:
     seats    this is a workstation; one person can be assigned to it
     comfort  contribution to the floor's 쾌적도, which feeds weekly motivation

   Prices are deliberately small next to the grant. The basics have to be
   affordable on turn one or the game opens with a wall. */

export const FURNITURE = [
  /* ---- 업무 (the things that let you hire) ---- */
  {
    id: 'desk', ko: '기본 책상', cat: 'work', price: 9000, seats: true, comfort: 1,
    w: 5.4, d: 4.6, desc: '한 명이 앉을 수 있다. 직원을 뽑으려면 책상이 먼저다.',
  },
  {
    id: 'deskDual', ko: '듀얼 모니터 책상', cat: 'work', price: 26000, seats: true, comfort: 3,
    w: 5.4, d: 4.6, desc: '모니터 두 대. 앉은 사람의 의욕이 잘 유지된다.',
  },
  {
    id: 'standDesk', ko: '스탠딩 책상', cat: 'work', price: 34000, seats: true, comfort: 4,
    w: 4.2, d: 3.4, desc: '허리가 편하다. 쾌적도가 크게 오른다.',
  },
  {
    id: 'cubeWall', ko: '파티션', cat: 'work', price: 4500, comfort: 1,
    w: 3.2, d: 3.8, desc: '자리를 나눈다. 싸고 공간을 적게 먹는다.',
  },

  /* ---- 수납 ---- */
  { id: 'shelf', ko: '책장', cat: 'store', price: 7000, comfort: 2, w: 7.2, d: 1.6, desc: '기술 서적이 꽂힌다.' },
  { id: 'fileCab', ko: '서류함', cat: 'store', price: 5000, comfort: 1, w: 4.2, d: 1.8, desc: '기획서를 쌓아둔다.' },
  { id: 'supplyShelf', ko: '비품 선반', cat: 'store', price: 6000, comfort: 1, w: 3.6, d: 1.6, desc: '사무용품 보관.' },
  { id: 'lockers', ko: '사물함', cat: 'store', price: 8000, comfort: 1, w: 5.2, d: 1.6, desc: '개인 짐을 넣는다.' },

  /* ---- 휴게 (comfort per won is best here) ---- */
  { id: 'plant', ko: '화분', cat: 'rest', price: 2500, comfort: 2, w: 2.0, d: 2.0, desc: '가장 싼 쾌적도.' },
  { id: 'plantTall', ko: '큰 화분', cat: 'rest', price: 6500, comfort: 4, w: 3.0, d: 3.0, desc: '구석을 채운다.' },
  { id: 'couch', ko: '소파', cat: 'rest', price: 14000, comfort: 5, w: 6.4, d: 3.0, desc: '앉아서 쉴 수 있다.' },
  { id: 'tableRound', ko: '원탁', cat: 'rest', price: 8000, comfort: 3, w: 3.8, d: 3.8, desc: '둘러앉아 이야기한다.' },
  { id: 'coffee', ko: '커피 머신', cat: 'rest', price: 18000, comfort: 6, w: 2.4, d: 2.0, desc: '의욕 회복이 눈에 띈다.' },
  { id: 'waterCooler', ko: '정수기', cat: 'rest', price: 7500, comfort: 3, w: 2.0, d: 2.0, desc: '작지만 확실하다.' },
  { id: 'vending', ko: '자판기', cat: 'rest', price: 22000, comfort: 6, w: 3.4, d: 2.0, desc: '야근의 친구.' },
  { id: 'rug', ko: '러그', cat: 'rest', price: 3500, comfort: 2, w: 8.0, d: 6.0, desc: '바닥만 덮는다. 위를 지나다닐 수 있다.', flat: true },

  /* ---- 전문 (each nudges one discipline) ---- */
  { id: 'whiteboard', ko: '화이트보드', cat: 'pro', price: 9000, comfort: 2, w: 6.0, d: 1.0, plan: 1, desc: '기획력이 조금 오른다.' },
  { id: 'pinBoard', ko: '게시판', cat: 'pro', price: 5500, comfort: 2, w: 5.0, d: 0.9, plan: 1, desc: '아이디어를 붙여둔다.' },
  { id: 'serverRack', ko: '서버 랙', cat: 'pro', price: 48000, comfort: 1, w: 3.0, d: 3.0, social: 1, desc: '소셜·운영에 도움이 된다.' },
  { id: 'copier', ko: '복합기', cat: 'pro', price: 26000, comfort: 1, w: 4.0, d: 3.4, desc: '출력물이 필요할 때.' },
  { id: 'phoneBooth', ko: '폰 부스', cat: 'pro', price: 32000, comfort: 5, w: 3.6, d: 3.6, desc: '조용한 통화 공간.' },

  /* ---- 수입 가구 (Kenney Furniture Kit) ----
     `kit: true` 는 "이건 절차적 박스가 아니라 모델" 이라는 표시다. 모델이
     아직 안 왔으면 상점에서 통째로 숨는다 — 돈을 냈는데 아무것도 안 보이는
     것보다는 아예 안 파는 편이 낫다. */
  {
    id: 'kitDesk', ko: '원목 책상 세트', cat: 'work', price: 15000, seats: true, comfort: 3,
    w: 5.4, d: 4.6, kit: true, desc: '모니터·키보드·의자까지 한 세트. 기본 책상보다 앉은 사람이 편하다.',
  },
  {
    id: 'kitDeskCorner', ko: 'L자 코너 책상', cat: 'work', price: 38000, seats: true, comfort: 6,
    w: 7.0, d: 7.0, kit: true, desc: '모니터 두 대가 올라가는 코너 자리. 넓은 만큼 자리를 많이 먹는다.',
  },
  { id: 'kitBookcase', ko: '오픈 책장', cat: 'store', price: 8000, comfort: 3, w: 3.2, d: 2.0, kit: true, desc: '책이 꽂힌 채로 온다.' },
  { id: 'kitCabinet', ko: '문 달린 책장', cat: 'store', price: 9500, comfort: 3, w: 3.2, d: 2.0, kit: true, desc: '안이 안 보여서 정돈돼 보인다.' },
  { id: 'kitSideTable', ko: '사이드 테이블', cat: 'store', price: 5000, comfort: 3, w: 3.8, d: 2.0, kit: true, desc: '작은 화분 셋이 올라가 있다.' },

  { id: 'kitSofa', ko: '라운지 소파', cat: 'rest', price: 16000, comfort: 7, w: 6.8, d: 3.2, kit: true, desc: '쿠션까지. 소파보다 쾌적도가 높다.' },
  { id: 'kitSofaCorner', ko: '코너 소파', cat: 'rest', price: 30000, comfort: 10, w: 7.0, d: 7.0, kit: true, desc: '구석을 통째로 휴게 공간으로 만든다.' },
  { id: 'kitRelax', ko: '안락의자', cat: 'rest', price: 12000, comfort: 5, w: 3.6, d: 4.6, kit: true, desc: '한 명이 제대로 쉰다.' },
  { id: 'kitCoffeeTable', ko: '유리 티테이블', cat: 'rest', price: 6000, comfort: 3, w: 4.6, d: 3.0, kit: true, desc: '소파 앞에 놓는다.' },
  { id: 'kitFridge', ko: '냉장고', cat: 'rest', price: 20000, comfort: 5, w: 3.2, d: 2.4, kit: true, desc: '음료를 넣어 둔다.' },
  { id: 'kitPantry', ko: '간이 주방', cat: 'rest', price: 34000, comfort: 9, w: 6.4, d: 3.4, kit: true, desc: '싱크대·커피 머신·전자레인지가 한 줄에.' },
  { id: 'kitBar', ko: '바 테이블', cat: 'rest', price: 15000, comfort: 5, w: 3.4, d: 5.0, kit: true, desc: '둘이 마주 앉아 커피를 마신다.' },
  { id: 'kitPlant', ko: '관엽 화분', cat: 'rest', price: 3000, comfort: 3, w: 2.2, d: 2.2, kit: true, desc: '잎이 넓다. 싼 쾌적도.' },
  { id: 'kitRugRound', ko: '원형 러그', cat: 'rest', price: 4000, comfort: 3, w: 6.2, d: 6.2, kit: true, desc: '바닥만 덮는다. 위를 지나다닐 수 있다.', flat: true },
  { id: 'kitLamp', ko: '플로어 램프', cat: 'rest', price: 5500, comfort: 4, w: 1.8, d: 1.8, kit: true, desc: '저녁 사무실의 색이 달라진다.' },
  { id: 'kitBear', ko: '마스코트 곰인형', cat: 'rest', price: 9000, comfort: 5, w: 2.8, d: 2.0, kit: true, desc: '회사 마스코트. 아무도 이유를 묻지 않는다.' },

  { id: 'kitTv', ko: 'TV 스탠드', cat: 'pro', price: 24000, comfort: 6, w: 5.6, d: 2.2, kit: true, desc: '시연용 대형 화면.' },
  { id: 'kitSpeaker', ko: '스피커', cat: 'pro', price: 12000, comfort: 4, w: 1.6, d: 1.6, kit: true, desc: '사운드 팀이 좋아한다.' },
  { id: 'kitCoatRack', ko: '코트 걸이', cat: 'pro', price: 4000, comfort: 2, w: 2.4, d: 2.4, kit: true, desc: '겨울에만 쓸모가 있다.' },
  { id: 'kitTrash', ko: '휴지통', cat: 'pro', price: 900, comfort: 1, w: 2.0, d: 2.0, kit: true, desc: '가장 싼 가구.' },
];

export const FURNITURE_BY_ID = new Map(FURNITURE.map((f) => [f.id, f]));

export const FURNITURE_CATS = [
  { id: 'work', ko: '업무' },
  { id: 'store', ko: '수납' },
  { id: 'rest', ko: '휴게' },
  { id: 'pro', ko: '전문' },
];

/* Selling back is lossy on purpose — placing badly should sting a little, but
   never enough to strand a studio that furnished the wrong floor. */
export const RESELL = 0.6;

/* Comfort turns into a weekly motivation drift and a small planning bonus. The
   curve saturates: a room crammed with sofas is not four times the office a
   tidy one is, and without the ceiling the cheapest strategy is to carpet every
   floor in ₩2,500 plants. */
export function comfortScore(placed) {
  let raw = 0;
  for (const p of placed || []) {
    const def = FURNITURE_BY_ID.get(p.id);
    if (def) raw += def.comfort || 0;
  }
  return raw;
}

export function comfortLevel(raw, staffCount) {
  // Measured per head: ten sofas for two people is not a nice office, it is a
  // warehouse. A studio needs roughly six comfort points per person to sit at
  // the middle of the scale.
  const per = raw / Math.max(1, staffCount);
  const t = 1 - Math.exp(-per / 7);
  return {
    raw, per,
    score: Math.round(t * 100),
    // Weekly chance that an idle staffer's motivation drifts UP instead of down.
    moodGain: t * 0.55,
    planBonus: 1 + t * 0.18,
  };
}

export function comfortLabel(score) {
  if (score >= 78) return { ko: '훌륭함', cls: 'great' };
  if (score >= 55) return { ko: '쾌적함', cls: 'good' };
  if (score >= 30) return { ko: '보통', cls: 'ok' };
  return { ko: '삭막함', cls: 'bad' };
}

/* The footprint a piece occupies once rotated. Rotation is quarter turns only,
   so a swap of width and depth is the whole of it. */
export function footprint(def, rot) {
  const swap = (rot & 1) === 1;
  return { w: swap ? def.d : def.w, d: swap ? def.w : def.d };
}

/* Two pieces overlap? Axis-aligned, because rotation is quantised. A small
   inset keeps two items that merely touch from being rejected. */
export function overlaps(a, aDef, b, bDef) {
  const fa = footprint(aDef, a.rot), fb = footprint(bDef, b.rot);
  return Math.abs(a.x - b.x) * 2 < fa.w + fb.w - 0.2
      && Math.abs(a.z - b.z) * 2 < fa.d + fb.d - 0.2;
}
