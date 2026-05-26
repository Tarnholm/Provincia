// Robust, save-agnostic locator for the N×N attitude matrix + validation against
// mod-file war ground truth across MULTIPLE saves (RIS, vanilla, later turn).
const fs = require("fs");
const DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";

function loadOrder(p) {
  let txt; try { txt = fs.readFileSync(p, "utf8"); } catch { return null; }
  const order = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) { const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/); if (cm) { order.push(cur); cur = null; } }
  }
  return order.length ? order : null;
}

// signature of a cell: u32[+0]==0, u32[+4]==key, u32[+8]==200, u32[+12]∈[0,1000], u32[+16]==2
function locateMatrix(buf, N) {
  const okAtt = v => v >= 0 && v <= 1000;
  for (let p = 0x4000; p < buf.length - 64; p++) {
    if (buf.readUInt32LE(p) !== 0) continue;
    const key = buf.readUInt32LE(p + 4);
    if (key < 1 || key > 64) continue;
    if (buf.readUInt32LE(p + 8) !== 200) continue;
    if (!okAtt(buf.readUInt32LE(p + 12))) continue;
    if (buf.readUInt32LE(p + 16) !== 2) continue;
    // measure stride: try every candidate, keep the one with the LONGEST run
    // (avoids picking a coincidental smaller stride that bails early).
    // run-check uses only the ROCK-SOLID invariants (the +16 "flag" and +12
    // attitude change in live saves, so don't require them here).
    const runFor = (s) => {
      let good = 0;
      for (let k = 0; k < N + 2; k++) {
        const o = p + k * s;
        if (o + 12 >= buf.length) break;
        if (buf.readUInt32LE(o) === 0 && buf.readUInt32LE(o + 4) === key &&
            buf.readUInt32LE(o + 8) === 200) good++;
        else break;
      }
      return good;
    };
    // Prefer the SMALLEST stride that yields a full row+ run (avoids 2×stride
    // aliasing, which also "matches" on every other cell).
    let bestStride = 0;
    for (let s = 80; s <= 400; s++) {
      if (p + s + 12 >= buf.length) break;
      if (buf.readUInt32LE(p + s) === 0 && buf.readUInt32LE(p + s + 4) === key &&
          buf.readUInt32LE(p + s + 8) === 200) {
        if (runFor(s) >= N) { bestStride = s; break; }
      }
    }
    if (bestStride) return { cellStart: p, base: p + 8, stride: bestStride, key, good: runFor(bestStride) };
  }
  return null;
}

function attitudeC(buf, m, N, A, B, C) {
  const idx = A * N + B + C;
  const off = m.base + idx * m.stride + 4;
  if (off < 0 || off + 4 > buf.length) return null;
  return buf.readUInt32LE(off);
}
// Self-calibrate the index constant C via matrix SYMMETRY (att(A,B)==att(B,A)
// for the real mapping). No ground truth needed.
function calibrateC(buf, m, N) {
  let bestC = -1, bestScore = -1;
  for (let C = -3; C <= 3; C++) {
    let sym = 0, tot = 0;
    for (let A = 1; A < N; A += 7) for (let B = A + 1; B < N; B += 5) {
      const v1 = attitudeC(buf, m, N, A, B, C), v2 = attitudeC(buf, m, N, B, A, C);
      if (v1 == null || v2 == null) continue;
      tot++; if (v1 === v2) sym++;
    }
    const score = tot ? sym / tot : 0;
    if (score > bestScore) { bestScore = score; bestC = C; }
  }
  return { C: bestC, score: bestScore };
}
function attitude(buf, m, N, A, B) { return attitudeC(buf, m, N, A, B, m.C); }

function test(label, savePath, orderPath, gtPairs) {
  const buf = (() => { try { return fs.readFileSync(savePath); } catch { return null; } })();
  const order = loadOrder(orderPath);
  if (!buf || !order) { console.log(`\n${label}: SKIP (missing save or order)`); return; }
  const N = order.length;
  const t0 = Date.now();
  const m = locateMatrix(buf, N);
  const ms = Date.now() - t0;
  if (!m) { console.log(`\n${label}: matrix NOT located (N=${N})`); return; }
  const cal = calibrateC(buf, m, N); m.C = cal.C;
  console.log(`\n${label}: N=${N} base=0x${m.base.toString(16)} stride=${m.stride} key=${m.key} C=${m.C} (sym=${(cal.score*100).toFixed(1)}%, ${ms}ms)`);
  // count war/ally cells
  let war = 0, ally = 0, neutral = 0, other = 0, total = 0;
  for (let i = 0; i < N * N; i++) {
    const off = m.base + i * m.stride + 4;
    if (off + 4 > buf.length) break;
    const v = buf.readUInt32LE(off); total++;
    if (v >= 600) war++; else if (v === 0) ally++; else if (v === 200) neutral++; else other++;
  }
  console.log(`  cells=${total} war(>=600)=${war} ally(0)=${ally} neutral(200)=${neutral} other=${other}`);
  // validate ground-truth war pairs
  if (gtPairs) {
    const idx = n => order.indexOf(n);
    let hit = 0;
    const miss = [];
    for (const [a, b] of gtPairs) {
      const A = idx(a), B = idx(b);
      if (A < 0 || B < 0) { miss.push(`${a}/${b}(notInOrder)`); continue; }
      const v = attitude(buf, m, N, A, B);
      if (v >= 600) hit++; else miss.push(`${a}<->${b}=${v}`);
    }
    console.log(`  GT war pairs: ${hit}/${gtPairs.length} matched${miss.length ? "  MISS: " + miss.join(", ") : ""}`);
  }
}

const RIS_ORDER = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
// RIS turn-0 known wars (subset, from faction_relationships_large.json)
const RIS_WARS = [["seleucid","bithynia"],["antigonid","epirus"],["antigonid","galatians"],["ptolemaic","egypt"],["ptolemaic","cyrene"]];
test("RIS macedon t0", DIR + "save_macedon t0.sav", RIS_ORDER, RIS_WARS);
test("RIS seleucid t0", DIR + "save_Seleucids t0.sav", RIS_ORDER, RIS_WARS);
test("RIS antigonid T1", DIR + "save_Autosave   Antigonid Kingdom   Turn 1.sav", RIS_ORDER, RIS_WARS);
test("RIS arretium turn 4 (player=romans_julii)", DIR + "save_arretium turn 4.sav", RIS_ORDER, null);
// vanilla
const VAN_ORDER = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Total War ROME REMASTERED\\Contents\\Resources\\Data\\data\\descr_sm_factions.txt";
test("vanilla Spain T4 Start", DIR + "save_Autosave   Spain   Turn 4 Start.sav", VAN_ORDER, null);
test("vanilla Spain T4 (at war w/ carthage)", DIR + "save_Autosave   Spain   Turn 4.sav", VAN_ORDER, [["spain","carthage"]]);
