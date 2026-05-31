// scripts/diff-saves.js — semantic diff between two RTW Remastered saves.
//
// Cracks both saves (crackSave) and reports, in human terms, exactly what the
// engine changed between them: settlement captures, treasury moves, diplomacy
// shifts, sieges started/ended, family births/deaths/marriages, AI-knowledge
// growth, and the authoritative end-of-turn event log delta. The practical
// payoff of the save-format reverse-engineering — run an in-game action, save
// before/after, and see precisely what changed.
//
// Usage:
//   node scripts/diff-saves.js <before.sav> <after.sav> [--mod <modDataDir>] [--json]

"use strict";
const fs = require("fs");
const path = require("path");
const { crackSave } = require("../src/saveCracker.js");
const { diffTurn } = require("../src/eventLogParser.js");

function parseArgs(argv) {
  const a = { before: null, after: null, mod: "C:\\RIS\\RIS\\data", json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--mod") a.mod = argv[++i];
    else if (argv[i] === "--json") a.json = true;
    else if (!a.before) a.before = argv[i];
    else if (!a.after) a.after = argv[i];
  }
  return a;
}

function sec(title) { console.log(`\n-- ${title} --`); }

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.before || !args.after) {
    console.error("usage: node scripts/diff-saves.js <before.sav> <after.sav> [--mod <dir>] [--json]");
    process.exit(1);
  }
  for (const p of [args.before, args.after]) {
    if (!fs.existsSync(p)) { console.error("not found:", p); process.exit(1); }
  }
  const A = crackSave(fs.readFileSync(args.before), args.mod);
  const B = crackSave(fs.readFileSync(args.after), args.mod);
  const diff = computeDiff(A, B);
  if (args.json) { console.log(JSON.stringify(diff, null, 2)); return; }
  report(A, B, diff, args);
}

function computeDiff(A, B) {
  const d = {};
  // Settlement ownership (captures)
  d.captures = [];
  const ownA = A.ownerByCity || {}, ownB = B.ownerByCity || {};
  for (const city of Object.keys(ownB)) {
    if (ownA[city] && ownA[city] !== ownB[city]) d.captures.push({ city, from: ownA[city], to: ownB[city] });
  }
  // Treasury deltas
  d.treasury = [];
  for (const [name, fb] of Object.entries(B.factions || {})) {
    const fa = A.factions && A.factions[name];
    if (fa && fa.treasury != null && fb.treasury != null && fa.treasury !== fb.treasury) {
      d.treasury.push({ faction: name, from: fa.treasury, to: fb.treasury, delta: fb.treasury - fa.treasury });
    }
  }
  d.treasury.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  // Diplomacy shifts (per faction: new/ended wars & alliances)
  d.diplomacy = [];
  for (const [name, db] of Object.entries(B.diplomacy || {})) {
    if (name === "_meta") continue;
    const da = (A.diplomacy && A.diplomacy[name]) || null;
    if (!da) continue;
    const setDiff = (x, y) => (x || []).filter((v) => !(y || []).includes(v));
    const newWar = setDiff(db.war, da.war), endWar = setDiff(da.war, db.war);
    const newAlly = setDiff(db.allied, da.allied), endAlly = setDiff(da.allied, db.allied);
    if (newWar.length || endWar.length || newAlly.length || endAlly.length) {
      d.diplomacy.push({ faction: name, newWar, endWar, newAlly, endAlly });
    }
  }
  // Sieges by siegeId
  const sidsA = new Set((A.sieges || []).map((s) => s.siegeId));
  const sidsB = new Set((B.sieges || []).map((s) => s.siegeId));
  d.siegesStarted = (B.sieges || []).filter((s) => !sidsA.has(s.siegeId));
  d.siegesEnded = (A.sieges || []).filter((s) => !sidsB.has(s.siegeId));
  // Family births / deaths / marriages (by uuid)
  const famA = new Map((A.characters?.family || []).map((m) => [m.uuid >>> 0, m]));
  const famB = new Map((B.characters?.family || []).map((m) => [m.uuid >>> 0, m]));
  d.births = []; d.deaths = []; d.marriages = [];
  for (const [uuid, mb] of famB) {
    const ma = famA.get(uuid);
    if (!ma) { d.births.push({ name: mb.fullName, gender: mb.gender, age: mb.age, faction: mb.faction }); continue; }
    if (ma.alive && !mb.alive) d.deaths.push({ name: mb.fullName, age: mb.age, faction: mb.faction });
    if (!ma.spouseUuid && mb.spouseUuid) d.marriages.push({ name: mb.fullName, spouse: mb.spouseName || mb.spouseUuid });
  }
  // AI knowledge growth (per faction known-settlement count delta)
  d.knowledge = [];
  const pkA = (A.factionKnowledge && A.factionKnowledge.perFaction) || {};
  const pkB = (B.factionKnowledge && B.factionKnowledge.perFaction) || {};
  for (const [name, vb] of Object.entries(pkB)) {
    const va = pkA[name];
    if (va && vb.knownSettlements !== va.knownSettlements) {
      d.knowledge.push({ faction: name, delta: vb.knownSettlements - va.knownSettlements });
    }
  }
  d.knowledge.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  // Authoritative end-of-turn event-log delta
  d.events = diffTurn(A.events || [], B.events || []);
  return d;
}

function report(A, B, d, args) {
  console.log(`\n=== ${path.basename(args.before)}  →  ${path.basename(args.after)} ===`);
  console.log(`turn ${A.turn} → ${B.turn}   player ${B.playerFaction}`);

  if (d.captures.length) { sec(`settlement captures (${d.captures.length})`); for (const c of d.captures.slice(0, 30)) console.log(`  ${c.city}: ${c.from} → ${c.to}`); }
  if (d.siegesStarted.length || d.siegesEnded.length) {
    sec(`sieges (+${d.siegesStarted.length} started, -${d.siegesEnded.length} ended)`);
    for (const s of d.siegesStarted.slice(0, 20)) console.log(`  started: ${s.targetSettlement || "(fort)"} (${s.turnsRemaining}t)`);
    for (const s of d.siegesEnded.slice(0, 20)) console.log(`  ended:   ${s.targetSettlement || "(fort)"}`);
  }
  if (d.diplomacy.length) {
    sec(`diplomacy changes (${d.diplomacy.length} factions)`);
    for (const x of d.diplomacy.slice(0, 20)) {
      const parts = [];
      if (x.newWar.length) parts.push(`+war ${x.newWar.join("/")}`);
      if (x.endWar.length) parts.push(`-war ${x.endWar.join("/")}`);
      if (x.newAlly.length) parts.push(`+ally ${x.newAlly.join("/")}`);
      if (x.endAlly.length) parts.push(`-ally ${x.endAlly.join("/")}`);
      console.log(`  ${x.faction}: ${parts.join(", ")}`);
    }
  }
  if (d.births.length || d.deaths.length || d.marriages.length) {
    sec(`family: ${d.births.length} new members (births/coming-of-age), ${d.deaths.length} deaths, ${d.marriages.length} marriages`);
    for (const b of d.births.slice(0, 15)) console.log(`  new:     ${b.name} (${b.gender}, ${b.faction || "?"})`);
    for (const x of d.deaths.slice(0, 15)) console.log(`  died:    ${x.name} (age ${x.age}, ${x.faction || "?"})`);
    for (const m of d.marriages.slice(0, 15)) console.log(`  married: ${m.name} ⚭ ${m.spouse}`);
  }
  if (d.treasury.length) { sec(`treasury movers (top 12 of ${d.treasury.length})`); for (const t of d.treasury.slice(0, 12)) console.log(`  ${t.faction}: ${t.from} → ${t.to} (${t.delta >= 0 ? "+" : ""}${t.delta})`); }
  if (d.knowledge.length) { sec(`AI knowledge growth (top 10)`); for (const k of d.knowledge.slice(0, 10)) console.log(`  ${k.faction}: ${k.delta >= 0 ? "+" : ""}${k.delta} settlements`); }
  if (d.events.length) {
    const hist = {};
    for (const e of d.events) hist[e.type] = (hist[e.type] || 0) + 1;
    sec(`event log: ${d.events.length} new events this turn`);
    console.log("  " + Object.entries(hist).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}:${n}`).join("  "));
  }
  console.log("");
}

main();
