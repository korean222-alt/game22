/* The opening tutorial, as data.

   A studio starts empty — no staff, no desks, a grant and a name — which makes
   the first hour the part most likely to lose someone. So the sequence is
   written down rather than left to a wall of text: each step names one action,
   says which tab it lives in, and carries a predicate that decides when it is
   finished. Nothing here blocks the player; the panel just knows what to point
   at next, and stops pointing once you have done it.

   왜 단계가 늘었는가: 예전에는 일곱 줄이 "책상 → 채용 → 기획서 → 개발 →
   전투 → 출시" 까지만 데려다 놓고 손을 놨다. 그런데 이 게임에서 실제로
   돈이 갈리는 자리는 그 다음이다 — 상점에서 무엇을 사는가, 보물상자를
   어떻게 쓰는가, 홍보를 걸 것인가, 직원을 어느 방향으로 키우는가. 그
   자리들을 한 번도 안 가르쳐 주면 플레이어는 게임을 다 봤다고 생각하고
   나간다. 그래서 첫 출시 **이후**까지 이어지도록 늘렸다.

   `done(game)` is pure and reads only committed state, so the tutorial cannot
   drift out of step with a save that was loaded halfway through, and can be run
   in the headless flow test alongside the rest of the simulation. */

export const TUTORIAL = [
  {
    id: 'desk',
    tab: 'office',
    title: '① 책상을 사세요',
    body: '직원은 <b>앉을 자리</b>가 있어야 뽑을 수 있습니다. 사무실 탭의 <b>가구점</b>에서 기본 책상(₩9,000)을 사세요. '
      + '창업 지원금으로 책상 서너 개와 직원 서너 명이 나옵니다 — 처음부터 다 쓰지는 마세요.',
    done: (g) => g.bag.some((b) => isSeat(b.id)) || g.company.placed.some((p) => isSeat(p.id)),
  },
  {
    id: 'place',
    tab: 'bag',
    title: '② 책상을 배치하세요',
    body: '산 가구는 <b>🎒 가방 탭</b>에 들어갑니다. 거기서 <b>배치</b>를 누르고 바닥의 <b>파란 구역</b> 안에 놓으세요. '
      + '⟳ 로 돌릴 수 있고, 빨갛게 보이면 그 자리에는 못 놓습니다. 잘못 놨으면 집어서 다시 놓으면 됩니다 — 공짜입니다.',
    done: (g) => g.company.placed.some((p) => isSeat(p.id)),
  },
  {
    id: 'hire',
    tab: 'staff',
    title: '③ 직원을 채용하세요',
    body: '직원 탭에서 지원자를 뽑습니다. 지금은 <b>신입 할인</b>이 붙어 있어 싸게 뽑을 수 있습니다. '
      + '직업이 서로 다른 사람을 섞으세요 — 프로그래머는 조작성, 디자이너는 임팩트, 네트워커는 소셜을 올립니다. '
      + '없는 직업의 능력치는 <b>아예 오르지 않습니다</b>.',
    done: (g) => g.staff.length > 0,
  },
  {
    id: 'proposal',
    tab: 'dev',
    title: '④ 기획서를 뽑으세요',
    body: '개발 탭의 <b>기획서 뽑기</b>는 스태미나를 1 씁니다. 장르와 ★등급이 정해지고, '
      + '기획자가 있으면 ★가 잘 나옵니다. 마음에 안 들면 다시 뽑아도 됩니다.',
    done: (g) => g.proposals.length > 0 || !!g.project || !!g.finished || g.company.shipped > 0,
  },
  {
    id: 'develop',
    tab: 'dev',
    title: '⑤ 개발을 시작하세요',
    body: '기획서를 고르고 <b>플랫폼 · 수익 모델 · 팀</b>을 정한 뒤 <b>개발 시작</b>. '
      + '개발비와 착수 스태미나가 여기서 한 번 나갑니다 — 싸움 자체는 공짜입니다. '
      + '첫 게임은 <b>피처폰 · 유료</b>로 작게 시작하는 편이 안전합니다.',
    done: (g) => !!g.project || !!g.finished || g.company.shipped > 0,
  },
  {
    id: 'battle',
    tab: 'dev',
    title: '⑥ 아이디어를 게임으로 만드세요',
    body: '개발 현장은 <b>기획 → 제작 → 마감</b> 세 공정입니다. 공정마다 아직 형태가 없는 '
      + '<b>아이디어</b>가 한 마리씩 버티고 있고, 그 체력이 곧 <b>남은 작업량</b>입니다 — 직원들이 '
      + '알아서 만들어 나가고, 만드는 동안 자기 체력이 깎입니다. '
      + '중간에 <b>게임 내용</b>과 <b>개발 방식</b> 카드를 고르는데, 장르와 <b>궁합</b>이 좋은 내용을 고르는 것이 '
      + '완성도에 가장 크게 작용합니다. 아래 다섯 줄(화제성·조작성·임팩트·소셜·지속성)이 지금까지 쌓인 점수입니다.',
    done: (g) => !!g.finished || g.company.shipped > 0,
  },
  {
    id: 'loot',
    tab: 'bag',
    title: '⑦ 보물상자를 확인하세요',
    body: '보스를 때리다 보면 <b>🎁 보물상자</b>가 떨어집니다. ★1부터 ★5까지 있고, 별이 높을수록 좋은 물건입니다. '
      + '가방 탭에서 확인하세요 — 큰 게임을 만들수록 높은 별이 잘 나옵니다.',
    // 상자가 하나도 안 떨어진 게임이었다면 이 단계는 건너뛴다. 가방이 빈
    // 채로 "가방을 확인하세요" 를 띄우면 안내가 아니라 오작동으로 읽힌다.
    done: (g) => Object.keys(g.company.bag || {}).length > 0
      || (!!g.finished && !(g.finished.lootTotal > 0))
      || g.company.shipped > 0,
  },
  {
    id: 'release',
    tab: 'dev',
    title: '⑧ 디버그하고 출시하세요',
    body: '<b>디버그</b>로 버그를 줄이면 평론가 점수가 오릅니다(스태미나 1). '
      + '<b>홍보</b>는 개발비의 몇 배가 나가는 <b>내기</b>입니다 — 잘 나온 게임에만 거세요. '
      + '출시하면 화면에서 <b>실시간으로 팔립니다</b>. 정산을 확인해야 다음 게임을 시작할 수 있습니다.',
    done: (g) => g.company.shipped > 0,
  },
  {
    id: 'gift',
    tab: 'staff',
    title: '⑨ 직원에게 선물을 주세요',
    body: '상점의 <b>선물</b>과 보물상자에서 나온 물건을 직원에게 주면 <b>경험치</b>가 들어오고, '
      + '그 물건이 가리키는 능력치가 <b>추가로</b> 오릅니다. 화집은 그래픽, LP는 사운드 — '
      + '같은 직업 두 명을 다르게 키우는 자리입니다.',
    done: (g) => g.staff.some((s) => (s.itemsGiven || []).length > 0),
  },
  {
    id: 'shop',
    tab: 'shop',
    title: '⑩ 상점을 둘러보세요',
    body: '<b>음식</b>은 전투 중 체력, <b>음료</b>는 스태미나, <b>장비</b>는 직원에게 장착하는 영구 강화입니다. '
      + '큰 게임은 밥을 안 사주면 팀이 전부 쓰러져 <b>덜 만든 채로</b> 마감됩니다 — 그때 완성도가 깎입니다.',
    done: (g) => (g.company.spentOnShop || 0) > 0,
  },
  {
    id: 'manage',
    tab: 'company',
    title: '⑪ 운영과 계약을 보세요',
    body: '출시작은 매주 매출을 냅니다(동시 3작품까지). 자금이 마르면 <b>계약 일감</b>이 스태미나만 쓰고 '
      + '확실한 현금을 줍니다. <b>연구</b>는 게임을 낼 때마다 쌓이는 포인트로 회사를 영구히 강하게 만듭니다.',
    done: (g) => g.company.shipped >= 2 || !!g.company.contract
      || Object.keys(g.company.research || {}).length > 0,
  },
];

/* A workstation by any name. Kept here rather than importing the catalogue so
   the tutorial stays a plain data module with no cycle back into furniture. */
function isSeat(id) {
  return id === 'desk' || id === 'deskDual' || id === 'standDesk'
    || id === 'kitDesk' || id === 'kitDeskCorner';
}

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
