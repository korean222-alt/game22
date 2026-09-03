/* A deliberately bad player: no research, no marketing, no contracts, random
   cards, hires whoever is cheapest, never trains, keeps three titles running.
   The design doc's rule is that a player must never be PERMANENTLY stuck at
   zero — this run is the check that a careless studio limps rather than dies. */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { Game } = await import(new URL('../src/game/state.js', import.meta.url));
const { buildOffice } = await import(new URL('../src/world/office.js', import.meta.url));
const won = (n) => Math.round(n).toLocaleString('en-US');
const g = new Game(Number(process.argv[2] || 999));
const built = buildOffice(5);
g.assignDesks(built.desks);
const rows = [];
let rescues = 0, minMoney = Infinity;
for (let week = 0; week < 8 * 48; week++) {
  const c = g.company;
  if (g.candidates.length && g.staff.length < g.info().staffCap && c.money > g.candidates[0].hireCost * 1.2) {
    g.hire(g.candidates[0].id); g.assignDesks(built.desks);
  }
  if (g.finished) {
    if (g.managed().length >= g.info().managedCap) g.endService(g.managed()[0].id);
    g.release();
  }
  if (!g.project && !g.finished) {
    if (!g.proposals.length && c.stamina > 2) g.makeProposal();
    const pr = g.proposals[0];
    if (pr) {
      const plats = g.availablePlatforms();
      const plat = plats[plats.length - 1];                    // always the priciest
      const mons = g.availableMonetize();
      const team = g.staff.slice(0, 5).map((s) => s.id);       // whoever is first
      g.beginDevelopment({ proposalId: pr.id, platformId: plat.id,
        monetizeId: mons[0].id, teamIds: team, seriesOfId: null });
    }
  }
  let guard = 0;
  while (g.project && c.stamina > 1 && guard++ < 80) {
    if (g.project.pendingCards) { g.pickCard(g.project.pendingCards.options[0].id); continue; }
    if (!g.devTurn().ok) break;
  }
  const before = c.money;
  g.nextWeek();
  minMoney = Math.min(minMoney, c.money);
  if (c.money > before && before < -200000) rescues++;
  if (week % 48 === 47) {
    const last = g.releases[0];
    rows.push({ year: c.year - 1, rank: c.rank, money: won(c.money), fans: won(c.fans),
      staff: g.staff.length, shipped: c.shipped, critic: last ? last.criticTotal : '-',
      peak: last ? won(last.peakUsers) : '-' });
  }
}
console.table(rows);
console.log('최저 잔고:', won(minMoney), '· 스폰서 구제:', rescues, '회');
