// scripts/probe-treasury-history-keying.js — empirically determine which
// faction ordering correctly keys parseFactionTreasuryHistory.
//
// Crib: for the sub=8 (Republic) layout, faction records are positional and
// stable across consecutive turns. Ground-truth net for the faction at record
// position i = treasury_{T+1}[i] - treasury_{T}[i]. The econ-history table that
// physically precedes record i should have last-completed-net == that delta.
// Then we test naming orderings (engineOrder vs smOrder vs stratOrder) against
// the player identity and the structural net.
"use strict";
const fs = require("fs");
const path = require("path");
const x = require("../src/saveCrackerExtras.js");
const { crackSave } = require("../src/saveCracker.js");

const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const MOD = "C:\\RIS\\RIS\\data";

// re-read mod orderings the same way crackSave does (via exported helpers where possible)
const saveCracker = require("../src/saveCracker.js");

function readLines(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").replace(/^﻿/, "").split(/\r?\n/);
}

// stratOrder: descr_strat faction declaration order (same logic as readFactionOrderFromStrat)
function readStratOrder(modDataDir) {
  const p = path.join(modDataDir, "world\\maps\\campaign\\imperial_campaign\\descr_strat.txt");
  const lines = readLines(p);
  const order = [];
  // descr_strat has a faction list near the top. Reuse crackSave instead — easier:
  return null;
}

// Instead of duplicating, run crackSave to get its internal orders? crackSave
// doesn't return them. We re-derive smOrder/stratOrder/engineOrder via the
// exported deriveEngineFactionOrder + reading files the way the parsers do.

function readSmOrder(modDataDir) {
  // matches src/saveCracker.js readSmFactionsOrder
  const src = path.join(modDataDir, "descr_sm_factions.txt");
  if (!fs.existsSync(src)) return [];
  const out = [];
  for (const line of readLines(src)) {
    const m = line.match(/^\t"([a-z_0-9]+)":/);
    if (m) out.push(m[1].toLowerCase());
  }
  return out;
}

function readStrat(modDataDir) {
  const p = path.join(modDataDir, "world\\maps\\campaign\\imperial_campaign\\descr_strat.txt");
  const lines = readLines(p);
  // descr_strat first non-comment line after header is the playable+nonplayable
  // faction list, comma separated across a couple lines. Simpler: the parser
  // readFactionOrderFromStrat reads `faction <name>` blocks? Let's grep both.
  const order = [];
  for (const line of lines) {
    const m = line.match(/^\s*faction\s+([A-Za-z0-9_]+)/);
    if (m) order.push(m[1].toLowerCase());
  }
  return order;
}

function loadTreasuries(savePath) {
  const buf = fs.readFileSync(savePath);
  const recs = x.parseFactionTreasuries(buf);
  return { buf, recs };
}

// econ series physically before a record offset (same as campaign-report)
function econSeriesBefore(buf, recOff) {
  let start = -1;
  for (let off = recOff - 4; off >= recOff - 100000 && off >= 0; off -= 4) {
    if (buf.readUInt32LE(off) === off) { start = off; break; }
  }
  if (start < 0) return null;
  const f = [];
  for (let o = start; o + 4 <= recOff; o += 4) f.push(buf.readInt32LE(o));
  const body = f.slice(2, f.length - 1);
  if (body.length < 23 || body.length % 23 !== 0) return null;
  const nb = body.length / 23;
  const series = [];
  for (let b = 0; b < nb; b++) series.push(body[b * 23 + 13]);
  if (series.length && series[series.length - 1] === 0) series.pop();
  return series;
}

function main() {
  const j1 = loadTreasuries(path.join(SAVE_DIR, "save_julii1.sav"));
  const j2 = loadTreasuries(path.join(SAVE_DIR, "save_julii2.sav"));
  const j3 = loadTreasuries(path.join(SAVE_DIR, "save_julii3.sav"));

  console.log(`julii1 records: ${j1.recs.length}`);
  console.log(`julii2 records: ${j2.recs.length}`);
  console.log(`julii3 records: ${j3.recs.length}`);

  const smOrder = readSmOrder(MOD);
  const stratOrder = readStrat(MOD);
  const engineOrder = x.deriveEngineFactionOrder(stratOrder);
  console.log(`smOrder len=${smOrder.length}  stratOrder len=${stratOrder.length}  engineOrder len=${engineOrder.length}`);
  console.log(`smOrder[0..3]    = ${smOrder.slice(0,4).join(", ")}`);
  console.log(`stratOrder[0..3] = ${stratOrder.slice(0,4).join(", ")}`);
  console.log(`engineOrder[0..3]= ${engineOrder.slice(0,4).join(", ")}`);

  // positionalLayout? main.js: factionTreasuries.length > 30
  const positional = j1.recs.length > 30;
  console.log(`positionalLayout=${positional}`);

  // Per-save series-length distribution + show the full series for a few
  // high-treasury positions, alongside that save's treasury, to see how the
  // checkpoint timeline lines up.
  function lenDistOf(jj) { const d={}; for (let i=0;i<jj.recs.length;i++){const s=econSeriesBefore(jj.buf,jj.recs[i].offset); d[s?s.length:0]=(d[s?s.length:0]||0)+1;} return d; }
  console.log(`\nseries-length dist j1=${JSON.stringify(lenDistOf(j1))}`);
  console.log(`series-length dist j2=${JSON.stringify(lenDistOf(j2))}`);
  console.log(`series-length dist j3=${JSON.stringify(lenDistOf(j3))}`);
  console.log(`\nPer-position treasury across saves + j3 full series (first 12 nonzero positions):`);
  let sh=0;
  for (let i=0;i<j3.recs.length && sh<12;i++){
    const t1=j1.recs[i].treasury,t2=j2.recs[i].treasury,t3=j3.recs[i].treasury;
    if (t1===0&&t2===0&&t3===0) continue;
    const s3=econSeriesBefore(j3.buf,j3.recs[i].offset);
    console.log(`pos ${String(i).padStart(3)}: t=[${t1},${t2},${t3}]  j3series=[${(s3||[]).join(",")}]  sm=${smOrder[i]} engine=${engineOrder[i]}`);
    sh++;
  }

  // For positional layout, record position i is stable across turns. Build the
  // ground-truth net at each position from j2[i].treasury - j1[i].treasury, and
  // the history net from j1's record i (series[-1]-series[-2]) and from j2's
  // record i. Compare.
  const n = Math.min(j1.recs.length, j2.recs.length, j3.recs.length);
  let structMatch = 0, structTested = 0;
  const samples = [];
  for (let i = 0; i < n; i++) {
    const t1 = j1.recs[i].treasury, t2 = j2.recs[i].treasury, t3 = j3.recs[i].treasury;
    const gtNet_1to2 = t2 - t1;   // net realised during turn that ended producing j2
    const gtNet_2to3 = t3 - t2;
    // history in j2 (after the j1->j2 turn completed): its last completed net
    const sBefore_j2 = econSeriesBefore(j2.buf, j2.recs[i].offset);
    let histNet_j2 = null;
    if (sBefore_j2 && sBefore_j2.length >= 2) histNet_j2 = sBefore_j2[sBefore_j2.length-1] - sBefore_j2[sBefore_j2.length-2];
    samples.push({ i, t1, t2, t3, gtNet_1to2, gtNet_2to3, histNet_j2, slen: sBefore_j2 ? sBefore_j2.length : 0 });
    if (histNet_j2 != null && (t1 !== 0 || t2 !== 0)) {
      structTested++;
      if (histNet_j2 === gtNet_1to2) structMatch++;
    }
  }
  console.log(`\n[structural check] econ-history-before-record net == treasury-delta(T1->T2): ${structMatch}/${structTested} positions match`);
  // diagnostics: distribution of series lengths in j2
  const lenDist = {};
  for (const s of samples) lenDist[s.slen] = (lenDist[s.slen]||0)+1;
  console.log(`series-length distribution (j2): ${JSON.stringify(lenDist)}`);

  // Show a handful of nonzero positions with names under each candidate order.
  console.log(`\nidx | t1 -> t2 (gtNet) | histNet_j2 | sm name | strat name | engine name`);
  let shown = 0;
  for (const s of samples) {
    if (s.t1 === 0 && s.t2 === 0) continue;
    if (s.histNet_j2 == null) continue;
    const nm = (arr, i) => (i >= 0 && i < arr.length ? arr[i] : "?");
    console.log(`${String(s.i).padStart(3)} | ${String(s.t1).padStart(7)} -> ${String(s.t2).padStart(7)} (${String(s.gtNet_1to2).padStart(6)}) | ${String(s.histNet_j2).padStart(6)} | ${nm(smOrder,s.i).padEnd(20)} | ${nm(stratOrder,s.i).padEnd(20)} | ${nm(engineOrder,s.i)}`);
    if (++shown >= 30) break;
  }

  // What factionId does each record carry, and what series sits before it?
  console.log(`\n=== record factionId vs position (j3), with preceding series ===`);
  // determine which branch: sub value at +44+layoutShift
  for (let i = 0; i < 12; i++) {
    const r = j3.recs[i];
    const s = econSeriesBefore(j3.buf, r.offset);
    console.log(`recIdx ${i}: factionId=${r.factionId}  knowledgeSize=${r.knowledgeSize}  regionCount=${r.regionCount}  treasury=${r.treasury}  series=[${(s||[]).join(",")}]  smOrder[fid]=${smOrder[r.factionId]} smOrder[recIdx]=${smOrder[i]}`);
  }
  // count distinct factionId vs record count
  const ids = j3.recs.map(r=>r.factionId);
  const uniq = new Set(ids);
  console.log(`records=${j3.recs.length}  distinct factionId=${uniq.size}  hasKnowledgeSize=${j3.recs.filter(r=>r.knowledgeSize!=null).length}  hasRegionCount=${j3.recs.filter(r=>r.regionCount!=null).length}`);

  // === DECISIVE: identify each record by its STARTING treasury (j1) and check
  // which order's name[i] matches. Carthage starts 25500, Julii 17500. ===
  console.log(`\n=== record-position identity via starting treasury (j1) ===`);
  const startTreasuryName = { 17500: "romans_julii", 25500: "carthage", 22000: "antigonid" };
  for (const [tre, expect] of Object.entries(startTreasuryName)) {
    const pos = j1.recs.findIndex(r => r.treasury === Number(tre));
    console.log(`start-treasury ${tre} (expect ${expect}): record pos=${pos}  sm=${smOrder[pos]}  strat=${stratOrder[pos]}  engine=${engineOrder[pos]}  ` +
      `[sm ${smOrder[pos]===expect?"OK":"WRONG"}] [engine ${engineOrder[pos]===expect?"OK":"WRONG"}]`);
  }

  // === Score each candidate keying by checkpoint-tracks-treasury, using the
  // RECORD's own series + the SAME record's treasury timeline (no name->idx
  // round trip). For each record i with a 2-pt series, the candidate name is
  // cand(i); we verify the record's series tracks the record's treasuries. This
  // tests the ALIGNMENT (does record i belong where cand says) independent of
  // name. Then we separately check the NAME assignment. ===
  console.log(`\n=== keying-source scan (record series vs record treasury, j3) ===`);
  // First: confirm record series tracks the record's OWN treasury timeline
  // (this is the alignment-free structural truth — series belongs to the record).
  {
    let ok=0,bad=0; const ex=[];
    for (let i=0;i<n;i++){
      const s=econSeriesBefore(j3.buf,j3.recs[i].offset);
      if(!s||s.length<2) continue;
      const t1=j1.recs[i].treasury,t2=j2.recs[i].treasury;
      if(t1===0&&t2===0) continue;
      if(s[0]===0&&s[1]===0) continue; // player's own zeros
      const close=Math.abs(s[0]-t1)<=2000&&Math.abs(s[1]-t2)<=2000;
      if(close)ok++;else{bad++;if(ex.length<6)ex.push(`rec${i}: s=[${s[0]},${s[1]}] t=[${t1},${t2}]`);}
    }
    console.log(`series-before-record tracks SAME-record treasury: ok=${ok} bad=${bad}` + (ex.length?`\n   e.g. ${ex.join("\n        ")}`:""));
  }

  // Now test the ACTUAL keyed output of parseFactionTreasuryHistory under each
  // ordering, and validate against the structural ground truth using j3 (which
  // has 2 completed checkpoints → net = series[1]-series[0] ~= t2-t1).
  console.log(`\n=== parseFactionTreasuryHistory(j3) output validation (net = s[1]-s[0] vs t2-t1) ===`);
  for (const [label, order] of [["smOrder", smOrder], ["stratOrder", stratOrder], ["engineOrder", engineOrder]]) {
    const hist = x.parseFactionTreasuryHistory(j3.buf, j3.recs, order);
    if (!hist) { console.log(`${label}: null`); continue; }
    // The checkpoint series for faction NAME (series[0]=turn1 EOT, series[1]=turn2
    // EOT) should TRACK that faction's own treasury timeline t1=julii1, t2=julii2.
    // The checkpoint is an end-of-turn snapshot taken a hair before the in-save
    // current treasury, so allow a small tolerance. The faction whose CHECKPOINTS
    // match its TREASURIES is correctly named.
    const TOL = 1500; // checkpoint vs current-treasury slack
    let ok = 0, bad = 0; const badEx = [];
    for (const [name, series] of Object.entries(hist)) {
      if (series.length < 2) continue;
      const idx = order.indexOf(name);
      if (idx < 0 || idx >= n) continue;
      const t1 = j1.recs[idx].treasury, t2 = j2.recs[idx].treasury;
      if (t1 === 0 && t2 === 0) continue;
      const close = Math.abs(series[0] - t1) <= TOL && Math.abs(series[1] - t2) <= TOL;
      if (close) ok++; else { bad++; if (badEx.length < 8) badEx.push(`${name}: s=[${series[0]},${series[1]}] t=[${t1},${t2}]`); }
    }
    console.log(`${label}: checkpoint-tracks-treasury ok=${ok} bad=${bad}` + (badEx.length ? `\n      e.g. ${badEx.join("\n           ")}` : ""));
  }

  // === DECISIVE name-source scan: for each record, the series + treasury belong
  // to the RECORD (proven above). The record's TRUE faction = whoever has that
  // starting treasury. We know carthage/antigonid/etc by starting treasury, so we
  // just ask: which candidate name source (smOrder[recIdx] vs smOrder[factionId]
  // vs engineOrder[recIdx]) yields a faction whose descr_strat starting treasury
  // matches the record's j1 treasury? Use the j1 treasury as the identity crib. ===
  console.log(`\n=== name-source correctness (record j1-treasury identity crib) ===`);
  // Build a starting-treasury -> faction map from j1 by trusting the record's
  // OWN series-tracks-treasury alignment: we already proved record i's treasury
  // is real. The faction NAME for record i is whatever the engine assigned; we
  // grade candidate name fns by self-consistency: the named faction's treasury
  // (looked up by that name's record under the SAME candidate) must equal record
  // i's treasury. Simpler & direct: print the mapping for the diagnostic factions.
  const cribByTreasury = { 17500:"romans_julii", 25500:"carthage", 22000:"antigonid", 47000:"ptolemaic", 62500:"seleucid", 11000:"bactria" };
  for (const cand of ["smOrder[recIdx]","smOrder[factionId]","engineOrder[recIdx]"]) {
    let ok=0,bad=0; const ex=[];
    for (let i=0;i<n;i++){
      const t1=j1.recs[i].treasury;
      const expect=cribByTreasury[t1];
      if(!expect) continue;
      let nm;
      if(cand==="smOrder[recIdx]") nm=smOrder[i];
      else if(cand==="smOrder[factionId]") nm=smOrder[j3.recs[i].factionId];
      else nm=engineOrder[i];
      if(nm===expect) ok++; else { bad++; if(ex.length<8) ex.push(`rec${i} t=${t1} expect=${expect} got=${nm}`); }
    }
    console.log(`${cand}: ${ok}/${ok+bad} crib factions correct` + (ex.length?`  | ${ex.join(" ; ")}`:""));
  }

  // === FINAL: with the fix in place, print the named history for the crib
  // factions from parseFactionTreasuryHistory(j3) and show their treasury
  // timeline t=[julii1,julii2,julii3]. The LAST history checkpoint should be the
  // most recent COMPLETED turn's treasury (≈ julii2 since julii3's current turn
  // is unfinalized). ===
  console.log(`\n=== FINAL named-history check (fix applied; pass smOrder) ===`);
  const histFix = x.parseFactionTreasuryHistory(j3.buf, j3.recs, smOrder);
  const idxByName = {}; for (let i=0;i<smOrder.length;i++) idxByName[smOrder[i]]=i;
  for (const fac of ["carthage","antigonid","ptolemaic","seleucid","bactria"]) {
    const series = histFix[fac];
    const i = idxByName[fac];
    const t = [j1.recs[i].treasury, j2.recs[i].treasury, j3.recs[i].treasury];
    console.log(`${fac.padEnd(12)} history=[${(series||[]).join(",")}]   treasury(julii1,2,3)=[${t.join(",")}]`);
  }
}
main();
