// dig-tail9.js — Count settlements in zone vs tail, count units in tail.

const fs = require("fs");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);

const settlementZoneStart = 0xf88637;
const settlementZoneEnd = 0x1f10c72;
const fileEnd = buf.length;

function findUtf16Strings(start, end) {
  const out = [];
  for (let p = start; p + 4 < end; p++) {
    const len = buf.readUInt16LE(p);
    if (len < 4 || len > 40) continue;
    const byteLen = len * 2;
    if (p + 2 + byteLen > end) continue;
    let ok = true;
    for (let i = 0; i < len; i++) {
      const c = buf.readUInt16LE(p + 2 + i * 2);
      if (c < 0x20 || c > 0x7e) { ok = false; break; }
    }
    if (!ok) continue;
    const s = buf.slice(p + 2, p + 2 + byteLen).toString("utf16le");
    if (/^[A-Za-z][A-Za-z0-9_\-]+$/.test(s)) {
      out.push({ off: p, name: s });
    }
  }
  return out;
}

const zoneNames = findUtf16Strings(settlementZoneStart, settlementZoneEnd);
const tailNames = findUtf16Strings(settlementZoneEnd, fileEnd);

const zoneUnique = new Set(zoneNames.map(h => h.name));
const tailUnique = new Set(tailNames.map(h => h.name));
console.log(`Settlement zone: ${zoneNames.length} name instances, ${zoneUnique.size} unique`);
console.log(`Tail: ${tailNames.length} name instances, ${tailUnique.size} unique`);

let overlap = 0;
for (const n of tailUnique) if (zoneUnique.has(n)) overlap++;
console.log(`Names present in BOTH: ${overlap}`);
console.log(`Names ONLY in tail: ${tailUnique.size - overlap}`);

const tailOnly = [...tailUnique].filter(n => !zoneUnique.has(n));
console.log(`Tail-only names (${tailOnly.length}): ${tailOnly.slice(0, 20).join(", ")}`);

const zoneNameCount = {};
for (const h of zoneNames) zoneNameCount[h.name] = (zoneNameCount[h.name] || 0) + 1;
const distrib = {};
for (const n of Object.values(zoneNameCount)) distrib[n] = (distrib[n] || 0) + 1;
console.log("\nZone name-instance distribution:");
for (const [n, count] of Object.entries(distrib).sort((a, b) => +a[0] - +b[0])) {
  console.log(`  ${n} instances: ${count} unique names`);
}

const tailNameCount = {};
for (const h of tailNames) tailNameCount[h.name] = (tailNameCount[h.name] || 0) + 1;
const tailDistrib = {};
for (const n of Object.values(tailNameCount)) tailDistrib[n] = (tailDistrib[n] || 0) + 1;
console.log("\nTail name-instance distribution:");
for (const [n, count] of Object.entries(tailDistrib).sort((a, b) => +a[0] - +b[0])) {
  console.log(`  ${n} instances: ${count} unique names`);
}

const tailUnits = [];
for (let p = settlementZoneEnd; p + 2 < fileEnd; p++) {
  const len = buf.readUInt16LE(p);
  if (len < 4 || len > 40) continue;
  if (p + 2 + len > fileEnd) continue;
  const s = buf.slice(p + 2, p + 2 + len).toString("ascii");
  if (/^[a-z][a-z ]+[a-z]\0?$/.test(s) && s.includes(" ")) {
    tailUnits.push({ off: p, name: s.replace(/\0$/, "") });
  }
}
console.log(`\nUnit records in tail (with space): ${tailUnits.length}`);
const unitUnique = new Set(tailUnits.map(h => h.name));
console.log(`Unique unit types: ${unitUnique.size}`);
const unitCount = {};
for (const u of tailUnits) unitCount[u.name] = (unitCount[u.name] || 0) + 1;
const top = Object.entries(unitCount).sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log("Top 10 unit types:");
for (const [name, n] of top) console.log(`  ${n}x ${name}`);

const lastUnit = tailUnits[tailUnits.length - 1];
console.log(`\nLast unit record: @0x${lastUnit.off.toString(16)} name=${lastUnit.name}`);

console.log(`\n=== Final 256 bytes of file ===`);
for (let i = 0; i < 16; i++) {
  const off = fileEnd - 256 + i * 16;
  const hex = [];
  const ascii = [];
  for (let j = 0; j < 16; j++) {
    const b = buf[off + j];
    hex.push(b.toString(16).padStart(2, "0"));
    ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
  }
  console.log(`  0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
}
