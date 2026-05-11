// Deep analysis of unit record variants. Goal: find the real
// commanderUuid offset for unit records whose post-region terminator
// is small (e.g. `0d 00 00 00`) instead of `ff ff ff ff`.
//
// Approach:
//   1. Find every "messapian general" string in the save → expected = ~8.
//      Check each is recognized by the parser; identify any that are missed.
//   2. Cross-reference each messapian general's bytes against Aulus's uuid
//      (0xb444a820). Find where in the bytes that uuid appears.
//   3. Also dump the ASCII-named "roman general" record at 0x155fbf4 as a
//      hex grid so we can spot field boundaries.

const fs = require("fs");
const buf = fs.readFileSync("C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 5.sav");

const AULUS_UUID = 0xb444a820;
const auluBytes = Buffer.from([0x20, 0xa8, 0x44, 0xb4]);

function hex(o, len = 64) {
  let s = "";
  for (let i = 0; i < len; i += 16) {
    let line = `0x${(o + i).toString(16).padStart(7, "0")}: `;
    let ascii = "";
    for (let j = 0; j < 16 && i + j < len; j++) {
      const b = buf[o + i + j];
      line += b.toString(16).padStart(2, "0") + " ";
      ascii += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".";
    }
    line = line.padEnd(60, " ") + " | " + ascii;
    s += line + "\n";
  }
  return s;
}

// 1. All "roman general" and "messapian general" records by raw string scan.
const findStrings = (label) => {
  const out = [];
  const needle = Buffer.from(label, "ascii");
  let p = 0;
  while ((p = buf.indexOf(needle, p)) !== -1) { out.push(p); p++; }
  return out;
};
const romanGenerals = findStrings("roman general");
const messapianGenerals = findStrings("messapian general");
console.log("Raw 'roman general' string occurrences:", romanGenerals.length);
console.log("Raw 'messapian general' string occurrences:", messapianGenerals.length);

// For unit records, the name is preceded by [u16 nameLen] where nameLen
// counts the null terminator. So for "roman general" (13 chars) nameLen=14.
function isUnitRecordStart(strOffset, strLen) {
  return strOffset >= 2 && buf.readUInt16LE(strOffset - 2) === strLen + 1
    && buf[strOffset + strLen] === 0;
}

console.log("\n=== Roman general unit records ===");
const romanRecords = romanGenerals.filter(p => isUnitRecordStart(p, "roman general".length));
console.log("Valid unit records:", romanRecords.length);

console.log("\n=== Messapian general unit records ===");
const messRecords = messapianGenerals.filter(p => isUnitRecordStart(p, "messapian general".length));
console.log("Valid unit records:", messRecords.length, "offsets:");
for (const o of messRecords) console.log("  0x" + o.toString(16));

// 2. For each messapian general record, dump the bytes and look for Aulus's uuid.
console.log("\n=== Messapian general dumps ===");
for (const o of messRecords) {
  // Record start = strOffset - 2 (the nameLen u16). Dump from -16 to +120.
  const start = o - 2;
  console.log(`\n--- Unit record @ 0x${start.toString(16)} (string at +2 = "messapian general") ---`);
  console.log(hex(start, 144));
  // Look for Aulus's uuid in the +0..+200 range:
  const search = buf.slice(start, start + 300);
  const localIdx = search.indexOf(auluBytes);
  if (localIdx >= 0) console.log(`  *** Aulus's uuid 0xb444a820 found at +${localIdx} (offset 0x${(start+localIdx).toString(16)}) ***`);
}

// 3. Compare the misclassified roman-general. The parser said offset 0x155fbf4.
//    But that's the offset of the unit name string. The record itself starts
//    2 bytes earlier (nameLen u16). Let me dump from the record start.
console.log("\n=== The 0d-variant 'roman general' (parser said @ 0x155fbf4) ===");
console.log("Record start (-2 for nameLen u16) = 0x" + (0x155fbf4 - 2).toString(16) + " ... but parser stores u.offset as the nameLen-aligned start, which IS 0x155fbf4 itself in the parser's case.");
// Actually the parser's i is the index where it found the nameLen u16. So
// u.offset = i; the string starts at i+2. But user said 0x155fbf6 (= 0x155fbf4+2)
// is "roman general\0". So u.offset = 0x155fbf4 IS already the nameLen position.
// Let me dump from there:
console.log(hex(0x155fbf4, 96));

// 4. Compare a known-good roman general (ff ff ff ff variant) for reference.
console.log("\n=== Known-good roman general (ff ff ff ff variant) ===");
// The parser earlier reported offset 0x1545350 region=Latium 32/37. Let me dump from there.
console.log(hex(0x1545350, 96));

// 5. Also look at all bytes in the save where 0xb444a820 appears + some
// context around each:
console.log("\n=== All occurrences of 0xb444a820 ===");
let p = 0;
while ((p = buf.indexOf(auluBytes, p)) !== -1) {
  console.log(`\n--- 0x${p.toString(16)} ---`);
  console.log(hex(p - 32, 80));
  p += 4;
}
