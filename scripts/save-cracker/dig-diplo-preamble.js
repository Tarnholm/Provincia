// Decode the ~32-byte "preamble sub-records" that sit between a zone's owner
// faction_id (M-53) and the 0x39240005 marker, plus the M-13 flag. Goal: give
// every byte in that window a meaning. Dump the window for several zones (a
// major, a minor, the player zone) across both RIS saves and characterize it.
const fs = require("fs");
const { parseFactionTreasuries, identifyFactionRecordOwners, parseAllFactionDiplomacy } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const SAVES = {
  macedon: "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav",
  seleucid: "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_Seleucids t0.sav",
};
const SM_FACTIONS = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";

function loadFactionOrder(path) {
  const txt = fs.readFileSync(path, "utf8");
  const order = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) { const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/); if (cm) { order.push(cur); cur = null; } }
  }
  return order;
}
const order = loadFactionOrder(SM_FACTIONS);

const MARKER = 0x39240005;
function findZones(buf) {
  const zones = [];
  for (let i = 53; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4);
    if (count === 0 || count > 200) continue;
    const fid = buf[i - 53];
    if (fid >= order.length) continue;
    zones.push({ marker: i, fid, name: order[fid], count });
  }
  return zones;
}

function hexdump(buf, start, len) {
  let out = "";
  for (let line = 0; line < len; line += 16) {
    let hex = "", asc = "";
    for (let j = 0; j < 16 && line + j < len; j++) {
      const b = buf[start + line + j];
      hex += b.toString(16).padStart(2, "0") + " ";
      asc += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".";
    }
    out += `    M${(line - 53 >= 0 ? "+" : "")}${line - 53}: ${hex.padEnd(48)} | ${asc}\n`;
  }
  return out;
}

for (const [label, path] of Object.entries(SAVES)) {
  let buf; try { buf = fs.readFileSync(path); } catch { console.log(`skip ${label}`); continue; }
  console.log(`\n\n========== ${label} ==========`);
  const zones = findZones(buf);
  console.log(`zones: ${zones.length}`);

  // Pick a few representative zones: first major (rome), a mid minor, the player zone.
  // Player zone = the one whose tag(+12 of first entry) == 0.
  const playerZone = zones.find(z => buf.readUInt32LE(z.marker + 8 + 12) === 0);
  const rome = zones.find(z => z.name === "romans_julii");
  const carthage = zones.find(z => z.name === "carthage");
  const sample = [rome, carthage, playerZone, zones[50], zones[120]].filter(Boolean);

  for (const z of sample) {
    const tag0 = buf.readUInt32LE(z.marker + 8 + 12);
    console.log(`\n-- zone ${z.name} (fid=${z.fid}) marker=0x${z.marker.toString(16)} count=${z.count} firstTag=0x${tag0.toString(16)}${z === playerZone ? "  <<< PLAYER ZONE" : ""}`);
    // dump M-53 .. M+12
    console.log(hexdump(buf, z.marker - 53, 53 + 16));
    // Are M-49..M-17 self-pointers? Check every u32 in that window for ==its own offset
    for (let off = z.marker - 49; off <= z.marker - 17; off += 4) {
      const v = buf.readUInt32LE(off);
      if (v === off) console.log(`    self-ptr at M${off - z.marker}: 0x${v.toString(16)} == own offset`);
      else if (v === off + 8) console.log(`    self-ptr+8 at M${off - z.marker}: 0x${v.toString(16)} == offset+8`);
    }
  }

  // Characterize the preamble window ACROSS ALL zones: which byte offsets are
  // constant vs varying, to translate each byte.
  console.log(`\n  -- preamble byte-constancy across all ${zones.length} zones (M-53..M-1) --`);
  for (let rel = -53; rel < 0; rel++) {
    const vals = new Set();
    for (const z of zones) vals.add(buf[z.marker + rel]);
    const arr = [...vals];
    if (arr.length === 1) console.log(`    M${rel}: CONST 0x${arr[0].toString(16).padStart(2, "0")}`);
    else if (arr.length <= 6) console.log(`    M${rel}: {${arr.map(v => "0x" + v.toString(16)).join(",")}} (${arr.length} distinct)`);
    else console.log(`    M${rel}: VARIES (${arr.length} distinct)`);
  }
}
