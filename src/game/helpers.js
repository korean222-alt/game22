/* 도우미.

   개발 현장에 붙는 작은 동료들. 회사에 고용된 사람이 아니라 마스코트에
   가깝고, 하는 일은 개발 배틀의 숫자를 조금씩 밀어 주는 것이다.

   ── 왜 있는가
   코인이 갈 곳이 소재 뽑기 하나뿐이었고, 소재를 다 모은 뒤로는 코인이
   그냥 쌓이기만 했다. 그리고 개발 화면에는 **모으는 재미**가 없었다 —
   장비는 직원 한 명에게 붙고 값이 비싸서, 초반에는 손댈 수 없는 시스템이다.
   도우미는 그 사이를 메운다: 코인으로 뽑고, 등급이 있고, 겹치면 쌓이고,
   개발 화면 아래에 얼굴이 보인다.

   ── 규칙의 크기
   효과는 **작아야 한다.** 도우미가 팀보다 세지면 게임은 직원을 키우는
   것이 아니라 뽑기를 돌리는 것이 된다. 그래서 한 마리의 효과는 한 자릿수
   퍼센트이고, 동시에 낄 수 있는 수는 랭크가 정한다.

   순수 데이터 모듈이다. */

/* 낄 수 있는 자리. 랭크가 열어 준다 — 초반에 셋을 다 끼면 뽑기의 재미가
   첫 판에 끝난다. */
export function helperSlots(rank) {
  if (rank >= 12) return 3;
  if (rank >= 5) return 2;
  return 1;
}

/* 효과의 종류
     dmg    한 방의 세기 (× 배율)
     crit   번뜩임 확률 (+절대값)
     loot   상자 확률 (× 배율)
     heal   전투 중 주기적인 회복 (최대 체력 대비 비율/초)
     urge   재촉 쿨다운 (× 배율, 작을수록 빠르다)
     plan   기획서 등급 굴림 (× 배율) */
export const HELPERS = [
  // ★1 — 흔하다. 하나씩은 다 나온다.
  { id: 'cat', ko: '사무실 고양이', icon: '🐈', star: 1, desc: '번뜩임 +2%p', crit: 0.02 },
  { id: 'plant', ko: '말하는 화분', icon: '🪴', star: 1, desc: '한 방 +3%', dmg: 1.03 },
  { id: 'mug', ko: '식지 않는 머그', icon: '☕', star: 1, desc: '재촉 쿨다운 -8%', urge: 0.92 },

  // ★2
  { id: 'duck', ko: '디버그 오리', icon: '🦆', star: 2, desc: '번뜩임 +4%p · 한 방 +2%', crit: 0.04, dmg: 1.02 },
  { id: 'robot', ko: '청소 로봇', icon: '🤖', star: 2, desc: '상자 확률 +35%', loot: 1.35 },
  { id: 'note', ko: '기획 요정', icon: '🧚', star: 2, desc: '기획서 등급 +8%', plan: 1.08 },

  // ★3
  { id: 'chef', ko: '야식 셰프', icon: '🍳', star: 3, desc: '개발 중 체력 서서히 회복', heal: 0.0055 },
  { id: 'ghost', ko: '납기 유령', icon: '👻', star: 3, desc: '한 방 +8%', dmg: 1.08 },
  { id: 'fox', ko: '마케팅 여우', icon: '🦊', star: 3, desc: '상자 확률 +60% · 번뜩임 +2%p', loot: 1.6, crit: 0.02 },

  // ★4 — 여기부터는 사건이다.
  { id: 'dragon', ko: '아기 드래곤', icon: '🐉', star: 4, desc: '한 방 +14% · 번뜩임 +5%p', dmg: 1.14, crit: 0.05 },
  { id: 'muse', ko: '뮤즈', icon: '🎼', star: 4, desc: '기획서 등급 +18% · 번뜩임 +4%p', plan: 1.18, crit: 0.04 },

  // ★5 — 거의 안 나온다.
  { id: 'oracle', ko: '전설의 프로듀서', icon: '🧙', star: 5, desc: '한 방 +20% · 번뜩임 +8%p · 재촉 쿨다운 -25%', dmg: 1.20, crit: 0.08, urge: 0.75 },
];

export const HELPER_BY_ID = new Map(HELPERS.map((h) => [h.id, h]));

/* 뽑기 값과 분포. 소재 뽑기(코인 3)보다 비싸다 — 이쪽이 영구 강화이므로. */
export const HELPER_GACHA = { coins: 5, weights: [52, 27, 14, 6, 1] };

/* 중복은 버리지 않는다. 같은 도우미를 또 뽑으면 **레벨**이 오르고, 효과가
   조금씩 세진다. 뽑기가 "이미 있는 것" 을 뱉는 순간 손해로 느껴지면
   그 뽑기는 두 번 돌리지 않게 된다. */
export const HELPER_LEVEL_STEP = 0.35;   // 레벨 1당 효과 증가분의 비율

export function helperLevel(count) { return Math.max(1, Math.min(5, count)); }

/* 레벨이 반영된 실제 효과. 배율(dmg/loot/plan)은 1 위쪽의 폭이 자라고,
   덧셈(crit/heal)은 값 자체가 자란다. 쿨다운(urge)은 1 아래쪽이므로 반대로. */
export function helperEffect(def, level) {
  const k = 1 + (level - 1) * HELPER_LEVEL_STEP;
  const out = {};
  if (def.dmg) out.dmg = 1 + (def.dmg - 1) * k;
  if (def.loot) out.loot = 1 + (def.loot - 1) * k;
  if (def.plan) out.plan = 1 + (def.plan - 1) * k;
  if (def.urge) out.urge = 1 - (1 - def.urge) * k;
  if (def.crit) out.crit = def.crit * k;
  if (def.heal) out.heal = def.heal * k;
  return out;
}

/* 낀 도우미들의 효과 합. 곱은 곱하고 덧셈은 더한다.
   상한을 두는 이유는 3.10 의 원칙과 같다 — 배율이 곱으로 쌓이는 시스템에는
   반드시 천장이 있어야 한다. */
export function helperBonus(owned, slots) {
  const out = { dmg: 1, loot: 1, plan: 1, urge: 1, crit: 0, heal: 0, list: [] };
  for (const id of slots || []) {
    const def = HELPER_BY_ID.get(id);
    if (!def) continue;
    const lv = helperLevel((owned && owned[id]) || 1);
    const e = helperEffect(def, lv);
    out.dmg *= e.dmg || 1;
    out.loot *= e.loot || 1;
    out.plan *= e.plan || 1;
    out.urge *= e.urge || 1;
    out.crit += e.crit || 0;
    out.heal += e.heal || 0;
    out.list.push({ id, def, level: lv, effect: e });
  }
  out.dmg = Math.min(1.8, out.dmg);
  out.plan = Math.min(1.6, out.plan);
  out.loot = Math.min(3.0, out.loot);
  out.urge = Math.max(0.5, out.urge);
  out.crit = Math.min(0.20, out.crit);
  out.heal = Math.min(0.02, out.heal);
  return out;
}

/* 별 하나 뽑기. data.js 의 rollStar 와 같은 모양이지만 분포가 다르므로
   여기 따로 둔다 — 두 뽑기가 같은 표를 공유하면 한쪽을 고칠 때마다
   다른 쪽이 조용히 움직인다. */
export function rollHelperStar(rnd) {
  const w = HELPER_GACHA.weights;
  const total = w.reduce((a, b) => a + b, 0);
  let r = rnd() * total;
  for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i + 1; }
  return 1;
}

export function drawHelper(rnd) {
  const star = rollHelperStar(rnd);
  const pool = HELPERS.filter((h) => h.star === star);
  const list = pool.length ? pool : HELPERS;
  return list[Math.floor(rnd() * list.length)];
}
