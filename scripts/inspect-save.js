// scripts/inspect-save.js — one-command inspection of an RTW Remastered save.
//
// Runs the production crackSave() and prints a complete human-readable report:
// turn/player, treasuries, active sieges (with turns-remaining), end-of-turn
// events, family roster, per-settlement growth/income/order, and diplomacy.
// Useful for testing the game from saves without launching Provincia.
//
// Usage:
//   node scripts/inspect-save.js <save.sav> [--mod <modDataDir>] [--faction <name>] [--json]
//
// --mod defaults to C:\RIS\RIS\data. --faction defaults to the detected player.

"use strict";
const fs = require("fs");
const path = require("path");
const { crackSave } = require("../src/saveCracker.js");
const { parseFactionKnowledge } = require("../src/factionKnowledgeParser.js");
const { buildTileIndex } = require("../src/tileResolver.js");
const { deriveEngineFactionOrder } = require("../src/saveCrackerExtras.js");

function parseArgs(argv) {
  const a = { save: null, mod: "C:\\RIS\\RIS\\data", faction: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--mod") a.mod = argv[++i];
    else if (argv[i] === "--faction") a.faction = argv[++i];
    else if (argv[i] === "--json") a.json = true;
    else if (!a.save) a.save = argv[i];
  }
  return a;
}

function pad(s, n) { s = String(s); return s.length >= n ? s : s + " ".repeat(n - s.length); }
function padl(s, n) { s = String(s); return s.length >= n ? s : " ".repeat(n - s.length) + s; }

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.save) {
    console.error("usage: node scripts/inspect-save.js <save.sav> [--mod <dir>] [--faction <name>] [--json]");
    process.exit(1);
  }
  if (!fs.existsSync(args.save)) { console.error("save not found:", args.save); process.exit(1); }

  const buf = fs.readFileSync(args.save);
  const r = crackSave(buf, args.mod);
  if (args.json) { console.log(JSON.stringify(r, null, 2)); return; }

  const fac = args.faction || r.playerFaction;
  console.log(`\n=== ${path.basename(args.save)} ===`);
  console.log(`turn ${r.turn}   player ${r.playerFaction}   factions ${r._stats.factions}   (${(buf.length / 1e6).toFixed(1)} MB)`);

  // Treasuries — top 10 by value
  const trs = Object.entries(r.factions)
    .filter(([, f]) => f.treasury != null)
    .sort((a, b) => b[1].treasury - a[1].treasury);
  console.log(`\n-- treasuries (top 10 of ${trs.length}) --`);
  for (const [name, f] of trs.slice(0, 10)) {
    console.log(`  ${pad(name, 18)} ${padl(f.treasury, 8)}   regions ${f.regionCount}`);
  }

  // Active sieges with turns-remaining
  console.log(`\n-- active sieges (${r.sieges.length}) --`);
  for (const s of r.sieges.slice(0, 25)) {
    console.log(`  ${pad(s.targetSettlement || "(fort/unknown)", 20)} ${s.turnsRemaining}t  army=${s.besiegerArmyUuid}`);
  }

  // Event log — counts + a few samples
  const hist = {};
  for (const e of r.events) hist[e.type] = (hist[e.type] || 0) + 1;
  console.log(`\n-- event log (${r.events.length} total) --`);
  console.log("  " + Object.entries(hist).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}:${n}`).join("  "));

  // Family roster for the chosen faction
  const fam = (r.characters.familyByFaction && r.characters.familyByFaction[fac]) || [];
  console.log(`\n-- family: ${fac} (${fam.length} members; ${fam.filter(m => m.gender === "female").length} female, ${fam.filter(m => !m.alive).length} dead) --`);
  for (const m of fam.slice(0, 20)) {
    const rel = m.spouseName ? `spouse ${m.spouseName}` : (m.fatherName ? `child of ${m.fatherName}` : "");
    console.log(`  ${pad(m.fullName, 26)} ${pad(m.gender, 6)} age ${padl(m.age == null ? "?" : m.age, 3)} ${m.alive ? "alive" : "DEAD "}  ${rel}`);
  }

  // Typed agents (spy/diplomat/assassin/merchant/admiral/princess) + role mix.
  // The character CLASS is encoded by the strat_card path the save embeds (see
  // saveCrackerExtras.parseTypedAgents). Generals/captains are identified by the
  // <culture> <role> bodyguard-description anchor; bodyguard-less agents by their
  // data/ui/<culture>/agents/card_<type>.tga path.
  const rb = r.characters.roleBreakdown || {};
  const allAgents = r.characters.agents || [];
  console.log(`\n-- character classes (role-anchor) --`);
  console.log("  " + (Object.keys(rb).length
    ? Object.entries(rb).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}:${n}`).join("  ")
    : "(none — no <culture> <role> anchors found)"));
  // Per-faction typed-agent counts, then the chosen faction's agents listed.
  const agByFacType = {};
  for (const a of allAgents) {
    const f = a.faction || "(unattributed)";
    ((agByFacType[f] ||= {})[a.type] ||= 0); agByFacType[f][a.type]++;
  }
  console.log(`\n-- typed agents (${allAgents.length} total) --`);
  if (!allAgents.length) {
    console.log("  (none — no spy/diplomat/assassin/merchant/admiral/princess in this save)");
  } else {
    for (const [f, types] of Object.entries(agByFacType).sort()) {
      console.log(`  ${pad(f, 18)} ${Object.entries(types).map(([t, n]) => `${t}:${n}`).join("  ")}`);
    }
    const mine = allAgents.filter((a) => a.faction === fac);
    if (mine.length) {
      console.log(`  -- ${fac} agents --`);
      for (const a of mine.slice(0, 30)) {
        const pos = (a.x != null && a.y != null) ? `(${a.x},${a.y})` : "";
        console.log(`    ${pad(a.type, 10)} ${pad(a.name || a.cardBasename || "?", 26)} ${pad(a.region || "", 16)} ${pos}`);
      }
    }
  }

  // Military: the chosen faction's units & armies
  if (Array.isArray(r.units)) {
    const fUnits = r.units.filter((u) => u.faction === fac);
    const fArmies = (r.armies || []).filter((a) => a.faction === fac);
    const soldiers = fUnits.reduce((s, u) => s + (u.soldiers || 0), 0);
    const garrison = fUnits.filter((u) => !u.commanderUuid).length;
    console.log(`\n-- military: ${fac} (${fUnits.length} units, ${soldiers} soldiers; ${fArmies.length} field/garrison stacks, ${garrison} commander-less units) --`);
    for (const a of fArmies.sort((x, y) => y.soldiers - x.soldiers).slice(0, 8)) {
      console.log(`  army @${pad(a.region || "?", 16)} ${padl(a.unitCount, 2)} units / ${padl(a.soldiers, 5)} soldiers`);
    }
  }

  // Settlements for the chosen faction — growth/income/order
  const cities = (r.factions[fac] && r.factions[fac].regions) || [];
  console.log(`\n-- settlements: ${fac} (${cities.length}) --`);
  for (const city of cities.slice(0, 20)) {
    const sf = r.settlementFields[city];
    if (!sf) { console.log(`  ${city}`); continue; }
    const g = sf.populationGrowth;
    console.log(`  ${pad(city, 18)} pop ${padl(sf.committedPopulation, 6)} growth ${padl(g == null ? "?" : (g >= 0 ? "+" + g : g), 5)} income ${padl(sf.income, 5)} order ${padl(sf.publicOrder == null ? "?" : Math.round(sf.publicOrder), 4)}`);
  }

  // Scripted-event / disaster schedule
  if (r.eventSchedule && r.eventSchedule.records.length) {
    const recs = r.eventSchedule.records;
    const random = recs.filter((e) => e.isRandom).length;
    console.log(`\n-- scripted-event schedule (${recs.length}: ${recs.length - random} static, ${random} random-appended) --`);
    for (const e of recs.filter((x) => !x.isRandom).slice(0, 12)) {
      const pos = e.x != null ? `(${e.x},${e.y})` : "";
      console.log(`  ${pad(e.category, 11)} ${pad(e.label, 26)} ${padl(Math.abs(e.year) + (e.year < 0 ? "BC" : "AD"), 6)} ${pad(e.season, 6)} ${pos}${e.warning ? "  [warning]" : ""}`);
    }
  }

  // Diplomacy for the chosen faction
  const dip = r.diplomacy && r.diplomacy[fac];
  if (dip) {
    console.log(`\n-- diplomacy: ${fac} --`);
    console.log(`  war:    ${dip.war.join(", ") || "—"}`);
    console.log(`  allied: ${dip.allied.join(", ") || "—"}`);
    console.log(`  trade:  ${dip.trade.join(", ") || "—"}`);
  }

  // AI world-knowledge — how many settlements each faction has scouted
  if (r.factionKnowledge && r.factionKnowledge.perFaction) {
    const pf = r.factionKnowledge.perFaction;
    console.log(`\n-- AI world-knowledge (${r.factionKnowledge.factionsWithTail} factions scouting; ${r.factionKnowledge.totalTuples} total observations) --`);
    const top = Object.entries(pf).sort((a, b) => b[1].knownSettlements - a[1].knownSettlements).slice(0, 8);
    for (const [n, v] of top) console.log(`  ${pad(n, 18)} knows ${padl(v.knownSettlements, 4)} settlements`);
    if (pf[fac]) console.log(`  → ${fac}: ${pf[fac].knownSettlements} settlements / ${pf[fac].knownTiles} observations`);
    // Resolve the chosen faction's scouted settlements to NAMES. The faction
    // record array is in ENGINE order (rebel-slot rotated); a faction's record
    // index = engineOrder.indexOf(faction). tag-27 tile coords → names via the
    // tileResolver. (Player faction has no AI-tuple cache, so prints nothing.)
    try {
      const smOrder = fs.readFileSync(path.join(args.mod, "descr_sm_factions.txt"), "utf8")
        .split(/\r?\n/).map((l) => { const m = l.match(/^\t"([a-z_0-9]+)":/); return m ? m[1] : null; }).filter(Boolean);
      const idx = deriveEngineFactionOrder(smOrder).indexOf(fac);
      if (idx >= 0) {
        const fk = parseFactionKnowledge(buf, smOrder, { tileIndex: buildTileIndex(args.mod) });
        const mine = fk.records.find((rec) => rec.factionIndex === idx);
        if (mine) {
          const names = mine.tuples.filter((t) => t.tag === 27 && t.settlement).map((t) => t.settlement);
          if (names.length) console.log(`     ${fac} scouted (${names.length}): ${names.slice(0, 20).join(", ")}${names.length > 20 ? " …" : ""}`);
        }
      }
    } catch (e) { /* name resolution optional */ }
  }
  console.log("");
}

main();
