/* A deliberately bad player: no research, no marketing, no contracts, random
   cards, hires whoever is cheapest, never trains, keeps three titles running.
   The design doc's rule is that a player must never be PERMANENTLY stuck at
   zero — this run is the check that a careless studio limps rather than dies. */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { Game } = await import(new URL('../src/game/state.js', import.meta.url));
const { placeZones, inPlaceZone } = await import(new URL('../src/world/office.js', import.meta.url));
const { buildPlaced } = await import(new URL('../src/world/placed.js', import.meta.url));
const won = (n) => Math.round(n).toLocaleString('en-US');
const g = new Game(Number(process.argv[2] || 999));
g.found('막장 스튜디오');

/* Even a careless player has to furnish, because a desk is what a hire sits at.
   This one buys the cheapest desk the moment it has no free seat and never buys
   anything else — no plants, no coffee, so 쾌적도 stays on the floor. */
const CHECKS = { zoneOk: inPlaceZone, clearOfWalls: () => true };
const slotsFor = (floor) => {
  const out = [];
  for (const r of placeZones(floor)) {
    for (let x = r.x0 + 3; x + 3 <= r.x1; x += 7) {
      for (let z = r.z0 + 2.6; z + 2.6 <= r.z1; z += 6) out.push([x, z]);
    }
  }
  return out;
};
const syncDesks = () => g.assignDesks(buildPlaced(g.company.placed).desks);
function buyDesk() {
  for (let f = 0; f < g.company.floors; f++) {
    const used = new Set(g.company.placed.filter((p) => p.floor === f).map((p) => `${p.x},${p.z}`));
    const slot = slotsFor(f).find(([x, z]) => !used.has(`${x},${z}`));
    if (!slot) continue;
    if (!g.buyFurniture('desk').ok) return false;
    const uid = g.bag[g.bag.length - 1].uid;
    if (!g.placeFurniture(uid, f, slot[0], slot[1], 0, CHECKS).ok) return false;
    syncDesks();
    return true;
  }
  return false;
}
syncDesks();
const rows = [];
let rescues = 0, minMoney = Infinity;
for (let week = 0; week < 8 * 48; week++) {
  const c = g.company;
  if (g.freeDesks() === 0 && g.staff.length < g.info().staffCap) buyDesk();
  if (g.candidates.length && g.staff.length < g.info().staffCap && g.freeDesks() > 0
      && c.money > g.candidates[0].hireCost * 1.2) {
    g.hire(g.candidates[0].id); syncDesks();
  }
  if (g.finished) {
    if (g.managed().length >= g.info().managedCap) g.endService(g.managed()[0].id);
    g.release();
  }
  if (!g.project && !g.finished) {
    if (!g.proposals.length && c.stamina > 2) g.makeProposal();
    const pr = g.proposals[0];
    if (pr) {
      // Always the priciest it can actually pay for. Careless, not suicidal:
      // a player who cannot start any project at all is testing nothing.
      const gm = 0.75 + pr.grade * 0.25;
      const plats = g.availablePlatforms().filter((p) => p.cost * gm <= c.money);
      const plat = plats[plats.length - 1];
      if (plat) {
        const mons = g.availableMonetize();
        const team = g.staff.slice(0, 5).map((s) => s.id);     // whoever is first
        g.beginDevelopment({ proposalId: pr.id, platformId: plat.id,
          monetizeId: mons[0].id, teamIds: team, seriesOfId: null });
      }
    }
  }
  let guard = 0;
  while (g.project && c.stamina > 1 && guard++ < 80) {
    if (g.project.pendingCards) { g.pickCard(g.project.pendingCards.options[0].id); continue; }
    if (!g.devTurn().ok) break;
  }
  g.nextWeek();
  minMoney = Math.min(minMoney, c.money);
  rescues = c.rescues;
  if (week % 48 === 47) {
    const last = g.releases[0];
    rows.push({ year: c.year - 1, rank: c.rank, money: won(c.money), fans: won(c.fans),
      staff: g.staff.length, shipped: c.shipped, critic: last ? last.criticTotal : '-',
      peak: last ? won(last.peakUsers) : '-' });
  }
}
console.table(rows);
console.log('최저 잔고:', won(minMoney), '· 긴급 지원금:', rescues, '회 · 직원',
  g.staff.length, '명 · 책상', g.deskCount(), '개');
if (g.staff.length === 0 && g.company.shipped === 0) {
  console.log('실패: 막장 플레이가 아무것도 못 하고 멈췄다 — 지원금이 부족하다');
  process.exit(1);
}
