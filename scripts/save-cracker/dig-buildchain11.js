// dig-buildchain11.js — Decode the 53-byte construction queue entry inserted in Pella's default_set.
// Compare default_set payloads of START (75 bytes) and CONSTR (128 bytes).

const fs = require("fs");
const path = require("path");

const ARCHIVE = "C:/dev/Provincia/calibration/archive/2026-04-21T22-49-17-100Z";
const startBuf = fs.readFileSync(path.join(ARCHIVE, "0010_save_saveturn1start.sav"));
const constrBuf = fs.readFileSync(path.join(ARCHIVE, "0008_save_saveturn1construction.sav"));

// Pella default_set name starts at 0x10dae in both. Length 12 (= "default_set" + null).
// Sub-record name actually starts at 0x10dae (= byte 'd' of "default_set"), so default_set's
// PAYLOAD (after null) starts at 0x10dae + 12 = 0x10dba.
//
// In START, payload extends to 0x10df9 - 6 = 0x10df3 (next sub-record's self-ptr at 0x10df3, which is
// inside next nameLen u16). So payload length = 0x10df3 - 0x10dba = 57 bytes.
//
// In CONSTR, payload extends to 0x10e2e - 6 = 0x10e28. Payload length = 0x10e28 - 0x10dba = 110 bytes.
// Insertion = 110 - 57 = 53 bytes. Matches!

const PAYLOAD_S = 0x10dba;
const PAYLOAD_LEN_S = 57;
const PAYLOAD_LEN_C = 110;

console.log("=== START default_set payload (57 bytes): ===");
for (let i = 0; i < PAYLOAD_LEN_S; i += 16) {
  const hex = [], asc = [];
  for (let j = 0; j < 16 && i + j < PAYLOAD_LEN_S; j++) {
    const b = startBuf[PAYLOAD_S + i + j];
    hex.push(b.toString(16).padStart(2, "0"));
    asc.push((b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".");
  }
  console.log(`  +${i.toString().padStart(3)}: ${hex.join(" ").padEnd(48)} | ${asc.join("")}`);
}

console.log("\n=== CONSTR default_set payload (110 bytes): ===");
for (let i = 0; i < PAYLOAD_LEN_C; i += 16) {
  const hex = [], asc = [];
  for (let j = 0; j < 16 && i + j < PAYLOAD_LEN_C; j++) {
    const b = constrBuf[PAYLOAD_S + i + j];
    hex.push(b.toString(16).padStart(2, "0"));
    asc.push((b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".");
  }
  console.log(`  +${i.toString().padStart(3)}: ${hex.join(" ").padEnd(48)} | ${asc.join("")}`);
}

// Try alignment: which suffix of CONSTR payload matches START payload?
// constrPayload[K..K+57] === startPayload[0..57] ?
const startPL = startBuf.slice(PAYLOAD_S, PAYLOAD_S + PAYLOAD_LEN_S);
const constrPL = constrBuf.slice(PAYLOAD_S, PAYLOAD_S + PAYLOAD_LEN_C);

console.log(`\nLooking for tail match:`);
for (let off = 0; off < 60; off++) {
  // Allow up to 6 byte mismatches (runtime pointers + diplomacy hashes)
  let mismatches = 0;
  for (let k = 0; k < PAYLOAD_LEN_S; k++) {
    if (off + k >= PAYLOAD_LEN_C) { mismatches = 999; break; }
    if (startPL[k] !== constrPL[off + k]) mismatches++;
  }
  if (mismatches <= 10) {
    console.log(`  offset ${off} matches with ${mismatches} mismatches`);
  }
}
