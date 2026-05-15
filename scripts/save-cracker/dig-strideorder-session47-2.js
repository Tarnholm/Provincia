// dig-strideorder-session47-2.js
// Attempt 2: Now we know s1 has ≥32 records (not 12). Find the REAL end of
// the array in s1, and figure out what's really happening in s2/s3 (where
// the record at idx=0 has A=12 or A=239 with huge C-values — that's likely
// already past the array, into the next section).
//
// Strategy:
// - Walk s1 byte-by-byte starting at tail+208 to find where 0x00010101 stops
//   appearing on a 16-byte stride. That's the true array length.
// - In s2/s3, scan backward and forward around tail+208 for the first 0x1e
//   terminator and see the raw bytes.

const fs = require("fs");
const ROME_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const SAVES = [
  ["s1", `${ROME_DIR}/save_1.2.sav`, "baseline"],
  ["s2", `${ROME_DIR}/save_2.2.sav`, "stone_wall queued"],
  ["s3", `${ROME_DIR}/save_3.2.sav`, "levies queued"],
];

function findMajors(buf) {
  const out = [];
  for (let p = 0; p < buf.length - 64; p += 4) {
    if (buf.readUInt32LE(p + 8) !== 100) continue;
    if (buf.readUInt32LE(p + 12) !== 1) continue;
    if (buf.readUInt32LE(p + 44) !== 6) continue;
    if (buf.readUInt32LE(p + 24) !== p + 24) continue;
    if (buf.readUInt32LE(p + 40) !== p + 40) continue;
    out.push(p);
  }
  return out;
}
function findRJ(buf) {
  for (const p of findMajors(buf)) {
    const N = buf.readUInt32LE(p + 48);
    const tail = p + 52 + 4 * N + 4;
    if (buf.readUInt32LE(tail + 36) === 10000) return { base: p, tail, N };
  }
  return null;
}

// Walk stride-16 starting at start, return records until header != 0x00010101.
function walkStrict(buf, start, maxRecords = 200) {
  const recs = [];
  for (let i = 0; i < maxRecords; i++) {
    const off = start + i * 16;
    if (off + 16 > buf.length) break;
    const hdr = buf.readUInt32LE(off);
    if (hdr !== 0x00010101) {
      // Save what follows for inspection.
      const next8 = [];
      for (let j = 0; j < 32 && off + j < buf.length; j++) next8.push(buf[off + j].toString(16).padStart(2, "0"));
      return { recs, breakAt: off, breakHdr: hdr, nextBytes: next8.join(" ") };
    }
    recs.push({
      off,
      A: buf.readUInt32LE(off + 4),
      B: buf.readUInt32LE(off + 8),
      C: buf.readUInt32LE(off + 12),
    });
  }
  return { recs, breakAt: null, breakHdr: null, nextBytes: "" };
}

for (const [tag, path, desc] of SAVES) {
  const buf = fs.readFileSync(path);
  const rj = findRJ(buf);
  if (!rj) continue;
  const strideStart = rj.tail + 208;
  const r = walkStrict(buf, strideStart, 200);

  console.log(`\n=== ${tag} (${desc}) — stride at 0x${strideStart.toString(16)} ===`);
  console.log(`STRICT walk (hdr==0x00010101): ${r.recs.length} records before break`);
  if (r.breakAt !== null) {
    console.log(`Break at 0x${r.breakAt.toString(16)} (offset from start: ${r.breakAt - strideStart}, idx=${(r.breakAt - strideStart) / 16})`);
    console.log(`Break hdr: 0x${r.breakHdr.toString(16).padStart(8, "0")}`);
    console.log(`Next 32 bytes: ${r.nextBytes}`);
  }

  // Print full record list for s1, just count + bounds for others.
  if (tag === "s1") {
    const As = r.recs.map(x => x.A);
    console.log(`A range: min=${Math.min(...As)} max=${Math.max(...As)}`);
    // B distribution
    const bCount = {};
    for (const x of r.recs) bCount[x.B] = (bCount[x.B] || 0) + 1;
    console.log(`B distribution: ${JSON.stringify(bCount)}`);
    const cCount = {};
    for (const x of r.recs) cCount[x.C] = (cCount[x.C] || 0) + 1;
    console.log(`C distribution: ${JSON.stringify(cCount)}`);
  } else {
    for (const x of r.recs) {
      console.log(`  rec@0x${x.off.toString(16)}: A=${x.A} (0x${x.A.toString(16)}) B=${x.B} C=${x.C}`);
    }
  }
}

// Also: dump s2 and s3 bytes between tail+192 and tail+260 to see exactly what
// happens (where does the array start? maybe it's NOT at +208 for s2/s3).
console.log("\n=== Raw byte comparison around tail+192..+288 (4-byte u32 LE) ===");
const bufs = SAVES.map(([t, p]) => ({ tag: t, buf: fs.readFileSync(p), rj: findRJ(fs.readFileSync(p)) }));
console.log("Off    s1                  s2                  s3");
for (let off = 192; off <= 288; off += 4) {
  const line = [];
  for (const b of bufs) {
    const v = b.buf.readUInt32LE(b.rj.tail + off);
    line.push(`${v.toString(16).padStart(8, "0")} (${v})`);
  }
  console.log(`+${off.toString().padStart(3)}: ${line.join("  ")}`);
}

// Cross-ref: 12 Roman settlements? Actually Romans Julii has 5 starting
// settlements (Arretium, Capua, Patavium, Ariminum, Tarentum or similar).
// But the array has 32 records in s1. So NOT per-settlement.
// 32 might match the number of buildings/options to score?
console.log("\n=== Possible meanings of 32 entries ===");
console.log("- Per AI policy / order priority: 32 entries");
console.log("- Per buildable item across all settlements? 5 setts * ~6 buildings = 30");
console.log("- A range 738..1028: likely SCORE values (not IDs - IDs would be 0x0001xxxx)");
console.log("- B=2 most common (29 of 32): some 'state' or 'priority class'");
console.log("- C in {0,1,2,3,4}: looks like a small enum (5 values) - phase/turn-counter");
