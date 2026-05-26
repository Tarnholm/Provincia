// Search for the literal faction name "antigonid" in the save. The
// player faction record likely embeds its own internal name.
const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

// Look for ASCII "antigonid" with null termination
const occs = [];
let p = 0;
const target = Buffer.from("antigonid", "ascii");
while ((p = buf.indexOf(target, p)) !== -1) {
  // Make sure it's a word boundary (no preceding letter)
  const before = p > 0 ? buf[p - 1] : 0;
  const isAlpha = (b) => (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a);
  if (!isAlpha(before)) {
    // Get the next 32 bytes for context
    const ctx = buf.slice(p, p + 32).toString("latin1").replace(/[^\x20-\x7e]/g, ".");
    occs.push({ at: p, ctx });
  }
  p += 1;
}
console.log(`${occs.length} 'antigonid' word matches`);
for (const o of occs.slice(0, 50)) {
  console.log(`  0x${o.at.toString(16).padStart(8,'0')}: ${o.ctx}`);
}

// Filter to those that DON'T have a path prefix (i.e., not "captain_card_" or "/antigonid/")
console.log("\n=== filtering OUT path-embedded occurrences ===");
const non_paths = occs.filter(o => {
  const ctx = o.ctx;
  // common false positives: paths
  return !ctx.startsWith("antigonid/") && o.ctx.indexOf("captain_card_") === -1 &&
         o.ctx.indexOf("antigonid_") === -1; // captain_card_antigonid_militia etc.
});
console.log(`${non_paths.length} non-path occurrences:`);
for (const o of non_paths.slice(0, 30)) {
  // Show 64 bytes context
  const wider = buf.slice(Math.max(0, o.at - 16), Math.min(buf.length, o.at + 48));
  const hex = Array.from(wider).map(b => b.toString(16).padStart(2, "0")).join(" ");
  const asc = Array.from(wider).map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".").join("");
  console.log(`  0x${o.at.toString(16)}:`);
  console.log(`    hex: ${hex}`);
  console.log(`    asc: ${asc}`);
}
