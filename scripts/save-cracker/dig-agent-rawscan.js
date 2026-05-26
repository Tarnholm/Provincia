// dig-agent-rawscan.js
// Find every raw occurrence of agent role tokens (any case) and dump context.
const fs = require("fs");
const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";

const saves = [
  "save_17-05-2026   Spain   Turn 1 move spy.sav",
  "save_17-05-2026   Spain   Turn 1move diplomat and army.sav",
];

const tokens = ["spy", "Spy", "diplomat", "Diplomat", "assassin", "Assassin", "merchant", "Merchant"];

function ctx(buf, at, before = 24, after = 40) {
  const s = Math.max(0, at - before);
  const e = Math.min(buf.length, at + after);
  let asc = "";
  for (let i = s; i < e; i++) {
    const b = buf[i];
    asc += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".";
  }
  return asc;
}

for (const name of saves) {
  const buf = fs.readFileSync(SAVE_DIR + name);
  console.log(`\n=== ${name} ===`);
  for (const tok of tokens) {
    const t = Buffer.from(tok, "ascii");
    let p = 0, n = 0;
    const samples = [];
    while ((p = buf.indexOf(t, p)) !== -1) {
      // word-boundary-ish: char before/after not alpha
      const before = p > 0 ? buf[p - 1] : 0;
      const after = p + tok.length < buf.length ? buf[p + tok.length] : 0;
      const ba = (before >= 0x41 && before <= 0x5a) || (before >= 0x61 && before <= 0x7a);
      const aa = (after >= 0x41 && after <= 0x5a) || (after >= 0x61 && after <= 0x7a);
      if (!ba && !aa) {
        n++;
        if (samples.length < 12) samples.push(`0x${p.toString(16)} [${ctx(buf, p)}]`);
      }
      p += 1;
    }
    if (n) {
      console.log(`  "${tok}" x${n}`);
      for (const s of samples) console.log(`     ${s}`);
    }
  }
}
