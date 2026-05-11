// Session 23: map the 24KB lua/script footer at 0x210f4d4..0x21153ae.
// Session 14 said:
//   (a) section preamble at 0x210f4d4
//   (b) UTF-16LE path 'data/world/maps/campaign/imperial_campaign/RIS_Campaign_Script.txt' at 0x210f4e5
//   (c) Lua persistent counter table 0x210f56f..0x2110a23 (115 records, 5300 bytes)
//   (d) Tile-coord trail array 0x2110a24..0x21153ae (~18KB)
// This script: enumerate ALL ASCII strings in the footer (campaign-event variable names)
// and look for scripted-event flags like "marian_reforms_triggered", "civil_war_active".

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAVE);

const footerStart = 0x210f4d4;
const footerEnd = 0x21153ae;
console.log(`=== Lua/script footer 0x${footerStart.toString(16)}..0x${footerEnd.toString(16)} (${footerEnd - footerStart} bytes) ===`);

// (a) ASCII strings ≥4 chars
console.log(`\n=== ASCII strings (≥4 chars) ===`);
let cur = '', curStart = -1;
const asciiStrings = [];
for (let p = footerStart; p < footerEnd; p++) {
  const b = buf[p];
  if (b >= 0x20 && b < 0x7f) {
    if (cur === '') curStart = p;
    cur += String.fromCharCode(b);
  } else {
    if (cur.length >= 4) { asciiStrings.push({ off: curStart, s: cur }); }
    cur = '';
  }
}
if (cur.length >= 4) asciiStrings.push({ off: curStart, s: cur });
console.log(`Total ASCII strings ≥4 chars: ${asciiStrings.length}`);
for (const a of asciiStrings.slice(0, 10)) console.log(`  0x${a.off.toString(16)}: '${a.s}'`);

// (b) UTF-16LE strings — char.code in [0x20..0x7e], every other byte = 0
console.log(`\n=== UTF-16LE strings (≥4 chars) ===`);
const utf16Strings = [];
{
  let p = footerStart;
  while (p < footerEnd - 2) {
    let len = 0;
    let s = '';
    while (p + 1 < footerEnd) {
      const lo = buf[p], hi = buf[p+1];
      if (hi === 0 && lo >= 0x20 && lo < 0x7f) {
        s += String.fromCharCode(lo);
        len++;
        p += 2;
      } else break;
    }
    if (len >= 4) utf16Strings.push({ off: p - 2 * len, s });
    p += 1;
  }
}
console.log(`Total UTF-16LE strings ≥4 chars: ${utf16Strings.length}`);

// Histogram by category (look for "ChrysaoriaRebellion", "MarianReforms", etc.)
const cats = {
  rebellion: 0,
  marian: 0,
  civil: 0,
  triumph: 0,
  reform: 0,
  done: 0,
  owned: 0,
  campaignName: 0,
  scriptPath: 0,
  RIS_: 0,
  factionNames: 0
};
const seen = new Set();
for (const u of utf16Strings) {
  if (seen.has(u.s)) continue;  // dedup
  seen.add(u.s);
  if (/rebellion/i.test(u.s)) cats.rebellion++;
  if (/marian/i.test(u.s)) cats.marian++;
  if (/civil/i.test(u.s)) cats.civil++;
  if (/triumph/i.test(u.s)) cats.triumph++;
  if (/reform/i.test(u.s)) cats.reform++;
  if (/done/i.test(u.s)) cats.done++;
  if (/owned/i.test(u.s)) cats.owned++;
  if (/_campaign|imperial_campaign/i.test(u.s)) cats.campaignName++;
  if (/script|\.txt|\.lua/i.test(u.s)) cats.scriptPath++;
  if (/^RIS_/.test(u.s)) cats.RIS_++;
  if (/Romans|Egypt|Greek|Carthag|Macedon|Spart|Selucid|Pontus/i.test(u.s)) cats.factionNames++;
}
console.log(`\nUTF-16LE category histogram (deduplicated):`);
for (const [k, v] of Object.entries(cats)) if (v > 0) console.log(`  ${k}: ${v}`);

// Dump all unique UTF-16LE strings sorted, but with a 200-char limit per to avoid spam
console.log(`\n=== All UTF-16LE unique strings (limited 100) ===`);
const arr = [...seen];
arr.sort();
for (const s of arr.slice(0, 100)) console.log(`  '${s}'`);
console.log(`  ... (${arr.length} total unique strings)`);

// (c) Find structural markers
// Self-pointers in footer
console.log(`\n=== Self-pointers in lua footer ===`);
const sps = [];
for (let p = footerStart; p < footerEnd - 4; p++) {
  if (buf.readUInt32LE(p) === p) {
    const sz = buf.readUInt32LE(p + 4);
    sps.push({ off: p, sz });
  }
}
console.log(`Found ${sps.length} self-pointers:`);
for (const sp of sps.slice(0, 30)) console.log(`  0x${sp.off.toString(16)}: size/val4=${sp.sz}`);
