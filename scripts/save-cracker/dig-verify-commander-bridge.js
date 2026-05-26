// Verify the bodyguard→portrait bridge actually has matching uuids.
// Parse the save, extract characters (v1 parser style) and units, then
// check overlap between unit.commanderUuid and character.secondaryUuid.
const fs = require("fs");

const path = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav";
const buf = fs.readFileSync(path);
console.log(`save: ${(buf.length/1024/1024).toFixed(1)} MB`);

// Find all `<culture> <role>\0` ASCII strings (character role anchors)
const ROLES = ["general", "captain", "diplomat", "spy", "assassin", "admiral", "merchant"];
const CULTURES = ["roman", "greek", "barbarian", "eastern", "egyptian", "carthaginian",
  "antigonid", "seleucid", "cappadocian", "sabaean", "baktrian", "galatian",
  "nabataean", "epirote", "kushite", "cyrene", "oscan", "syracusan",
  "aitolian", "campanian", "athenian", "picentine", "spartan", "cilician",
  "achaian", "knossian", "lyttian", "prienian", "bithynian", "gortynian",
  "indian", "messapian", "paionian", "paphlagonian", "etruscan"];

const charRecords = [];
for (const culture of CULTURES) {
  for (const role of ROLES) {
    const target = Buffer.from(culture + " " + role + "\0", "ascii");
    let p = 0;
    while (true) {
      const idx = buf.indexOf(target, p);
      if (idx === -1) break;
      p = idx + 1;
      charRecords.push({ idx, culture, role });
    }
  }
}
console.log(`role-string anchored: ${charRecords.length}`);

// For each char record, find the portrait path nearby
// Portrait paths look like "data/ui/<culture>/portraits/(cards|portraits)/..."
const target = Buffer.from("data/ui/", "ascii");
const portraitsFound = [];
{
  let p = 0;
  while ((p = buf.indexOf(target, p)) !== -1) {
    // Read backwards to find the pstr16 length prefix
    const len16 = buf.readUInt16LE(p - 2);
    let end = p + target.length;
    while (end < p + 200 && buf[end] !== 0 && buf[end] >= 0x20 && buf[end] < 0x7f) end++;
    const path = buf.slice(p, end).toString("ascii");
    if (path.includes("/portraits/") && (path.endsWith(".tga") || path.endsWith(".tga\0"))) {
      portraitsFound.push({ at: p, path: path.replace(/\0+$/, "") });
    }
    p = end;
  }
}
console.log(`portrait paths found: ${portraitsFound.length}`);
console.log("First 5:");
for (const p of portraitsFound.slice(0, 5)) {
  console.log(`  0x${p.at.toString(16)}: ${p.path}`);
}

// Also find role-string back-references (each character has 2 — first is in
// the portrait pool, second is in their own record).
console.log("\nFirst 3 character records detail:");
for (const cr of charRecords.slice(0, 3)) {
  console.log(`\n  rolestr at 0x${cr.idx.toString(16)} = "${cr.culture} ${cr.role}"`);
  const roleLen = cr.culture.length + 1 + cr.role.length + 1;
  // ownUuid (parseCharacterExtras style) at idx+roleLen+1
  const ownUuid = buf.readUInt32LE(cr.idx + roleLen + 1);
  console.log(`    +roleLen+1 (ownUuid in parseCharacterExtras): 0x${ownUuid.toString(16).padStart(8, "0")}`);
  // bgUuid
  const bgUuid = buf.readUInt32LE(cr.idx + roleLen + 5);
  console.log(`    +roleLen+5 (bgUuid): 0x${bgUuid.toString(16).padStart(8, "0")}`);
  // Check 32 bytes before — typical commanderUuid layout
  console.log(`    bytes before role string:`);
  for (let off = -32; off < 0; off += 4) {
    const v = buf.readUInt32LE(cr.idx + off);
    console.log(`      idx${off}: 0x${v.toString(16).padStart(8, "0")} (=${v})`);
  }
}
