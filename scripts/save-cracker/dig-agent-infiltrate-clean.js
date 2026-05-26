// dig-agent-infiltrate-clean.js
// =====================
// Turn3-End vs Turn3-infiltrated diff, with the global per-character "MP reset"
// churn filtered OUT so the actual infiltration flag/target stands out.
//
// MP-reset signature: a single byte at offset N whose value toggles among
// {0xff, 0x01, 0x02, 0x03} and which is bracketed by 0xff bytes:
//   buf[N-4..N-1] == ff ff ff ff   AND   buf[N+1..N+2] == ff ff
// We drop any changed byte matching that shape on BOTH sides.
//
// Research-only.

const fs = require("fs");
const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";
function load(n) { return fs.readFileSync(SAVE_DIR + n); }

const a = load("save_Autosave   Spain   Turn 3 End.sav");
const b = load("save_Autosave   Spain   Turn 3 inflitrated city with spy..sav");
console.log(`A=${a.length} B=${b.length} sizeDelta=${b.length - a.length}`);
const n = Math.min(a.length, b.length);

// Is this offset the MP-reset flag byte? (value in {ff,01,02,03} bracketed by ff)
function isMpResetByte(buf, off) {
  const v = buf[off];
  if (v !== 0xff && v > 0x0a) return false;
  if (off < 4 || off + 3 > buf.length) return false;
  return buf[off - 4] === 0xff && buf[off - 3] === 0xff && buf[off - 2] === 0xff &&
         buf[off - 1] === 0xff && buf[off + 1] === 0xff && buf[off + 2] === 0xff;
}

// Cluster changed runs (gap<=12 merges).
const runs = [];
let i = 0;
while (i < n) {
  if (a[i] !== b[i]) {
    let start = i, end = i, gap = 0, j = i + 1;
    while (j < n && gap <= 12) {
      if (a[j] !== b[j]) { end = j; gap = 0; } else gap++;
      j++;
    }
    runs.push({ start, end });
    i = end + 1;
  } else i++;
}

// Classify each run.
let mpResetRuns = 0, kept = 0;
const keptRuns = [];
for (const r of runs) {
  // Collect changed byte offsets in this run.
  const changed = [];
  for (let k = r.start; k <= r.end; k++) if (a[k] !== b[k]) changed.push(k);
  // If EVERY changed byte is an MP-reset flag in both, drop it.
  const allMp = changed.every((o) => isMpResetByte(a, o) || isMpResetByte(b, o));
  if (allMp) { mpResetRuns++; continue; }
  kept++;
  keptRuns.push(r);
}

console.log(`\n${runs.length} runs total | ${mpResetRuns} MP-reset-only (dropped) | ${kept} kept\n`);

for (const r of keptRuns) {
  const len = r.end - r.start + 1;
  const cs = Math.max(0, r.start - 16), ce = Math.min(n, r.end + 16);
  const ah = [], bh = [], asc = [];
  for (let k = cs; k < ce; k++) {
    const mk = a[k] !== b[k] ? "*" : " ";
    ah.push(a[k].toString(16).padStart(2, "0") + mk);
    bh.push(b[k].toString(16).padStart(2, "0") + mk);
    asc.push(a[k] >= 0x20 && a[k] <= 0x7e ? String.fromCharCode(a[k]) : ".");
  }
  console.log(`RUN @0x${r.start.toString(16)}..0x${r.end.toString(16)} len=${len}`);
  console.log(`  asc: ${asc.join("")}`);
  console.log(`  A:   ${ah.join("")}`);
  console.log(`  B:   ${bh.join("")}`);
  // interpret changed dwords
  for (let k = r.start; k <= r.end; k++) {
    if (a[k] !== b[k]) {
      const au = k + 4 <= a.length ? a.readUInt32LE(k & ~0) : 0;
      console.log(`     +0x${k.toString(16)}: ${a[k].toString(16).padStart(2,"0")} -> ${b[k].toString(16).padStart(2,"0")}`);
    }
  }
  console.log("");
}
