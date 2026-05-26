// dig-diplocat-markers.js
// Hunt for OTHER repeated 4-byte "class tag" markers (like 0x39240005) that
// could be additional diplomacy structures. RTW:R taw serializes each
// polymorphic class with a 4-byte tag of form 0x39240005 (the "05 00 24 39"
// seen for diplomacy relations). Tags share the pattern: low byte = a small
// class enum, then "00 24 39" or similar constant. We enumerate all 4-byte
// values matching `?? 00 24 39` and `?? ?? 24 39` and count clusters, then
// report which appear near faction records / in plausible diplomacy ranges.
const fs = require("fs");
const { parseFactionTreasuries } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const SAVES = {
  "macedon t0 (RIS)": "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav",
};

for (const [label, path] of Object.entries(SAVES)) {
  const buf = fs.readFileSync(path);
  const recs = parseFactionTreasuries(buf);
  const firstMajor = recs[0].offset;
  const lastMajor = recs[recs.length - 1].offset;
  console.log(`############ ${label} ############`);
  console.log(`faction records: ${firstMajor.toString(16)}..${lastMajor.toString(16)}`);

  // 1) Histogram all 4-byte values whose high 2 bytes == 0x3924 (same family
  //    as diplomacy marker 0x39240005). These would be sibling class tags.
  const family = {}; // value -> {count, firstAt}
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf[i + 2] === 0x24 && buf[i + 3] === 0x39) {
      const v = buf.readUInt32LE(i);
      if (!family[v]) family[v] = { count: 0, firstAt: i };
      family[v].count++;
    }
  }
  console.log(`\n0x3924???? tag family (high 2 bytes = 0x3924):`);
  Object.entries(family).sort((a, b) => b[1].count - a[1].count).slice(0, 20)
    .forEach(([v, info]) => console.log(`  0x${Number(v).toString(16).padStart(8, "0")}  count=${info.count}  firstAt=0x${info.firstAt.toString(16)}`));

  // 2) The diplomacy marker is 0x39240005. The "0524" part may be a versioned
  //    class id. Let's look at the byte BEFORE each known diplo marker and the
  //    next 2 — to characterize the wrapper.
  const MARKER = 0x39240005;
  const positions = [];
  for (let i = 0; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) === MARKER) { const c = buf.readUInt32LE(i + 4); if (c > 0 && c <= 250) positions.push(i); }
  }
  console.log(`\ntotal valid 0x39240005 diplomacy zones: ${positions.length}`);

  // 3) Also search for any plausible "global relation table" — a long run of
  //    16-byte entries each matching the relation entry shape
  //    {uuid, class<8, attitude<8, tag==0x00010101} OUTSIDE the per-faction
  //    zones (a candidate "events"/"pending offers" master list).
  const TAG = 0x00010101;
  let bestRun = 0, bestAt = -1, curAt = -1, curRun = 0;
  for (let i = 0; i + 16 <= buf.length; i += 16) {
    const cls = buf.readUInt32LE(i + 4), att = buf.readUInt32LE(i + 8), tag = buf.readUInt32LE(i + 12);
    const ok = cls <= 8 && att <= 8 && tag === TAG;
    if (ok) { if (curAt < 0) { curAt = i; curRun = 0; } curRun++; } else { if (curRun > bestRun) { bestRun = curRun; bestAt = curAt; } curAt = -1; curRun = 0; }
  }
  if (curRun > bestRun) { bestRun = curRun; bestAt = curAt; }
  console.log(`longest aligned 16-byte relation-shaped run (tag==0x00010101): ${bestRun} entries at 0x${bestAt > 0 ? bestAt.toString(16) : "-"}`);
}
