// dig-econ-settle-debug.js
// Debug settlement stats-block alignment. Find "Arretium" (the player's retrain
// city) as a \x01-prefixed UTF-16 pstr, dump u32s at name-583..name-0 to locate
// the real income / creator / level fields. Cross-check name-127 income claim.

const fs = require("fs");
const path = require("path");
const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const buf = fs.readFileSync(path.join(BASE, "save_arretium pre retrained..sav"));

// Build UTF-16 LE of a name with \x01 + u16 len prefix.
function findSettlementMarker(buf, name) {
  // settlement marker: 0x01, then u16 nchars, then UTF-16 name
  const nchars = name.length;
  const pre = Buffer.alloc(3);
  pre[0] = 0x01;
  pre.writeUInt16LE(nchars, 1);
  const body = Buffer.alloc(nchars * 2);
  for (let i = 0; i < nchars; i++) { body[i*2] = name.charCodeAt(i); body[i*2+1] = 0; }
  const target = Buffer.concat([pre, body]);
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(target, p)) !== -1) { hits.push(p); p++; }
  return hits;
}

for (const name of ["Arretium", "Rome", "Capua"]) {
  const hits = findSettlementMarker(buf, name);
  console.log(`\n=== "${name}": ${hits.length} \\x01-prefixed UTF-16 markers ===`);
  for (const marker of hits.slice(0, 4)) {
    const namePos = marker + 1; // the u16 len byte
    console.log(`  marker@0x${marker.toString(16)} namePos@0x${namePos.toString(16)}`);
    // Dump u32 at name-583..name+0 to find income/creator
    const interesting = [-583, -571, -562, -456, -435, -148, -127, -35];
    for (const d of interesting) {
      const off = namePos + d;
      if (off < 0 || off + 4 > buf.length) continue;
      console.log(`    name${d}: u32=${buf.readUInt32LE(off)}  u8=${buf[off]}  i32=${buf.readInt32LE(off)}`);
    }
  }
}
