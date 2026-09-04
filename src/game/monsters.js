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

/* A short line for the moment the fight starts, and for the moment it ends. */
export function tauntFor(def, rnd) {
  const list = def.taunts || [];
  if (!list.length) return '';
  return list[Math.floor(rnd() * list.length)];
}
