// Find a TAW section header whose [pos, pos+size] encompasses the
// antigonid char roster at 0x1517fe3. The section format is
// `{u32 ptr==pos, u32 size}` per the existing memory.
const fs = require("fs");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");
const ROSTER = 0x1517fe3;

console.log(`looking for section enclosing 0x${ROSTER.toString(16)}...`);
console.log("scanning the whole save for {u32 self-ptr, u32 size} where size encompasses roster\n");

const candidates = [];
// Scan with 4-byte alignment for speed
for (let p = 0; p + 8 < buf.length; p += 4) {
  if (buf.readUInt32LE(p) !== p) continue;
  const size = buf.readUInt32LE(p + 4);
  if (size < 100 || size > 50 * 1024 * 1024) continue;
  const end = p + size;
  if (p < ROSTER && end > ROSTER) {
    candidates.push({ pos: p, size, end });
  }
}

console.log(`${candidates.length} sections enclose roster:`);
// Sort by section size — smallest enclosing section is most specific
candidates.sort((a, b) => a.size - b.size);
for (const c of candidates.slice(0, 20)) {
  console.log(`  0x${c.pos.toString(16).padStart(8, '0')} size=${c.size.toLocaleString().padStart(12)} end=0x${c.end.toString(16).padStart(8, '0')} delta_from_roster=${(ROSTER - c.pos).toLocaleString()}`);
}

// Also check 1-byte alignment for first 5 candidates (might be unaligned)
if (candidates.length === 0) {
  console.log("\nno aligned candidates — trying 1-byte alignment:");
  let found = 0;
  for (let p = 0; p + 8 < buf.length && found < 10; p += 1) {
    if (buf.readUInt32LE(p) !== p) continue;
    const size = buf.readUInt32LE(p + 4);
    if (size < 100 || size > 50 * 1024 * 1024) continue;
    const end = p + size;
    if (p < ROSTER && end > ROSTER && p > ROSTER - 1000000) {
      console.log(`  0x${p.toString(16).padStart(8, '0')} size=${size.toLocaleString()} delta=${(ROSTER - p).toLocaleString()}`);
      found++;
    }
  }
}

// Tightest section: the most specific player record
if (candidates.length > 0) {
  const tightest = candidates[0];
  console.log(`\nTIGHTEST enclosing section: 0x${tightest.pos.toString(16)} size=${tightest.size.toLocaleString()} (${(tightest.size / 1024).toFixed(1)} KB)`);
  console.log("First 96 bytes of this section:");
  for (let off = 0; off < 96; off += 16) {
    let hex = "", asc = "";
    for (let i = 0; i < 16; i++) {
      const b = buf[tightest.pos + off + i];
      hex += b.toString(16).padStart(2, "0") + " ";
      asc += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".";
    }
    console.log(`  +${off.toString(16).padStart(4, '0')}: ${hex.padEnd(48)} | ${asc}`);
  }
}
