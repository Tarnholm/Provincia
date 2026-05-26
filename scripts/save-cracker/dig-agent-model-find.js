// dig-agent-model-find.js
// The live agent unit uses strat_model "spy"/"assassin"/"diplomat"/"merchant"
// (per descr_character.txt). These appear as null-terminated ASCII pstr in the
// unit/character zone of the save. Find every "<model>\0" occurrence (length-
// prefixed pstr16 form: [u16 len][ascii len bytes including null? or excluding])
// and dump context so we can locate the agent record.
const fs = require("fs");
const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";
const MODELS = ["spy", "assassin", "diplomat", "merchant"];

function ctx(buf, at, before = 32, after = 48) {
  const s = Math.max(0, at - before), e = Math.min(buf.length, at + after);
  let asc = "";
  for (let i = s; i < e; i++) { const b = buf[i]; asc += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : "."; }
  return asc;
}

const saves = [
  "save_17-05-2026   Spain   Turn 1 move spy.sav",
  "save_17-05-2026   Spain   Turn 1move diplomat and army.sav",
  "save_Autosave   Spain   Turn 3 inflitrated city with spy..sav",
];

for (const name of saves) {
  const buf = fs.readFileSync(SAVE_DIR + name);
  console.log(`\n=== ${name} ===`);
  for (const m of MODELS) {
    // pstr16: [u16 len][ascii...]. The string content is exactly model (no null in some, null-term in others).
    // Search the model bytes preceded by a u16 length == model.length or model.length+1.
    const t = Buffer.from(m, "ascii");
    let p = 0, n = 0;
    const samples = [];
    while ((p = buf.indexOf(t, p)) !== -1) {
      // boundary: byte after must be null or non-alpha
      const after = p + m.length < buf.length ? buf[p + m.length] : -1;
      const before = p > 0 ? buf[p - 1] : -1;
      const afterAlpha = (after >= 0x41 && after <= 0x5a) || (after >= 0x61 && after <= 0x7a);
      const beforeAlpha = (before >= 0x41 && before <= 0x5a) || (before >= 0x61 && before <= 0x7a);
      if (!afterAlpha && !beforeAlpha) {
        // Check for pstr16 length prefix
        const len16 = p >= 2 ? buf.readUInt16LE(p - 2) : -1;
        const isPstr = (len16 === m.length || len16 === m.length + 1);
        n++;
        if (samples.length < 10) samples.push(`0x${p.toString(16)}${isPstr ? "[PSTR]" : ""} after=0x${after.toString(16)} [${ctx(buf, p)}]`);
      }
      p += 1;
    }
    console.log(`  "${m}" x${n}`);
    for (const s of samples) console.log(`     ${s}`);
  }
}
