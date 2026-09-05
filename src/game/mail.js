/* 편지함.

   회사로 오는 편지가 모이는 곳이다. 편지는 세 가지 일을 한다.

     1. 돈이나 물건을 **들고 온다**. 창업 축하 편지에 개발비가 들어 있고,
        시상식 상금도, 게임덱스 정산도 편지로 온다. 자금이 늘어난 이유가
        토스트 한 줄로 지나가 버리는 대신, 읽고 받는 동작이 붙는다.
     2. 회사 밖에 **사람이 있다는 것**을 보여준다. 잘 만든 게임에는 유저가
        편지를 쓴다. 숫자로만 늘던 팬이 문장을 갖는 유일한 자리다.
     3. 놓친 일을 **나중에 확인할 수 있게** 한다. 시상식도 대회도 주를
        넘기는 사이에 지나가지만, 편지는 남는다.

   순수 데이터 모듈이다. 편지를 만들어 돌려줄 뿐, Game 을 건드리지 않는다 —
   보관과 수령은 state.js 가 한다. */

/* 편지함이 들고 있는 최대 통수. 넘치면 오래된 것부터 지운다.
   단, 아직 안 받은 선물이 붙어 있거나 자물쇠가 걸린 편지는 지우지 않는다. */
export const MAIL_CAP = 40;

/* ---------- 창업 축하 ----------
   창업 지원금과 별개로 오는 개발비다. 액수를 작게 잡은 이유가 있다:
   이 돈은 "책상 두 개를 더 살 수 있다" 정도여야, 편지를 여는 행동이
   첫 판의 선택 하나로 이어진다. 지원금만큼 크면 편지가 아니라 두 번째
   창업이 된다. */
export const WELCOME_GRANT = 20000;

export function welcomeMail(company, at) {
  return {
    kind: 'welcome',
    from: '곰 거주 최비서',
    icon: '📨',
    title: '개발비를 조금 보탰어요',
    at,
    body: `「${company.name}」 설립 축하드립니다!\n\n`
      + '창업 지원금만으로는 책상도 사람도 빠듯하다는 걸 아니까,\n'
      + '제 몫으로 나온 회식비를 개발비로 돌렸습니다.\n'
      + '치킨 대신 책상을 사세요. 저는 이미 혼자 먹었습니다.\n\n'
      + '앞으로도 잘 부탁드려요!',
    gift: { money: WELCOME_GRANT },
  };
}

/* ---------- 유저 편지 ----------
   잘 나온 게임에만 온다. 문장은 게임의 어느 축이 높았는지에 따라 고른다 —
   "재밌어요" 한 줄이 모든 게임에 붙으면 그건 편지가 아니라 알림이다. */
const FAN_NAMES = [
  '중2 게이머 민준', '야근하는 회사원 A', '지하철 3호선 승객', '누워서 하는 사람',
  '자칭 얼리어답터', '리뷰만 3천 개 쓴 사람', '초등학교 5학년', '게임 카페 사장',
  '새벽 4시의 대학생', '아이 재우고 하는 엄마', '통학버스의 고3', '편의점 야간 알바',
];

const FAN_LINES = {
  craze: [
    '친구들 단톡방이 이 게임 얘기밖에 안 해요. 제가 제일 먼저 깔았습니다.',
    '출근길에 옆자리 사람도 이거 하고 있더라고요. 뭔가 이상한 기분이었어요.',
  ],
  usability: [
    '한 손으로 되는 게 제일 좋아요. 손잡이 잡고도 됩니다.',
    '설명서 없이 3분 만에 이해했어요. 이런 게 잘 만든 거죠.',
  ],
  impact: [
    '마지막 장면에서 진짜로 소리를 냈습니다. 지하철이었는데요.',
    '스크린샷 찍어서 배경화면 했어요. 이런 적 처음입니다.',
  ],
  social: [
    '길드 사람들이랑 매일 만나요. 이제 게임보다 사람 보러 켭니다.',
    '동생이랑 같이 하다가 몇 년 만에 대화했습니다. 고맙습니다.',
  ],
  retention: [
    '벌써 넉 달째 매일 접속 중입니다. 출석 보상보다 그냥 하고 싶어서요.',
    '지웠다가 다시 깔았습니다. 세 번째예요.',
  ],
};

/* 편지에 딸려 오는 선물. 유저가 보내는 것이니 대단한 물건은 아니다 —
   먹을 것과 응원, 그리고 아주 가끔 코인. */
const FAN_GIFTS = [
  { item: 'onigiri', n: 2, note: '야식 하시라고 삼각김밥 보냅니다' },
  { item: 'ramen', n: 2, note: '컵라면 두 개 넣었어요' },
  { item: 'cancoffee', n: 2, note: '캔커피는 개발자의 피라고 들었습니다' },
  { item: 'bento', n: 1, note: '도시락 하나 부칩니다. 챙겨 드세요' },
  { item: 'figure', n: 1, note: '제가 만든 피규어예요. 책상에 놔 주세요' },
  { item: 'cake', n: 1, note: '조각 케이크입니다. 다 같이 드세요' },
];

/* 편지가 오는가. 재미가 높을수록, 유저가 많을수록 잘 온다. 한 게임에서
   몇 통까지만 오게 막는 것은 state 쪽 일이다. */
export function fanMailChance(fun, users) {
  if (fun < 90) return 0;
  const byFun = Math.min(0.34, (fun - 90) / 900);
  const byUsers = Math.min(0.16, users / 600000);
  return byFun + byUsers;
}

export function fanMail(release, fun, topStat, rnd, at) {
  const name = FAN_NAMES[Math.floor(rnd() * FAN_NAMES.length)];
  const lines = FAN_LINES[topStat] || FAN_LINES.craze;
  const line = lines[Math.floor(rnd() * lines.length)];
  const g = FAN_GIFTS[Math.floor(rnd() * FAN_GIFTS.length)];
  // 코인은 가끔만. 매번 붙으면 편지가 화폐 배급구가 된다.
  const coins = rnd() < 0.25 ? 1 + Math.floor(rnd() * 2) : 0;
  return {
    kind: 'fan',
    from: name,
    icon: '💌',
    title: `「${release.title}」 정말 재밌어요`,
    at,
    body: `${line}\n\n`
      + `${g.note}. 다음 작품도 기다릴게요!\n\n`
      + `— ${name} 드림`,
    gift: { items: [{ id: g.item, n: g.n }], coins, fans: Math.max(20, Math.round(release.users * 0.004)) },
  };
}

/* ---------- 다운로드 기념비 ----------
   회사 전체의 누적 다운로드가 자릿수를 바꿀 때 온다. 게임 하나의 성적이
   아니라 회사가 여기까지 왔다는 표시라, 보내는 사람은 늘 비서다. */
export const DL_MARKS = [
  { at: 100000, ko: '10만', money: 60000, coins: 2, fans: 300 },
  { at: 500000, ko: '50만', money: 200000, coins: 4, fans: 1200 },
  { at: 1000000, ko: '100만', money: 500000, coins: 8, fans: 3000 },
  { at: 5000000, ko: '500만', money: 1800000, coins: 14, fans: 12000 },
  { at: 10000000, ko: '1000만', money: 4000000, coins: 25, fans: 30000 },
  // 5년을 돌려 보면 누적 6천만을 넘긴다. 1000만에서 표가 끝나면 그 뒤로는
  // 자릿수를 바꿔도 아무 일이 없다.
  { at: 30000000, ko: '3000만', money: 9000000, coins: 40, fans: 70000 },
  { at: 50000000, ko: '5000만', money: 15000000, coins: 60, fans: 120000 },
  { at: 100000000, ko: '1억', money: 30000000, coins: 100, fans: 250000 },
];

export function dlMail(mark, at) {
  return {
    kind: 'dl',
    from: '곰 거주 최비서',
    icon: '🎊',
    title: `${mark.ko} DL 축하해요!`,
    at,
    body: `드디어 ${mark.ko} 다운로드!\n축하드립니다.\n\n`
      + '제가 늘 마음속으로 응원한 덕분이라고\n소문이 났죠! 너무 기쁘니\n'
      + '오늘은 치킨집에서 축배를 들었어요. 혼자서.\n\n'
      + '앞으로도 대박입시다!',
    gift: { money: mark.money, coins: mark.coins, fans: mark.fans },
  };
}

/* ---------- 시상식·게임덱스가 보내는 편지 ----------
   결과 화면은 한 번 닫으면 끝이다. 무엇을 받았는지 나중에 다시 볼 수 있게
   같은 내용을 편지로도 남긴다. 선물은 이미 결과 화면에서 지급했으므로
   여기에는 붙이지 않는다 (gift: null). */
export function recordMail(kind, title, body, at, icon) {
  return { kind, from: '게임 협회', icon: icon || '🏆', title, at, body, gift: null };
}

/* 편지 한 통을 완성한다. 보관에 필요한 칸(id·읽음·수령·자물쇠)은 여기서
   붙는다 — 만드는 쪽이 매번 기억해야 하는 필드가 있으면 언젠가 빠진다. */
export function sealMail(mail, id) {
  return {
    id,
    kind: mail.kind || 'system',
    from: mail.from || '알 수 없음',
    icon: mail.icon || '✉️',
    title: mail.title || '(제목 없음)',
    at: mail.at || '',
    body: mail.body || '',
    gift: mail.gift || null,
    read: false,
    claimed: !mail.gift,
    locked: false,
  };
}

/* 선물 한 줄 요약. 목록에서 "무엇이 들었나" 가 열어 보기 전에 보여야 한다. */
export function giftText(gift, itemName) {
  if (!gift) return '';
  const bits = [];
  if (gift.money) bits.push('₩' + Math.round(gift.money).toLocaleString('ko-KR'));
  if (gift.coins) bits.push(`코인 +${gift.coins}`);
  if (gift.research) bits.push(`연구 +${gift.research}`);
  if (gift.fans) bits.push(`팬 +${gift.fans.toLocaleString('ko-KR')}`);
  for (const it of gift.items || []) {
    const ko = itemName ? itemName(it.id) : it.id;
    bits.push(`${ko}${it.n > 1 ? ` ×${it.n}` : ''}`);
  }
  return bits.join(' · ');
}
