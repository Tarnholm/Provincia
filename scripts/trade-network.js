// scripts/trade-network.js — DERIVED trade-route connectivity for a save.
//
// RTW doesn't store trade routes (engine-derived), so this COMPUTES them from
// region land/sea adjacency (map_regions.tga) + per-settlement road/port
// buildings + diplomacy trade-rights. Reports, per settlement, which others it
// can trade with. ENGINE-APPROXIMATION (connectivity + partners; exact gold
// value depends on distance/resources/route-capacity and is out of scope).
// See src/tradeNetwork.js + docs/findings-trade-network-2026-05-31.md.
//
// Usage: node scripts/trade-network.js <save.sav> [--mod <dir>] [--faction <name>] [--json]

"use strict";
const fs = require("fs");
const path = require("path");
const { computeTradeNetwork } = require("../src/tradeNetwork.js");

const argv = process.argv.slice(2);
const getArg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const save = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--mod" && argv[argv.indexOf(a) - 1] !== "--faction");
const mod = getArg("--mod", "C:\\RIS\\RIS\\data");
const faction = getArg("--faction", null);
const asJson = argv.includes("--json");

if (!save || !fs.existsSync(save)) { console.error("usage: node scripts/trade-network.js <save.sav> [--mod <dir>] [--faction <name>] [--json]"); process.exit(1); }

const r = computeTradeNetwork(fs.readFileSync(save), mod);
if (asJson) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }

const pad = (s, n) => { s = String(s); return s.length >= n ? s : s + " ".repeat(n - s.length); };
console.log(`\n=== trade network — ${path.basename(save)} (turn ${r.turn}, player ${r.playerFaction}) ===`);
const s = r.stats;
console.log(`map: ${s.regions} regions, ${s.landEdges} land edges, ${s.seaBodies} sea bodies, ${s.coastalRegions} coastal`);
console.log(`buildings: ${s.withRoad} with road, ${s.withSeaPort} with sea port`);
console.log(`avg ${s.avgPartnersPerSettlement} trade partners/settlement; ${s.isolatedSettlements} isolated`);

const fac = faction || r.playerFaction;
const sett = r.trade.settlements;
const mine = Object.entries(sett).filter(([, v]) => v.faction === fac);
console.log(`\n-- ${fac}: ${mine.length} settlements --`);
for (const [name, v] of mine.slice(0, 20)) {
  const tags = [v.road ? "road" : null, v.seaPort ? "port" : null].filter(Boolean).join("+") || "—";
  // top-3 nearest partners by the HYPOTHESIS (unverified) distance-decay value
  const top = Object.entries(v.valuesHypothesis || {}).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([n, s]) => `${n}:${s.toFixed(2)}`).join(", ");
  console.log(`  ${pad(name, 18)} [${pad(tags, 9)}] ${v.partners.length} partners  (land ${v.landPartners.length}, sea ${v.seaPartners.length})`);
  if (top) console.log(`  ${pad("", 18)}  ~value(HYP, unverified): ${top}`);
}
console.log("\n  NOTE: ~value is a HYPOTHESIS (distance-decay, shorter=higher) — NOT engine gold.\n");
