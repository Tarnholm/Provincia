// dig-lua-state6.js — Find all UTF-16LE Pascal-style paths in the body.
// Pattern: [u16 charCount (4..127)][UTF-16LE printable ASCII chars]

const fs = require("fs");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);

console.log("=== All UTF-16LE Pascal strings >=8 chars in the file ===");
const records = [];
for (let p = 0; p + 4 < buf.length; p++) {
  const cc = buf.readUInt16LE(p);
  if (cc < 8 || cc > 200) continue;
  const strStart = p + 2;
  if (strStart + cc * 2 > buf.length) continue;
  // Check UTF-16LE printable ASCII
  let ok = true;
  for (let i = 0; i < cc; i++) {
    const c = buf.readUInt16LE(strStart + i * 2);
    if (c < 0x20 || c > 0x7e) { ok = false; break; }
  }
  if (!ok) continue;
  const s = buf.slice(strStart, strStart + cc * 2).toString("utf16le");
  records.push({ off: p, len: cc, s });
}
console.log(`Total candidate records: ${records.length}`);

// Filter to paths or recognizable tokens
const interesting = records.filter(r =>
  r.s.includes("/") || r.s.includes("\\") || /^[A-Z][a-zA-Z0-9_]{6,}$/.test(r.s)
);
console.log(`Interesting (paths or CapTokens): ${interesting.length}`);
for (const r of interesting.slice(0, 50)) {
  console.log(`  @0x${r.off.toString(16)} len=${r.len}: ${JSON.stringify(r.s.slice(0, 70))}`);
}

// Now: look at the area RIGHT AFTER each spawn_script path to find trailing data
// The chrysaoria record at 0x18d3693 (=string@0x18d3695) had after-content
// `33 37 8d 01 00 00 00 00 00 00 4b 00 00 00 bf ac 17 cc 45 37 8d 01 0f 00 00 00...`
// `33 37 8d 01` = 0x018d3733 (a file offset close by — self-ptr or back-ref)
// `4b 00 00 00` = 75 (a length or count)
// Then likely several 16-byte uuid + value records.
console.log("\n=== Decode the trailing data after each spawn_script path ===");
const scriptPaths = records.filter(r => r.s.endsWith(".txt") && r.s.includes("spawn_scripts"));
for (const r of scriptPaths) {
  const trailStart = r.off + 2 + r.len * 2;
  console.log(`\n--- ${r.s.split("/").pop()} (${r.s.length} chars) trailing@0x${trailStart.toString(16)} ---`);
  // Read first 64 bytes as u32 stream
  const u32s = [];
  for (let i = 0; i < 16; i++) {
    if (trailStart + i * 4 + 4 > buf.length) break;
    u32s.push(buf.readUInt32LE(trailStart + i * 4));
  }
  console.log(`  u32s: ${u32s.map(v => "0x" + v.toString(16)).join(", ")}`);
  // u32[0] is likely a near self-ptr / back-ref. Verify it's within 0x100 bytes of trailStart.
  if (Math.abs(u32s[0] - trailStart) < 0x200) {
    console.log(`  u32[0] looks like self-ptr/back-ref (delta=${u32s[0] - trailStart})`);
  }
  // u32[2] looks like count
  console.log(`  count? u32[2]=${u32s[2]}, u32[3]=${u32s[3]}`);
}

// Critical question: is the lua-counter value in any way correlated with what's IN this record?
// "chrysaoria" → ChrysaoriaRebellion_* counters: RebelOwned, ForeignOwned, RhodesTurns, RhodesOwned, Done
// "thessaly" → ThessalyRebellion_* counters
// "lycia" → LyciaRebellion_* counters
// "miletus" → MiletusRebellion_* counters
// "egypt" → EgyptianRebellion_* counters
// "cilicians" → CiliciaRebellion_* counters
//
// The lua counter table at end-of-file holds DECLARATIONS (the persistent counter
// names + values). The body records keyed by script PATH must hold richer state
// (which characters/units have triggered, faction-specific outcomes).
