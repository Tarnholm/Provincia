// dig-siege-spain-recon.js
// Recon on the controlled Spain ground-truth siege saves (1.5 MB each).
//   PRE  = "...Turn 4 attack Carthage army (declaring war).sav"   (no siege yet)
//   SIEGE= "...Turn 4 besiged corduba.sav"                        (Spain besieging Corduba)
//   SIEGE2="...Turn 4 besiged .sav"                               (earlier besieged autosave)
//   FINAL= "...Turn 4.sav"                                        (identical-size to corduba)
//
// 1. Whole-file common-prefix/suffix diff to bound the inserted siege region.
// 2. Event-log frames (f2 fe ff ff) -> list "Settlement Under Siege" names.
// 3. Locate every settlement marker; print which are present, and Corduba's offset.
// 4. Dump the changed-region bytes (hex+ascii) so we can eyeball the schema.

const fs = require("fs");
const path = require("path");

const DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const PRE   = "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav";
const SIEGE = "save_Autosave   Spain   Turn 4 besiged corduba.sav";
const SIEGEA= "save_Autosave   Spain   Turn 4 besiged .sav";
const FINAL = "save_Autosave   Spain   Turn 4.sav";

const pre   = fs.readFileSync(DIR + PRE);
const siege = fs.readFileSync(DIR + SIEGE);
const siegeA= fs.readFileSync(DIR + SIEGEA);
const final = fs.readFileSync(DIR + FINAL);

console.log("sizes:");
console.log("  PRE   ", pre.length);
console.log("  SIEGEA", siegeA.length, "Δ=" + (siegeA.length - pre.length));
console.log("  SIEGE ", siege.length, "Δ=" + (siege.length - pre.length));
console.log("  FINAL ", final.length, "Δ=" + (final.length - pre.length));

function commonPrefix(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0; while (i < n && a[i] === b[i]) i++; return i;
}
function commonSuffix(a, b) {
  let i = 0; while (i < a.length && i < b.length && a[a.length-1-i] === b[b.length-1-i]) i++; return i;
}

function boundDiff(A, B, label) {
  const pre = commonPrefix(A, B), suf = commonSuffix(A, B);
  console.log(`\n=== ${label}  (Δ=${B.length-A.length}) ===`);
  console.log(`  commonPrefix=0x${pre.toString(16)}  commonSuffix=0x${suf.toString(16)}`);
  console.log(`  A diff region: 0x${pre.toString(16)} .. 0x${(A.length-suf).toString(16)} (${A.length-suf-pre}B)`);
  console.log(`  B diff region: 0x${pre.toString(16)} .. 0x${(B.length-suf).toString(16)} (${B.length-suf-pre}B)`);
  return { pre, suf };
}

const d = boundDiff(pre, siege, "PRE -> SIEGE corduba");

// ---- event-log frames ----
const FRAME = Buffer.from([0xf2, 0xfe, 0xff, 0xff]);
function readUtf16(buf, off, maxChars = 200) {
  if (off + 2 > buf.length) return null;
  const n = buf.readUInt16LE(off);
  if (n < 1 || n > maxChars || off + 2 + n * 2 > buf.length) return null;
  let s = "";
  for (let i = 0; i < n; i++) {
    const lo = buf[off+2+i*2], hi = buf[off+2+i*2+1];
    if (hi !== 0 || lo < 0x20 || lo > 0x7e) return null;
    s += String.fromCharCode(lo);
  }
  return { s, end: off + 2 + n * 2 };
}
function dumpEventStrings(buf, label) {
  console.log(`\n=== event-log UTF-16 strings: ${label} ===`);
  let p = 0; const seen = [];
  while ((p = buf.indexOf(FRAME, p)) !== -1) {
    for (let dpos = 4; dpos < 120; dpos++) {
      const u = readUtf16(buf, p + dpos);
      if (u && u.s.length >= 4) { seen.push(`0x${p.toString(16)}+${dpos}: "${u.s}"`); break; }
    }
    p += 4;
  }
  for (const s of seen) console.log("  " + s);
}
dumpEventStrings(siege, "SIEGE corduba");

// ---- settlement markers ----
function findAllSettlementMarkers(buf) {
  const out = [];
  for (let i = 0; i < buf.length - 30; i++) {
    const flag = buf[i];
    if (flag !== 0x01 && flag !== 0x00) continue;
    const nc = buf[i + 1];
    if (nc < 3 || nc > 32 || buf[i + 2] !== 0) continue;
    const se = i + 3 + nc * 2;
    if (se + 2 > buf.length || buf[se] !== 0 || buf[se + 1] !== 0) continue;
    let ok = true, name = "";
    for (let j = i + 3; j < se; j += 2) {
      const lo = buf[j], hi = buf[j + 1];
      if (hi !== 0 || lo < 0x20 || lo > 0x7e) { ok = false; break; }
      name += String.fromCharCode(lo);
    }
    if (ok && name[0] >= "A" && name[0] <= "Z") out.push({ offset: i, name, blockEnd: se + 2 });
  }
  return out;
}
const preM = findAllSettlementMarkers(pre);
const siM  = findAllSettlementMarkers(siege);
console.log(`\nsettlement markers: PRE=${preM.length} SIEGE=${siM.length}`);
const corPre = preM.filter(m => m.name === "Corduba");
const corSi  = siM.filter(m => m.name === "Corduba");
console.log("Corduba in PRE  :", corPre.map(m => "0x" + m.offset.toString(16)).join(", ") || "none");
console.log("Corduba in SIEGE:", corSi.map(m => "0x" + m.offset.toString(16)).join(", ") || "none");

// Is the diff region near Corduba?
if (corSi.length) {
  for (const c of corSi) {
    console.log(`  Corduba@0x${c.offset.toString(16)}  diffStart-corduba = ${d.pre - c.offset}`);
  }
}

// ---- dump the diff region from both ----
function hexAscii(buf, off, n) {
  const lines = [];
  for (let r = 0; r < n; r += 16) {
    const row = [];
    let asc = "";
    for (let i = 0; i < 16 && r + i < n; i++) {
      const b = buf[off + r + i];
      row.push(b.toString(16).padStart(2, "0"));
      asc += (b >= 32 && b < 127) ? String.fromCharCode(b) : ".";
    }
    lines.push(`  0x${(off+r).toString(16)}: ${row.join(" ").padEnd(48)}  ${asc}`);
  }
  return lines.join("\n");
}
const regionLen = Math.min(700, (siege.length - d.suf) - d.pre + 32);
console.log(`\n=== SIEGE diff region @0x${d.pre.toString(16)} (${regionLen} bytes) ===`);
console.log(hexAscii(siege, d.pre - 16, regionLen + 16));
console.log(`\n=== PRE same offset @0x${d.pre.toString(16)} (for compare) ===`);
console.log(hexAscii(pre, d.pre - 16, 200));
