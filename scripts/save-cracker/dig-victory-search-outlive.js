// dig-victory-search-outlive.js
// Search the save for the player's outlive_factions faction-ID list.
// antigonid (Macedon) outlive: epirus aetolia athens boeotia achaea sparta.
// Try u8 and u32 encodings, declared + sorted order, contiguous.
// Research/diagnostics only.

const fs = require("fs");
const path = require("path");
const SAVES = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const file = process.argv[2] || "save_macedon t0.sav";
const listArg = process.argv[3] || "epirus,aetolia,athens,boeotia,achaea,sparta";
const buf = fs.readFileSync(SAVES + file);
const order = JSON.parse(fs.readFileSync(path.join(__dirname, "_faction_order.json"), "latin1"));
const idOf = (n) => order.indexOf(n);

const names = listArg.split(",").map(s => s.trim());
const ids = names.map(idOf);
console.log(`=== ${file} ===`);
console.log(`outlive list: ${names.join(", ")}`);
console.log(`faction IDs: ${ids.join(", ")}\n`);
if (ids.some(x => x < 0)) { console.log("WARN unresolved:", names.filter((n,i)=>ids[i]<0)); }

function searchU8(arr, label) {
  const t = Buffer.from(arr);
  let p = 0, hits = [];
  while ((p = buf.indexOf(t, p)) !== -1) { hits.push(p); p += 1; if (hits.length > 30) break; }
  console.log(`  [u8 ${label}] ${arr.join(",")} -> ${hits.length} hits${hits.length?": "+hits.slice(0,10).map(h=>"0x"+h.toString(16)).join(", "):""}`);
  return hits;
}
function searchU32(arr, label) {
  const t = Buffer.alloc(arr.length * 4);
  arr.forEach((v, k) => t.writeUInt32LE(v >>> 0, k * 4));
  let p = 0, hits = [];
  while ((p = buf.indexOf(t, p)) !== -1) { hits.push(p); p += 1; if (hits.length > 30) break; }
  console.log(`  [u32 ${label}] ${arr.join(",")} -> ${hits.length} hits${hits.length?": "+hits.slice(0,10).map(h=>"0x"+h.toString(16)).join(", "):""}`);
  return hits;
}

const sorted = [...ids].sort((a, b) => a - b);
console.log("u8 searches:");
searchU8(ids, "declared");
searchU8(sorted, "sorted");
console.log("\nu32 searches:");
searchU32(ids, "declared");
searchU32(sorted, "sorted");

// Also try with a count prefix (u32 6) before the u32 list, and (u8 6) before u8 list
console.log("\nwith count prefix:");
searchU32([ids.length, ...ids], "u32 count+declared");
searchU32([ids.length, ...sorted], "u32 count+sorted");
searchU8([ids.length, ...ids], "u8 count+declared");
searchU8([ids.length, ...sorted], "u8 count+sorted");

// Try u16
function searchU16(arr, label) {
  const t = Buffer.alloc(arr.length * 2);
  arr.forEach((v, k) => t.writeUInt16LE(v & 0xffff, k * 2));
  let p = 0, hits = [];
  while ((p = buf.indexOf(t, p)) !== -1) { hits.push(p); p += 1; if (hits.length > 30) break; }
  console.log(`  [u16 ${label}] ${arr.join(",")} -> ${hits.length} hits${hits.length?": "+hits.slice(0,10).map(h=>"0x"+h.toString(16)).join(", "):""}`);
}
console.log("\nu16 searches:");
searchU16(ids, "declared");
searchU16(sorted, "sorted");
