// dig-buildchain2.js — Parse building sub-record structure.
// Format hypothesis: [u32 self_ptr at sub-record start][u16 nameLen+1][asciiz_name][payload]
// The self_ptr is BEFORE the nameLen.
//
// Sub-record names: default_set (12), hinterland_region(?), core_building(14), governmentA(?),
//                   military_industrial_complex, port_buildings, hinterland_roads, defenses, etc.

const fs = require("fs");
const path = require("path");

const ARCHIVE = "C:/dev/Provincia/calibration/archive/2026-04-21T22-49-17-100Z";
const F = "0010_save_saveturn1start.sav";

const buf = fs.readFileSync(path.join(ARCHIVE, F));

// Walk the file: at each u16 = name-length + 1 followed by an ASCII name + null, this is a building sub-record.
// Find ALL sub-records and print their structure.
function findAllSubrecords(buf) {
  const NAMES = [
    "default_set", "hinterland_region", "core_building", "governmentA", "governmentB",
    "governmentC", "governmentD", "military_industrial_complex", "hinterland_roads",
    "port_buildings", "town_walls", "theatres", "academia", "defenses", "barracks",
    "core_building_temple", "temples", "amphitheatres", "racing", "horse_breeders",
    "guilds", "core_walls", "smiths", "ports", "trade", "markets", "mines",
    "religious", "hinterland_farms", "core_building_high_resource",
  ];
  const out = [];
  for (const name of NAMES) {
    const t = Buffer.from(name);
    let p = 0;
    while ((p = buf.indexOf(t, p)) !== -1) {
      // Check 'p-2' is u16 = name.length + 1, and 'p + name.length' is 0
      if (p - 2 >= 0 && buf.readUInt16LE(p - 2) === name.length + 1 && buf[p + name.length] === 0) {
        out.push({ name, nameOff: p });
      }
      p += 1;
    }
  }
  return out.sort((a, b) => a.nameOff - b.nameOff);
}

const subs = findAllSubrecords(buf);
console.log(`Found ${subs.length} building sub-records`);

// Look at the first 20: name + the 32 bytes following the null terminator
console.log("\nFirst 20 sub-records: name and next 40 bytes (payload):");
for (const s of subs.slice(0, 20)) {
  const payloadStart = s.nameOff + s.name.length + 1; // skip null
  const hex = [];
  const asc = [];
  for (let i = 0; i < 32; i++) {
    const b = buf[payloadStart + i];
    hex.push(b.toString(16).padStart(2, "0"));
    asc.push((b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".");
  }
  console.log(`  @0x${s.nameOff.toString(16)} ${s.name.padEnd(30)} payload: ${hex.slice(0,16).join(" ")}  | ${asc.slice(0,16).join("")}`);
  console.log(`     ${" ".repeat(38)}        ${hex.slice(16, 32).join(" ")}  | ${asc.slice(16, 32).join("")}`);
}

// For each subrecord, the bytes IMMEDIATELY before the u16 nameLen should be a u32 self-ptr.
// Verify: pos = nameOff - 2 - 4 = nameOff - 6; the u32 there should equal nameOff - 6.
console.log("\nSelf-ptr verification (first 5):");
for (const s of subs.slice(0, 10)) {
  const selfPtrOff = s.nameOff - 6;
  const selfPtrVal = buf.readUInt32LE(selfPtrOff);
  console.log(`  ${s.name}: selfPtrOff=0x${selfPtrOff.toString(16)} val=0x${selfPtrVal.toString(16)} match=${selfPtrVal === selfPtrOff ? "YES" : "NO"}`);
}
