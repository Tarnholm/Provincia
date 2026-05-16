// Decode all path records in the CHARACTER_PATHS section. Header layout:
//   +0   u32 selfPtr (= pos)
//   +4   u32 character UUID  (varies per path)
//   +8   u32 selfPtr (= pos + 8)
//   +12  u32 record-type tag (small set: 0x230, 0x237, 0x2a6, ...)
//   +16  u32 ???
//   +20  u32 ???
//   +24..+31  more header data
//   +32+ (u32 X, u32 Y) × N waypoints
//   +(32 + 8N)  trailer (often 0..4 zero bytes)
//
// Each path size from min 53 to max 1285. Stride 8 (waypoints).
// 53 = 32 + 8×N + trailer → N=2 + 5-byte trailer? Or header smaller.

const fs = require('fs');

const A = fs.readFileSync('C:\\Users\\vtarn\\Downloads\\save_halo_oneman.sav..sav');

const START = 0x000a9000;
const END = 0x000f9000;

// Find paths
const pathStarts = [];
for (let p = START; p + 12 <= END; p++) {
  if (A.readUInt32LE(p) === p && A.readUInt32LE(p + 8) === p + 8) pathStarts.push(p);
}

function decodePath(p, nextP) {
  const size = nextP - p;
  const uuid = A.readUInt32LE(p + 4);
  const tag = A.readUInt32LE(p + 12);
  const f16 = A.readUInt32LE(p + 16);
  const f20 = A.readUInt32LE(p + 20);
  const f24 = A.readUInt32LE(p + 24);
  const f28 = A.readUInt32LE(p + 28);
  // Try waypoints starting at +32
  const wpStart = p + 32;
  const wpEnd = p + size;
  // Wp area = (size - 32) bytes. Trailer is 0..7 bytes.
  // Most likely interpretation: N waypoints with optional small trailer.
  // Try to find the largest N such that 32 + 8*N <= size, and the
  // last waypoint has plausible (X, Y).
  const wps = [];
  for (let off = wpStart; off + 8 <= wpEnd; off += 8) {
    const x = A.readUInt32LE(off);
    const y = A.readUInt32LE(off + 4);
    if (x < 1 || x > 1100 || y < 1 || y > 800) break;
    wps.push({ x, y });
  }
  return { off: p, size, uuid, tag, f16, f20, f24, f28, waypoints: wps };
}

// Decode all 1695 paths
const paths = [];
for (let i = 0; i < pathStarts.length; i++) {
  const next = pathStarts[i + 1] || END;
  paths.push(decodePath(pathStarts[i], next));
}
console.log('Decoded ' + paths.length + ' paths.');

// Stats
const wpCounts = paths.map(p => p.waypoints.length);
console.log('Waypoint count distribution:');
const hist = new Map();
for (const c of wpCounts) hist.set(c, (hist.get(c) || 0) + 1);
const sorted = Array.from(hist.entries()).sort((a, b) => a[0] - b[0]);
for (const [c, n] of sorted) console.log('  ' + String(c).padStart(4) + ' waypoints: ' + n + ' paths');

// Tag distribution
const tagHist = new Map();
for (const p of paths) tagHist.set(p.tag, (tagHist.get(p.tag) || 0) + 1);
console.log('\nTag distribution (u32@+12):');
for (const [t, n] of Array.from(tagHist.entries()).sort((a, b) => b[1] - a[1])) {
  console.log('  0x' + t.toString(16).padStart(4, '0') + ' (' + t + '): ' + n + ' paths');
}

// Look for Gnaeus's UUID (0xf6971a2c) in path records
const GNAEUS_UUID = 0xf6971a2c;
const gnaeusPath = paths.find(p => p.uuid === GNAEUS_UUID);
if (gnaeusPath) {
  console.log('\n=== Gnaeus path at 0x' + gnaeusPath.off.toString(16) + ' ===');
  console.log('  size=' + gnaeusPath.size + '  tag=0x' + gnaeusPath.tag.toString(16) + '  waypoints=' + gnaeusPath.waypoints.length);
  console.log('  +16=' + gnaeusPath.f16 + '  +20=' + gnaeusPath.f20 + '  +24=' + gnaeusPath.f24 + '  +28=' + gnaeusPath.f28);
  console.log('  Waypoints:');
  for (let i = 0; i < gnaeusPath.waypoints.length; i++) {
    const w = gnaeusPath.waypoints[i];
    const marker = (i === 0) ? '  ← START' : (i === gnaeusPath.waypoints.length - 1) ? '  ← END' : '';
    console.log('    [' + String(i).padStart(2) + '] (' + w.x + ', ' + w.y + ')' + marker);
  }
} else {
  console.log('\nGnaeus UUID 0x' + GNAEUS_UUID.toString(16) + ' not found in any path record.');
  // Sample some uuid values
  const uuids = new Set(paths.map(p => p.uuid));
  console.log('  Unique UUIDs in path records:', uuids.size);
}

// Try matching path UUIDs to character metadata UUIDs
function findCharMeta(buf) {
  const out = new Map();
  for (let i = 0; i < buf.length - 64; i++) {
    if (buf.readUInt32LE(i) !== 0xef) continue;
    const uuid = buf.readUInt32LE(i + 4);
    if (!uuid || uuid === 0xffffffff) continue;
    let className = null;
    for (let p = i + 0x10; p < i + 0x40 && p + 2 < buf.length; p++) {
      const lenP1 = buf.readUInt16LE(p);
      if (lenP1 < 4 || lenP1 > 50) continue;
      if (p + 2 + lenP1 > buf.length) continue;
      let ok = true;
      for (let j = 0; j < lenP1 - 1; j++) {
        const c = buf[p + 2 + j];
        if (c < 0x20 || c > 0x7e) { ok = false; break; }
      }
      if (!ok) continue;
      if (buf[p + 2 + lenP1 - 1] !== 0) continue;
      const s = buf.slice(p + 2, p + 2 + lenP1 - 1).toString('latin1');
      if (/\b(general|captain|admiral|diplomat|spy|assassin|merchant|princess|priest)\b/i.test(s)) {
        className = s; break;
      }
    }
    if (className) out.set(uuid, className);
  }
  return out;
}

const charMeta = findCharMeta(A);
const pathUuids = new Set(paths.map(p => p.uuid));
let matched = 0;
for (const u of pathUuids) if (charMeta.has(u)) matched++;
console.log('\n=== Path UUID ↔ Character metadata UUID match ===');
console.log('  Unique UUIDs in paths:', pathUuids.size);
console.log('  Character metadata UUIDs:', charMeta.size);
console.log('  Matched:', matched);
console.log('  (high match would mean path UUIDs ARE character UUIDs)');
