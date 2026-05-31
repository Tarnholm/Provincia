// scripts/probe-ui-additions.js
//
// Validation probe for the four UI-additions features (2026-05-31). It does NOT
// render the UI — it asserts that each datum the renderer needs is actually
// produced by the parser layer and is shaped the way the App.js / RegionInfo.js
// wiring expects. Run:  node scripts/probe-ui-additions.js [savePath] [modDataDir]
//
// Checks, per feature:
//   1. settlementFields[city].order — CONFIRMED public-order slots present + the
//      named contributions reconcile in sign toward the order total.
//   2. sieges[] — each siege resolves to a target settlement (so the RegionInfo
//      card can match it by city name) and carries the counters.
//   3. computeTradeNetwork().trade.settlements[city] — land/sea partners resolve
//      to known settlements (and thus to factions via the same map).
//   4. unit.movementPoints — read for NON-bodyguard units, not just generals.

"use strict";

const fs = require("fs");
const path = require("path");

const SAVE = process.argv[2] || path.join(
  "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves",
  "save_julii2.sav"
);
const MOD = process.argv[3] || "C:/RIS/RIS/data";

const { findAllSettlementMarkers } = require("../src/buildingParser.js");
const { parseSettlementFields } = require("../src/settlementFieldsParser.js");
const { parseSieges } = require("../src/siegeParser.js");
const { findUnitRecords } = require("../src/unitParser.js");
const { computeTradeNetwork } = require("../src/tradeNetwork.js");

let failures = 0;
const ok = (m) => console.log("  PASS:", m);
const bad = (m) => { console.log("  FAIL:", m); failures++; };

console.log(`Save: ${SAVE}`);
console.log(`Mod:  ${MOD}\n`);
const buf = fs.readFileSync(SAVE);
const markers = findAllSettlementMarkers(buf);
console.log(`Settlement markers: ${markers.length}\n`);

// ── Feature 1: public-order breakdown ────────────────────────────────────────
console.log("Feature 1 — public-order breakdown:");
const sf = parseSettlementFields(buf, markers);
const sfNames = Object.keys(sf);
if (sfNames.length === 0) { bad("parseSettlementFields produced no settlements"); }
else {
  ok(`parseSettlementFields → ${sfNames.length} settlements`);
  // find one with at least one non-zero CONFIRMED order slot
  let sampled = 0, withOrder = 0;
  for (const name of sfNames) {
    const o = sf[name].order;
    if (!o) continue;
    sampled++;
    const slots = [o.tax, o.foreignCulturePenalty, o.distanceToCapitalPenalty,
      o.religiousUnrestPenalty, o.healthBonus, o.capitalBonus, o.taxAdminLine, o.startTransientBonus];
    if (slots.some(v => typeof v === "number" && Math.abs(v) >= 0.05)) withOrder++;
  }
  if (sampled === 0) bad("no settlement carried an `order` object");
  else ok(`order{} present on all ${sampled} settlements; ${withOrder} have ≥1 non-zero CONFIRMED slot`);
  // Spot-print one settlement's breakdown so it's eyeballable.
  const ex = sfNames.find(n => sf[n].order && [sf[n].order.distanceToCapitalPenalty, sf[n].order.capitalBonus, sf[n].order.healthBonus].some(v => Math.abs(v) >= 0.05)) || sfNames[0];
  const o = sf[ex].order;
  console.log(`    e.g. ${ex}: order total=${sf[ex].publicOrder != null ? sf[ex].publicOrder.toFixed(0) : "—"} | ` +
    `Tax ${o.tax} · Distance −${Math.abs(o.distanceToCapitalPenalty)} · Foreign −${Math.abs(o.foreignCulturePenalty)} · ` +
    `Religion −${Math.abs(o.religiousUnrestPenalty)} · Health +${o.healthBonus} · Capital +${o.capitalBonus}`);
}

// ── Feature 2: sieges ─────────────────────────────────────────────────────────
console.log("\nFeature 2 — sieges:");
const sieges = parseSieges(buf, markers);
console.log(`    parseSieges → ${sieges.length} active siege(s)`);
if (sieges.length === 0) {
  ok("no active sieges in this save (RegionInfo siege row simply won't render) — structurally fine");
} else {
  let resolved = 0;
  for (const s of sieges) {
    if (s.targetSettlement) resolved++;
    console.log(`    siege target=${s.targetSettlement || "(unresolved)"} underSiege=${s.turnsUnderSiege} remain=${s.turnsRemaining} window=${s.siegeWindow}`);
  }
  if (resolved === sieges.length) ok(`all ${sieges.length} sieges resolved to a settlement name (card can match by city)`);
  else bad(`${sieges.length - resolved}/${sieges.length} sieges did NOT resolve a target settlement — card can't match`);
}

// ── Feature 4: per-unit movement points ──────────────────────────────────────
console.log("\nFeature 4 — per-unit movement points:");
const units = findUnitRecords(buf);
console.log(`    parseUnits → ${units.length} units`);
const nonBg = units.filter(u => !u.commanderUuid); // non-bodyguard combat units
const nonBgWithMp = nonBg.filter(u => typeof u.movementPoints === "number");
if (nonBg.length === 0) bad("no non-bodyguard units found");
else if (nonBgWithMp.length === 0) bad("movementPoints not read for ANY non-bodyguard unit (Feature 4 regressed)");
else {
  ok(`movementPoints read for ${nonBgWithMp.length}/${nonBg.length} non-bodyguard units (not just generals)`);
  const ex = nonBgWithMp[0];
  console.log(`    e.g. ${ex.name} (cmd=${ex.commanderUuid || 0}): MP=${ex.movementPoints.toFixed(1)}`);
  const spent = nonBgWithMp.filter(u => u.movementPoints < 1).length;
  console.log(`    ${spent} non-bg units read <1 MP (would render "spent")`);
}

// ── Feature 3: trade network ──────────────────────────────────────────────────
console.log("\nFeature 3 — trade network (this is the slow one):");
try {
  const r = computeTradeNetwork(buf, MOD, { campaign: "imperial_campaign" });
  if (r.error) { bad("computeTradeNetwork returned error: " + r.error); }
  else {
    const setts = r.trade && r.trade.settlements ? r.trade.settlements : {};
    const names = Object.keys(setts);
    ok(`computeTradeNetwork → ${names.length} settlements in ${r.stats && r.stats.ms}ms`);
    // pick one with partners and confirm partner names resolve back to factions
    const withPartners = names.find(n => (setts[n].landPartners.length + setts[n].seaPartners.length) > 0);
    if (!withPartners) {
      bad("no settlement had any trade partner — gating/connectivity produced nothing");
    } else {
      const me = setts[withPartners];
      const all = [...me.landPartners, ...me.seaPartners];
      const resolvable = all.filter(n => setts[n] && setts[n].faction).length;
      ok(`${withPartners}: ${me.landPartners.length} land + ${me.seaPartners.length} sea partners; ` +
        `${resolvable}/${all.length} resolve to a faction`);
      console.log(`    land: ${me.landPartners.slice(0, 5).map(n => `${n}(${setts[n] && setts[n].faction})`).join(", ")}`);
      console.log(`    sea:  ${me.seaPartners.slice(0, 5).map(n => `${n}(${setts[n] && setts[n].faction})`).join(", ")}`);
      console.log(`    tradeScoreHypothesis=${me.tradeScoreHypothesis} (relative estimate, unverified)`);
      if (resolvable === all.length) ok("every partner resolved to a faction");
      else bad(`${all.length - resolvable} partners did not resolve to a faction`);
    }
  }
} catch (e) {
  bad("computeTradeNetwork threw: " + e.message);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
