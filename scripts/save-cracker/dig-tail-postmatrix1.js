// dig-tail-postmatrix1.js — map the tail AFTER the diplomacy attitude matrix.
// Finds the matrix end, then segments the remaining bytes by dominant string
// family per 256KB and reports section boundaries + key markers.
"use strict";
const fs = require("fs");
const SAVE = process.argv[2] ||
  "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav";
const buf = fs.readFileSync(SAVE);
const N = buf.length;

// 1. find matrix base (cell sig) and its true end (first default_set)
let matBase = -1;
for (let p = 0x80000; p < 0x200000; p++) {
  if (buf.readUInt32LE(p) !== 0) continue;
  const k = buf.readUInt32LE(p + 4); if (k < 1 || k > 64) continue;
  if (buf.readUInt32LE(p + 8) !== 200) continue;
  if (buf.readUInt32LE(p + 16) !== 2) continue;
  matBase = p; break;
}
const dsFirst = buf.indexOf(Buffer.from("default_set"));
console.log(`matrix base 0x${matBase.toString(16)}  building-zone start (first default_set) 0x${dsFirst.toString(16)}`);
console.log(`matrix span ~${((dsFirst-matBase)/1048576).toFixed(2)} MB, cells ~${Math.round((dsFirst-matBase)/267)}`);

// 2. For each 256KB window from dsFirst to EOF, list the top-3 distinct ASCII
//    tokens (len>=5) to name the section.
const WIN = 0x40000;
function topTokens(s, e, n = 4) {
  const freq = new Map();
  let cur = -1;
  for (let i = s; i <= e; i++) {
    const v = i < e ? buf[i] : 0;
    const p = v >= 0x20 && v < 0x7f;
    if (p && cur < 0) cur = i;
    else if (!p && cur >= 0) { if (i - cur >= 5) { const t = buf.slice(cur, i).toString("ascii"); if (/^[a-z]/.test(t)) freq.set(t, (freq.get(t)||0)+1); } cur = -1; }
  }
  return [...freq.entries()].sort((a,b)=>b[1]-a[1]).slice(0,n);
}
console.log(`\n=== post-matrix section scan (256KB windows) ===`);
let prevSig = null, runStart = dsFirst;
for (let base = dsFirst; base < N; base += WIN) {
  const end = Math.min(base + WIN, N);
  const toks = topTokens(base, end, 3);
  const sig = toks.map(t=>t[0]).join("|");
  console.log(`0x${base.toString(16).padStart(8,"0")}  ${toks.map(t=>`${t[0]}(${t[1]})`).join("  ")}`);
}

// 3. Markers: registry-type markers? scan for the diplo zone marker 0x39240005 count in tail
const DZ = Buffer.from([0x05,0x00,0x24,0x39]);
let dz=0,p=0,dzTail=0; while((p=buf.indexOf(DZ,p))!==-1){dz++;if(p>=dsFirst)dzTail++;p+=1;}
console.log(`\n0x39240005 diplo-zone markers: total=${dz} (in post-matrix tail=${dzTail})`);

// 4. Final object-graph footer: count self-ptr records in last 1MB & confirm fixed end tag
const tag = buf.slice(N-6).toString("hex");
console.log(`last 6 bytes (end tag): ${tag}  (constant 000000010100 across saves = no checksum)`);
