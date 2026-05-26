// dig-mapfeat-strings.js
// Locate every occurrence of the map-feature type-name strings in the body of
// an early and a late save. Section tags in the body are ASCII type names; the
// records that follow them carry the live data. If FORT_MANAGER / WATCHTOWER /
// ROAD appear as section tags, we anchor the dig there.
import fs from "node:fs";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const TARGETS = [
  "FORT_MANAGER", "WATCHTOWER_MANAGER", "ROAD_MANAGER", "PORT_MANAGER",
  "WATCHTOWER", "FORT", "ROAD", "PORT",
  "FORT_SHROUD", "WATCHTOWER_SHROUD",
];

function findAll(buf, str) {
  const needle = Buffer.from(str, "latin1");
  const hits = [];
  let from = 0;
  while (true) {
    const idx = buf.indexOf(needle, from);
    if (idx === -1) break;
    // record the byte before & after to see if it's a standalone tag
    const before = idx > 0 ? buf[idx - 1] : -1;
    const after = idx + needle.length < buf.length ? buf[idx + needle.length] : -1;
    hits.push({ idx, before, after });
    from = idx + 1;
  }
  return hits;
}

const files = process.argv.slice(2);
if (files.length === 0) files.push("save_t0.sav", "save_t7.sav");

for (const f of files) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, f));
  console.log(`\n========== ${f} (${buf.length.toLocaleString()} bytes) ==========`);
  // Skip the registry zone (< 0x3c00) so we only see body occurrences.
  const BODY = 0x3c00;
  for (const t of TARGETS) {
    const hits = findAll(buf, t).filter(h => h.idx >= BODY);
    // Filter out hits that are substrings of a longer target (e.g. FORT inside FORT_MANAGER)
    // by checking the char after is not [A-Z0-9_]
    const standalone = hits.filter(h => {
      const a = h.after;
      const isNameChar = (a >= 0x41 && a <= 0x5a) || (a >= 0x30 && a <= 0x39) || a === 0x5f;
      const b = h.before;
      const beforeNameChar = (b >= 0x41 && b <= 0x5a) || (b >= 0x30 && b <= 0x39) || b === 0x5f;
      return !isNameChar && !beforeNameChar;
    });
    console.log(`  ${t.padEnd(20)} body hits: ${standalone.length}`);
    for (const h of standalone.slice(0, 12)) {
      const ctxBefore = Array.from(buf.subarray(Math.max(0, h.idx - 6), h.idx)).map(x => x.toString(16).padStart(2, "0")).join(" ");
      const ctxAfter = Array.from(buf.subarray(h.idx + t.length, h.idx + t.length + 8)).map(x => x.toString(16).padStart(2, "0")).join(" ");
      console.log(`      0x${h.idx.toString(16)}  [${ctxBefore}] ${t} [${ctxAfter}]`);
    }
    if (standalone.length > 12) console.log(`      ... +${standalone.length - 12} more`);
  }
}
