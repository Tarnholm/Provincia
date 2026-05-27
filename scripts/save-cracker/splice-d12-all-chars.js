// splice-d12-all-chars.js — D12: patches ALL character records, not just dead.
//
// 🎯 MAJOR breakthrough (post-D11 research): character records exist in
// THREE flavors with the SAME +(pathLen+9) self-pointer structure:
//
//   - /portraits/dead/    21,762  ← D11 patched these
//   - /portraits/young/   3,473   ← MISSED by D11
//   - /portraits/old/     1,146   ← MISSED by D11
//   TOTAL CHARACTER RECORDS: 26,381
//
// Verified 100% self-pointer match across all 3 flavors. So splicing one
// dead record leaves 3,473+1,146 = 4,619 living character self-pointers
// stale. The engine's character iterator hits these living-char positions,
// reads a stale self-pointer that points 462 bytes past current location,
// trips the `next < buffer_end Failed` infinite loop.
//
// D12 patches ALL character records with /portraits/(dead|young|old)/.
//
// Generate by running:  node scripts/save-cracker/splice-d12-all-chars.js

\"use strict\";
const fs = require(\"fs\");

const SRC = \"C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav\";
const OUT = \"C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_TEST_D12_splice_all_chars.sav\";
const FMAG = Buffer.from([0xff, 0x0a, 0xaf, 0xf0]);
const TRAILER_START = 0x40f772c;

// Locate ALL character records (dead + young + old) and verify self-pointer
function locateAllCharRecords(buf) {
  const records = [];
  const NEEDLES = [
    Buffer.from(\"/portraits/dead/\", \"ascii\"),
    Buffer.from(\"/portraits/young/\", \"ascii\"),
    Buffer.from(\"/portraits/old/\", \"ascii\"),
  ];
  for (const needle of NEEDLES) {
    let from = 0;
    while (true) {
      const i = buf.indexOf(needle, from);
      if (i < 0) break;
      // Find 'data/' before
      let dataOff = -1;
      for (let p = i - 1; p >= i - 64; p--) {
        if (buf[p] === 0x64 && buf[p+1] === 0x61 && buf[p+2] === 0x74 && buf[p+3] === 0x61 && buf[p+4] === 0x2f) {
          dataOff = p; break;
        }
      }
      if (dataOff < 0) { from = i + needle.length; continue; }
      const lp = dataOff - 2;
      const pl = buf.readUInt16LE(lp);
      if (pl < 16 || pl > 200) { from = i + needle.length; continue; }
      const selfPtrOff = lp + pl + 9;
      if (selfPtrOff + 4 > buf.length) { from = dataOff + pl; continue; }
      // Verify it's a real record
      if (buf.readUInt32LE(selfPtrOff) === selfPtrOff) {
        records.push({ lenPrefixOff: lp, pathLen: pl, selfPtrOff, type: needle.toString().match(/\\/(\\w+)\\//)[1] });
      }
      from = dataOff + pl;
    }
  }
  // Sort by lenPrefixOff to find the dead record at our splice point
  records.sort((a, b) => a.lenPrefixOff - b.lenPrefixOff);
  return records;
}

const buf = fs.readFileSync(SRC);
const all = locateAllCharRecords(buf);
console.log(`Total character records: ${all.length}`);
const dead = all.filter(r => r.type === 'dead');
const young = all.filter(r => r.type === 'young');
const old_ = all.filter(r => r.type === 'old');
console.log(`  dead: ${dead.length}`);
console.log(`  young: ${young.length}`);
console.log(`  old: ${old_.length}`);

// Pick splice victim: dead record at 0x1896d92 (= rec #50 in dead-only list)
const SPLICE_FROM = 0x1896d92;
// Find next dead record's lenPrefixOff to know splice length
const victim = dead.find(r => r.lenPrefixOff === SPLICE_FROM);
if (!victim) { console.log('FATAL: no dead record at 0x' + SPLICE_FROM.toString(16)); process.exit(1); }
const victimIdx = dead.indexOf(victim);
const nextDead = dead[victimIdx + 1];
const SPLICE_TO = nextDead.lenPrefixOff;
const SPLICE_BYTES = SPLICE_TO - SPLICE_FROM;
console.log(`\\nsplice: 0x${SPLICE_FROM.toString(16)}..0x${SPLICE_TO.toString(16)} (-${SPLICE_BYTES} B)`);

const out = Buffer.from(Buffer.concat([buf.slice(0, SPLICE_FROM), buf.slice(SPLICE_TO)]));

let patchCount = 0;
function patchStalePtr(originalOff, originalVal) {
  const newPos = originalOff < SPLICE_FROM ? originalOff : originalOff - SPLICE_BYTES;
  if (newPos + 4 > out.length) return false;
  const cur = out.readUInt32LE(newPos);
  if (cur !== originalVal) return false;
  out.writeUInt32LE(originalVal - SPLICE_BYTES, newPos);
  patchCount++;
  return true;
}

// (1) ALL character record self-pointers (dead + young + old) where the
//     record is AFTER the splice point.
let charPatched = { dead: 0, young: 0, old: 0 };
for (const r of all) {
  if (r.lenPrefixOff === SPLICE_FROM) continue; // skip the victim itself
  if (r.lenPrefixOff < SPLICE_FROM) continue;    // before splice = no patch needed
  if (patchStalePtr(r.selfPtrOff, r.selfPtrOff)) charPatched[r.type]++;
}
console.log(`(1) character self-pointers patched: ` +
  `dead=${charPatched.dead}, young=${charPatched.young}, old=${charPatched.old} ` +
  `(total ${charPatched.dead + charPatched.young + charPatched.old})`);

// (2) Canonical top-level section self_offsets (sec[2..7])
const CANONICAL_TLS = [];
{
  let p = 0x3b99;
  while (CANONICAL_TLS.length < 8 && p + 8 <= buf.length) {
    if (buf.readUInt32LE(p) === p) {
      const sz = buf.readUInt32LE(p + 4);
      if (sz >= 8 && p + sz <= buf.length) {
        CANONICAL_TLS.push({ off: p, size: sz });
        p += sz;
        continue;
      }
    }
    p++;
  }
}
let tp = 0;
for (const s of CANONICAL_TLS) {
  if (s.off > SPLICE_FROM && patchStalePtr(s.off, s.off)) tp++;
}
console.log(`(2) canonical top-level section self_offsets: ${tp}`);

// (3) Faction record self-pointers at +4 and +8
const factions = [];
{
  let from = 0;
  while (true) {
    const i = buf.indexOf(FMAG, from);
    if (i < 0) break;
    if (i + 12 <= buf.length &&
        buf.readUInt32LE(i + 4) === i + 4 &&
        buf.readUInt32LE(i + 8) === i + 8) {
      factions.push(i);
    }
    from = i + 4;
  }
}
let fp = 0;
for (const f of factions) {
  if (f > SPLICE_FROM) {
    if (patchStalePtr(f + 4, f + 4)) fp++;
    if (patchStalePtr(f + 8, f + 8)) fp++;
  }
}
console.log(`(3) faction self-pointers: ${fp}`);

// (4) ALL trailer self-pointers (brute force)
let trp = 0;
for (let p = TRAILER_START; p + 4 <= buf.length; p++) {
  if (buf.readUInt32LE(p) === p) {
    if (patchStalePtr(p, p)) trp++;
  }
}
console.log(`(4) trailer self-pointers: ${trp}`);

console.log();
console.log(`TOTAL patches: ${patchCount}`);

fs.writeFileSync(OUT, out);
console.log(`\\nwrote ${OUT}`);
console.log(`file size: ${buf.length} -> ${out.length} (-${buf.length - out.length})`);
