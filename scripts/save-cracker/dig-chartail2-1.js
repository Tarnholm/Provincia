#!/usr/bin/env node
// dig-chartail2-1.js — exhaustive character tail-byte diff across save pairs.
//
// Goal: pin character record bytes +219..+285, +287..+301 (LAYOUT_A) by
// finding the same character across save pairs and listing ALL byte deltas.
//
// Pairs analyzed:
//   - Macedon T97 → T98 End → T99 Start (3-save sequence, late game)
//   - damagedturn1 → damagedturn2 (battle happened between)
//
// Method: match by primaryUuid + firstName + (lastName or '') + culture
// (parser already provides primaryUuid stably within a session).

const fs = require('fs');
const path = require('path');
const cp = require('C:/dev/Provincia/src/characterParser.js');

const MOD = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods/RIS beta/data";
const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames = [];
{
  const lines = fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/);
  for (const line of lines) {
    const tm = line.match(/^Trait\s+(\S+)/);
    if (tm) traitNames.push(tm[1]);
  }
}

function loadChars(savePath) {
  const buf = fs.readFileSync(savePath);
  const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);
  return { buf, recs };
}

function diffRange(bufA, offA, bufB, offB, lo, hi, layoutB) {
  // layoutB if true means LAYOUT_B; the offsets are absolute. We compare
  // bytes [offA+lo..offA+hi) to [offB+lo..offB+hi).
  const diffs = [];
  for (let i = lo; i < hi; i++) {
    if (bufA[offA + i] !== bufB[offB + i]) {
      diffs.push({ rel: i, a: bufA[offA + i], b: bufB[offB + i] });
    }
  }
  return diffs;
}

function matchChars(A, B) {
  // Match by primaryUuid (best), fall back to firstName+lastName.
  const byUuid = new Map();
  for (const r of B.recs) byUuid.set(r.primaryUuid, r);
  const matches = [];
  for (const ra of A.recs) {
    const rb = byUuid.get(ra.primaryUuid);
    if (rb && rb.firstName === ra.firstName) {
      matches.push({ a: ra, b: rb, layoutB: !ra.lastName });
    }
  }
  return matches;
}

function summarize(label, A, B) {
  const matches = matchChars(A, B);
  console.log(`\n=== ${label} — ${matches.length} characters matched by uuid+name ===`);
  // Aggregate diffs across all matches
  const aggA = new Map(); // rel -> { count, examples }
  const aggB = new Map();
  for (const m of matches) {
    const hi = m.layoutB ? 298 : 302; // up to traitCount
    const diffs = diffRange(A.buf, m.a.offset, B.buf, m.b.offset, 0, hi);
    for (const d of diffs) {
      if (!aggA.has(d.rel)) aggA.set(d.rel, []);
      aggA.get(d.rel).push({ a: d.a, b: d.b, char: m.a.firstName + (m.a.lastName ? ' ' + m.a.lastName : '') });
    }
  }
  // Print bytes that changed for >=1 char, sorted by relative offset
  const sortedRels = [...aggA.keys()].sort((a, b) => a - b);
  for (const rel of sortedRels) {
    const list = aggA.get(rel);
    const examples = list.slice(0, 3).map(e => `${e.char}:${e.a}->${e.b}`).join(', ');
    console.log(`  +${rel.toString().padStart(3)}: ${list.length} chars changed; ${examples}${list.length > 3 ? ', ...' : ''}`);
  }
  // Focus zone: +219..+301
  console.log(`  [Focus +219..+301]:`);
  const focusRels = sortedRels.filter(r => r >= 219 && r < 302);
  if (focusRels.length === 0) console.log(`    (no changes in focus zone)`);
  else for (const rel of focusRels) {
    const list = aggA.get(rel);
    const examples = list.slice(0, 5).map(e => `${e.char}:${e.a}->${e.b}`).join(', ');
    console.log(`    +${rel}: ${list.length} chars; ${examples}${list.length > 5 ? ', ...' : ''}`);
  }
}

const ALEX = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves";
const T97 = loadChars(path.join(ALEX, 'save_Autosave   Macedon   Turn 97.sav'));
const T98E = loadChars(path.join(ALEX, 'save_Autosave   Macedon   Turn 98 End.sav'));
const T99S = loadChars(path.join(ALEX, 'save_Autosave   Macedon   Turn 99 Start.sav'));
const DAM1 = loadChars(path.join(ALEX, 'save_damagedturn1.sav'));
const DAM2 = loadChars(path.join(ALEX, 'save_damagedturn2.sav'));

console.log(`T97: ${T97.recs.length} chars (${T97.recs.filter(r=>r.lastName).length} LAYOUT_A)`);
console.log(`T98E: ${T98E.recs.length} chars`);
console.log(`T99S: ${T99S.recs.length} chars`);
console.log(`DAM1: ${DAM1.recs.length} chars`);
console.log(`DAM2: ${DAM2.recs.length} chars`);

summarize('Macedon T97 → T98 End', T97, T98E);
summarize('Macedon T98 End → T99 Start', T98E, T99S);
summarize('damagedturn1 → damagedturn2', DAM1, DAM2);
