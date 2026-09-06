/* 도우미.

   개발 현장에 붙는 작은 동료들. 회사에 고용된 사람이 아니라 마스코트에
   가깝고, 하는 일은 **보스를 잡는 동안 한 번 쓰는 능력**이다.

   ── 왜 바뀌었는가
   예전 도우미는 끼워 두면 한 방 +3%, 상자 +35% 처럼 숫자에 조용히 얹히는
   물건이었다. 그러면 도우미는 화면에 있을 이유가 없다 — 장착하고 나면 다시
   볼 일이 없고, 무엇이 달라졌는지도 안 보인다. 지금은 반대다: 능력은
   **누르는 것**이고, 누르는 순간 버그가 반으로 줄거나 임팩트가 50 오른다.
   개발 현장 아래에 얼굴이 서 있는 이유가 그때 생긴다.

   ── 규칙의 크기
   한 능력은 **보스 한 마리에 한 번**이다. 공정이 셋이니 게임 한 편에 세 번.
   자리는 랭크가 열어 준다. 그래서 도우미는 팀을 대신하지 못하고, 결정적인
   순간을 한 번 사 준다.

   ── 어떻게 얻는가
   뽑기가 아니다. 코인으로 사는 물건이 아니라 **행사와 사건이 남기고 가는
   것**이다 (게임덱스 부스, 시상식, 주간 사건, 팬 편지). 그래서 도우미는
   돈을 넣으면 나오는 것이 아니라 회사가 바깥과 만난 흔적이 된다.

   순수 데이터 모듈이다. */

/* 낄 수 있는 자리. 랭크가 열어 준다. 능력이 액티브가 되면서 자리 하나의
   값이 커졌으므로 예전(5·12)보다 조금 일찍 열어 준다. */
export function helperSlots(rank) {
  if (rank >= 10) return 3;
  if (rank >= 4) return 2;
  return 1;
}

/* 능력의 종류
     bug    완성 시 붙을 버그를 비율만큼 지운다 (0.5 = 절반)
     stat   한 축을 즉시 올린다 — 개발 화면의 그 숫자에 그대로 더해진다
     stats  다섯 축 전부를 올린다
     dmg    남은 작업량을 최대치 대비 비율만큼 즉시 깎는다
     heal   팀 전원의 체력을 최대 체력 대비 비율만큼 회복한다
     crit   잠깐 동안 번뜩임 확률이 뛴다 (초)
     loot   보물상자 하나를 즉시 떨어뜨린다 */
export const HELPERS = [
  // ★1 — 흔하다. 하나씩은 다 나온다.
  {
    id: 'duck', ko: '디버그 오리', icon: '🦆', star: 1,
    skill: { kind: 'bug', value: 0.5, ko: '버그 잡기', desc: '지금 붙을 버그를 절반으로' },
  },
  {
    id: 'plant', ko: '말하는 화분', icon: '🪴', star: 1,
    skill: { kind: 'stat', stat: 'craze', value: 40, ko: '엉뚱한 한마디', desc: '화제성 +40' },
  },
  {
    id: 'mug', ko: '식지 않는 머그', icon: '☕', star: 1,
    skill: { kind: 'heal', value: 0.28, ko: '커피 한 잔', desc: '팀 체력 28% 회복' },
  },

  // ★2
  {
    id: 'robot', ko: '청소 로봇', icon: '🤖', star: 2,
    skill: { kind: 'stat', stat: 'usability', value: 50, ko: '동선 정리', desc: '조작성 +50' },
  },
  {
    id: 'brush', ko: '그림 요정', icon: '🎨', star: 2,
    skill: { kind: 'stat', stat: 'impact', value: 50, ko: '덧칠하기', desc: '임팩트(그래픽) +50' },
  },
  {
    id: 'fox', ko: '마케팅 여우', icon: '🦊', star: 2,
    skill: { kind: 'stat', stat: 'social', value: 50, ko: '입소문', desc: '소셜 +50' },
  },

  // ★3
  {
    id: 'chef', ko: '야식 셰프', icon: '🍳', star: 3,
    skill: { kind: 'heal', value: 0.6, ko: '야식 배달', desc: '팀 체력 60% 회복' },
  },
  {
    id: 'ghost', ko: '납기 유령', icon: '👻', star: 3,
    skill: { kind: 'dmg', value: 0.14, ko: '납기 압박', desc: '남은 작업량 14% 즉시 처리' },
  },
  {
    id: 'note', ko: '기획 요정', icon: '🧚', star: 3,
    skill: { kind: 'stat', stat: 'retention', value: 60, ko: '한 줄 더', desc: '지속성 +60' },
  },

  // ★4 — 여기부터는 사건이다.
  {
    id: 'dragon', ko: '아기 드래곤', icon: '🐉', star: 4,
    skill: { kind: 'crit', value: 0.35, secs: 12, ko: '불붙은 손', desc: '12초간 번뜩임 +35%p' },
  },
  {
    id: 'muse', ko: '뮤즈', icon: '🎼', star: 4,
    skill: { kind: 'stats', value: 28, ko: '영감', desc: '다섯 축 전부 +28' },
  },

  // ★5 — 거의 안 나온다.
  {
    id: 'oracle', ko: '전설의 프로듀서', icon: '🧙', star: 5,
    skill: { kind: 'all', value: 40, bug: 0.6, dmg: 0.12, ko: '한 수 지도',
      desc: '다섯 축 +40 · 버그 60% 감소 · 작업량 12% 처리' },
  },
];

export const HELPER_BY_ID = new Map(HELPERS.map((h) => [h.id, h]));

/* 겹쳐 얻으면 레벨이 오르고 능력이 세진다. 같은 도우미가 또 나왔을 때
   "이미 있는 것" 이라는 느낌이 들면 그 도우미는 다시 반갑지 않다. */
export const HELPER_LEVEL_STEP = 0.30;
export function helperLevel(count) { return Math.max(1, Math.min(5, count)); }
export function helperScale(level) { return 1 + (Math.max(1, level) - 1) * HELPER_LEVEL_STEP; }

/* 레벨이 반영된 실제 능력값. 비율로 지우는 것(버그)은 1 을 넘을 수 없으므로
   남는 쪽을 깎는 식으로 자란다. */
export function helperSkill(def, level) {
  const s = def.skill;
  const k = helperScale(level);
  const out = { ...s };
  if (s.kind === 'bug') out.value = 1 - (1 - s.value) / k;
  else if (s.kind === 'crit') { out.value = s.value * k; out.secs = s.secs; }
  else out.value = s.value * k;
  if (s.bug) out.bug = 1 - (1 - s.bug) / k;
  if (s.dmg) out.dmg = s.dmg * k;
  return out;
}

/* 능력 한 줄. 레벨이 오르면 숫자가 실제로 바뀌므로 설명도 같이 바뀐다 —
   설명이 ★1 의 값에 붙박여 있으면 레벨을 올릴 이유가 화면에 안 남는다. */
export function helperSkillText(def, level) {
  const s = helperSkill(def, level);
  const pct = (v) => Math.round(v * 100) + '%';
  switch (s.kind) {
    case 'bug': return `붙을 버그 ${pct(s.value)} 감소`;
    case 'stat': return `${STAT_LABEL[s.stat] || s.stat} +${Math.round(s.value)}`;
    case 'stats': return `다섯 축 전부 +${Math.round(s.value)}`;
    case 'dmg': return `남은 작업량 ${pct(s.value)} 즉시 처리`;
    case 'heal': return `팀 체력 ${pct(s.value)} 회복`;
    case 'crit': return `${s.secs}초간 번뜩임 +${Math.round(s.value * 100)}%p`;
    case 'all': return `다섯 축 +${Math.round(s.value)} · 버그 ${pct(s.bug)} 감소 · 작업량 ${pct(s.dmg)} 처리`;
    default: return def.skill.desc || '';
  }
}

const STAT_LABEL = {
  craze: '화제성', usability: '조작성', impact: '임팩트',
  social: '소셜', retention: '지속성',
};

/* 낀 도우미들. 능력이 액티브가 되면서 상시 배율은 전부 없앴다 — 배율과
   액티브를 같이 주면 도우미가 팀보다 세진다. 그래서 여기가 돌려주는 곱은
   전부 1 이고, project.js 는 예전과 완전히 같은 수를 만든다. `list` 만
   실제 내용이 있고, 그것이 개발 현장 아래에 서는 얼굴들이다. */
export function helperBonus(owned, slots) {
  const out = { dmg: 1, loot: 1, plan: 1, urge: 1, crit: 0, heal: 0, list: [] };
  for (const id of slots || []) {
    const def = HELPER_BY_ID.get(id);
    if (!def) continue;
    const lv = helperLevel((owned && owned[id]) || 1);
    out.list.push({ id, def, level: lv, skill: helperSkill(def, lv) });
  }
  return out;
}

/* ---------- 어디서 나오는가 ----------
   행사와 사건이 남기고 간다. `luck` 은 그 자리의 씀씀이다 — 게임덱스에
   큰돈을 쓰면 좋은 도우미가 나올 확률이 올라간다. */
export const HELPER_ODDS = { weights: [46, 27, 16, 9, 2] };

export function rollHelperStar(rnd, luck = 1) {
  const w = HELPER_ODDS.weights.map((v, i) => v * Math.pow(luck, i));
  const total = w.reduce((a, b) => a + b, 0);
  let r = rnd() * total;
  for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i + 1; }
  return 1;
}

export function drawHelper(rnd, luck = 1) {
  const star = rollHelperStar(rnd, luck);
  const pool = HELPERS.filter((h) => h.star === star);
  const list = pool.length ? pool : HELPERS;
  return list[Math.floor(rnd() * list.length)];
}
