// dig-trade7.js — examine Uria's record in the broader -2400..-200 zone where
// most diffs occur. Specifically -1191..-1109 has clustered diffs that smell
// like updated float fields (4-byte sequences with high bytes matching IEEE 754).

const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const a = fs.readFileSync(path.join(SAVES, "save_rome6.sav"));
const b = fs.readFileSync(path.join(SAVES, "save_rome7.sav"));

function findSettlementByName(buf, name) {
  const nameU16 = Buffer.alloc(name.length * 2);
  for (let i = 0; i < name.length; i++) nameU16.writeUInt16LE(name.charCodeAt(i), i * 2);
  let p = 0;
  while ((p = buf.indexOf(nameU16, p)) !== -1) {
    if (p >= 3) {
      const marker = buf.readUInt8(p - 3);
      const len = buf.readUInt16LE(p - 2);
      if (marker === 0x01 && len === name.length) return p;
    }
    p += 1;
  }
  return -1;
}

const uA = findSettlementByName(a, "Uria");
const uB = findSettlementByName(b, "Uria");

// Print -2200..-1900 in both saves
function show(buf, label, anchor, start, end) {
  console.log(`\n## ${label}: anchor=0x${anchor.toString(16)}  rel [${start}..${end}]`);
  const startPos = anchor + start;
  const endPos = anchor + end;
  const slice = buf.slice(startPos, endPos);
  const hex = slice.toString("hex").match(/.{1,2}/g);
  for (let i = 0; i < hex.length; i += 16) {
    const rel = start + i;
    const hexstr = hex.slice(i, i + 16).join(" ");
    const ascii = Array.from(slice.slice(i, i + 16)).map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".").join("");
    console.log(`  +${rel.toString().padStart(5)}: ${hexstr.padEnd(48)}  ${ascii}`);
  }
}

show(a, "Uria rome6 (-1200..-1100)", uA, -1200, -1100);
show(b, "Uria rome7 (-1200..-1100)", uB, -1200, -1100);

// Big-picture diff between rome6 and rome7 Uria record, EVERY byte
console.log(`\n## All diffs rome6 vs rome7 Uria record -3000..+800`);
const diffsRel = [];
for (let rel = -3000; rel < 800; rel++) {
  if (a[uA + rel] !== b[uB + rel]) diffsRel.push(rel);
}
console.log(`  total diffs: ${diffsRel.length}`);
// histogram by 100-byte buckets
const buckets = {};
for (const rel of diffsRel) {
  const b = Math.floor(rel / 100) * 100;
  buckets[b] = (buckets[b] || 0) + 1;
}
console.log(`  histogram by 100-byte buckets:`);
for (const [b, c] of Object.entries(buckets).sort((x, y) => Number(x[0]) - Number(y[0]))) {
  console.log(`    [${b}..${Number(b) + 99}]: ${c}`);
}

// For diffs region by region — show some samples interpreted as u32, i32, f32
console.log(`\n## Showing diffs in -2050..-1900 zone with u32/f32 interpretations`);
for (let rel = -2050; rel < -1900; rel += 4) {
  const uA_v = a.readUInt32LE(uA + rel);
  const uB_v = b.readUInt32LE(uB + rel);
  if (uA_v !== uB_v) {
    const fA = a.readFloatLE(uA + rel);
    const fB = b.readFloatLE(uB + rel);
    const i_A = a.readInt32LE(uA + rel);
    const i_B = b.readInt32LE(uB + rel);
    const fAs = Number.isFinite(fA) && Math.abs(fA) > 1e-30 && Math.abs(fA) < 1e10 ? fA.toFixed(2) : "_";
    const fBs = Number.isFinite(fB) && Math.abs(fB) > 1e-30 && Math.abs(fB) < 1e10 ? fB.toFixed(2) : "_";
    console.log(`  +${rel.toString().padStart(5)}: u32 ${uA_v.toString().padStart(8)}→${uB_v.toString().padStart(8)}  i32 ${i_A}→${i_B}  f32 ${fAs}→${fBs}`);
  }
}

// Look for "trade" / "route" ASCII inside this record
console.log(`\n## Search for ASCII tokens in Uria's record region`);
const tokens = ["trade", "route", "land", "sea", "road", "port", "merchant"];
for (const tok of tokens) {
  const tokB = Buffer.from(tok);
  let pa = 0; let pb = 0; const countsA = []; const countsB = [];
  // only count within ±3000 bytes from name
  while ((pa = a.indexOf(tokB, pa)) !== -1 && pa < uA + 3000) {
    if (pa > uA - 3000) countsA.push(pa);
    pa += 1;
  }
  while ((pb = b.indexOf(tokB, pb)) !== -1 && pb < uB + 3000) {
    if (pb > uB - 3000) countsB.push(pb);
    pb += 1;
  }
  if (countsA.length || countsB.length) {
    console.log(`  ${tok}: rome6=${countsA.length} hits, rome7=${countsB.length} hits`);
  }
}
