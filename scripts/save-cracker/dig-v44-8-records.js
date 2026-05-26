// What's the actual structure of `+44=8` records? They have the same
// self-pointer + +8=100 + +12=1 signature but different "next" field.
const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

// Find all records: +8=100, +12=1, self-ptrs, +44=8
const recs = [];
for (let i = 0; i + 200 < buf.length; i += 1) {
  if (buf.readUInt32LE(i + 8) !== 100) continue;
  if (buf.readUInt32LE(i + 12) !== 1) continue;
  if (buf.readUInt32LE(i + 24) !== i + 24) continue;
  if (buf.readUInt32LE(i + 40) !== i + 40) continue;
  if (buf.readUInt32LE(i + 44) !== 8) continue;
  recs.push(i);
}
console.log(`${recs.length} records with +44=8`);

// Dump first 3 records (96 bytes each)
for (let r = 0; r < 3 && r < recs.length; r++) {
  const off = recs[r];
  console.log(`\n--- record ${r} at 0x${off.toString(16)} ---`);
  for (let line = 0; line < 96; line += 16) {
    let hex = "", asc = "";
    for (let i = 0; i < 16; i++) {
      const b = buf[off + line + i];
      hex += b.toString(16).padStart(2, "0") + " ";
      asc += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".";
    }
    console.log(`  +${line.toString(16).padStart(2, '0')}: ${hex.padEnd(48)} | ${asc}`);
  }
}

// What's the inter-record distance? If they're all in an array,
// stride should be visible
console.log(`\n--- record offsets (first 30) ---`);
for (let i = 0; i < Math.min(30, recs.length); i++) {
  const delta = i > 0 ? recs[i] - recs[i - 1] : 0;
  console.log(`  ${i.toString().padStart(2)}: 0x${recs[i].toString(16)}  delta=${delta}`);
}

// Are they actual faction-econ records? Check if they have a captain banner
// nearby (which would suggest they're real faction-like records)
console.log("\n--- search 'captain_card_' WITHIN each +44=8 record (next 20 KB) ---");
let withBanner = 0;
const banners = new Map();
for (let r = 0; r < recs.length; r++) {
  const off = recs[r];
  const nextRec = r + 1 < recs.length ? recs[r + 1] : off + 20000;
  const region = buf.slice(off, nextRec);
  const idx = region.indexOf("captain_card_");
  if (idx !== -1) {
    withBanner++;
    let end = idx + "captain_card_".length;
    while (end < idx + 60 && region[end] !== 0x2e && region[end] >= 0x20 && region[end] < 0x7f) end++;
    const name = region.slice(idx + "captain_card_".length, end).toString("ascii");
    banners.set(name, (banners.get(name) || 0) + 1);
  }
}
console.log(`${withBanner}/${recs.length} records contain a captain banner`);
console.log("banner faction counts:");
for (const [k, v] of Array.from(banners.entries()).sort((a, b) => b[1] - a[1]).slice(0, 30)) {
  console.log(`  ${k.padEnd(20)} : ${v}`);
}
