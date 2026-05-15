// dig-aipolicy-session45-2.js — Session 45 attempt 2: decode the +48 count-prefixed
// u32 array in major faction record 0 (player = romans_julii).
//
// Observation from attempt 1:
//   T1 record 0 +48: u32=22 (0x16), followed by 24 u32 values in range 0x100..0x500
//   T2 record 0 +48: u32=30 (0x1e), followed by 30+ u32 values in same range
//
// Hypothesis: this is a u32-prefixed list of REGION IDs the faction owns
// (matches session 5's note "+48 = N regions"). Owned-region count goes
// 22 → 30 ... which is impossible turn-1 to turn-2 for a single faction
// (Romans Julii start with ~3 settlements). So +48 might NOT be the
// owned-region count; the array might be something else.
//
// Cross-check: read +48 as a count, then read N+1 u32 values starting at +52.
// Also: check what the VALUES look like — region IDs (0..199 in RIS) or
// larger numbers (settlement uuids?).

const fs = require("fs");
const ROME_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const T1_PATH = `${ROME_DIR}/save_1.2.sav`;
const T2_PATH = `${ROME_DIR}/save_Autosave   Republic of Rome   Turn 2 Start.sav`;
const bufT1 = fs.readFileSync(T1_PATH);
const bufT2 = fs.readFileSync(T2_PATH);

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

const majorsT1 = findMajors(bufT1);
const majorsT2 = findMajors(bufT2);

console.log("=== Player record 0 (romans_julii?) +48 read as count ===");
function inspect(label, buf, base) {
  const count = buf.readUInt32LE(base + 48);
  console.log(`\n[${label}] base=0x${base.toString(16)}, +48 count = ${count}`);
  console.log(`  treasury (+0) = ${buf.readInt32LE(base)}`);
  console.log(`  +52..+(52+4*count) array values:`);
  for (let i = 0; i < count; i++) {
    const v = buf.readUInt32LE(base + 52 + i * 4);
    console.log(`    [${i}] 0x${v.toString(16).padStart(8, "0")} (=${v})`);
  }
  // Read 4 more after the array to see what follows.
  console.log(`  trailing 4 u32 after array:`);
  for (let i = count; i < count + 8; i++) {
    const v = buf.readUInt32LE(base + 52 + i * 4);
    console.log(`    [+${i}] 0x${v.toString(16).padStart(8, "0")} (=${v})`);
  }
}
inspect("T1 R0", bufT1, majorsT1[0]);
inspect("T2 R0", bufT2, majorsT2[0]);

// Compare to session 5 doc: "+48 = N regions". For Romans Julii at game start,
// the descr_strat region list should be ~3 cities. But +48=22 in T1.
// What if 22 is the AI's "interest count" — regions of strategic interest?
//
// Let's see: count grows 22 → 30 from turn 1 → turn 2. That growth of +8
// per turn is plausible for "AI's strategic-interest region list" expanding
// as the AI runs more deliberation cycles.
//
// Test: are values < 200 (RIS region count is ~199 per descr_regions)?
function pctSmall(buf, base, max) {
  const count = buf.readUInt32LE(base + 48);
  let small = 0;
  let smallEnough = 0;
  for (let i = 0; i < count; i++) {
    const v = buf.readUInt32LE(base + 52 + i * 4);
    if (v < 200) small++;
    if (v < max) smallEnough++;
  }
  return { count, small, smallEnough };
}
console.log("\n=== Value-range test ===");
const t1stat = pctSmall(bufT1, majorsT1[0], 2000);
const t2stat = pctSmall(bufT2, majorsT2[0], 2000);
console.log(`T1 R0: count=${t1stat.count}, values<200: ${t1stat.small}, values<2000: ${t1stat.smallEnough}`);
console.log(`T2 R0: count=${t2stat.count}, values<200: ${t2stat.small}, values<2000: ${t2stat.smallEnough}`);
// Most values are 0x100..0x500 — i.e. 256..1280. Too big for region IDs (RIS has ~199).
// Too small for character uuids. Mid-range u32 around 0x300-0x500 — could be:
//   - settlement IDs (RIS imperial has ~199 regions, but settlements are 1 per region)
//   - financial scores (treasury-amounts in denarii — 200..1280 denarii would make sense)
//   - threat scores (computed weights)
//
// Test: do the values intersect with the next 22 u32 values of OTHER faction records?
// If yes → these values are per-faction-record indices.
console.log("\n=== Cross-check: do these values match other major-record offsets? ===");
const offsT1 = majorsT1;
console.log(`T1 major offsets: ${offsT1.map(o => "0x" + o.toString(16)).join(", ")}`);

// Compare R0's array values to a known set of region IDs. Read descr_regions list size
// (we don't have it parsed here; just dump for inspection).
// Also: what's the data RIGHT BEFORE this array, in detail? +0=treasury, +4=cookie,
// +8=class, +12=1, ..., +44=6, +48=count, +52=array[0]...
//
// And after the array: trailing data — could be ANOTHER u32-prefixed array.
function deepDump(label, buf, base) {
  console.log(`\n[${label}] base=0x${base.toString(16)}`);
  for (let off = 0; off <= 320; off += 4) {
    const v = buf.readUInt32LE(base + off);
    let note = "";
    if (off === 0) note = "treasury (i32)";
    else if (off === 4) note = "cookie/hash";
    else if (off === 8) note = "class tag (=100)";
    else if (off === 12) note = "version (=1)";
    else if (off === 24) note = "self-ptr +24";
    else if (off === 40) note = "self-ptr +40";
    else if (off === 44) note = "discriminator (=6)";
    else if (off === 48) note = "COUNT?";
    else if (off >= 52 && off < 52 + buf.readUInt32LE(base + 48) * 4) {
      const idx = (off - 52) / 4;
      note = `array[${idx}]`;
    }
    console.log(`  +${off.toString().padStart(3)} (0x${off.toString(16).padStart(3, "0")}): 0x${v.toString(16).padStart(8, "0")} = ${v.toString().padStart(11)}  ${note}`);
  }
}
deepDump("T1 R0", bufT1, majorsT1[0]);
deepDump("T2 R0", bufT2, majorsT2[0]);

// Also walk records 0..4 in T1 to see if other factions have the same +48 count.
console.log("\n=== All major records in T1: +0 treasury / +48 count / first 3 array values ===");
for (let i = 0; i < majorsT1.length; i++) {
  const b = majorsT1[i];
  const t = bufT1.readInt32LE(b);
  const c = bufT1.readUInt32LE(b + 48);
  const v0 = bufT1.readUInt32LE(b + 52);
  const v1 = bufT1.readUInt32LE(b + 56);
  const v2 = bufT1.readUInt32LE(b + 60);
  console.log(`  R${i} @0x${b.toString(16)}: treasury=${t}  count=${c}  arr[0..2]=${v0},${v1},${v2}`);
}
console.log("\n=== All major records in T2 ===");
for (let i = 0; i < majorsT2.length; i++) {
  const b = majorsT2[i];
  const t = bufT2.readInt32LE(b);
  const c = bufT2.readUInt32LE(b + 48);
  const v0 = bufT2.readUInt32LE(b + 52);
  const v1 = bufT2.readUInt32LE(b + 56);
  const v2 = bufT2.readUInt32LE(b + 60);
  console.log(`  R${i} @0x${b.toString(16)}: treasury=${t}  count=${c}  arr[0..2]=${v0},${v1},${v2}`);
}
