// INDEPENDENT verification of the N×N attitude matrix (not reusing agent code).
// Decode specific (A,B) cells from scratch and check against KNOWN ground truth:
//   war pairs  -> 600,  ally pairs -> 0 (ALLIED),  unrelated -> 200 (neutral).
const fs = require("fs");
const SAVE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav";
const buf = fs.readFileSync(SAVE);

const N = 239, STRIDE = 267, BASE = 0xf8fd1; // documented params
function attitude(A, B) {
  const idx = A * N + B - 1;            // documented index formula
  const off = BASE + idx * STRIDE + 4;  // attitude at cell+4
  if (off + 4 > buf.length) return null;
  return buf.readUInt32LE(off);
}
// faction ids (from descr_sm_factions order)
const F = { romans_julii:0, antigonid:5, seleucid:7, bithynia:46, epirus:98, galatians:102, ptolemaic:6, egypt:95, carthage:4 };

const checks = [
  ["seleucid","bithynia","WAR(600)"],
  ["antigonid","epirus","WAR(600)"],
  ["antigonid","galatians","WAR(600)"],
  ["ptolemaic","egypt","WAR(600)"],
  ["seleucid","antigonid","ALLY(0)"],      // allies in mod file
  ["antigonid","seleucid","ALLY(0)"],      // symmetric
  ["seleucid","romans_julii","neutral?"],  // no known relation
  ["romans_julii","carthage","?"],
];
console.log(`base=0x${BASE.toString(16)} stride=${STRIDE} N=${N}`);
for (const [a, b, expect] of checks) {
  const v = attitude(F[a], F[b]);
  console.log(`  ${a}(${F[a]}) -> ${b}(${F[b]}): attitude=${v}   [expect ${expect}]`);
}

// Also: dump the full row for ANTIGONID (player) — every faction it has a non-200 stance with.
console.log("\nAntigonid(5) full stance row (non-200/non-0 baseline shown, plus 0=ally and >=600=war):");
const order = fs.readFileSync("C:\\RIS\\RIS\\data\\descr_sm_factions.txt","utf8");
const names = []; { let cur=null; for (const l of order.split(/\r?\n/)){ const m=l.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/); if(m){cur=m[1];continue;} if(cur){const c=l.match(/^\s*"culture":\s*"([a-z_]+)"/); if(c){names.push(cur);cur=null;}} } }
for (let b = 0; b < N; b++) {
  const v = attitude(5, b);
  if (v === 0 || v >= 400) console.log(`   antigonid -> ${names[b]||b}: ${v} ${v===0?"(ALLIED)":v>=600?"(WAR)":"(hostile)"}`);
}
