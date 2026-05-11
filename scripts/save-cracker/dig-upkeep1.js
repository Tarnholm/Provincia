// dig-upkeep1.js — session 9
//
// Goal: locate per-faction military upkeep (or other per-turn finance values)
// in the major-faction-record trailing data.
//
// Strategy:
//   - Locate Romans Julii (player, major record idx 0) and ALL 23 major records
//     across rome1..rome10.
//   - For each record, compare bytes from +56 .. +(record_end) across saves.
//   - Within-turn pairs (rome5/rome6) should produce minimal diff if upkeep
//     is constant. Turn-boundary pairs (rome6/rome7) should change upkeep
//     if the AI is recalculating.
//   - rome10 = same in-game state different session → identify runtime-pointer
//     bytes (drop them).
//
// What we're looking for: u32 fields in the 200-3000 denarii range that
// match a plausible upkeep estimate (single-army-per-faction = 30-150,
// large empire = 1000+).

const fs = require("fs");
const path = require("path");

const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function findMajorRecords(buf) {
  const hits = [];
  for (let i = 0; i + 64 < buf.length; i += 1) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 32) !== 0 || buf.readUInt32LE(i + 36) !== 0) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    const regionCount = buf.readUInt32LE(i + 48);
    if (regionCount > 200) continue;
    const treasury = buf.readInt32LE(i);
    hits.push({ pos: i, treasury, regionCount });
  }
  return hits;
}

function loadAll() {
  const out = {};
  for (const n of ["rome1", "rome2", "rome3", "rome4", "rome5.", "rome6", "rome7", "rome8", "rome9", "rome10"]) {
    const fn = path.join(SAVES, `save_${n}.sav`);
    if (!fs.existsSync(fn)) { console.log("MISS", fn); continue; }
    out[n] = { buf: fs.readFileSync(fn), recs: null };
    out[n].recs = findMajorRecords(out[n].buf);
  }
  return out;
}

function main() {
  const saves = loadAll();
  const names = Object.keys(saves);

  console.log("=== Major record counts and player treasury ===");
  for (const n of names) {
    const s = saves[n];
    console.log(`${n}: records=${s.recs.length}, player[0].treasury=${s.recs[0].treasury}, player[0].regions=${s.recs[0].regionCount}, player[0].pos=0x${s.recs[0].pos.toString(16)}`);
  }

  // For Romans Julii (player, idx 0): walk the trailing data.
  // The record size is variable (until next record begins). Pick the byte range from
  // +96 (after region list end + treasury snapshot) onwards.
  //
  // Take player record in rome5, rome6 (within turn), rome7 (turn boundary), rome10 (diff session)
  console.log("\n=== Player record sizes (distance to next record start) ===");
  for (const n of names) {
    const s = saves[n];
    const p = s.recs[0].pos;
    const p1 = s.recs.length > 1 ? s.recs[1].pos : null;
    console.log(`${n}: player rec at 0x${p.toString(16)}, next rec at 0x${(p1 || 0).toString(16)}, size=${p1 ? p1 - p : "?"}`);
  }

  // Build a diff table: for each u32 dword index from 0..min(size)/4, list values across all 10 saves.
  // Look for u32s that change at turn boundary (rome6 → rome7) but stay same within-turn
  // AND stay same in rome10 (different session — eliminates pointers).
  const idx = 0; // player
  const r5 = saves["rome5."]; // typo in filename
  const r6 = saves["rome6"];
  const r7 = saves["rome7"];
  const r10 = saves["rome10"];

  if (!r5 || !r6 || !r7 || !r10) {
    console.log("Missing critical save"); return;
  }

  const p5 = r5.recs[idx].pos;
  const p6 = r6.recs[idx].pos;
  const p7 = r7.recs[idx].pos;
  const p10 = r10.recs[idx].pos;

  // Find next-record positions to bound the scan
  const e5 = r5.recs[idx+1] ? r5.recs[idx+1].pos : p5 + 200000;
  const e6 = r6.recs[idx+1] ? r6.recs[idx+1].pos : p6 + 200000;
  const e7 = r7.recs[idx+1] ? r7.recs[idx+1].pos : p7 + 200000;
  const e10 = r10.recs[idx+1] ? r10.recs[idx+1].pos : p10 + 200000;

  const maxLen = Math.min(e5 - p5, e6 - p6, e7 - p7, e10 - p10);
  console.log(`\nPlayer record bounded size for diff: ${maxLen} bytes (max u32 dwords: ${Math.floor(maxLen / 4)})`);

  // For each dword offset, classify:
  //   stable: all four equal
  //   pointer: rome5 vs rome10 differ (different session)
  //   turnBoundary: rome5==rome6 && rome6!=rome7 && rome5==rome10 (same session, but changes at turn end)
  //   withinTurn: rome5 != rome6 — game state delta during the same turn
  const cats = { stable: 0, pointer: 0, turnBoundary: 0, withinTurn: 0, other: 0 };
  const tbHits = [];

  for (let dw = 0; dw * 4 + 4 < maxLen; dw++) {
    const off = dw * 4;
    const v5 = r5.buf.readUInt32LE(p5 + off);
    const v6 = r6.buf.readUInt32LE(p6 + off);
    const v7 = r7.buf.readUInt32LE(p7 + off);
    const v10 = r10.buf.readUInt32LE(p10 + off);
    if (v5 === v6 && v6 === v7 && v7 === v10) { cats.stable++; continue; }
    // session pointer: r5 != r10 but matches all else
    const sessionDiff = v5 !== v10;
    const turnDiff = v6 !== v7;
    const withinTurn = v5 !== v6;

    if (sessionDiff && !turnDiff && !withinTurn) {
      cats.pointer++;
    } else if (!sessionDiff && turnDiff && !withinTurn) {
      cats.turnBoundary++;
      const v5s = v5 > 2**31 ? v5 - 2**32 : v5;
      const v7s = v7 > 2**31 ? v7 - 2**32 : v7;
      tbHits.push({ off, v5s, v7s, delta: v7s - v5s });
    } else if (withinTurn) {
      cats.withinTurn++;
    } else {
      cats.other++;
    }
  }

  console.log("\n=== Classification ===");
  console.log("Stable u32s (across all 4 saves):", cats.stable);
  console.log("Session-pointer u32s:", cats.pointer);
  console.log("Turn-boundary u32s (CANDIDATES for game-state):", cats.turnBoundary);
  console.log("Within-turn u32s:", cats.withinTurn);
  console.log("Other:", cats.other);

  console.log("\n=== Turn-boundary candidates (first 80, with small magnitudes) ===");
  // Filter for plausible game-state values: small magnitude
  const plausible = tbHits.filter(h => Math.abs(h.v5s) < 200000 && Math.abs(h.v7s) < 200000);
  console.log(`Total turn-boundary u32s with |value|<200k: ${plausible.length}`);
  for (const h of plausible.slice(0, 80)) {
    console.log(`  +${h.off.toString().padStart(5)}: ${String(h.v5s).padStart(8)} → ${String(h.v7s).padStart(8)} (Δ=${h.delta})`);
  }
}

main();
