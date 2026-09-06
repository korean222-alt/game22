/* The idea you are fighting, as a creature.

   개발 배틀 always had an enemy with hit points; it just had no body. Giving it
   one costs nothing mechanically — the monster deals no damage and changes no
   number — and buys the thing the battle bar could never show: that a feature
   phone puzzle game and a console cross-release are not the same fight.

   Which species turns up is decided by the idea's HP, so it reads as the scale
   of what you have taken on rather than as a random skin.

   Assets are Quaternius' CC0 "Ultimate Monsters" pack, repacked by
   tools/gltf2glb.mjs. Clip names are the pack's own and differ between rigs —
   the cat says HitRecieve where the humanoids say HitReact — so every name the
   code plays is listed here rather than guessed at the call site. */

export const MONSTERS = [
  {
    id: 'cat',
    ko: '아이디어 냥이',
    file: 'assets/monsters/cat.glb',
    desc: '작고 만만해 보이지만, 놓치면 도망간다.',
    height: 4.2,
    minHp: 0,
    idle: 'Idle', walk: 'Walk', attack: 'Bite_Front', hit: 'HitRecieve', death: 'Death',
    taunts: ['냐아…', '잡을 수 있겠어?', '가벼운 아이디어다냥'],
  },
  {
    id: 'orc',
    ko: '난제 오크',
    file: 'assets/monsters/orc.glb',
    desc: '기획서에 적힌 대로는 절대 안 되는 그 부분.',
    height: 7.6,
    minHp: 26000,
    idle: 'Idle', walk: 'Walk', attack: 'Punch', hit: 'HitReact', death: 'Death',
    taunts: ['그렇게 만들면 안 될 텐데', '사양이 또 바뀐다', '이 정도로 되겠나'],
  },
  {
    id: 'demon',
    ko: '마감 데몬',
    file: 'assets/monsters/demon.glb',
    desc: '마감이 다가올수록 커진다. 대작에만 나타난다.',
    height: 9.4,
    minHp: 90000,
    idle: 'Idle', walk: 'Walk', attack: 'Punch', hit: 'HitReact', death: 'Death',
    taunts: ['일정은 이미 늦었다', '이번 분기 안에 되겠나?', '버그는 내 편이다'],
  },
  /* ---- 버그 무리 ----
     마지막 공정에 서는 놈. 몸은 냥이 리그를 그대로 쓴다 — 새 팩을 받는
     값보다, 작고 빠르고 혼자서는 아무것도 못 하는 실루엣이 '버그' 라는
     말에 더 맞는다. 크기를 줄여서 앞의 세 마리와 한눈에 구분되게 했다.

     `minHp: Infinity` 는 이 놈이 **체력으로는 절대 뽑히지 않는다**는 뜻이다.
     버그 보스는 스테이지가 부르는 자리에만 서고, 예전 monsterFor 의 사다리는
     건드리지 않는다. */
  {
    id: 'bug',
    ko: '버그 무리',
    file: 'assets/monsters/cat.glb',
    desc: '급하게 덮은 자리마다 한 마리씩 기어 나온다.',
    height: 3.4,
    minHp: Infinity,
    idle: 'Idle', walk: 'Walk', attack: 'Bite_Front', hit: 'HitRecieve', death: 'Death',
    taunts: ['재현이 안 될걸', '내 탓 아니야', '한 마리만 더…'],
  },

  /* ---- 나중에 들어온 네 마리 ----
     Quaternius 의 같은 리그를 쓰는 CC0 캐릭터들이다. 클립 이름이 냥이와
     같아서(Bite_Front / HitRecieve) 보스 코드는 한 줄도 안 바뀐다.

     이 넷은 `minHp: Infinity` 다 — 체력 사다리(monsterFor)로는 절대 뽑히지
     않고, **스테이지가 제비뽑기로 부를 때만** 선다. 그래야 한 판의 4연전이
     매번 같은 얼굴이 아니게 되면서도, 옛 세이브의 사다리는 그대로 돈다. */
  {
    id: 'chicken',
    ko: '기획 병아리',
    file: 'assets/monsters/chicken.glb',
    desc: '아직 아무것도 아닌 기획. 그런데 시끄럽다.',
    height: 4.0,
    minHp: Infinity,
    idle: 'Idle', walk: 'Idle', attack: 'Bite_Front', hit: 'HitRecieve', death: 'Death',
    taunts: ['삐약', '이거 재밌겠는데?', '한 줄만 더 적어 봐'],
  },
  {
    id: 'bee',
    ko: '잡생각 벌떼',
    file: 'assets/monsters/bee.glb',
    desc: '하나씩은 아무것도 아닌데 떼로 온다.',
    height: 3.8,
    minHp: Infinity,
    // 벌은 걷지 않는다. 팩에 Idle 이 없어서 Flying 이 그 자리를 대신한다 —
    // 없는 클립을 넣으면 SkinnedInstance 가 첫 프레임에서 멈춘 채로 선다.
    idle: 'Flying', walk: 'Flying', attack: 'Bite_Front', hit: 'HitRecieve', death: 'Death',
    taunts: ['그것도 넣을까?', '이것도 넣자', '아 그거 어떻게 하더라'],
  },
  {
    id: 'alien',
    ko: '외계 사양',
    file: 'assets/monsters/alien.glb',
    desc: '누가 썼는지 모르는 요구사항. 말이 안 통한다.',
    height: 7.4,
    minHp: Infinity,
    idle: 'Idle', walk: 'Idle', attack: 'Bite_Front', hit: 'HitRecieve', death: 'Death',
    taunts: ['…?', '그건 원래 그렇게 되는 겁니다', '문서에 적혀 있는데요'],
  },
  {
    /* 버그 자리의 다른 얼굴. 몸은 벌이고 크기만 더 작다 — 마지막 공정에
       설 놈이 매번 같은 실루엣이면 4연전의 마지막 칸만 늘 같은 그림이다. */
    id: 'bugBee',
    ko: '버그 벌레떼',
    file: 'assets/monsters/bee.glb',
    desc: '덮은 자리마다 한 마리씩 날아오른다.',
    height: 3.2,
    minHp: Infinity,
    idle: 'Flying', walk: 'Flying', attack: 'Bite_Front', hit: 'HitRecieve', death: 'Death',
    taunts: ['재현이 안 될걸', '이건 사양입니다', '한 마리만 더…'],
  },
];

export const MONSTER_BY_ID = new Map(MONSTERS.map((m) => [m.id, m]));

/* The species a project's idea wears. Highest threshold at or below the
   project's HP wins, so the ladder extends by adding a row rather than by
   editing a chain of comparisons. */
export function monsterFor(project) {
  if (!project) return MONSTERS[0];
  const hp = project.hpMax || 0;
  let pick = MONSTERS[0];
  for (const m of MONSTERS) if (hp >= m.minHp) pick = m;
  return pick;
}

/* 연전에서는 종류를 체력으로 고르지 않는다. 스테이지가 곧 사다리다 —
   장르 보스는 냥이, 조합 보스는 오크, 마감은 데몬, 그리고 마지막이 버그
   무리다. 넷을 차례로 잡는 구조 자체가 눈에 보여야 하기 때문이다. */
export function monsterForStage(project) {
  if (!project || !project.stages) return monsterFor(project);
  const st = project.stages[Math.min(project.stage || 0, project.stages.length - 1)];
  return (st && MONSTER_BY_ID.get(st.species)) || monsterFor(project);
}

/* 그 공정의 **무대** id. 세트장은 몬스터가 아니라 공정의 것이다 — 기획
   단계는 누가 서 있든 브레인스토밍 광장이고, 마지막은 누가 서 있든 QA 실.
   옛 세이브에는 set 칸이 없으므로 종족으로 되돌아간다(그 시절엔 같은 값이었다). */
export function stageSetOf(project) {
  if (!project || !project.stages) return 'cat';
  const st = project.stages[Math.min(project.stage || 0, project.stages.length - 1)];
  return (st && (st.set || st.species)) || 'cat';
}

/* ---------- 제비뽑기 ----------
   4연전의 네 칸은 각자 **후보 목록**을 갖는다. 착수할 때 한 번 뽑고 그 결과가
   프로젝트에 박히므로, 같은 게임을 다시 들어가도 상대는 안 바뀐다 — 세이브를
   불러도, 화면을 껐다 켜도 같다.

   칸마다 크기가 다른 놈들만 모여 있는 것이 요령이다. 첫 칸은 작고 만만한
   것들, 두 번째는 중간, 세 번째는 큰 놈, 마지막은 벌레. 무작위가 "이번엔
   왜 데뷔작에 마감 데몬이 나오지" 로 읽히면 그건 무작위가 아니라 고장이다. */
export const STAGE_SPECIES = [
  ['cat', 'chicken', 'bee'],
  ['orc', 'alien', 'chicken'],
  ['demon', 'alien', 'orc'],
  ['bug', 'bugBee'],
];

export function rollStageSpecies(i, rnd) {
  const pool = STAGE_SPECIES[Math.max(0, Math.min(STAGE_SPECIES.length - 1, i))];
  if (!pool || !pool.length) return 'cat';
  const r = typeof rnd === 'function' ? rnd() : Math.random();
  return pool[Math.floor(r * pool.length) % pool.length];
}

/* A short line for the moment the fight starts, and for the moment it ends. */
export function tauntFor(def, rnd) {
  const list = def.taunts || [];
  if (!list.length) return '';
  return list[Math.floor(rnd() * list.length)];
}
