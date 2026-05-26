// Final check: is there a compact list of {partner_faction_id, stance} pairs?
// The seleucid player's REAL relations involve faction ids:
//   wars: 46(bithynia) [235/236 are rebels, internal]
//   allies: 5,177,61,8,11,85,86,175,180,167 (+protect 26,68,145,178)
// If such a list exists, these specific faction-id BYTES would cluster together
// in a small window. Search for a window of <=120 bytes containing >=8 of the
// seleucid ally faction-id bytes AND the bithynia war byte.
const fs = require("fs");
function loadOrder(p){const t=fs.readFileSync(p,"utf8");const o=[];let c=null;for(const l of t.split(/\r?\n/)){const fm=l.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);if(fm){c=fm[1];continue;}if(c){const cm=l.match(/^\s*"culture":\s*"([a-z_]+)"/);if(cm){o.push(c);c=null;}}}return o;}
const order = loadOrder("C:\\RIS\\RIS\\data\\descr_sm_factions.txt");
const path = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_Seleucids t0.sav";
const buf = fs.readFileSync(path);

// seleucid real partner faction ids (active factions only, exclude rebels)
const partners = [5,177,61,8,11,85,86,175,180,167,26,68,145,178,46]; // allies+protects+war(bithynia)
const pset = new Set(partners);

// Slide a 120-byte window; count distinct partner-ids appearing as u8 at any
// offset (this is generous). Report windows with >=10 distinct partners.
const WIN = 120;
const hits = [];
for (let base = 0; base + WIN < buf.length; base += 4) {
  const seen = new Set();
  for (let o = base; o < base + WIN; o++) { if (pset.has(buf[o])) seen.add(buf[o]); }
  if (seen.size >= 12) hits.push({ base, n: seen.size });
}
hits.sort((a,b)=>b.n-a.n);
console.log(`windows (120B) with >=12 distinct seleucid partner-id bytes: ${hits.length}`);
for (const h of hits.slice(0, 15)) console.log(`  0x${h.base.toString(16)} distinct=${h.n}`);

// Also try u32-encoded partner ids in a window (each partner as a u32 value).
const hits4 = [];
for (let base = 0; base + 240 < buf.length; base += 4) {
  const seen = new Set();
  for (let o = base; o < base + 240; o += 4) { const v=buf.readUInt32LE(o); if (pset.has(v)) seen.add(v); }
  if (seen.size >= 12) hits4.push({ base, n: seen.size });
}
hits4.sort((a,b)=>b.n-a.n);
console.log(`\nwindows (60 u32) with >=12 distinct partner-id u32 values: ${hits4.length}`);
for (const h of hits4.slice(0, 15)) console.log(`  0x${h.base.toString(16)} distinct=${h.n}`);
