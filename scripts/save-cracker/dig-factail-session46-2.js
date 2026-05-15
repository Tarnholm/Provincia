// dig-factail-session46-2.js — Session 46 attempt 2: match faction by AI-policy
// array fingerprint across the 3 saves, then diff the tail.
//
// Since findMajors() doesn't preserve faction identity across saves and the
// player (Romans Julii) is the only common, identifiable thread (treasury
// changes when queues are paid, but more reliably: cookie/hash at +4), we
// fingerprint each record and match.
//
// Even better: in T1 (no actions taken yet), the array values define the
// initial state. If the player's record is "stone_wall queued" in s2 and
// "levies queued" in s3, the AI policy array MIGHT differ. The TREASURY (+0)
// might also differ if the queue was paid.
//
// Strategy: dump ALL faction records' treasury + first few array values + tail
// bytes 132..200 (where session 46-1 showed differences). Find the
// "best matched" faction across the 3 saves.

const fs = require("fs");
const ROME_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const S1 = `${ROME_DIR}/save_1.2.sav`;
const S2 = `${ROME_DIR}/save_2.2.sav`;
const S3 = `${ROME_DIR}/save_3.2.sav`;

const b1 = fs.readFileSync(S1);
const b2 = fs.readFileSync(S2);
const b3 = fs.readFileSync(S3);

function findMajors(buf) {
  const out = [];
  for (let p = 0; p < buf.length - 64; p += 4) {
    if (buf.readUInt32LE(p + 8) !== 100) continue;
    if (buf.readUInt32LE(p + 12) !== 1) continue;
    if (buf.readUInt32LE(p + 44) !== 6) continue;
    if (buf.readUInt32LE(p + 24) !== p + 24) continue;
    if (buf.readUInt32LE(p + 40) !== p + 40) continue;
    out.push(p);
  }
  return out;
}

function fingerprint(buf, base) {
  const N = buf.readUInt32LE(base + 48);
  const tail = base + 52 + 4*N + 4;
  return {
    base,
    N,
    treasury: buf.readInt32LE(base),
    cookie: buf.readUInt32LE(base + 4),  // +4 hash/cookie field
    tail,
    // tail post-sentinel: read significant offsets
    t_36: buf.readUInt32LE(tail + 36),     // expected = 10000 treasury echo
    t_40: buf.readUInt32LE(tail + 40),     // expected = 0x1e (=30)
    t_124: buf.readUInt32LE(tail + 124),
    t_172: buf.readUInt32LE(tail + 172),
    t_180: buf.readUInt32LE(tail + 180),
    t_184: buf.readUInt32LE(tail + 184),
    t_188: buf.readUInt32LE(tail + 188),
    t_192: buf.readUInt32LE(tail + 192),
    t_196: buf.readUInt32LE(tail + 196),
    t_200: buf.readUInt32LE(tail + 200),
    t_204: buf.readUInt32LE(tail + 204),
    t_208: buf.readUInt32LE(tail + 208),
    t_212: buf.readUInt32LE(tail + 212),
    t_216: buf.readUInt32LE(tail + 216),
    t_220: buf.readUInt32LE(tail + 220),
  };
}

function dumpAll(label, buf) {
  const m = findMajors(buf);
  console.log(`\n=== ${label} (${m.length} majors) ===`);
  console.log(`R    base       N   treasury  +28 +36     +40  +124   +172 +180 +184 +188     +192 +196 +200 +204 +208 +212 +216 +220`);
  for (let i = 0; i < m.length; i++) {
    const f = fingerprint(buf, m[i]);
    console.log(`R${i}  0x${m[i].toString(16).padStart(7,'0')}  ${String(f.N).padStart(2)}  ${String(f.treasury).padStart(8)}  ` +
      `${f.t_36.toString().padStart(5)} ${f.t_40.toString().padStart(3)} ${f.t_124.toString().padStart(6)} ` +
      `${f.t_172.toString().padStart(8)} ${f.t_180} ${f.t_184} ${f.t_188.toString().padStart(11)} ` +
      `${f.t_192.toString().padStart(4)} ${f.t_196.toString().padStart(4)} ${f.t_200.toString().padStart(4)} ${f.t_204.toString().padStart(4)} ` +
      `${f.t_208.toString().padStart(4)} ${f.t_212.toString().padStart(4)} ${f.t_216.toString().padStart(4)} ${f.t_220.toString().padStart(4)}`);
  }
  return m;
}

const m1 = dumpAll("s1 (T1)", b1);
const m2 = dumpAll("s2 (stone_wall queued)", b2);
const m3 = dumpAll("s3 (levies queued)", b3);

// Now identify Romans Julii. In all 3 saves, the SAME faction (Romans Julii =
// the player) is present. The cookie at +4 should be stable across saves for
// the same faction.
console.log("\n=== Match by +4 cookie ===");
function cookies(buf, m) {
  return m.map(p => buf.readUInt32LE(p + 4).toString(16));
}
const c1 = cookies(b1, m1);
const c2 = cookies(b2, m2);
const c3 = cookies(b3, m3);
console.log(`s1: ${c1.join(", ")}`);
console.log(`s2: ${c2.join(", ")}`);
console.log(`s3: ${c3.join(", ")}`);
const all1 = new Set(c1);
const all2 = new Set(c2);
const all3 = new Set(c3);
const common = [...all1].filter(x => all2.has(x) && all3.has(x));
console.log(`common cookies: ${common.join(", ")}`);

// For each common-cookie faction, dump the tail.
for (const cookie of common) {
  const r1 = m1[c1.indexOf(cookie)];
  const r2 = m2[c2.indexOf(cookie)];
  const r3 = m3[c3.indexOf(cookie)];
  console.log(`\n=== Cookie 0x${cookie}: s1@0x${r1.toString(16)} s2@0x${r2.toString(16)} s3@0x${r3.toString(16)} ===`);

  function tailRead(buf, base) {
    const N = buf.readUInt32LE(base + 48);
    return { N, tail: base + 52 + 4*N + 4, treasury: buf.readInt32LE(base) };
  }
  const t1 = tailRead(b1, r1);
  const t2 = tailRead(b2, r2);
  const t3 = tailRead(b3, r3);
  console.log(`s1: N=${t1.N} treasury=${t1.treasury} tail=0x${t1.tail.toString(16)}`);
  console.log(`s2: N=${t2.N} treasury=${t2.treasury} tail=0x${t2.tail.toString(16)}`);
  console.log(`s3: N=${t3.N} treasury=${t3.treasury} tail=0x${t3.tail.toString(16)}`);

  // Compare tail bytes 0..300 across all 3 saves.
  console.log(`\nOffsets where bytes differ across 3 saves (first 400):`);
  let count = 0;
  for (let off = 0; off < 400; off++) {
    const v1 = b1[t1.tail + off];
    const v2 = b2[t2.tail + off];
    const v3 = b3[t3.tail + off];
    if (v1 !== v2 || v1 !== v3 || v2 !== v3) {
      count++;
      if (count <= 60) console.log(`  +${off.toString().padStart(3)}: s1=${v1.toString(16).padStart(2,'0')} s2=${v2.toString(16).padStart(2,'0')} s3=${v3.toString(16).padStart(2,'0')}`);
    }
  }
  console.log(`  total: ${count} diff bytes`);
}

// Also: re-fingerprint by treasury since same faction same turn pre-actions
// should have the same treasury (10000 for Romans Julii).
console.log("\n=== Match by treasury==10000 (Romans Julii fingerprint) ===");
function findByTreasury(buf, m, t) {
  for (const p of m) if (buf.readInt32LE(p) === t) return p;
  return -1;
}
const rj1 = findByTreasury(b1, m1, 10000);
const rj2 = findByTreasury(b2, m2, 10000);
const rj3 = findByTreasury(b3, m3, 10000);
console.log(`treasury==10000: s1@0x${rj1.toString(16)} s2@0x${rj2.toString(16)} s3@0x${rj3.toString(16)}`);
