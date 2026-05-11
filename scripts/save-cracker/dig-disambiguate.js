// Disambiguate the value-30 finding. Compare:
//   savestartsparta.sav  — baseline, no actions
//   save_1.1.sav         — declare war on Argos + siege Prasiai (gave us 30)
//   save_1.2.sav         — attack Messene + autoresolve battle (war only, NO siege)
//
// Logic:
//   - If save_1.2 also flips u32@0x15491cb from -1 to some N → field is war-target-faction-id
//     - N should be Messene's faction-id; 30 should have been Argos's faction-id
//   - If save_1.2 leaves u32@0x15491cb = -1 → field is siege-target-settlement-id
//     - 30 was Prasiai's settlement-id
//   - If save_1.2 flips it to 30 too (unlikely) → field encodes "any active military objective"
import fs from "node:fs";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const baseline = fs.readFileSync(path.join(SAVE_DIR, "save_savestartsparta.sav"));
const v11      = fs.readFileSync(path.join(SAVE_DIR, "save_1.1.sav"));
const v12      = fs.readFileSync(path.join(SAVE_DIR, "save_1.2.sav"));

console.log(`baseline:  ${baseline.length.toLocaleString()} bytes`);
console.log(`save_1.1:  ${v11.length.toLocaleString()} bytes  (Δ=${v11.length - baseline.length})`);
console.log(`save_1.2:  ${v12.length.toLocaleString()} bytes  (Δ=${v12.length - baseline.length})\n`);

// Read u32 at 0x15491cb in each
const TARGET = 0x15491cb;
console.log(`u32le @ 0x${TARGET.toString(16)}:`);
console.log(`  baseline: 0x${baseline.readUInt32LE(TARGET).toString(16).padStart(8, "0")} (${baseline.readUInt32LE(TARGET) | 0})`);
console.log(`  save_1.1: 0x${v11.readUInt32LE(TARGET).toString(16).padStart(8, "0")} (${v11.readUInt32LE(TARGET) | 0})`);
console.log(`  save_1.2: 0x${v12.readUInt32LE(TARGET).toString(16).padStart(8, "0")} (${v12.readUInt32LE(TARGET) | 0})`);

// But save_1.2 may have a different shift. The TARGET offset in save_1.1 was at the same
// position as baseline (no upstream shift in that region). Let's check baseline near
// "sparta" string to find the actual target offset in v12.
function findAll(buf, needle, max = 100) {
  const hits = []; let from = 0;
  while (hits.length < max) {
    const i = buf.indexOf(needle, from);
    if (i < 0) break;
    hits.push(i); from = i + 1;
  }
  return hits;
}
const sparta = Buffer.from("sparta", "utf-8");
const baseSp = findAll(baseline, sparta);
const v11Sp  = findAll(v11, sparta);
const v12Sp  = findAll(v12, sparta);
console.log(`\n"sparta" hits — baseline:${baseSp.length}  save_1.1:${v11Sp.length}  save_1.2:${v12Sp.length}`);

// First 2 sparta hits = the actual sparta faction record header
console.log(`\nfirst sparta cstring offsets:`);
for (let i = 0; i < 2; i++) {
  console.log(`  baseline: 0x${baseSp[i]?.toString(16) ?? "—"}, save_1.1: 0x${v11Sp[i]?.toString(16) ?? "—"}, save_1.2: 0x${v12Sp[i]?.toString(16) ?? "—"}`);
}

// The target u32 was at offset 65 from sparta#0 (Δ=+65 from baseline:0x154918a → target=0x15491cb)
// Compute the equivalent offset in v11 and v12 by tracking the "sparta" anchor shift.
const baseSp0 = baseSp[0];
const TARGET_DELTA = TARGET - baseSp0;
console.log(`\ntarget u32 offset relative to sparta#0: Δ=${TARGET_DELTA}`);

const v11Target = v11Sp[0] + TARGET_DELTA;
const v12Target = v12Sp[0] + TARGET_DELTA;
console.log(`  baseline @ 0x${baseSp0.toString(16)} + ${TARGET_DELTA} = 0x${TARGET.toString(16)}     u32=0x${baseline.readUInt32LE(TARGET).toString(16).padStart(8,"0")} = ${baseline.readUInt32LE(TARGET)}`);
console.log(`  save_1.1 @ 0x${v11Sp[0].toString(16)} + ${TARGET_DELTA} = 0x${v11Target.toString(16)}    u32=0x${v11.readUInt32LE(v11Target).toString(16).padStart(8,"0")} = ${v11.readUInt32LE(v11Target)}`);
console.log(`  save_1.2 @ 0x${v12Sp[0].toString(16)} + ${TARGET_DELTA} = 0x${v12Target.toString(16)}    u32=0x${v12.readUInt32LE(v12Target).toString(16).padStart(8,"0")} = ${v12.readUInt32LE(v12Target)}`);

// Also dump the raw u32 at the IDENTICAL absolute offsets across all three
console.log(`\n[u32le at the SAME absolute offset 0x${TARGET.toString(16)}]`);
console.log(`  baseline: 0x${baseline.readUInt32LE(TARGET).toString(16).padStart(8,"0")}`);
console.log(`  save_1.1: 0x${v11.readUInt32LE(TARGET).toString(16).padStart(8,"0")}`);
console.log(`  save_1.2: 0x${v12.readUInt32LE(TARGET).toString(16).padStart(8,"0")}`);

// Show ±32B of bytes around v12's anchor-aligned target
console.log(`\n[bytes around save_1.2 anchor-aligned target offset 0x${v12Target.toString(16)}]`);
const PRE = 32, POST = 32;
for (let row = -PRE; row < POST; row += 16) {
  let line = `Δ${String(row).padStart(4)}  `;
  for (let c = 0; c < 16; c++) {
    const o = v12Target + row + c;
    if (o < 0 || o >= v12.length) { line += "   "; continue; }
    line += `${v12[o].toString(16).padStart(2,"0")} `;
  }
  console.log(line);
}

// Verdict
console.log(`\n=== VERDICT ===`);
const v11Val = v11.readUInt32LE(v11Sp[0] + TARGET_DELTA);
const v12Val = v12.readUInt32LE(v12Sp[0] + TARGET_DELTA);
const baseVal = baseline.readUInt32LE(baseSp0 + TARGET_DELTA);
console.log(`baseline value: ${baseVal | 0}`);
console.log(`save_1.1 (war + siege)  value: ${v11Val | 0}`);
console.log(`save_1.2 (war only)     value: ${v12Val | 0}`);
if (v11Val === 30 && v12Val !== 0xFFFFFFFF >>> 0 && v12Val !== 30) {
  console.log(`→ Field is WAR-TARGET-FACTION-ID. Argos id=30, Messene id=${v12Val | 0}`);
} else if (v11Val === 30 && v12Val === (0xFFFFFFFF >>> 0)) {
  console.log(`→ Field is SIEGE-TARGET-SETTLEMENT-ID. Prasiai id=30. War declaration alone doesn't set this field.`);
} else if (v11Val === v12Val) {
  console.log(`→ Both variants have the same value. Both wars happen to point at the same id (unlikely) OR field encodes something else.`);
} else {
  console.log(`→ Unexpected combination: war+siege=${v11Val}, war only=${v12Val}. Re-examine.`);
}
