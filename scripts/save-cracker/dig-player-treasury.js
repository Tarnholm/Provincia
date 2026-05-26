// dig-player-treasury.js
//
// Goal: locate the PLAYER faction's current treasury in an RTW:RR save.
//
// Hypothesis under test: the existing parseFactionTreasuries() class-100
// record scan ALREADY captures the player's faction record (it is NOT in a
// separate section). We validate by:
//   1. Listing all class-100 records + treasuries.
//   2. Bridging each record to a faction name via embedded faction-icon /
//      symbol paths and via region-id overlap with descr_strat, NOT via the
//      brittle captain-banner-after-record heuristic.
//   3. Confirming the record whose treasury == the player's descr_strat
//      starting wealth is the player.
//   4. Cross-validating against the arretium turn 2/3/4 saves (different
//      player faction, treasury must change turn-to-turn).
//
// Pure read-only diagnostic. Does not touch app code.

"use strict";

const fs = require("fs");
const path = require("path");
const ex = require(path.join(__dirname, "..", "..", "src", "saveCrackerExtras.js"));

const SAVES_DIR =
  "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";
const FIXTURES = path.join(__dirname, "fixtures", "feral");

// ── helpers ──────────────────────────────────────────────────────────────

// Collect every distinct ASCII path token of form `<prefix><name><.>` inside
// [start,end). Returns {name: count}.
function bannersInRange(buf, start, end, prefix) {
  const t = Buffer.from(prefix, "ascii");
  const out = {};
  let p = start;
  while ((p = buf.indexOf(t, p)) !== -1 && p < end) {
    let e = p + t.length;
    while (e < p + 80 && buf[e] !== 0x2e && buf[e] >= 0x20 && buf[e] < 0x7f) e++;
    const nm = buf.slice(p + t.length, e).toString("ascii");
    out[nm] = (out[nm] || 0) + 1;
    p = e;
  }
  return out;
}

function dominant(obj) {
  const es = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  return es.length ? es[0][0] : null;
}

// Read the i32 immediately preceding a record start (some records may carry
// a different value); also dump a hex window for manual inspection.
function hexWindow(buf, at, before, after) {
  const s = Math.max(0, at - before);
  const e = Math.min(buf.length, at + after);
  let out = "";
  for (let i = s; i < e; i++) {
    if ((i - s) % 16 === 0) out += "\n0x" + i.toString(16).padStart(7, "0") + ": ";
    out += buf[i].toString(16).padStart(2, "0") + " ";
  }
  return out;
}

function analyze(label, buf, expectedPlayerWealth) {
  console.log("\n================ " + label + " ================");
  const recs = ex.parseFactionTreasuries(buf);
  console.log("class-100 records found: " + recs.length);

  // Bridge each record to a faction by the SYMBOL/banner path that appears
  // INSIDE the record's own byte range (captain_card_X belongs to the captains
  // OF that faction, written within the faction's own record).
  const rows = [];
  for (let i = 0; i < recs.length; i++) {
    const start = recs[i].offset;
    const end = i + 1 < recs.length ? recs[i + 1].offset : buf.length;
    const cap = bannersInRange(buf, start, end, "captain_card_");
    rows.push({
      i,
      off: recs[i].offset,
      treasury: recs[i].treasury,
      turnStart: recs[i].turnStartTreasury,
      regions: recs[i].regionCount,
      factionIdByte: recs[i].factionId,
      captainBanner: dominant(cap),
      captainBanners: cap,
    });
  }

  for (const r of rows) {
    console.log(
      `rec${r.i} off=0x${r.off.toString(16)} treas=${r.treasury} turnStart=${r.turnStart} reg=${r.regions} fidByte=${r.factionIdByte} capBanner=${r.captainBanner}`
    );
  }

  // Find which record(s) match the expected player wealth.
  if (expectedPlayerWealth != null) {
    const matches = rows.filter((r) => r.treasury === expectedPlayerWealth);
    console.log(
      `\n>>> records with treasury == expected player wealth (${expectedPlayerWealth}): ${matches.length}`
    );
    for (const m of matches) {
      console.log(`    rec${m.i} off=0x${m.off.toString(16)} reg=${m.regions} capBanner=${m.captainBanner}`);
    }
  }

  return rows;
}

// ── main ───────────────────────────────────────────────────────────────────

// Macedon T0: player = antigonid, expected wealth 7500.
const macedon = fs.readFileSync(SAVES_DIR + "save_macedon t0.sav");
analyze("save_macedon t0  (player=antigonid, expect 7500)", macedon, 7500);

// Antigonid Kingdom Turn 1 autosave: same player faction, turn 1 — treasury
// should be 7500 + income (so >= 7500, plausibly higher).
try {
  const antT1 = fs.readFileSync(SAVES_DIR + "save_Autosave   Antigonid Kingdom   Turn 1.sav");
  analyze("save_Autosave Antigonid Kingdom Turn 1  (player=antigonid)", antT1, 7500);
} catch (e) {
  console.log("antigonid T1 autosave not readable: " + e.message);
}

// ── Cross-validation: track the player's treasury across turns ───────────────
// The player record is located generically by REGION-ID SET (a faction's
// starting region set is stable; lock it from the earliest save, then follow
// the same set across later turns). This avoids the unreliable factionId byte
// and captain-banner heuristics.
function regionKey(rec) {
  return rec.regionIds.slice().sort((a, b) => a - b).join(",");
}

function trackPlayer(label, files, lockReg) {
  console.log("\n---- cross-validation: " + label + " ----");
  let lockedKey = null;
  for (const f of files) {
    let buf;
    try { buf = fs.readFileSync(SAVES_DIR + f); } catch (e) {
      console.log("  " + f + ": MISSING"); continue;
    }
    const recs = ex.parseFactionTreasuries(buf);
    if (lockedKey === null) {
      const seed = recs.find((r) => r.regionCount === lockReg);
      lockedKey = seed ? regionKey(seed) : null;
    }
    const rec = lockedKey ? recs.find((r) => regionKey(r) === lockedKey) : null;
    console.log(
      "  " + f.padEnd(44) +
      " player treasury=" + (rec ? rec.treasury : "??") +
      " (slot=" + (rec ? recs.indexOf(rec) : "?") + ", regions=" + (rec ? rec.regionCount : "?") + ")"
    );
  }
}

// Arretium player = romans_julii (22 starting regions in these saves).
trackPlayer("Arretium player=romans_julii (expect 10000 then rising)", [
  "save_arretium pre retrained..sav",
  "save_arretium retrained turn 2.sav",
  "save_arretium turn 3.sav",
  "save_arretium turn 4.sav",
], 22);

console.log("\n\n############ done ############");
