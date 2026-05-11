// dig-faction-treasury.js — session 5
//
// Strategy: scan a TURN-1-START save for all u32 values matching the
// descr_strat starting treasury of each faction in faction_wealth_large.json.
// For each faction, list positions where (a) the u32 matches that wealth and
// (b) within ±64 bytes there's another faction's wealth (proving array
// adjacency). This is what the dossier's session 1 cluster analysis tried,
// but we'll filter more aggressively.
const fs = require("fs");
const path = require("path");

function findU32(buf, target) {
  const out = [];
  for (let i = 0; i + 4 <= buf.length; i += 1) {
    if (buf.readUInt32LE(i) === target) out.push(i);
  }
  return out;
}

function main() {
  const filePath = process.argv[2];
  const wealthPath = path.resolve(__dirname, "../../public/faction_wealth_large.json");
  const buf = fs.readFileSync(filePath);
  const wealth = JSON.parse(fs.readFileSync(wealthPath, "utf8"));
  const factions = Object.entries(wealth);

  console.log("File:", path.basename(filePath), buf.length);
  console.log("Factions:", factions.length);

  // Pick factions with starting wealth that's not extremely common
  const wealthCount = {};
  for (const [, w] of factions) wealthCount[w] = (wealthCount[w] || 0) + 1;

  // Build per-faction u32 hit list
  const hits = {};
  for (const [name, w] of factions) {
    hits[name] = { wealth: w, positions: findU32(buf, w) };
  }

  // Look at every u32 hit. For each, check ±200 bytes for ANOTHER faction's wealth
  // value. The faction RECORD array would have adjacent records with their respective
  // wealths.
  const STRIDE_MIN = 1500;
  const STRIDE_MAX = 5000;

  // For each hit of any faction, find the nearest "next" faction wealth within stride distance.
  // Build a flat sorted list of (pos, faction, wealth) tuples.
  const all = [];
  for (const [name, { wealth: w, positions }] of Object.entries(hits)) {
    for (const p of positions) all.push({ pos: p, faction: name, wealth: w });
  }
  all.sort((a, b) => a.pos - b.pos);
  console.log(`Total wealth-u32 hits in file: ${all.length}`);

  // For each adjacent pair in `all`, compute Δ. Pairs with consistent Δ ≈
  // stride point us to the array.
  const deltaByStride = new Map();
  for (let i = 0; i < all.length - 1; i += 1) {
    const a = all[i], b = all[i + 1];
    if (a.faction === b.faction) continue;
    const delta = b.pos - a.pos;
    if (delta < STRIDE_MIN || delta > STRIDE_MAX) continue;
    if (!deltaByStride.has(delta)) deltaByStride.set(delta, []);
    deltaByStride.get(delta).push({ a, b, delta });
  }
  const topDeltas = [...deltaByStride.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 20);
  console.log("\nMost common stride deltas between consecutive wealth hits:");
  for (const [d, list] of topDeltas) {
    console.log(`  Δ=${d}: ${list.length} pairs. Sample: ${list[0].a.faction}(${list[0].a.wealth})@0x${list[0].a.pos.toString(16)} → ${list[0].b.faction}(${list[0].b.wealth})@0x${list[0].b.pos.toString(16)}`);
  }

  // Look for long chains: ≥5 consecutive wealth hits each with stride in the same band.
  // Bucket Δ by rounding to nearest 50.
  console.log("\nChains of 4+ consecutive different-faction wealth hits with stride in [1500..5000]:");
  let chain = [all[0]];
  const chains = [];
  for (let i = 1; i < all.length; i += 1) {
    const prev = chain[chain.length - 1];
    const cur = all[i];
    const d = cur.pos - prev.pos;
    if (d >= STRIDE_MIN && d <= STRIDE_MAX && cur.faction !== prev.faction) {
      chain.push(cur);
    } else {
      if (chain.length >= 4) chains.push(chain);
      chain = [cur];
    }
  }
  if (chain.length >= 4) chains.push(chain);
  for (const c of chains.slice(0, 10)) {
    console.log(`\n  chain length=${c.length} starting at 0x${c[0].pos.toString(16)}:`);
    for (const e of c) {
      console.log(`    ${e.faction.padEnd(20)} wealth=${e.wealth} pos=0x${e.pos.toString(16)} +${e.pos - c[0].pos}`);
    }
  }
}

main();
