// dig-trade10.js — dump the inside of a `hinterland_roads` sub-record.
// Cross-reference with `core_building` sub-record structure: each has the
// signature [u32 self-ptr][u16 nameLen][ASCIIZ name][payload].
//
// Look at Rome's hinterland_roads sub-record and dump 100 bytes of payload.

const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const buf = fs.readFileSync(path.join(SAVES, "save_rome6.sav"));

function findAll(buf, tok) {
  const tokB = Buffer.from(tok);
  const out = [];
  let p = 0;
  while ((p = buf.indexOf(tokB, p)) !== -1) { out.push(p); p += 1; }
  return out;
}

// Find Rome's hinterland_roads
const hr = findAll(buf, "hinterland_roads");
console.log(`# hinterland_roads count: ${hr.length}`);

// Examine the FIRST one (in Rome's record)
for (const p of hr.slice(0, 3)) {
  console.log(`\n## hinterland_roads at 0x${p.toString(16)}`);
  // Header before "hinterland_roads": u16 nameLen + 4 bytes of self-ptr
  // Look at bytes -8..+200
  const start = Math.max(0, p - 8);
  const end = Math.min(buf.length, p + 250);
  const slice = buf.slice(start, end);
  const hex = slice.toString("hex").match(/.{1,2}/g);
  for (let i = 0; i < hex.length; i += 16) {
    const rel = i - 8;
    const hexstr = hex.slice(i, i + 16).join(" ");
    const ascii = Array.from(slice.slice(i, i + 16)).map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".").join("");
    console.log(`  +${rel.toString().padStart(5)}: ${hexstr.padEnd(48)}  ${ascii}`);
  }
  // After the name "hinterland_roads" (16 bytes) + null term = at p+16+1 = p+17
  // The next bytes are the payload. Look for u32 lists.
  const payloadStart = p + 17; // past name + null
  // dump 20 u32 values
  console.log(`  payload as u32 values (first 20):`);
  for (let i = 0; i < 20; i++) {
    const off = payloadStart + i * 4;
    if (off + 4 > buf.length) break;
    const v = buf.readUInt32LE(off);
    const f = buf.readFloatLE(off);
    const fStr = Number.isFinite(f) && Math.abs(f) > 1e-30 && Math.abs(f) < 1e10 ? f.toFixed(3) : "_";
    console.log(`    [${i}] off=+${i*4}  u32=${v}  i32=${buf.readInt32LE(off)}  f32=${fStr}`);
  }
}

// Compare hinterland_roads payload byte size by looking at the next sub-record
// (hinterland_port or core_building). The size of the hinterland_roads payload
// might encode trade-partner-count.
console.log(`\n## stride between hinterland_roads and next major sub-record per settlement`);
const known = ["core_building", "governmentA", "governmentB", "governmentC", "governmentD",
               "hinterland_port", "port_buildings", "military_industrial_complex",
               "default_set", "hinterland_region", "hinterland_roads", "town_walls"];
function findAllTokens(buf, tokens) {
  const out = [];
  for (const tok of tokens) {
    const tokB = Buffer.from(tok);
    let p = 0;
    while ((p = buf.indexOf(tokB, p)) !== -1) {
      // Ensure name length is followed by a null byte
      if (buf[p + tok.length] === 0) {
        out.push({ pos: p, name: tok });
      }
      p += 1;
    }
  }
  return out.sort((a, b) => a.pos - b.pos);
}
const tokens = findAllTokens(buf, known);
console.log(`# total sub-record tokens found: ${tokens.length}`);

// Find a hinterland_roads followed by another sub-record. Look at first 5.
let count = 0;
for (let i = 0; i < tokens.length - 1; i++) {
  if (tokens[i].name === "hinterland_roads") {
    const next = tokens[i + 1];
    if (next) {
      const stride = next.pos - tokens[i].pos;
      console.log(`  hinterland_roads@0x${tokens[i].pos.toString(16)}  → next ${next.name}@0x${next.pos.toString(16)}  stride=${stride}`);
      if (++count > 8) break;
    }
  }
}
