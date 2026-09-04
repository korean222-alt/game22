/* The opening tutorial, as data.

   A studio now starts empty — no staff, no desks, a grant and a name — which
   makes the first ten minutes the part most likely to lose someone. So the
   sequence is written down rather than left to a wall of text: each step names
   one action, says which tab it lives in, and carries a predicate that decides
   when it is finished. Nothing here blocks the player; the panel just knows
   what to point at next, and stops pointing once you have done it.

   `done(game)` is pure and reads only committed state, so the tutorial cannot
   drift out of step with a save that was loaded halfway through, and can be run
   in the headless flow test alongside the rest of the simulation. */

export const TUTORIAL = [
  {
    id: 'desk',
    tab: 'office',
    title: '책상을 사세요',
    body: '직원은 앉을 자리가 있어야 뽑을 수 있습니다. 사무실 탭의 <b>가구점</b>에서 기본 책상을 하나 사세요.',
    done: (g) => g.bag.some((b) => isSeat(b.id)) || g.company.placed.some((p) => isSeat(p.id)),
  },
  {
    id: 'place',
    tab: 'office',
    title: '책상을 배치하세요',
    body: '산 가구는 <b>가방</b>에 들어갑니다. <b>배치 모드</b>를 켜고 바닥의 파란 구역을 눌러 책상을 놓으세요. 회전은 ⟳ 버튼입니다.',
    done: (g) => g.company.placed.some((p) => isSeat(p.id)),
  },
  {
    id: 'hire',
    tab: 'staff',
    title: '직원을 채용하세요',
    body: '직원 탭에서 지원자를 뽑습니다. 지금은 <b>신입 할인</b>이 붙어 있어 싸게 뽑을 수 있습니다. 빈 책상 수만큼 뽑을 수 있습니다.',
    done: (g) => g.staff.length > 0,
  },
  {
    id: 'proposal',
    tab: 'dev',
    title: '기획서를 뽑으세요',
    body: '개발 탭의 <b>기획서 뽑기</b>는 스태미나를 1 씁니다. 장르와 ★등급이 정해집니다.',
    done: (g) => g.proposals.length > 0 || !!g.project || !!g.finished || g.company.shipped > 0,
  },
  {
    id: 'develop',
    tab: 'dev',
    title: '개발을 시작하세요',
    body: '기획서를 고르고 플랫폼·수익 모델·팀을 정한 뒤 <b>개발 시작</b>. 개발비가 듭니다.',
    done: (g) => !!g.project || !!g.finished || g.company.shipped > 0,
  },
  {
    id: 'battle',
    tab: 'dev',
    title: '아이디어를 물리치세요',
    body: '사무실에 <b>아이디어 몬스터</b>가 나타납니다. 하단의 <b>개발 진행</b>으로 HP를 0까지 깎으세요. 스태미나가 떨어지면 회사 탭에서 다음 주로 넘기면 회복됩니다.',
    done: (g) => !!g.finished || g.company.shipped > 0,
  },
  {
    id: 'release',
    tab: 'dev',
    title: '출시하세요',
    body: '버그를 디버그하고 홍보를 고른 다음 <b>출시하기</b>. 이후 운영 탭에서 주간 매출이 들어옵니다.',
    done: (g) => g.company.shipped > 0,
  },
];

/* A workstation by any name. Kept here rather than importing the catalogue so
   the tutorial stays a plain data module with no cycle back into furniture. */
function isSeat(id) { return id === 'desk' || id === 'deskDual' || id === 'standDesk'; }

/* The step the company is on, or null once the sequence is finished. Steps that
   are already satisfied are skipped, so a player who buys a desk before the
   tutorial mentions desks is not told to do it again. */
export function tutorialStep(game) {
  if (!game || game.company.tutorialDone) return null;
  for (const step of TUTORIAL) {
    if (!step.done(game)) return step;
  }
  return null;
}

export function tutorialIndex(game) {
  const step = tutorialStep(game);
  return step ? TUTORIAL.indexOf(step) : TUTORIAL.length;
}
