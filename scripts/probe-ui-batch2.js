// scripts/probe-ui-batch2.js — validate the FOUR UI-batch-2 data paths end-to-end
// against real saves, WITHOUT the renderer (we can't visually test headless).
//
//   1. eventSchedule records reach the parser WITH positions (x,y) for map markers
//   2. diffTurn yields sane deltas across a consecutive turn pair (T5→T8)
//   3. factionKnowledge perFaction resolves to faction NAMES + counts
//   4. (timeline) crackSave sorts saves by turn — exercised by feature-3 probe below
//
// Usage: node scripts/probe-ui-batch2.js
"use strict";

const fs = require("fs");
const path = require("path");

const { parseEventLog, diffTurn } = require("../src/eventLogParser.js");
const { parseEventSchedule } = require("../src/eventScheduleParser.js");
const { parseFactionKnowledge } = require("../src/factionKnowledgeParser.js");
const { deriveEngineFactionOrder } = require("../src/saveCrackerExtras.js");

const MOD = "C:/RIS/RIS/data";
const FERAL = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const CRASH = "C:/dev/crash-saves-v7.2";

function stratOrder(modDir) {
  const src = path.join(modDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
  const out = [];
  if (!fs.existsSync(src)) return out;
  for (const line of fs.readFileSync(src, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*faction\s+([a-z_0-9]+)/i);
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

const order = stratOrder(MOD);
const engineOrder = deriveEngineFactionOrder(order);
console.log(`stratOrder factions: ${order.length}; engineOrder[0]=${engineOrder[0]}, engineOrder[last]=${engineOrder[engineOrder.length-1]}`);

function probe(label, savePath) {
  if (!fs.existsSync(savePath)) { console.log(`\n## ${label}: MISSING ${savePath}`); return null; }
  const buf = fs.readFileSync(savePath);
  console.log(`\n## ${label} (${(buf.length/1e6).toFixed(1)} MB)`);

  // --- Feature 2: event schedule ---
  const sched = parseEventSchedule(buf);
  if (!sched) { console.log("  eventSchedule: NULL (not located)"); }
  else {
    const withPos = sched.records.filter(r => r.x != null && r.y != null);
    const rnd = sched.records.filter(r => r.isRandom);
    const cats = {};
    for (const r of sched.records) cats[r.category] = (cats[r.category]||0)+1;
    console.log(`  eventSchedule: count=${sched.count}, withPosition=${withPos.length}, random=${rnd.length}`);
    console.log(`    categories: ${Object.entries(cats).map(([k,v])=>`${k}:${v}`).join(", ")}`);
    const sample = withPos.slice(0,3).map(r=>`${r.category}@(${r.x},${r.y}) ${r.year}${r.year<0?"BC":"AD"}/${r.season}${r.warning?" [WARN]":""}${r.isRandom?" [rnd]":""}`);
    console.log(`    sample positioned: ${sample.join(" | ") || "(none)"}`);
  }

  // --- Feature 4: faction knowledge summary ---
  const fk = parseFactionKnowledge(buf, order);
  const perFaction = {};
  for (const r of fk.records) {
    const name = engineOrder[r.factionIndex];
    if (name) perFaction[name] = { knownTiles: r.tupleCount, knownSettlements: r.fullCount };
  }
  const named = Object.entries(perFaction).sort((a,b)=>b[1].knownSettlements-a[1].knownSettlements);
  console.log(`  factionKnowledge: ${fk.records.length} factions with tails, ${fk.totalTuples} tuples; named=${named.length}`);
  console.log(`    top scouts: ${named.slice(0,5).map(([n,v])=>`${n}=${v.knownSettlements}s/${v.knownTiles}t`).join(", ")}`);

  // --- event log (for diff) ---
  const log = parseEventLog(buf, order);
  const byType = {};
  for (const e of log) byType[e.type] = (byType[e.type]||0)+1;
  console.log(`  eventLog: ${log.length} records; types: ${Object.entries(byType).map(([k,v])=>`${k}:${v}`).join(", ") || "(none)"}`);

  return { log, sched, fk: perFaction };
}

// Feature 2 + 4 across a spread of saves
probe("julii1", path.join(FERAL, "save_julii1.sav"));
probe("Carthage1", path.join(FERAL, "save_Carthage1.sav"));

// Feature 1: diffTurn on a CONSECUTIVE RoR pair (T5 Start → T8 End).
const t5 = path.join(CRASH, "2026-05-30__Raymond__save_Autosave_Republic_of_Rome_Turn_5_Start", "save_Autosave   Republic of Rome   Turn 5 Start.sav");
const t8 = path.join(CRASH, "2026-05-30__Raymond__save_Autosave_Republic_of_Rome_Turn_8_End", "save_Autosave   Republic of Rome   Turn 8 End.sav");
const a = probe("RoR T5 Start", t5);
const b = probe("RoR T8 End", t8);
if (a && b) {
  const newEvents = diffTurn(a.log, b.log);
  const byType = {};
  for (const e of newEvents) byType[e.type] = (byType[e.type]||0)+1;
  console.log(`\n## DIFF T5→T8: ${a.log.length} → ${b.log.length} log records; ${newEvents.length} NEW events`);
  console.log(`  new by type: ${Object.entries(byType).map(([k,v])=>`${k}:${v}`).join(", ") || "(none)"}`);
  console.log(`  sample new: ${newEvents.slice(0,8).map(e=>`[${e.type}] ${e.faction||"?"}: ${e.subject}`).join(" | ")}`);
  // Reverse: T8 vs T5 should also yield "removed"? No — log is append-only, so
  // diffTurn(b,a) should be ~empty (a is a SUBSET of b if same chain).
  const rev = diffTurn(b.log, a.log);
  console.log(`  reverse diff (T8 as 'before', T5 as 'after'): ${rev.length} (expect ~0 if append-only same-chain)`);
}
