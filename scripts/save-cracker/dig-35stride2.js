// dig-35stride2.js
// Session 66 attempt 2: 35-stride only holds for ~89 rows (0x4556..0x51a0).
// The rest of the 155KB region has a different structure.
// Tail rows show a 12-byte repeating pattern: `XX XX XX XX  YY YY YY YY  ZZ 03 0c 02` -ish.
//
// Plan:
// 1. Decode the 89-row 35-byte head subtable cleanly.
// 2. Sweep the rest of the region looking for stride-12 (or other) periodic
//    patterns. Use autocorrelation on byte-level.
// 3. Look for known UUID prefixes that appear in character/settlement tables.
// 4. The `0120` substring + `0c020000` looks like packed-UUID + small const
//    field. Hypothesise: list of (uuid, type, ?) entries — character UUID
//    table.
// 5. Cross-reference UUIDs against the character section if possible.

const fs = require("fs");
const PATH = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const buf = fs.readFileSync(PATH);
const START = 0x44e2, END = 0x2a25d;
const REGION_LEN = END - START;
console.log(`region: 0x${START.toString(16)}..0x${END.toString(16)} = ${REGION_LEN} bytes`);

// ============================================================
// PART A: decode the 89-row 35-byte head subtable
// ============================================================
console.log("\n=== PART A: 35-byte head subtable (0x4556..0x51a0) ===");
const HEAD_START = 0x4556;
const HEAD_END = HEAD_START + 89 * 35; // 0x51a0
const STRIDE = 35;
console.log(`head end = 0x${HEAD_END.toString(16)}, rows = 89`);

// row 0 hex:
//   2944000000  006d22a6e00c000000  ffffffffffffffffffffffffff  59000000  1e000000
// row 1 (mostly 0xff):
//   00 ff*30  1e 00 00 00
// row 2 same
// row 3..: all 0 + 1e 00 00 00
//
// Hypothesis: 89 rows of 35 bytes is a vassal/diplomat lookup table for
// 0x59 (=89) entries — possibly faction relationships. But content is
// almost all 0xff or 0x00, which strongly suggests a "slot table" with
// only a few live entries.
//
// Count live rows (any non-zero byte in row offsets 0..30):
let live = 0, allFF = 0, allZero = 0;
for (let i = 0; i < 89; i++) {
  const r = HEAD_START + i * STRIDE;
  let z = true, f = true;
  for (let k = 0; k < 31; k++) {
    if (buf[r + k] !== 0) z = false;
    if (buf[r + k] !== 0xff) f = false;
  }
  if (z) allZero++;
  else if (f) allFF++;
  else live++;
}
console.log(`live=${live}, all-zero=${allZero}, all-ff=${allFF}`);

console.log("\nrow 0 detail (the lone live row):");
const r0 = HEAD_START;
console.log(`  hex: ${buf.slice(r0, r0 + 35).toString("hex")}`);
console.log(`  +0  u32: ${buf.readUInt32LE(r0+0)}`);
console.log(`  +4  u32: ${buf.readUInt32LE(r0+4)}`);
console.log(`  +8  u32: ${buf.readUInt32LE(r0+8)} (0x${buf.readUInt32LE(r0+8).toString(16)})`);
console.log(`  +12 u32: ${buf.readUInt32LE(r0+12)} (0x${buf.readUInt32LE(r0+12).toString(16)})`);
console.log(`  +16 u32: 0x${buf.readUInt32LE(r0+16).toString(16)}`);
console.log(`  +20 u32: 0x${buf.readUInt32LE(r0+20).toString(16)}`);
console.log(`  +24 u32: 0x${buf.readUInt32LE(r0+24).toString(16)}`);
console.log(`  +27 u32: ${buf.readUInt32LE(r0+27)} (0x${buf.readUInt32LE(r0+27).toString(16)})`);
console.log(`  +31 u32: ${buf.readUInt32LE(r0+31)} (terminator 0x1e)`);

// list which 1e markers are within the 89-row head — should be all 89
let headMarkers = 0;
for (let i = 0; i < 89; i++) {
  const r = HEAD_START + i * STRIDE;
  if (buf.readUInt32LE(r + 31) === 0x0000001e) headMarkers++;
}
console.log(`head: ${headMarkers}/89 rows have 1e marker (CONFIRMED 35-stride if =89)`);

// ============================================================
// PART B: what comes after the head?  0x51a0..0x2a25d = 151,357 bytes
// ============================================================
const BODY_START = HEAD_END;
const BODY_END = END;
const BODY_LEN = BODY_END - BODY_START;
console.log(`\n=== PART B: body 0x${BODY_START.toString(16)}..0x${BODY_END.toString(16)} (${BODY_LEN} bytes) ===`);

// First 256 bytes raw
console.log("\nfirst 256 bytes of body:");
const head = buf.slice(BODY_START, BODY_START + 256);
for (let i = 0; i < 256; i += 32) {
  const slice = head.slice(i, i + 32);
  let hex = slice.toString("hex").match(/.{2}/g).join(" ");
  let ascii = "";
  for (const b of slice) ascii += (b >= 32 && b < 127) ? String.fromCharCode(b) : ".";
  console.log(`  0x${(BODY_START+i).toString(16)}: ${hex}  ${ascii}`);
}

// Stride autocorrelation
console.log("\n=== stride autocorrelation (body) ===");
function autocorr(stride, sample = 50000) {
  let matches = 0, n = 0;
  for (let p = BODY_START; p + stride < BODY_END && n < sample; p++, n++) {
    if (buf[p] === buf[p + stride]) matches++;
  }
  return matches / n;
}
const baseline = autocorr(7919); // a prime, ~random baseline
console.log(`baseline (prime 7919): ${baseline.toFixed(4)}`);
for (let s of [4,6,8,10,12,14,16,18,20,24,28,32,35,40,48,56,64]) {
  console.log(`  stride ${s}: ${autocorr(s).toFixed(4)}`);
}

// Search for repeated `0c 02 00 00` 4-byte signature, which appeared
// frequently in the tail rows
console.log("\n=== `0c 02 00 00` (=524) marker scan in body ===");
const markers = [];
for (let p = BODY_START; p + 4 <= BODY_END; p++) {
  if (buf.readUInt32LE(p) === 0x0000020c) markers.push(p);
}
console.log(`hits: ${markers.length}`);
console.log(`first 10: ${markers.slice(0, 10).map(p => "0x" + p.toString(16)).join(" ")}`);
console.log(`last 5: ${markers.slice(-5).map(p => "0x" + p.toString(16)).join(" ")}`);
const dh = new Map();
for (let i = 1; i < markers.length; i++) {
  const d = markers[i] - markers[i - 1];
  dh.set(d, (dh.get(d) || 0) + 1);
}
const top = [...dh.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log("top deltas:");
for (const [d, c] of top) console.log(`  delta=${d}: ${c}`);

// Look at structure if stride is 12 starting from first marker
if (markers.length > 100) {
  const m0 = markers[0];
  console.log(`\n=== assuming stride 12, row start at first marker = 0x${m0.toString(16)} - 8 = 0x${(m0-8).toString(16)} ===`);
  // pattern is `XXXXXXXX YYYYYYYY ZZ 03 0c 02 00 00` — 12 bytes per row?
  // Actually rows showed: `02 00 00 b8 24 9d 57 01 20 53 03 0c` — looks like
  // little-endian u32 + 8-byte UUID-ish + 1-byte + ` 03 0c 02 00 00` = 0c 02 is mid-record
  // Recount: last row context:
  //   `...d4000d 02 0000 d4000d 02 0000 b6715b8c 0120 d4000d 02 0000 ...`?
  // Let me dump some
  for (let i = 0; i < 8; i++) {
    const p = m0 + i * 12;
    console.log(`  +${i*12} @0x${p.toString(16)}: ${buf.slice(p, p + 24).toString("hex")}`);
  }
}

// ============================================================
// PART C: try a different interpretation.
// The last rows show "0c 02 00 00 d0 73 9d 97 01 20 20 03"
//                    ----------- ----------------- -----
//                    u32=524     ?bytes u32        u8s
// Actually "01 20" is a likely 16-bit constant 0x2001 = 8193.
// Let's hunt the "01 20" marker.
// ============================================================
console.log("\n=== `01 20` 2-byte marker scan in body ===");
let m20 = 0, m20pos = [];
for (let p = BODY_START; p + 2 <= BODY_END; p++) {
  if (buf[p] === 0x01 && buf[p+1] === 0x20) { m20++; m20pos.push(p); }
}
console.log(`hits: ${m20}`);
const dh20 = new Map();
for (let i = 1; i < m20pos.length; i++) {
  const d = m20pos[i] - m20pos[i-1];
  dh20.set(d, (dh20.get(d) || 0) + 1);
}
const top20 = [...dh20.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log("top deltas:");
for (const [d, c] of top20) console.log(`  delta=${d}: ${c}`);
console.log(`first 5: ${m20pos.slice(0, 5).map(p => "0x" + p.toString(16)).join(" ")}`);
console.log(`last 5: ${m20pos.slice(-5).map(p => "0x" + p.toString(16)).join(" ")}`);

// ============================================================
// PART D: stride 12 walk from first '0120' marker
// ============================================================
if (m20pos.length > 100) {
  // align row so '01 20' is at offset +8 (=after a u32+u32 prefix?)
  const m0 = m20pos[0];
  console.log(`\n=== stride-12 from row start = 0x${(m0-8).toString(16)} (01 20 at +8) ===`);
  let aligned = 0;
  for (let i = 0; i < 200; i++) {
    const p = m0 - 8 + i * 12;
    if (buf[p + 8] === 0x01 && buf[p + 9] === 0x20) aligned++;
  }
  console.log(`first 200 rows: aligned=${aligned}/200`);
  for (let i = 0; i < 6; i++) {
    const p = m0 - 8 + i * 12;
    const u32a = buf.readUInt32LE(p);
    const u32b = buf.readUInt32LE(p + 4);
    const u16c = buf.readUInt16LE(p + 8); // 0x2001
    const u16d = buf.readUInt16LE(p + 10);
    console.log(`  row${i} @0x${p.toString(16)}: ${buf.slice(p, p+12).toString("hex")}   u32a=${u32a} u32b=0x${u32b.toString(16)} u16c=0x${u16c.toString(16)} u16d=0x${u16d.toString(16)}`);
  }
}

// stride 16
if (m20pos.length > 100) {
  // try 16
  const m0 = m20pos[0];
  for (const align of [4, 8, 12]) {
    let aligned = 0;
    for (let i = 0; i < 500; i++) {
      const p = m0 - align + i * 16;
      if (p + 16 > BODY_END) break;
      if (buf[p + align] === 0x01 && buf[p + align + 1] === 0x20) aligned++;
    }
    console.log(`stride16 align=+${align}: ${aligned}/500`);
  }
}

// ============================================================
// PART E: where does the body-format actually start?
// Walk from BODY_START until we hit the first non-zero pattern.
// ============================================================
console.log("\n=== first non-zero/ff bytes in body ===");
let p = BODY_START;
while (p < BODY_END && (buf[p] === 0 || buf[p] === 0xff)) p++;
console.log(`first interesting byte at 0x${p.toString(16)} (offset +${p - BODY_START} into body)`);
console.log(`context: ${buf.slice(p - 8, p + 64).toString("hex")}`);

// ============================================================
// PART F: dig into 0120 region structure. Look at the 32-bit values just BEFORE 0120
// to see if they look like character UUIDs.
// ============================================================
console.log("\n=== 8 bytes before each of first 12 '01 20' markers ===");
for (const p of m20pos.slice(0, 12)) {
  const pre = buf.slice(p - 8, p).toString("hex");
  const post = buf.slice(p, p + 8).toString("hex");
  console.log(`  @0x${p.toString(16)}: pre=${pre}  '01 20' post=${post}`);
}

// ============================================================
// PART G: 0120 + bytes pattern repeats - is it [UUID][0120][turn][type] sequence?
// Let's check if "01 20" might be a STRING terminator + length pair: 0x01 = length 1, 0x20 = ' '
// Actually 0x01 0x20 = u16 0x2001 (8193). Could be a sentinel.
// Better: scan for what "01 20" usually means by reading bytes around all instances.
// Plus look for the 4-byte sequence "01 20 XX YY" — is YY usually 03?
// ============================================================
console.log("\n=== byte +3 and byte +2 after '01 20' ===");
const after2 = new Map(), after3 = new Map();
for (const p of m20pos) {
  if (p + 4 > BODY_END) continue;
  const b2 = buf[p + 2], b3 = buf[p + 3];
  after2.set(b2, (after2.get(b2) || 0) + 1);
  after3.set(b3, (after3.get(b3) || 0) + 1);
}
const a2 = [...after2.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
const a3 = [...after3.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log(`byte +2 top: ${a2.map(([k, c]) => `0x${k.toString(16)}:${c}`).join(" ")}`);
console.log(`byte +3 top: ${a3.map(([k, c]) => `0x${k.toString(16)}:${c}`).join(" ")}`);

// ============================================================
// PART H: Look for fixed-stride structure around well-known UUIDs.
// The "0d020000" (= u32 0x0000020d = 525, which is also the turn-counter start
// from session 57's tail block!) pattern hints at turn-counters.
// 525..580 was the turn range. Check if the body is a per-character ASCII-less
// log keyed by character UUID + turn.
// ============================================================
console.log("\n=== turn-marker scan: 0x020d..0x0244 as u32 ===");
const turnHits = new Map();
for (let p = BODY_START; p + 4 <= BODY_END; p++) {
  const v = buf.readUInt32LE(p);
  if (v >= 525 && v <= 580) turnHits.set(v, (turnHits.get(v) || 0) + 1);
}
console.log(`distinct turns: ${turnHits.size}`);
const turnList = [...turnHits.entries()].sort((a, b) => a[0] - b[0]).slice(0, 20);
for (const [v, c] of turnList) console.log(`  turn ${v} (0x${v.toString(16)}): ${c} hits`);

// What if 0d 02 is just byte 525 truncated — check 16-bit turn values
console.log("\n=== u16 turn scan ===");
const t16 = new Map();
for (let p = BODY_START; p + 2 <= BODY_END; p++) {
  const v = buf.readUInt16LE(p);
  if (v >= 525 && v <= 580) t16.set(v, (t16.get(v) || 0) + 1);
}
console.log(`distinct u16 turns: ${t16.size}, sum hits=${[...t16.values()].reduce((a,b)=>a+b,0)}`);

// ============================================================
// PART I: zone B starts around 0x60xx (oVBn @ 0x5fad) - what's in the gap
// 0x51a0..0x5fad?
// ============================================================
console.log("\n=== gap 0x51a0..0x5fad (3597 bytes between head subtable end and first oVBn) ===");
const gap = buf.slice(0x51a0, 0x5fad);
let nz = 0;
for (const b of gap) if (b !== 0 && b !== 0xff) nz++;
console.log(`non-zero/ff bytes: ${nz}/${gap.length} (${(100*nz/gap.length).toFixed(1)}%)`);
console.log(`first 128 bytes after head subtable:`);
for (let i = 0; i < 128; i += 32) {
  const slice = buf.slice(0x51a0 + i, 0x51a0 + i + 32);
  let hex = slice.toString("hex").match(/.{2}/g).join(" ");
  console.log(`  0x${(0x51a0+i).toString(16)}: ${hex}`);
}

// ============================================================
// Final: count fixed slots
// 89 rows in head subtable. Note: 89 also matches 'count of distinct turns' or could be number-of-buildings?
// But it's 35 bytes wide.
// 89 = a prime? yes 89 is prime, possibly 89 active diplomatic agents (diplomats/spies/assassins).
// Check the live count: only 1 live row out of 89. That's a SLOT TABLE with 89 slots.
// ============================================================
console.log("\n=== summary ===");
console.log(`Head subtable 0x4556..0x51a0: 89 slots × 35 bytes, 1 live + 1 prologue-pair (rows 1&2 are all-FF) + 86 zero-rows. Looks like a fixed-size SLOT TABLE for ~89-entity feature.`);
console.log(`Body 0x51a0..0x2a25d: ${BODY_LEN} bytes of mixed structure - 1e marker periodicity does NOT continue past row 89.`);
