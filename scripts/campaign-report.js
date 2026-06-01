// scripts/campaign-report.js — per-faction strategic dashboard for an
// RTW Remastered save. A one-glance "state of the campaign" table, sorted by
// power (treasury + territory + military), built entirely from crackSave().
//
// For each faction it shows:
//   treasury   current denarii (class-100 record +0)
//   income     gross income THIS turn = sum of the faction's settlements'
//              per-settlement income (settlementFields marker-1586, selected via
//              ownerByCity). This is the ground-truth income source — the record
//              +4 field is NOT net income (it is an AI-internal seeded value;
//              see rtw-sav-parser/docs/findings-treasury-net-2026-06-01.md).
//   net        last completed turn's treasury delta, read structurally from the
//              econ-history table that physically precedes the faction's OWN
//              treasury record (f13 per-turn treasury checkpoints). "—" before
//              turn 3 (needs >=2 completed checkpoints; turn N has N-1) and for
//              the player faction (whose own f13 series reads as all-zeros —
//              left "—", never surfaced as a fabricated +0).
//   regions    settlement count (ownerByCity tally — the correct source).
//   units/sol  military: unit count and total soldiers (crackSave.units).
//   family     family roster size (familyByFaction; generals + women + dead).
//   knows      AI world-knowledge: settlements this faction has scouted.
//   war/ally/prot  diplomacy counts (war / allied / protectorate, from the
//              cracked attitude matrix).
//
// Usage:
//   node scripts/campaign-report.js <save.sav> [--mod <modDataDir>] [--json]
//   node scripts/campaign-report.js <save.sav> --all      (include 0-region factions)
//   node scripts/campaign-report.js <save.sav> --sort income|treasury|regions|soldiers|power
//   node scripts/campaign-report.js <save.sav> --faction <name>   (focus one faction)
//
// --mod defaults to C:\RIS\RIS\data. --faction prints a single faction's full
// detail (incl. its per-settlement income breakdown) instead of the table.

"use strict";
const fs = require("fs");
const path = require("path");
const { crackSave } = require("../src/saveCracker.js");
const {
  parseFactionTreasuries,
  isDiplomaticFaction,
} = require("../src/saveCrackerExtras.js");

function parseArgs(argv) {
  const a = { save: null, mod: "C:\\RIS\\RIS\\data", json: false, all: false, sort: "power", faction: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--mod") a.mod = argv[++i];
    else if (argv[i] === "--json") a.json = true;
    else if (argv[i] === "--all") a.all = true;
    else if (argv[i] === "--sort") a.sort = argv[++i];
    else if (argv[i] === "--faction") a.faction = argv[++i];
    else if (!a.save) a.save = argv[i];
  }
  return a;
}

function pad(s, n) { s = String(s); return s.length >= n ? s : s + " ".repeat(n - s.length); }
function padl(s, n) { s = String(s); return s.length >= n ? s : " ".repeat(n - s.length) + s; }
function num(v) { return v == null ? "—" : (v >= 0 ? String(v) : String(v)); }
function signed(v) { return v == null ? "—" : (v >= 0 ? "+" + v : String(v)); }

// Read the per-turn treasury-checkpoint series that sits IMMEDIATELY BEFORE a
// faction record at `recOff`. This is the structurally-correct net source: the
// econ-history table belongs to the record it precedes, so it needs no
// factionId name-lookup (parseFactionTreasuryHistory's factionId→name mapping
// is mis-shifted by a slot on these saves and cross-wires factions, so we avoid
// it). f13 of each 23-i32 block = that turn's end-of-turn treasury.
function econSeriesBefore(buf, recOff) {
  let start = -1;
  for (let off = recOff - 4; off >= recOff - 100000 && off >= 0; off -= 4) {
    if (buf.readUInt32LE(off) === off) { start = off; break; }
  }
  if (start < 0) return null;
  const f = [];
  for (let o = start; o + 4 <= recOff; o += 4) f.push(buf.readInt32LE(o));
  const body = f.slice(2, f.length - 1); // [0]=selfptr [1]=turnSerial … [last]=marker
  if (body.length < 23 || body.length % 23 !== 0) return null;
  const nb = body.length / 23;
  const series = [];
  for (let b = 0; b < nb; b++) series.push(body[b * 23 + 13]);
  // drop the trailing 0 of the unfinalized current turn (engine zeroes it)
  if (series.length && series[series.length - 1] === 0) series.pop();
  return series;
}

// NET per faction = delta of the last two completed treasury checkpoints, read
// from the faction's OWN record's econ-history. Keyed by record offset →
// resolved to a name by the caller via the treasury match. Returns
// { recordOffset: net }.
function buildNetByRecordOffset(buf) {
  const out = {};
  try {
    for (const r of parseFactionTreasuries(buf)) {
      const s = econSeriesBefore(buf, r.offset);
      if (!s || s.length < 2) continue;
      const a = s[s.length - 2], b = s[s.length - 1];
      // An all-zero checkpoint series means the timeline isn't recorded for this
      // record (the PLAYER faction's own f13 series reads as all zeros) — leave
      // net unavailable rather than reporting a fabricated +0.
      if (a === 0 && b === 0) continue;
      out[r.offset] = b - a;
    }
  } catch (e) { /* leave empty — net shows "—" */ }
  return out;
}

// Map each resolved faction name to its treasury record's offset, so net can be
// looked up structurally. crackSave resolves treasury per name; treasuries plus
// the matching econ-history make a record unambiguous. Returns { name: offset }.
function buildRecordOffsetByFaction(buf, factions) {
  const recs = parseFactionTreasuries(buf);
  const byTreasury = new Map();
  for (const r of recs) {
    if (!byTreasury.has(r.treasury)) byTreasury.set(r.treasury, []);
    byTreasury.get(r.treasury).push(r.offset);
  }
  const used = new Set();
  const out = {};
  for (const [name, f] of Object.entries(factions)) {
    if (f.treasury == null) continue;
    const offs = byTreasury.get(f.treasury);
    if (!offs) continue;
    const pick = offs.find((o) => !used.has(o));
    if (pick != null) { out[name] = pick; used.add(pick); }
  }
  return out;
}

// Assemble one row per faction from a cracked save `r` (+ raw `buf` for the
// structural net read). Exported so the test can assert on real saves without
// shelling out. Every field is either a real value or null → rendered "—";
// nothing is fabricated (provincia-no-fallbacks).
function buildRows(r, buf) {
  // Per-faction income = sum of owned settlements' per-settlement income.
  const own = r.ownerByCity || {};
  const sf = r.settlementFields || {};
  const incomeByFaction = {};
  for (const [city, fac] of Object.entries(own)) {
    const f = sf[city];
    if (!f || f.income == null) continue;
    incomeByFaction[fac] = (incomeByFaction[fac] || 0) + f.income;
  }
  const netByOffset = buildNetByRecordOffset(buf);
  const offsetByFaction = buildRecordOffsetByFaction(buf, r.factions);

  // Military rollup from units.
  const milByFaction = {};
  for (const u of (r.units || [])) {
    if (!u.faction) continue;
    const m = (milByFaction[u.faction] ||= { units: 0, soldiers: 0 });
    m.units++; m.soldiers += u.soldiers || 0;
  }

  const rows = [];
  for (const [name, f] of Object.entries(r.factions)) {
    const fam = (r.characters.familyByFaction && r.characters.familyByFaction[name]) || [];
    const fk = r.factionKnowledge && r.factionKnowledge.perFaction && r.factionKnowledge.perFaction[name];
    const mil = milByFaction[name] || { units: 0, soldiers: 0 };
    const dip = f.diplomacy || {};
    rows.push({
      faction: name,
      treasury: f.treasury,
      income: incomeByFaction[name] != null ? incomeByFaction[name] : null,
      net: offsetByFaction[name] != null && netByOffset[offsetByFaction[name]] != null
        ? netByOffset[offsetByFaction[name]] : null,
      regions: f.regionCount || 0,
      units: mil.units,
      soldiers: mil.soldiers,
      family: fam.length,
      generals: f.generalCount || 0,
      knows: fk ? fk.knownSettlements : null,
      wars: dip.war ? dip.war.length : 0,
      allies: dip.allied ? dip.allied.length : 0,
      protectorates: dip.protectorates ? dip.protectorates.length : 0,
      suzerains: dip.suzerains ? dip.suzerains.length : 0,
    });
  }
  return rows;
}

// Full single-faction detail, incl. the per-settlement income breakdown that
// the summed `income` column rolls up. Used by --faction.
function printFactionDetail(r, row) {
  console.log(`\n-- faction: ${row.faction}${row.faction === r.playerFaction ? "  (player)" : ""} --`);
  console.log(`  territory   ${num(row.regions)} settlements`);
  console.log(`  income      ${num(row.income)} / turn  (gross — sum of settlement income, CONFIRMED)`);
  console.log(`  treasury    ${num(row.treasury)}`);
  console.log(`  net         ${signed(row.net)}  (last-completed-turn treasury delta; — before turn 3 / for the player record)`);
  console.log(`  military    ${num(row.units)} units / ${num(row.soldiers)} soldiers (${num(row.generals)} generals)`);
  console.log(`  family      ${num(row.family)} members (generals + women + dead)`);
  console.log(`  AI-knows    ${num(row.knows)} settlements${row.knows == null ? "  (no AI-tuple cache — expected for the player faction)" : ""}`);
  const dip = [];
  if (row.wars) dip.push(`${row.wars} war`);
  if (row.allies) dip.push(`${row.allies} allied`);
  if (row.protectorates) dip.push(`${row.protectorates} protectorate`);
  if (row.suzerains) dip.push(`suzerain-of ${row.suzerains}`);
  console.log(`  diplomacy   ${dip.length ? dip.join(", ") : "—"}`);

  const own = r.ownerByCity || {};
  const sf = r.settlementFields || {};
  const cities = Object.keys(own).filter((c) => own[c] === row.faction).sort();
  if (cities.length) {
    console.log(`\n  settlements (${cities.length}):`);
    for (const c of cities) {
      const f = sf[c];
      const v = f && typeof f.income === "number" ? f.income : null;
      console.log(`    ${pad(c, 22)} income ${padl(num(v), 7)}`);
    }
  }
  console.log("");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.save) {
    console.error("usage: node scripts/campaign-report.js <save.sav> [--mod <dir>] [--json] [--all] [--faction <name>] [--sort power|treasury|income|regions|soldiers]");
    process.exit(1);
  }
  if (!fs.existsSync(args.save)) { console.error("save not found:", args.save); process.exit(1); }

  const buf = fs.readFileSync(args.save);
  const r = crackSave(buf, args.mod);
  const rows = buildRows(r, buf);

  // --faction <name>: single-faction focus (full detail, no table).
  if (args.faction) {
    const row = rows.find((x) => x.faction === args.faction);
    if (!row) { console.error(`faction not found in save: ${args.faction}`); process.exit(1); }
    console.log(`\n=== Campaign report: ${path.basename(args.save)} ===`);
    console.log(`turn ${r.turn ?? "?"}   player ${r.playerFaction || "?"}`);
    if (args.json) { console.log(JSON.stringify(row, null, 2)); return; }
    printFactionDetail(r, row);
    return;
  }

  // Filter to real, active factions unless --all. Drop engine placeholders
  // (slave/rebels/dummies/italics — the SAME single-source rule the diplomacy
  // decoder uses) and factions with no territory and no army.
  let view = args.all
    ? rows
    : rows.filter((x) => isDiplomaticFaction(x.faction) && (x.regions > 0 || x.soldiers > 0));

  // Sort. "power" = a blended rank: territory dominates, then soldiers, then treasury.
  const sorters = {
    power: (x) => (x.regions * 1e9) + (x.soldiers * 1e3) + (x.treasury || 0),
    treasury: (x) => (x.treasury == null ? -Infinity : x.treasury),
    income: (x) => (x.income == null ? -Infinity : x.income),
    regions: (x) => x.regions,
    soldiers: (x) => x.soldiers,
  };
  const keyfn = sorters[args.sort] || sorters.power;
  view.sort((a, b) => keyfn(b) - keyfn(a));

  if (args.json) {
    console.log(JSON.stringify({
      save: path.basename(args.save), turn: r.turn, player: r.playerFaction,
      factionCount: view.length, factions: view,
    }, null, 2));
    return;
  }

  console.log(`\n=== Campaign report: ${path.basename(args.save)} ===`);
  console.log(`turn ${r.turn ?? "?"}   player ${r.playerFaction || "?"}   ${view.length} active factions   (${(buf.length / 1e6).toFixed(1)} MB save)`);
  const wars = r.diplomacy && r.diplomacy._meta ? r.diplomacy._meta.warPairs : null;
  if (wars != null) console.log(`active war pairs: ${wars}`);

  // Header.
  const H = `  ${pad("faction", 16)} ${padl("treasury", 9)} ${padl("income", 7)} ${padl("net", 7)} ${padl("rgn", 4)} ${padl("units", 5)} ${padl("soldiers", 8)} ${padl("fam", 4)} ${padl("gen", 4)} ${padl("knows", 5)}  diplomacy`;
  console.log("\n" + H);
  console.log("  " + "-".repeat(H.length - 2));
  for (const x of view) {
    const dipParts = [];
    if (x.wars) dipParts.push(`${x.wars}W`);
    if (x.allies) dipParts.push(`${x.allies}A`);
    if (x.protectorates) dipParts.push(`${x.protectorates}P`);
    if (x.suzerains) dipParts.push(`suz:${x.suzerains}`);
    const dipStr = dipParts.length ? dipParts.join(" ") : "—";
    const tag = x.faction === r.playerFaction ? " *" : "";
    console.log(`  ${pad(x.faction + tag, 16)} ${padl(num(x.treasury), 9)} ${padl(num(x.income), 7)} ${padl(signed(x.net), 7)} ${padl(x.regions, 4)} ${padl(x.units, 5)} ${padl(x.soldiers, 8)} ${padl(x.family, 4)} ${padl(x.generals, 4)} ${padl(num(x.knows), 5)}  ${dipStr}`);
  }
  console.log("\n  legend: net = last-completed-turn treasury delta (— before turn 3, when");
  console.log("          a faction has <2 completed checkpoints, and for the player record);");
  console.log("          diplomacy W=wars A=allies P=protectorates suz=suzerain-of; * = player\n");
}

// Run as a CLI; export the pure helpers for the test harness.
if (require.main === module) main();

module.exports = { buildRows, econSeriesBefore, buildNetByRecordOffset };
