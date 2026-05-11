// dig-tail-tilegrid5.js — Look at the REGION 0x1f10c72..0x210f4d4 in rome10.
// Session 14 says: field-army units 0x1f10c72..0x1f42cb6, hash blob 0x1f43000..0x1f47abd,
// settlement model strings 0x1f47abd..0x1f8f97b, alternate tile grid 0x1f8f97b..0x210f4d4,
// lua/script footer 0x210f4d4..0x21153ae.
//
// We want to characterize the "alternate tile grid" segment 0x1f8f97b..0x210f4d4.

const fs = require("fs");

const ROME10 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const ROR_T1 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav";

// We need to also work out where this zone is in RoR-T1. The boundaries shift per save.

function findFooter(buf) {
  // The lua/script footer starts with the UTF-16LE string
  // "data/world/maps/campaign/imperial_campaign/RIS_Campaign_Script.txt"
  // and that's preceded by an u32 length-ish marker. We can search for the
  // UTF-16LE bytes of "RIS_Campaign_Script".
  const needle = Buffer.from("R\x00I\x00S\x00_\x00C\x00a\x00m\x00p\x00a\x00i\x00g\x00n\x00", "binary");
  return buf.indexOf(needle);
}

function findFieldArmies(buf) {
  // Field-army region starts somewhere - and the section starts with units.
  // Section starts with W_models BEFORE it, so let's find the last "W_models" related thing.
  // Easier: find the "Settlement model strings" boundary by locating "W_hellenistic_Large_Town"
  // and going back.
  const needle = Buffer.from("W_hellenistic", "ascii");
  return buf.indexOf(needle);
}

function findModelEnd(buf, modelStart) {
  // Walk forward from modelStart until we see >= 64 consecutive 00 ff cells.
  // The end of model strings + start of "alt tile grid".
  for (let p = modelStart; p < buf.length - 128; p++) {
    let ok = true;
    for (let j = 0; j < 64; j += 2) {
      if (buf[p + j] !== 0x00 || buf[p + j + 1] !== 0xff) { ok = false; break; }
    }
    if (ok) return p;
  }
  return -1;
}

function analyze(savePath, label) {
  const buf = fs.readFileSync(savePath);
  console.log(`\n===== ${label} =====`);
  const footerStart = findFooter(buf);
  // footerStart points to "R" of "RIS_Campaign_Script". Strip back to find the
  // u16 prefix length and the section's actual start (just before "data/world").
  const dataStart = buf.indexOf(Buffer.from("d\x00a\x00t\x00a\x00/\x00w\x00o\x00r\x00l\x00d\x00", "binary"), footerStart - 200);
  console.log(`Footer 'data/world' start at: 0x${dataStart.toString(16)}`);
  // Walk back to find the u16 length prefix. Length value should be 66 (chars).
  const lenAt = dataStart - 2;
  const lenVal = buf.readUInt16LE(lenAt);
  console.log(`Length-prefix u16: ${lenVal} (expected 66 for the path "data/world/.../RIS_Campaign_Script.txt")`);

  const modelStart = findFieldArmies(buf);
  console.log(`First "W_hellenistic" at: 0x${modelStart.toString(16)}`);

  const altGridStart = findModelEnd(buf, modelStart);
  console.log(`First long 00ff run (alt tile grid start): 0x${altGridStart.toString(16)}`);
  const altGridEnd = lenAt; // up to right before the footer length
  console.log(`Alt tile grid: 0x${altGridStart.toString(16)}..0x${altGridEnd.toString(16)} = ${altGridEnd - altGridStart} bytes`);

  // Walk through the alt tile grid and characterize its blocks.
  // First, do a u16 LE histogram for the whole zone.
  const u16Hist = new Map();
  for (let p = altGridStart; p < altGridEnd - 1; p += 2) {
    const w = buf.readUInt16LE(p);
    u16Hist.set(w, (u16Hist.get(w) || 0) + 1);
  }
  const totCells = (altGridEnd - altGridStart) / 2;
  const ff00Count = u16Hist.get(0xff00) || 0;
  console.log(`Total u16 cells: ${totCells}`);
  console.log(`Cells == 0xff00 (empty): ${ff00Count} (${(ff00Count / totCells * 100).toFixed(2)}%)`);
  console.log(`Distinct u16 values: ${u16Hist.size}`);
  const u16Sorted = [...u16Hist.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`Top 25 u16: ${u16Sorted.slice(0, 25).map(([v, c]) => `${v.toString(16).padStart(4, "0")}=${c}`).join(" ")}`);

  // Look for structure: are there embedded u32 self-pointers (= file offset)?
  let nSelfPtrs = 0;
  const selfPtrSample = [];
  for (let p = altGridStart; p < altGridEnd - 3; p += 1) {
    const v = buf.readUInt32LE(p);
    if (v === p) {
      nSelfPtrs++;
      if (selfPtrSample.length < 12) selfPtrSample.push(p);
    }
  }
  console.log(`Self-pointers (u32 == offset): ${nSelfPtrs}`);
  console.log(`Sample: ${selfPtrSample.map(o => "0x" + o.toString(16)).join(", ")}`);

  // Find ASCII strings (length >= 6) within the zone
  let inStr = false;
  let strStart = -1;
  const strs = [];
  for (let p = altGridStart; p < altGridEnd; p++) {
    const b = buf[p];
    const printable = (b >= 0x20 && b <= 0x7e);
    if (printable) {
      if (!inStr) { inStr = true; strStart = p; }
    } else {
      if (inStr) {
        if (p - strStart >= 6) {
          strs.push({ off: strStart, len: p - strStart, s: buf.slice(strStart, p).toString("ascii") });
        }
        inStr = false;
      }
    }
  }
  console.log(`ASCII strings (len>=6): ${strs.length}`);
  if (strs.length > 0) {
    console.log(`First 20:`);
    for (const s of strs.slice(0, 20)) console.log(`    0x${s.off.toString(16)}: ${JSON.stringify(s.s)}`);
  }

  // Find UTF-16LE strings (len >= 4)
  let utf16Strings = [];
  for (let p = altGridStart; p < altGridEnd - 16; p++) {
    if (buf[p] >= 0x41 && buf[p] <= 0x7a && buf[p+1] === 0x00 && buf[p+2] >= 0x41 && buf[p+2] <= 0x7a && buf[p+3] === 0x00) {
      // potential UTF-16LE ASCII start
      let q = p;
      let s = "";
      while (q < altGridEnd - 1 && buf[q+1] === 0x00 && buf[q] >= 0x20 && buf[q] <= 0x7e) {
        s += String.fromCharCode(buf[q]);
        q += 2;
      }
      if (s.length >= 4) {
        utf16Strings.push({ off: p, len: s.length, s });
        p = q;
      }
    }
  }
  console.log(`UTF-16LE strings (len>=4): ${utf16Strings.length}`);
  if (utf16Strings.length > 0) {
    console.log(`First 15:`);
    for (const s of utf16Strings.slice(0, 15)) console.log(`    0x${s.off.toString(16)}: len=${s.len} ${JSON.stringify(s.s)}`);
  }

  return { buf, altGridStart, altGridEnd };
}

const r10 = analyze(ROME10, "rome10");
const rT1 = analyze(ROR_T1, "RoR-T1");

// Now: take the rome10 alt-grid and look at a "raw" hex dump every 4KB
console.log(`\n\n===== rome10 alt-grid 4KB samples =====`);
for (let off = r10.altGridStart; off < r10.altGridEnd; off += 0x10000) {
  console.log(`\n--- offset 0x${off.toString(16)} (delta=${off - r10.altGridStart}) ---`);
  for (let row = 0; row < 2; row++) {
    const o = off + row * 16;
    const hex = [];
    for (let j = 0; j < 16; j++) hex.push(r10.buf[o + j].toString(16).padStart(2, "0"));
    console.log(`  0x${o.toString(16)}: ${hex.join(" ")}`);
  }
}
