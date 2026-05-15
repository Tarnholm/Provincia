// dig-89slot-s92.js
// Session 92: classify the 89-row x 35-byte head table at 0x4556..0x5181.
// Session 66 confirmed structure; this attempt classifies semantics.
//
// Hypotheses to test:
//  - 89 = ???  RTW engine constants: 31 factions, ~5000 characters,
//    diplomats/spies/assassins per-faction agent rosters, settlements, etc.
//  - Likely candidates: 89 == max named scripts? 89 named events?
//    Provincia uses ~20 factions; 89 could be MAX_FACTIONS in vanilla RTW.
//  - Check live-row growth across saves (does it grow turn by turn?)
//  - Check if any of the 35 bytes per row decode as known UUIDs.
//
// Method:
//  1. Walk all 89 rows in each save.
//  2. Tag rows as ZERO / SPARSE / LIVE (sparse = some bytes set but < ~12 set bytes).
//  3. Dump non-zero rows raw hex + per-field u32/u16/u8 candidates.
//  4. Look for ASCII bits (>= 3 printable consecutive chars).
//  5. Look up u32 candidates against any reference set we have.
//  6. Compare LIVE counts across saves.

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const SAVES = [
  "save_1.2.sav",
  "save_2.2.sav",
  "save_3.2.sav",
  "save_Autosave   Republic of Rome   Turn 2 Start.sav",
];
const ROW_START = 0x4556;
const ROW_END   = 0x5181;
const STRIDE    = 35;
const N_ROWS    = (ROW_END - ROW_START) / STRIDE; // 89

function isPrintable(b) {
  return (b >= 0x20 && b < 0x7f);
}
function extractAscii(buf) {
  // any run >= 3 printables
  const runs = [];
  let cur = "";
  for (const b of buf) {
    if (isPrintable(b)) cur += String.fromCharCode(b);
    else {
      if (cur.length >= 3) runs.push(cur);
      cur = "";
    }
  }
  if (cur.length >= 3) runs.push(cur);
  return runs;
}

function classifyRow(row) {
  let nonZero = 0;
  for (const b of row) if (b !== 0) nonZero++;
  // sentinel 1e 00 00 00 at +31 always present — subtract from nonZero check
  const nz = nonZero - 1; // sentinel byte counts once (just 0x1e)
  if (nz <= 0) return "ZERO";
  if (nz < 10) return "SPARSE";
  return "LIVE";
}

function dumpSave(savePath) {
  console.log("\n================================================================");
  console.log("SAVE:", path.basename(savePath));
  console.log("================================================================");
  const buf = fs.readFileSync(savePath);
  console.log(`size: ${buf.length} bytes (0x${buf.length.toString(16)})`);

  // Verify the table is at the expected location.
  // Sentinel check: 89/89 rows should have 1e 00 00 00 at +31.
  let sentHits = 0;
  for (let i = 0; i < N_ROWS; i++) {
    const r = ROW_START + i * STRIDE;
    if (buf.readUInt32LE(r + 31) === 0x0000001e) sentHits++;
  }
  console.log(`sentinel 1e000000 @+31: ${sentHits}/${N_ROWS}`);

  const buckets = { ZERO: 0, SPARSE: 0, LIVE: 0 };
  const interesting = [];
  for (let i = 0; i < N_ROWS; i++) {
    const r = ROW_START + i * STRIDE;
    const row = buf.slice(r, r + STRIDE);
    const cls = classifyRow(row);
    buckets[cls]++;
    if (cls !== "ZERO") interesting.push({ idx: i, off: r, cls, row });
  }
  console.log(`row classes: LIVE=${buckets.LIVE}, SPARSE=${buckets.SPARSE}, ZERO=${buckets.ZERO}`);

  console.log("\nnon-zero rows (hex + decoded):");
  for (const { idx, off, cls, row } of interesting) {
    console.log(`\n  row ${idx.toString().padStart(2)} @0x${off.toString(16)} [${cls}]`);
    console.log(`    hex: ${row.toString("hex").match(/.{1,8}/g).join(" ")}`);
    // per-u32
    const u32s = [];
    for (let o = 0; o + 4 <= STRIDE; o += 1) {
      u32s.push({ off: o, v: row.readUInt32LE(o) });
    }
    // print aligned u32s (offs 0,4,8,...,28)
    const aligned = [0, 4, 8, 12, 16, 20, 24, 28].map(o => {
      const v = row.readUInt32LE(o);
      return `+${o.toString().padStart(2)}=${v.toString().padStart(10)} (0x${v.toString(16)})`;
    });
    console.log(`    u32: ${aligned.join("  ")}`);
    // u16 at 32,33 trailing
    const tail = row.readUInt32LE(31);
    console.log(`    sentinel u32 @+31 = 0x${tail.toString(16)}`);
    // ascii runs
    const ascii = extractAscii(row);
    if (ascii.length) console.log(`    ascii: ${JSON.stringify(ascii)}`);
    // small-int candidates (faction IDs: 0..50)
    const smallInts = [];
    for (let o = 0; o < STRIDE; o++) {
      const v = row[o];
      if (v > 0 && v < 50) smallInts.push(`+${o}=${v}`);
    }
    if (smallInts.length) console.log(`    small-int bytes (0<v<50): ${smallInts.join(", ")}`);
  }

  return { buckets, interesting };
}

// ---- run on every save and compare ----
const results = SAVES.map(s => {
  const p = path.join(SAVE_DIR, s);
  if (!fs.existsSync(p)) {
    console.log(`SKIP missing: ${s}`);
    return null;
  }
  return { name: s, ...dumpSave(p) };
}).filter(Boolean);

console.log("\n\n================================================================");
console.log("CROSS-SAVE SUMMARY (live-row count growth?)");
console.log("================================================================");
for (const r of results) {
  console.log(`  ${r.name.padEnd(60)} LIVE=${r.buckets.LIVE}  SPARSE=${r.buckets.SPARSE}  ZERO=${r.buckets.ZERO}`);
}

// ---- engine constant search ----
console.log("\n================================================================");
console.log("ENGINE-CONSTANT MATCH for 89");
console.log("================================================================");
console.log(" - vanilla RTW MAX_FACTIONS = 31 (no)");
console.log(" - vanilla RTW MAX_CHARACTERS = ~700 (no)");
console.log(" - vanilla RTW MAX_BUILDINGS = ~150 (no)");
console.log(" - hardcoded HISTORIC_EVENTS in descr_events.txt? — RTW often ~89");
console.log(" - HOTSEAT/diplomatic relation matrix = N*(N-1)/2 for N=? ... N=14 -> 91; no");
console.log(" - VICTORY_CONDITIONS slots? CULTURES? ");
console.log(" - MAX_REGIONS_VISIBLE_PER_FACTION? unclear");

// Look up Provincia mod data for any '89' constants.
try {
  const winC = fs.readFileSync("C:/dev/Provincia/public/descr_win_conditions_large.txt", "utf8");
  const lines = winC.split(/\r?\n/);
  console.log(`\nwin_conditions lines: ${lines.length}`);
  // count entries (faction blocks)
  const factions = lines.filter(l => /^\s*faction\s+\w+/.test(l));
  console.log(`win_conditions faction blocks: ${factions.length}`);
} catch (e) {}

// list mod victory factions
try {
  const sm = fs.readFileSync("C:/dev/Provincia/public/descr_sm_factions.txt", "utf8");
  const factions = sm.match(/^\s*faction\s+(\w+)/gm) || [];
  console.log(`descr_sm_factions blocks: ${factions.length}`);
} catch (e) {}
