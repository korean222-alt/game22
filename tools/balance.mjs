/* Headless balance run: play the game with a greedy-but-sane AI and print the
   shape of a five-year career. No DOM, no WebGL — the game modules are pure. */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { Game } = await import(new URL('../src/game/state.js', import.meta.url));
const { MARKETING, RESEARCH, CONTRACTS, JOBS } = await import(new URL('../src/game/data.js', import.meta.url));
const { power } = await import(new URL('../src/game/staff.js', import.meta.url));
const { awardBar } = await import(new URL('../src/game/awards.js', import.meta.url));
const { placeZones, inPlaceZone } = await import(new URL('../src/world/office.js', import.meta.url));
const { buildPlaced } = await import(new URL('../src/world/placed.js', import.meta.url));
const { FURNITURE_BY_ID } = await import(new URL('../src/game/furniture.js', import.meta.url));

const won = (n) => Math.round(n).toLocaleString('en-US');
const YEARS = Number(process.argv[3] || 5);
const g = new Game(Number(process.argv[2] || 12345));
g.found('밸런스 스튜디오');

/* The office starts bare, so the AI has to furnish it before it can hire. Slots
   are laid out inside the same bays the placement UI offers, spaced by a desk's
   footprint plus an aisle.

   `clearOfWalls` is stubbed true: that test needs the building's collision grid,
   which only exists once WebGL has built the world. The zone test alone is
   enough here — the bays are carved to be clear of the architecture. */
const CHECKS = { zoneOk: inPlaceZone, clearOfWalls: () => true };

function slotsFor(floor) {
  const out = [];
  for (const r of placeZones(floor)) {
    for (let x = r.x0 + 3; x + 3 <= r.x1; x += 7) {
      for (let z = r.z0 + 2.6; z + 2.6 <= r.z1; z += 6) out.push([x, z]);
    }
  }
  return out;
}
const slots = new Map();
function nextSlot(floor) {
  if (!slots.has(floor)) slots.set(floor, slotsFor(floor));
  const list = slots.get(floor);
  const used = new Set(g.company.placed.filter((p) => p.floor === floor).map((p) => `${p.x},${p.z}`));
  return list.find(([x, z]) => !used.has(`${x},${z}`)) || null;
}

/* Buy and place one piece on the lowest floor with room. Returns false when the
   money is not there or every bay is full. */
function furnish(id) {
  const def = FURNITURE_BY_ID.get(id);
  if (!def || g.company.money < def.price) return false;
  for (let f = 0; f < g.company.floors; f++) {
    const slot = nextSlot(f);
    if (!slot) continue;
    if (!g.buyFurniture(id).ok) return false;
    const uid = g.bag[g.bag.length - 1].uid;
    const r = g.placeFurniture(uid, f, slot[0], slot[1], 0, CHECKS);
    if (!r.ok) { g.sellFurniture(uid); return false; }
    syncDesks();
    return true;
  }
  return false;
}

function syncDesks() { g.assignDesks(buildPlaced(g.company.placed).desks); }
syncDesks();

/* 달력을 미는 버튼은 없어졌다. 시간은 게임을 완성하고, 정산을 확인하고,
   계약을 받을 때 흐른다 — 그러니 이 루프도 주를 밀지 않고 **한 번 놀아 본다**.
   아무 일도 못 한 바퀴에는 스태미나만 채운다: 브라우저에서는 실시간으로
   차는 그 회복이고, 시계가 없는 여기서는 이렇게 흉내 낸다. */
const rows = [];
const bugSamples = [], dbgSamples = [];
let lastYear = 1, stall = 0;
for (let loop = 0; loop < YEARS * 48 * 20; loop++) {
  const c = g.company;
  if (c.year > YEARS) break;
  const weekBefore = ((c.year - 1) * 12 + (c.month - 1)) * 4 + c.week;

  // ── grow the office when it comfortably pays for itself ──
  if (g.canBuyFloor().ok && c.money > g.nextFloorCost() * 3.2) {
    g.buyFloor();
    syncDesks();
  }

  // ── furnish: a desk to hire into, then comfort once there is slack ──
  if (g.freeDesks() === 0 && g.staff.length < g.info().staffCap) {
    furnish(c.money > 400000 ? 'deskDual' : 'desk');
  }
  if (c.money > 250000 && g.comfort().score < 60) furnish('plant') || furnish('coffee');

  // ── hire when we can afford the person several times over ──
  if (g.candidates.length && g.staff.length < g.info().staffCap && g.freeDesks() > 0) {
    const best = g.candidates.slice().sort((a, b) => b.talent - a.talent)[0];
    if (c.money > best.hireCost * 6) { g.hire(best.id); syncDesks(); }
  }

  // ── research: buy the cheapest available upgrade ──
  for (let i = 0; i < 3; i++) {
    const opts = RESEARCH
      .filter((r) => g.researchLevel(r.id) < r.max && c.researchPts >= g.researchPrice(r.id))
      .sort((a, b) => g.researchPrice(a.id) - g.researchPrice(b.id));
    if (!opts.length) break;
    g.doResearch(opts[0].id);
  }

  // ── 외주: 자금이 얇을 때만. 목록이 사라지고 주간 사건이 됐지만,
  //    헤드리스에서는 사건 창을 기다릴 수 없으므로 직접 받는다. ──
  if (!c.contract && c.money < 120000 && c.rank >= 4) {
    const best = CONTRACTS.slice().sort((a, b) => g.contractPayFor(b.id) - g.contractPayFor(a.id))[0];
    g.takeContract(best.id);
  }

  // ── release anything finished, with affordable promotion ──
  if (g.finished) {
    bugSamples.push(g.finished.bugs);
    // 디버그 버튼은 사라졌다. 버그는 마지막 공정의 버그 보스가 가져간다.
    dbgSamples.push(0);
    const affordable = MARKETING.filter((m) => g.marketingPrice(m.id) < c.money * 0.28);
    g.setMarketing(affordable[affordable.length - 1].id);
    if (g.managed().length >= g.info().managedCap) {
      g.endService(g.managed().slice().sort((a, b) => a.users - b.users)[0].id);
    }
    const shipped = g.finished;
    g.release();
    /* 출시하면 실시간 판매가 돈다. 브라우저에서는 플레이어가 18초를 보고
       정산 버튼을 누르지만, 여기서는 시계가 없으므로 한 번에 흘려 보낸다.
       이걸 빼면 판매가 영원히 안 끝나고, 다음 게임에 착수할 수도 없어서
       시뮬레이션이 5년 동안 게임 한 개만 내고 멈춘다. */
    for (let i = 0; i < 40 && g.sales && !g.sales.ended; i++) g.salesTick(2);
    if (g.sales) g.closeSalesRun();
    if (g.company.shipped <= 12 || g.company.shipped % 20 === 0) {
      const r0 = g.releases[0];
      console.log(`  #${String(g.company.shipped).padStart(3)} ${g.dateLabel()}  x=${(shipped.rawPerSlot || 0).toFixed(0).padStart(4)}  avgQ=${String(Math.round(Object.values(r0.quality).reduce((a, b) => a + b, 0) / 5)).padStart(4)}  critic=${String(r0.criticTotal).padStart(2)}  lvl=${Math.round(g.staff.reduce((a, s) => a + s.level, 0) / g.staff.length)}`);
    }
  }

  // ── 소재 뽑기 ──
  // 코인이 모이면 뽑는다. 다른 데 쓸 곳이 없으므로 실제 플레이어도 그렇게
  // 한다. 이걸 빼면 시뮬레이션이 기본 소재 6종으로만 10년을 돌아서, 궁합
  // 좋은 조합을 못 만나는 쪽으로 밸런스가 기운다.
  while (g.company.coins >= g.gachaCost() && g.lockedContents().length) g.drawContent();

  // ── keep a project running ──
  if (!g.project && !g.finished) {
    if (!g.proposals.length && c.stamina > 2) g.makeProposal();
    // Prefer a proposal in the trending genre, then the best grade.
    const pr = g.proposals.slice().sort((a, b) => {
      const ta = c.trends && c.trends.genreId === a.genreId ? 1 : 0;
      const tb = c.trends && c.trends.genreId === b.genreId ? 1 : 0;
      return (tb - ta) || (b.grade - a.grade);
    })[0];
    if (pr) {
      const gm = 0.75 + pr.grade * 0.25;
      const plats = g.availablePlatforms();
      const afford = plats.filter((pl) => c.money > pl.cost * gm * 2.5);
      const plat = afford.length ? afford[afford.length - 1] : plats[0];
      const mons = g.availableMonetize();
      // One of each discipline beats five of the strongest: quality is measured
      // per staffer, so an unrepresented axis simply scores nothing.
      const byRole = new Map();
      for (const s of g.staff.slice().sort((a, b) => power(b) - power(a))) {
        const r = g.roleOf(s);
        if (!byRole.has(r)) byRole.set(r, s);
      }
      const team = [...byRole.values()].map((s) => s.id);
      if (c.money >= plat.cost * gm) {
        g.beginDevelopment({
          proposalId: pr.id, platformId: plat.id,
          monetizeId: mons[mons.length - 1].id, teamIds: team, seriesOfId: null,
        });
      }
    }
  }

  // ── 이번 주에 팀이 버티는 데까지 싸운다 ──
  // 전투는 스태미나를 먹지 않는다. 멈추는 것은 팀이 전부 쓰러졌을 때뿐이고,
  // devTurn() 이 그때 {ok:false} 를 돌려준다. guard 는 라운드 상한(58)의 몇 배.
  let guard = 0;
  while (g.project && guard++ < 400) {
    if (g.project.pendingCards) {
      const pc = g.project.pendingCards;
      const best = pc.kind === 'content'
        ? pc.options.slice().sort((a, b) => b.combo - a.combo)[0]
        : (pc.options.find((o) => o.id === 'quality') || pc.options[0]);
      g.pickCard(best.id);
      continue;
    }
    const t = g.devTurn();
    if (t.ok) continue;
    /* 팀이 전부 쓰러졌다. 브라우저에서는 개발 현장의 유예 시간이 지나면
       이 단계가 자동으로 마감되는데, 시계가 없는 여기서는 그 자리를
       직접 눌러 준다 — 안 그러면 시뮬레이션이 쓰러진 팀 앞에서 멈춘다. */
    if (t.exhausted && g.wrapUpStage().ok) continue;
    break;
  }
  // Train the CORE team, not whoever happens to be furthest behind: spreading
  // gifts across the whole roster means nobody ever reaches a higher tier.
  const core = g.staff.slice().sort((a, b) => power(b) - power(a)).slice(0, 6);
  let budget = Math.max(1, Math.floor(c.stamina / 2));
  while (budget-- > 0 && c.money > 60000) {
    const s = core.filter((x) => x.level < x.maxLevel).sort((a, b) => a.level - b.level)[0];
    if (!s) break;
    if (!g.train(s.id, ['book', 'chair', 'headset', 'monitor', 'trip', 'coffee'][s.itemsGiven.length % 6]).ok) break;
  }
  for (const s of g.staff) g.promoteStaff(s.id);

  // A weekly event with a choice holds the calendar until it is answered; the
  // AI always takes the first affordable option.
  if (g.pendingEvent) g.answerEvent(0);
  const weekAfter = ((c.year - 1) * 12 + (c.month - 1)) * 4 + c.week;
  if (weekAfter === weekBefore) {
    // 달력이 안 움직였다 = 할 수 있는 일이 없었다. 기다린 셈 치고 스태미나만
    // 채운다. 그래도 계속 제자리면 회사가 막힌 것이므로 거기서 끊는다.
    c.stamina = c.staminaMax;
    if (++stall > 400) { console.log('  (막혔다 — 더 진행할 수 없음)'); break; }
  } else stall = 0;

  if (c.year !== lastYear) {
    const last = g.releases[0];
    lastYear = c.year;
    rows.push({
      year: g.company.year - 1,
      rank: c.rank,
      money: won(c.money),
      fans: won(c.fans),
      staff: g.staff.length,
      floors: c.floors,
      RP: c.researchPts,
      shipped: c.shipped,
      critic: last ? last.criticTotal : '-',
      avgQ: last ? Math.round(Object.values(last.quality).reduce((a, b) => a + b, 0) / 5) : '-',
      lvl: Math.round(g.staff.reduce((a, s) => a + s.level, 0) / Math.max(1, g.staff.length)),
      peak: last ? won(last.peakUsers) : '-',
      hof: g.releases.filter((r) => r.hallOfFame).length,
      combos: Object.keys(c.discovered).length,
      tiers: [0,1,2].map((t)=>g.staff.filter((s)=>JOBS[s.job].tier===t).length).join('/'),
    });
  }
  if (c.money < -500000) { console.log(`!! BANKRUPT week ${week} (${g.dateLabel()})`); break; }
}
console.table(rows);
const res = RESEARCH.map((r) => `${r.ko} ${g.researchLevel(r.id)}`).join(' · ');
const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] || 0;
console.log(`버그: 중앙값 ${med(bugSamples)}개 (최대 ${Math.max(...bugSamples)}) · 디버그 ${med(dbgSamples)}회`);
console.log('연구:', res);
console.log('최고작:', g.releases.slice().sort((a, b) => b.peakUsers - a.peakUsers).slice(0, 3)
  .map((r) => `${r.title}(${r.criticTotal}점/${won(r.peakUsers)}명)`).join(', '));

/* 시상식과 게임덱스가 실제로 얼마나 나오는지. 기준선이 품질 곡선을 앞질러
   가면 상은 2년쯤 반짝하다 사라지고, 뒤처지면 내는 족족 금상이 된다 —
   둘 다 숫자로만 보이므로 여기서 센다. AI 는 게임덱스에 나가지 않으므로
   초대장이 몇 번 왔는지만 본다. */
const byGrade = {};
for (const a of g.company.awards || []) byGrade[a.gradeKo] = (byGrade[a.gradeKo] || 0) + 1;
console.log(`시상: 총 ${(g.company.awards || []).length}개 —`,
  Object.entries(byGrade).map(([k, v]) => `${k} ${v}`).join(' · ') || '없음');
console.log(`기준선: ${[1, 2, 3, 4, 5].map((y) => `${y}년 ${awardBar(y, 'craze')}`).join(' · ')}`);
console.log(`편지함: ${(g.company.mail || []).length}통 · 누적 DL ${won(g.company.totalDl)}`);
