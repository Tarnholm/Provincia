// dig-deadpool-count-v4.js — clusters aren't per-faction pools. Pivot:
//   (a) find what's immediately before the FIRST dead-record start (the
//       record start is ~28 B before the /portraits/dead/ string),
//   (b) scan whole save for u16/u32 == total dead count (21762) or near-
//       neighbour values, since that's a single GLOBAL count likely in
//       a header somewhere,
//   (c) inspect the BYTE STRUCTURE of an isolated record (looking for a
//       record boundary marker we can use for splice-out instead of truncate).

"use strict";
const fs = require("fs");
const path = require("path");

const SRC = "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const DEAD = Buffer.from("/portraits/dead/", "ascii");
const buf = fs.readFileSync(SRC);

// Index dead-record portrait paths.
const deads = [];
{ let from = 0; while (true) { const i = buf.indexOf(DEAD, from); if (i < 0) break; deads.push(i); from = i + DEAD.length; } }
const totalDead = deads.length;
console.log(`total /portraits/dead/ records: ${totalDead}  (0x${totalDead.toString(16)})`);

// --- (a) Dump bytes before the very FIRST dead record start ---------------
const first = deads[0];
const recordStartEst = first - 28; // typical 'data/ui/<culture>/portraits/' prefix length
console.log();
console.log(`first /portraits/dead/ at 0x${first.toString(16)}; estimated record start ~0x${recordStartEst.toString(16)}`);
console.log(`bytes [0x${(recordStartEst - 64).toString(16)} .. 0x${recordStartEst.toString(16)}]:`);
const preStart = recordStartEst - 64;
console.log(buf.slice(preStart, recordStartEst).toString("hex").match(/.{2}/g).join(" "));
const ascii = Array.from(buf.slice(preStart, recordStartEst)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : ".").join("");
console.log(`ascii: ${ascii}`);

// --- (b) Scan whole save for the total count value (and near-neighbours) ---
console.log();
console.log(`--- whole-save scan for u32 == ${totalDead} ---`);
{
  const targets = [totalDead, totalDead - 1, totalDead + 1, 21000, 22000];
  for (const t of targets) {
    const hits = [];
    for (let p = 0; p < buf.length - 3; p++) {
      if (buf.readUInt32LE(p) === t) {
        hits.push(p);
        if (hits.length >= 8) break;
      }
    }
    console.log(`u32 == ${t.toString().padStart(5)}: ${hits.length}${hits.length === 8 ? "+" : ""} hits` + (hits.length ? "  first: " + hits.slice(0, 6).map(h => "0x"+h.toString(16)).join(", ") : ""));
  }
}
console.log();
console.log(`--- whole-save scan for u16 == ${totalDead} (= 0x${totalDead.toString(16)}) ---`);
{
  let cnt = 0;
  const sample = [];
  for (let p = 0; p < buf.length - 1; p++) {
    if (buf.readUInt16LE(p) === totalDead) { cnt++; if (sample.length < 4) sample.push(p); }
  }
  console.log(`u16 == ${totalDead}: ${cnt} hits${cnt ? "  first: " + sample.map(h => "0x"+h.toString(16)).join(", ") : ""}`);
}

// --- (c) Determine actual record stride from a dense intra-cluster region ---
console.log();
console.log("--- record stride inside the first dense run (deads[0..20]) ---");
for (let i = 0; i < 20 && i < deads.length - 1; i++) {
  const gap = deads[i+1] - deads[i];
  console.log(`  rec[${String(i).padStart(2)}] @ 0x${deads[i].toString(16)}  → next gap ${gap}`);
}

// --- (d) Inspect the BYTES of record #0 (full structure) -------------------
// Extract from estimated record start to next record start (= deads[1] - 28).
console.log();
const r0Start = first - 28;
const r1Start = deads[1] - 28;
const r0Len   = r1Start - r0Start;
console.log(`record #0 estimated bytes [0x${r0Start.toString(16)} .. 0x${r1Start.toString(16)}] (${r0Len} bytes):`);
const recBytes = buf.slice(r0Start, r1Start);
console.log(recBytes.toString("hex").match(/.{2}/g).join(" "));
console.log("ascii:");
console.log(Array.from(recBytes).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : ".").join(""));

// --- (e) Look for a u32 length prefix u16 PASCAL string pattern ----------
// Common engine pattern: u16 len + ascii; OR u32 len + ascii. Check if
// (first - 2) bytes encode the path length.
console.log();
const pathStart = first - 22; // approximate where 'data/ui/' could begin
// Find the actual 'data' prefix offset before `first`.
let dataPrefixOff = -1;
for (let p = first - 64; p < first; p++) {
  if (buf[p] === 0x64 && buf[p+1] === 0x61 && buf[p+2] === 0x74 && buf[p+3] === 0x61 && buf[p+4] === 0x2f) {
    dataPrefixOff = p; break;
  }
}
if (dataPrefixOff >= 0) {
  console.log(`record #0 'data/' starts at 0x${dataPrefixOff.toString(16)}`);
  // Find the .tga\0 terminator.
  const tgaIdx = buf.indexOf(Buffer.from(".tga\0", "binary"), dataPrefixOff);
  if (tgaIdx > 0 && tgaIdx < dataPrefixOff + 200) {
    const pathLen = tgaIdx + 5 - dataPrefixOff; // include .tga\0
    console.log(`path length: ${pathLen}`);
    console.log(`bytes immediately BEFORE 'data/' (8 B): ${buf.slice(dataPrefixOff - 8, dataPrefixOff).toString("hex").match(/.{2}/g).join(" ")}`);
    console.log(`  as u16 @ data-2: ${buf.readUInt16LE(dataPrefixOff - 2)}`);
    console.log(`  as u32 @ data-4: ${buf.readUInt32LE(dataPrefixOff - 4)}`);
  }
}
