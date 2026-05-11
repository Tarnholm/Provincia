// dig-tail-tilegrid7.js — Walk the 241 records and identify the pattern.
// Each record has the structure:
//   [u32 selfPtr][u32 selfPtr+4]   (TAW double self-ptr pattern)
//   [4 bytes magic: f0 0a af f0]
//   [u32 = 0x3fc (1020)]
//   [u32 = 0x2bc (700)]
//   [variable payload — likely a 2D mask of tiles with 0x00 ff stride]
//
// Before each record sits a header that may contain an ASCII string (like
// "Eastern_City" or "Eastern_Huge_City" - the settlement model name).
//
// Goal: (a) confirm 241 records both in rome10 and RoR-T1, (b) identify a
// per-record "settlement key" (ID / position / name), (c) check if the
// (1020, 700) pair is settlement size (W=1020, H=700? Or some bound box?).

const fs = require("fs");

const ROME10 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const ROR_T1 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav";

function walk(savePath, label, altStart, altEnd) {
  const buf = fs.readFileSync(savePath);
  console.log(`\n===== ${label} =====`);

  // Find all (selfPtr, selfPtr+4) pairs in the range
  const records = [];
  for (let p = altStart; p < altEnd - 7; p++) {
    if (buf.readUInt32LE(p) === p && buf.readUInt32LE(p + 4) === p + 4) {
      records.push(p);
    }
  }
  console.log(`Found ${records.length} record start markers`);

  // What's in the 64 bytes before record[0]?
  console.log(`\nFirst record @ 0x${records[0].toString(16)}, 64 bytes preceding:`);
  for (let row = 0; row < 4; row++) {
    const o = records[0] - 64 + row * 16;
    const hex = [];
    const ascii = [];
    for (let j = 0; j < 16; j++) {
      const b = buf[o + j];
      hex.push(b.toString(16).padStart(2, "0"));
      ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
    }
    console.log(`  0x${o.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
  }

  // Read the (1020, 700) fields. Are they always (0x3fc, 0x2bc)?
  console.log(`\nField analysis of each record's u32 fields at +8, +12, +16, +20...`);
  // header = [selfPtr][selfPtr+4][f0 0a af f0][u32_a][u32_b]...
  // The +8 byte is the magic "f0 0a af f0"
  // The +12 u32 is fixed at 0x3fc (1020)
  // The +16 u32 is fixed at 0x2bc (700)
  const f12 = new Map();
  const f16 = new Map();
  const f20 = new Map();
  const f24 = new Map();
  for (const p of records) {
    const v12 = buf.readUInt32LE(p + 12);
    const v16 = buf.readUInt32LE(p + 16);
    const v20 = buf.readUInt32LE(p + 20);
    const v24 = buf.readUInt32LE(p + 24);
    f12.set(v12, (f12.get(v12) || 0) + 1);
    f16.set(v16, (f16.get(v16) || 0) + 1);
    f20.set(v20, (f20.get(v20) || 0) + 1);
    f24.set(v24, (f24.get(v24) || 0) + 1);
  }
  const showHist = (h, n) => [...h.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([v, c]) => `0x${v.toString(16)}=${c}`).join(" ");
  console.log(`  u32 @+12: ${showHist(f12, 8)}`);
  console.log(`  u32 @+16: ${showHist(f16, 8)}`);
  console.log(`  u32 @+20: ${showHist(f20, 8)}`);
  console.log(`  u32 @+24: ${showHist(f24, 8)}`);

  // Record lengths
  const lengths = [];
  for (let i = 0; i < records.length; i++) {
    const next = i + 1 < records.length ? records[i + 1] : altEnd;
    // strip leading 64 bytes of header from next record to compute true record length
    // Actually just use spacing.
    lengths.push(next - records[i]);
  }
  const sortedLen = [...lengths].sort((a, b) => a - b);
  console.log(`\nRecord lengths: min=${sortedLen[0]}, p10=${sortedLen[Math.floor(lengths.length * 0.1)]}, median=${sortedLen[Math.floor(lengths.length / 2)]}, p90=${sortedLen[Math.floor(lengths.length * 0.9)]}, max=${sortedLen[lengths.length - 1]}`);
  console.log(`Sum of lengths: ${lengths.reduce((a, b) => a + b, 0)} (zone size: ${altEnd - altStart})`);

  // For each record: find ASCII strings within it (architectural model name)
  // ASCII strings should be at the start of each record (just before selfPtr we saw "Eastern_City")
  // Look 64 bytes before each record start
  const nameByOff = new Map();
  for (const p of records) {
    // Search 200 bytes backward for an ASCII string ending with NUL
    for (let q = p - 1; q >= p - 200 && q >= altStart; q--) {
      if (buf[q] === 0x00) {
        // Walk back from q-1 until non-printable
        let s = q - 1;
        while (s >= altStart && buf[s] >= 0x20 && buf[s] <= 0x7e) s--;
        const strLen = q - 1 - s;
        if (strLen >= 4) {
          const str = buf.slice(s + 1, q).toString("ascii");
          if (str.startsWith("W_") || str.startsWith("Celtic") || str.startsWith("Eastern") || str.startsWith("Egyptian") || str.startsWith("Carthaginian") || str.startsWith("Germanic") || str.startsWith("Illyrian") || str.startsWith("Nomad")) {
            nameByOff.set(p, { name: str, namePos: s + 1 });
            break;
          }
        }
      }
    }
  }
  console.log(`\nRecords with attached settlement-model name: ${nameByOff.size} / ${records.length}`);
  // First 10:
  let printed = 0;
  for (const p of records) {
    const n = nameByOff.get(p);
    if (n) {
      console.log(`  [${records.indexOf(p)}] @0x${p.toString(16)}: name="${n.name}" at 0x${n.namePos.toString(16)}`);
      if (++printed >= 10) break;
    }
  }

  return { buf, records, lengths, nameByOff, altStart, altEnd };
}

// Need to find altStart and altEnd for each save dynamically.
function findAltZone(buf) {
  // The zone runs from the end of the W_models section to start of footer.
  // End of model strings = where the first long run of 00 ff begins.
  // Walk forward through buf looking for first "Eastern_City\0" "W_hellenistic..." etc strings.
  // Actually easier: locate the 'f0 0a af f0' magic. First occurrence in tail.
  const magic = Buffer.from([0xf0, 0x0a, 0xaf, 0xf0]);
  let first = -1;
  for (let p = 0x1f00000; p < buf.length - 4; p++) {
    if (buf[p] === 0xf0 && buf[p+1] === 0x0a && buf[p+2] === 0xaf && buf[p+3] === 0xf0) {
      // Check if this is followed by 0x3fc and 0x2bc
      const a = buf.readUInt32LE(p + 4);
      const b = buf.readUInt32LE(p + 8);
      if (a === 0x3fc && b === 0x2bc) {
        if (first === -1) first = p - 8;  // back up to start of selfPtr pair
      }
    }
  }
  // End: last occurrence
  let last = -1;
  for (let p = buf.length - 12; p > first; p--) {
    if (buf[p] === 0xf0 && buf[p+1] === 0x0a && buf[p+2] === 0xaf && buf[p+3] === 0xf0) {
      const a = buf.readUInt32LE(p + 4);
      const b = buf.readUInt32LE(p + 8);
      if (a === 0x3fc && b === 0x2bc) { last = p; break; }
    }
  }
  return { first, last };
}

for (const [path, label] of [[ROME10, "rome10"], [ROR_T1, "RoR-T1"]]) {
  const buf = fs.readFileSync(path);
  const z = findAltZone(buf);
  console.log(`${label}: zone first=0x${z.first.toString(16)}, last=0x${z.last.toString(16)}`);
}

walk(ROME10, "rome10", 0x1f48000, 0x210f4e5);
walk(ROR_T1, "RoR-T1", 0x1f1f000, 0x20e6a3a);
