// dig-aidiplocache3.js — verify the cover.js detector tests against the 5 known targets.
"use strict";
const fs = require("fs");
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const buf = fs.readFileSync(SAVE);

const TARGETS = [
  { start: 0x01f1a697, end: 0x01f1fc14, label: "T1-21885" },
  { start: 0x018be452, end: 0x018c1c1d, label: "T2-14283" },
  { start: 0x01d000d6, end: 0x01d0373b, label: "T3-13925" },
  { start: 0x01cf5669, end: 0x01cf8cbb, label: "T4-13906" },
  { start: 0x01a9372d, end: 0x01a96d0e, label: "T5-13793" },
];
const CHAIN_TOKENS = [
  Buffer.from("_Town"), Buffer.from("_City"), Buffer.from("_Village"),
  Buffer.from("Hillfort"), Buffer.from("Stockade"),
];

for (const t of TARGETS) {
  const rs = t.start, re = t.end;
  console.log(`\n=== ${t.label} ===`);
  // Test A (lookback 320)
  let unitTailOk = false, detail = "";
  for (let p = Math.max(0, rs - 320); p < rs - 4; p++) {
    const len = buf.readUInt16LE(p);
    if (len < 4 || len > 48) continue;
    if (p + 2 + len > rs) continue;
    let ok = true;
    for (let k = 0; k < len; k++) {
      const c = buf[p + 2 + k];
      const isAlpha = (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a);
      const isDigit = (c >= 0x30 && c <= 0x39);
      if (!isAlpha && !isDigit && c !== 0x20 && c !== 0x5f && c !== 0x2d) { ok = false; break; }
    }
    if (!ok) continue;
    detail = `len=${len} ascii="${buf.toString('ascii', p+2, p+2+len)}" gap=${rs-(p+2+len)}`;
    unitTailOk = true; break;
  }
  console.log(`  A unitTailOk=${unitTailOk}  ${detail}`);

  // Test B (new logic)
  let tileHits = 0;
  const winEnd = Math.min(re - 9, rs + 2048);
  for (let i = rs; i < winEnd; i++) {
    if (buf[i] === 0) continue;
    const hi = buf[i + 1];
    if (hi < 0x0d || hi > 0x17) continue;
    let zeros = 0;
    for (let k = 2; k < 9; k++) if (buf[i + k] === 0) zeros++;
    if (zeros >= 5) tileHits++;
  }
  const winLen = winEnd - rs;
  const stridePct = tileHits / winLen;
  console.log(`  B tileHits=${tileHits}/${winLen} (${(stridePct*100).toFixed(2)}%)  strideOk=${stridePct >= 0.06}`);

  // Test C
  let tokenOk = false;
  for (const tt of CHAIN_TOKENS) {
    const i = buf.indexOf(tt, rs);
    if (i >= 0 && i < re) { tokenOk = true; break; }
  }
  let termOk = false;
  for (let p = Math.max(rs, re - 96); p + 20 < re; p++) {
    if (buf[p] === 0x1e && buf[p+1] === 0 && buf[p+2] === 0 && buf[p+3] === 0) {
      let z = 0;
      for (let k = 4; k < 20 && p + k < re; k++) if (buf[p + k] === 0) z++;
      if (z >= 14) { termOk = true; break; }
    }
  }
  console.log(`  C tokenOk=${tokenOk} termOk=${termOk}`);
  console.log(`  RESULT: ${unitTailOk || (stridePct >= 0.06 && winLen >= 256) || (tokenOk && termOk) ? 'CLAIM' : 'SKIP'}`);
}
