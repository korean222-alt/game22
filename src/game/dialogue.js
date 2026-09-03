/* Meeting dialogue.

   The meeting scene is the moment the numbers become people, so the lines are
   written per discipline: a programmer worries about scope, a designer about
   how it looks, a networker about servers, a planner about the hook. Templates
   take {genre} {content} {platform} {title} so a line lands on this project
   rather than sounding generic.

   Every list is picked from without replacement within one meeting, so a
   four-person team never says the same thing twice in a row. */

const T = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => (v[k] !== undefined ? v[k] : ''));

/* ---------- 착수 회의 ---------- */
const KICKOFF = {
  boss: [
    '자, {genre} 신작 갑니다. 다들 집중!',
    '이번 건 {platform} 타겟이에요. 시작해봅시다.',
    '「{title}」, 오늘부터 개발 착수합니다.',
    '{genre}로 한 방 노려봅시다.',
    '기간은 넉넉하지 않아요. 핵심부터 잡죠.',
  ],
  plan: [
    '{genre}는 초반 30초가 전부입니다. 거기 걸어요.',
    '컨셉은 잡혔어요. 문제는 어떤 소재를 붙이냐죠.',
    '레퍼런스 돌려봤는데 아직 빈 자리가 있어요.',
    '이번엔 훅을 하나만 확실하게 갑시다.',
    '{platform} 유저 취향은 제가 정리해뒀습니다.',
    '기획서 대로만 가면 승산 있어요.',
  ],
  dev: [
    '{genre}면 그 구조 재활용 가능합니다.',
    '기술적으로는 됩니다. 일정이 문제죠.',
    '프로토타입 먼저 뽑아볼게요.',
    '{platform} 최적화는 제가 붙겠습니다.',
    '그거 넣으면 일정 일주일 늘어요. 그래도 갈까요?',
    '코어 루프부터 돌려보고 판단합시다.',
  ],
  art: [
    '{genre}는 첫인상이 반이에요. 아트에 힘 줍시다.',
    '컬러 톤은 제가 두 방향 뽑아올게요.',
    '캐릭터 실루엣만 잡혀도 절반은 끝나요.',
    '사운드는 초반부터 붙여야 분위기가 나옵니다.',
    '스크린샷 잘 나오는 각도로 설계하죠.',
    '{platform}는 화면이 작아요. 아이콘 크게 갑시다.',
  ],
  net: [
    '서버 구조는 미리 잡아둬야 합니다.',
    '{genre}는 이탈률이 관건이에요. 리텐션 설계 붙일게요.',
    '친구 초대 동선 넣으면 유입이 달라집니다.',
    '동시접속 예측치 뽑아볼게요.',
    '나중에 붙이면 늦어요. 소셜은 처음부터 갑시다.',
    '{platform} 결제 연동은 제가 처리하겠습니다.',
  ],
};

/* ---------- 게임 내용 회의 ---------- */
const CONTENT = {
  boss: [
    '소재 정합시다. 의견 있는 사람?',
    '{genre}에 뭘 얹어야 터질까요.',
    '자유롭게 던져보세요.',
    '이번 소재가 승부처입니다.',
  ],
  plan: [
    '{genre}랑 붙였을 때 그림이 그려지는 쪽으로 가죠.',
    '요즘 그 소재가 다시 올라오고 있어요.',
    '안전하게 갈지, 새로 뚫을지 정해야 합니다.',
    '유저가 한 줄로 설명할 수 있어야 해요.',
    '스토어 썸네일에 뭐가 찍힐지 생각해봅시다.',
  ],
  dev: [
    '구현 난이도는 그쪽이 훨씬 낮습니다.',
    '데이터 양이 문제인데, 그건 감당 가능해요.',
    '기존 시스템 재활용하면 빨라집니다.',
    '그 소재는 콘텐츠 뽑기가 편해요.',
    '개인적으로는 두 번째가 재밌을 것 같은데요.',
  ],
  art: [
    '그림이 제일 잘 나오는 건 확실히 그쪽이에요.',
    '색감 잡기는 저쪽이 훨씬 편합니다.',
    '캐릭터 뽑을 여지가 많은 쪽으로 가죠.',
    '음악 방향도 소재 따라가야 해서요.',
    '보여줄 게 많은 소재가 좋습니다.',
  ],
  net: [
    '커뮤니티 붙기 좋은 소재가 오래 갑니다.',
    '수집 요소 넣기 좋은 쪽으로 가면 리텐션이 삽니다.',
    '공유하고 싶어지는 그림이 나와야 해요.',
    '랭킹 붙일 여지 있는지도 봐야죠.',
    '장기 운영 생각하면 확장성이 중요합니다.',
  ],
};

/* ---------- 개발 방식 회의 ---------- */
const METHOD = {
  boss: [
    '어떻게 만들지 정합시다.',
    '남은 기간 어떻게 쓸까요.',
    '속도냐 완성도냐, 골라야죠.',
    '자, 마지막 결정입니다.',
  ],
  plan: [
    '지금 시장 타이밍이 나쁘지 않아요.',
    '무리하면 다 망가집니다. 신중하게 가죠.',
    '차별화 포인트는 확실히 살려야 해요.',
    '한 군데만 깊게 파는 게 낫습니다.',
  ],
  dev: [
    '지금 밀어붙이면 버그 남습니다.',
    '리팩터링 한 번 하고 가면 뒤가 편해요.',
    '테스트 돌릴 시간은 확보해주세요.',
    '급하면 급한 대로 방법은 있습니다.',
  ],
  art: [
    '폴리싱 한 주만 더 주시면 확 달라집니다.',
    '지금 퀄리티로도 나쁘지 않아요.',
    '이펙트만 다듬어도 인상이 달라집니다.',
    '사운드 믹싱은 마지막에 몰아서 하죠.',
  ],
  net: [
    '유저 피드백 받으면서 가는 게 안전합니다.',
    '서버 부하 테스트는 꼭 하고 나가야 해요.',
    '초반 이탈만 잡으면 오래 갑니다.',
    '운영 도구도 같이 만들어두죠.',
  ],
};

/* ---------- 완성 회고 ---------- */
const WRAP = {
  boss: [
    '수고했습니다. 「{title}」 완성!',
    '다들 고생했어요. 출시 준비합시다.',
    '이 정도면 내놓을 만합니다.',
    '자, 반응 보러 갑시다.',
  ],
  plan: [
    '생각한 그림은 나왔네요.',
    '초반 훅은 확실히 살았습니다.',
    '지표 보고 다음 걸 정하죠.',
  ],
  dev: [
    '남은 버그는 리스트 정리해뒀습니다.',
    '돌아는 갑니다. 진짜로요.',
    '빌드 올렸어요. 확인해주세요.',
  ],
  art: [
    '스크린샷은 잘 나옵니다.',
    '마지막에 톤 한 번 더 잡았어요.',
    '사운드까지 다 붙었습니다.',
  ],
  net: [
    '서버 준비 끝났습니다.',
    '지표 대시보드 열어뒀어요.',
    '오픈하면 바로 모니터링 들어갑니다.',
  ],
};

const CRIT = [
  '아, 이거다!',
  '잠깐만요, 좋은 생각이!',
  '이렇게 하면 되겠는데요?',
  '오, 방금 떠올랐어요!',
  '이거 되겠어요!',
];

const BANKS = { kickoff: KICKOFF, content: CONTENT, method: METHOD, wrap: WRAP };

/* Draw one line per speaker for a meeting, without repeats. `speakers` is a
   list of { id, role } in speaking order; the first is treated as the chair. */
export function meetingScript(phase, speakers, vars, rnd) {
  const bank = BANKS[phase] || KICKOFF;
  const used = new Set();
  const draw = (role) => {
    const list = bank[role] || bank.plan;
    const fresh = list.filter((l) => !used.has(l));
    const pool = fresh.length ? fresh : list;
    const line = pool[Math.floor(rnd() * pool.length)];
    used.add(line);
    return T(line, vars);
  };
  return speakers.map((sp, i) => ({
    id: sp.id,
    text: draw(i === 0 ? 'boss' : sp.role),
    // The chair opens, then the rest follow about a second and a half apart.
    at: i === 0 ? 0.2 : 0.2 + i * 1.55,
  }));
}

export function critLine(rnd) { return CRIT[Math.floor(rnd() * CRIT.length)]; }

/* Small one-off remarks for ambient life, so a floor is not silent. */
const IDLE = [
  '커피 한 잔 하고 올게요',
  '잠깐 스트레칭 좀',
  '오늘 지표 봤어요?',
  '점심 뭐 먹죠',
  '이거 되게 잘 나왔는데요',
  '리뷰 하나 올라왔어요',
  '빌드 돌려놓고 왔습니다',
  '창밖 좋다',
];
export function idleLine(rnd) { return IDLE[Math.floor(rnd() * IDLE.length)]; }
