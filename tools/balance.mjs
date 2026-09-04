/* Headless balance run: play the game with a greedy-but-sane AI and print the
   shape of a five-year career. No DOM, no WebGL — the game modules are pure. */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { Game } = await import(new URL('../src/game/state.js', import.meta.url));
const { MARKETING, RESEARCH, CONTRACTS, JOBS } = await import(new URL('../src/game/data.js', import.meta.url));
const { power } = await import(new URL('../src/game/staff.js', import.meta.url));
const { buildOffice } = await import(new URL('../src/world/office.js', import.meta.url));

const won = (n) => Math.round(n).toLocaleString('en-US');
const YEARS = Number(process.argv[3] || 5);
const g = new Game(Number(process.argv[2] || 12345));

// Real desks from the real generator, so floor roles are what the game sees.
const built = buildOffice(5);
g.assignDesks(built.desks);

const rows = [];
const bugSamples = [], dbgSamples = [];
for (let week = 0; week < YEARS * 48; week++) {
  const c = g.company;

  // ── grow the office when it comfortably pays for itself ──
  if (g.canBuyFloor().ok && c.money > g.nextFloorCost() * 3.2) {
    g.buyFloor();
    g.assignDesks(built.desks);
  }

  // ── hire when we can afford the person several times over ──
  if (g.candidates.length && g.staff.length < g.info().staffCap) {
    const best = g.candidates.slice().sort((a, b) => b.talent - a.talent)[0];
    if (c.money > best.hireCost * 6) { g.hire(best.id); g.assignDesks(built.desks); }
  }

  // ── research: buy the cheapest available upgrade ──
  for (let i = 0; i < 3; i++) {
    const opts = RESEARCH
      .filter((r) => g.researchLevel(r.id) < r.max && c.researchPts >= g.researchPrice(r.id))
      .sort((a, b) => g.researchPrice(a.id) - g.researchPrice(b.id));
    if (!opts.length) break;
    g.doResearch(opts[0].id);
  }

  // ── contracts when cash is thin ──
  if (!c.contract && c.money < 120000 && c.stamina > 4) {
    const best = CONTRACTS.slice().sort((a, b) => g.contractPayFor(b.id) - g.contractPayFor(a.id))[0];
    g.takeContract(best.id);
  }

  // ── release anything finished, with affordable promotion ──
  if (g.finished) {
    bugSamples.push(g.finished.bugs);
    let dbg = 0;
    while (g.finished.bugs > 0 && c.stamina > 2) { g.debugProject(); dbg++; }
    dbgSamples.push(dbg);
    const affordable = MARKETING.filter((m) => g.marketingPrice(m.id) < c.money * 0.28);
    g.setMarketing(affordable[affordable.length - 1].id);
    if (g.managed().length >= g.info().managedCap) {
      g.endService(g.managed().slice().sort((a, b) => a.users - b.users)[0].id);
    }
    const shipped = g.finished;
    g.release();
    if (g.company.shipped <= 12 || g.company.shipped % 20 === 0) {
      const r0 = g.releases[0];
      console.log(`  #${String(g.company.shipped).padStart(3)} ${g.dateLabel()}  x=${(shipped.rawPerSlot || 0).toFixed(0).padStart(4)}  avgQ=${String(Math.round(Object.values(r0.quality).reduce((a, b) => a + b, 0) / 5)).padStart(4)}  critic=${String(r0.criticTotal).padStart(2)}  lvl=${Math.round(g.staff.reduce((a, s) => a + s.level, 0) / g.staff.length)}`);
    }
  }

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

  // ── spend the week's stamina on the battle, then on training ──
  let guard = 0;
  while (g.project && c.stamina > 1 && guard++ < 80) {
    if (g.project.pendingCards) {
      const pc = g.project.pendingCards;
      const best = pc.kind === 'content'
        ? pc.options.slice().sort((a, b) => b.combo - a.combo)[0]
        : (pc.options.find((o) => o.id === 'quality') || pc.options[0]);
      g.pickCard(best.id);
      continue;
    }
    if (!g.devTurn().ok) break;
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
  g.nextWeek();
  if (g.pendingEvent) g.answerEvent(0);

  if (week % 48 === 47) {
    const last = g.releases[0];
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
