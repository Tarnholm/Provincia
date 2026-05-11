// dig-lua-state5.js — Decode the spawn-script event records more thoroughly.
//
// Each one has structure:
//   [16 zero bytes][03 00 01][u16 charCount][UTF-16LE script path][u32 self-ptr][...]
//
// Find them all and see what the structure looks like uniformly.

const fs = require("fs");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);

// Search for the pattern `00 00 00 03 00 01 NN 00` where NN is the UTF-16LE char count.
// Actually `03 00 01 NN 00` is consistent.
// Let me search for `03 00 01` followed by u8 count followed by UTF-16LE printable text.
console.log("=== Find all script-event records: `03 00 01 NN 00 [utf16le]` ===");
const records = [];
for (let p = 0; p + 6 < buf.length; p++) {
  // Strong pattern: prior 4 bytes are `00 00 03 00 01`, then `NN 00` (u16 charCount, NN 4..127)
  if (buf[p] !== 0x03 || buf[p + 1] !== 0x00 || buf[p + 2] !== 0x01) continue;
  // Try as a u8: char count
  const cc = buf[p + 3];
  if (cc < 4 || cc > 127) continue;
  if (buf[p + 4] !== 0x00) continue;  // second byte of u16 = 0 (so the count is u16 LE)
  // Verify the UTF-16LE string starting at p+4
  const strStart = p + 4;
  if (strStart + cc * 2 > buf.length) continue;
  let ok = true;
  for (let i = 0; i < cc; i++) {
    const c = buf.readUInt16LE(strStart + i * 2);
    if (c < 0x20 || c > 0x7e) { ok = false; break; }
  }
  if (!ok) continue;
  const s = buf.slice(strStart, strStart + cc * 2).toString("utf16le");
  records.push({ headOff: p, strOff: strStart, len: cc, s });
}
console.log(`Found ${records.length} candidate records:`);
// Show unique strings
const uniqStr = new Set(records.map(r => r.s));
console.log(`Unique strings: ${uniqStr.size}`);
// First 30 records
for (let i = 0; i < Math.min(30, records.length); i++) {
  const r = records[i];
  console.log(`  [${i}] head@0x${r.headOff.toString(16)} str@0x${r.strOff.toString(16)} len=${r.len} ${JSON.stringify(r.s.slice(0, 60))}`);
}
console.log(`... ${records.length - 30} more`);

// Group by content prefix
const cats = {};
for (const r of records) {
  let cat = r.s;
  if (r.s.startsWith("data/")) cat = "data/path";
  else if (r.s.match(/^[A-Z]+/)) cat = "ENUM_CONST";
  else if (r.s.match(/^[a-z_]+$/)) cat = "lowercase_tok";
  cats[cat] = (cats[cat] || 0) + 1;
}
console.log("\nGrouping:");
for (const [c, n] of Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 30)) {
  console.log(`  ${c}: ${n}`);
}

// Hmm, the pattern might be too loose. Let me restrict: must end in ".txt" and contain "/"
const scripts = records.filter(r => r.s.endsWith(".txt") && r.s.includes("/"));
console.log(`\nScript-path records (.txt + /): ${scripts.length}`);
for (const r of scripts) {
  // Look at the 32 bytes after the string
  const end = r.strOff + r.len * 2;
  const afterBytes = buf.slice(end, end + 32);
  const hex = [...afterBytes].map(b => b.toString(16).padStart(2, "0")).join(" ");
  console.log(`  ${r.s.split("/").pop()}: head@0x${r.headOff.toString(16)} after-32-bytes=${hex}`);
  // What u32 immediately follows?
  if (end + 8 <= buf.length) {
    const u32a = buf.readUInt32LE(end);
    const u32b = buf.readUInt32LE(end + 4);
    console.log(`    u32a=0x${u32a.toString(16)} (selfPtr? ${u32a > end - 0x100 && u32a < end + 0x10000})  u32b=${u32b}`);
  }
}

// Now: between the path and the next record, how much data is there?
// Search the body for ALL `<u32_offset_self> <u32_count> <ASCII a-z>` triples that look like
// script-state events — these are CharString name + counter pairs.
console.log("\n=== Find counter-like ASCII names with adjacent values in body 0x500000..0x1f10c72 ===");
const tokenPattern = /^[a-z][a-z0-9_]+$/;
const foundCounters = [];
// 8-byte stride pattern: [u32 ascii-name-ptr OR name itself][u32 value]
// Look for `[u32 length 1..50][ASCII name][u32 value]`
for (let p = 0x500000; p + 60 < 0x1f10c72; p += 4) {
  const len = buf.readUInt32LE(p);
  if (len < 4 || len > 50) continue;
  if (p + 4 + len + 4 > buf.length) continue;
  // Check ASCII printable
  let ok = true;
  for (let i = 0; i < len; i++) {
    const b = buf[p + 4 + i];
    if (b < 0x20 || b > 0x7e) { ok = false; break; }
  }
  if (!ok) continue;
  const name = buf.slice(p + 4, p + 4 + len).toString("ascii");
  if (!tokenPattern.test(name)) continue;
  if (name.length < 6) continue;  // skip too-short matches
  if (!/[a-z]_[a-z]/.test(name)) continue;  // must have an underscore (identifier-shaped)
  const val = buf.readUInt32LE(p + 4 + len);
  foundCounters.push({ off: p, name, val });
}
console.log(`Found ${foundCounters.length} ASCII-name + value pairs in body`);
// Sample
for (const f of foundCounters.slice(0, 20)) {
  console.log(`  @0x${f.off.toString(16)} name=${JSON.stringify(f.name)} val=${f.val}`);
}
