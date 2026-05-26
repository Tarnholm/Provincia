// dig-econ-settlement-sum.js
// Compute per-faction total settlement income (sum of name-127 u32 over all
// settlements owned by that faction, using name-583 creator/owner u32). This
// gives a KNOWN gross-income value per faction that we can then search for in
// the FACTION_ECONOMICS section.
//
// NOTE: name-583 "creator" is the REVOLT-TO faction, not necessarily live owner
// (per memory project_creator_vs_owner). We'll print both the creator-grouped
// sum AND the raw settlement list so we can sanity-check which faction is the
// player (antigonid, 22 regions => ~22 settlements).

const fs = require("fs");
const path = require("path");

const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const FILES = { T1: "save_arretium pre retrained..sav", T2: "save_arretium retrained turn 2.sav", T3: "save_arretium turn 3.sav", T4: "save_arretium turn 4.sav" };
const SM_FACTIONS = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";

function loadFactionOrder(p) {
  const txt = fs.readFileSync(p, "utf8");
  const order = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) { const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/); if (cm) { order.push(cur); cur = null; } }
  }
  return order;
}
const order = loadFactionOrder(SM_FACTIONS);

function readUtf16Name(buf, pos, maxLen) {
  if (pos + 2 > buf.length) return null;
  const n = buf.readUInt16LE(pos);
  if (n < 2 || n > 40) return null;
  const start = pos + 2;
  if (start + n * 2 > buf.length) return null;
  let s = "";
  for (let i = 0; i < n; i++) {
    const lo = buf[start + i * 2], hi = buf[start + i * 2 + 1];
    if (hi !== 0 || lo < 0x20 || lo > 0x7e) return null;
    s += String.fromCharCode(lo);
  }
  return { name: s, namePos: pos };
}

// Settlement discovery: \x01 marker then UTF-16 name. To avoid false positives,
// require the stats-block income (name-127) and creator (name-583) to be sane.
function findSettlements(buf) {
  const out = [];
  for (let i = 0; i < buf.length - 10; i++) {
    if (buf[i] !== 0x01) continue;
    const r = readUtf16Name(buf, i + 1, buf.length);
    if (!r) continue;
    const namePos = i + 1;
    const incOff = namePos - 127, creatorOff = namePos - 583, levelOff = namePos - 571, popOff = namePos - 35;
    if (creatorOff < 0) continue;
    const creator = buf.readUInt32LE(creatorOff);
    const income = buf.readUInt32LE(incOff);
    const level = buf.readUInt32LE(levelOff);
    const pop = buf.readUInt32LE(popOff);
    // Sanity gates: creator a valid faction idx, income & pop in range, level 0..5
    if (creator >= order.length) continue;
    if (income > 50000) continue;
    if (level > 5) continue;
    if (pop < 100 || pop > 200000) continue;
    out.push({ namePos, name: r.name, creator, income, level, pop });
  }
  return out;
}

for (const [t, f] of Object.entries(FILES)) {
  const buf = fs.readFileSync(path.join(BASE, f));
  const setts = findSettlements(buf);
  // Group by creator
  const byFac = new Map();
  for (const s of setts) {
    if (!byFac.has(s.creator)) byFac.set(s.creator, { count: 0, income: 0, names: [] });
    const g = byFac.get(s.creator);
    g.count++; g.income += s.income; g.names.push(`${s.name}(${s.income})`);
  }
  console.log(`\n===== [${t}] ${f} — ${setts.length} settlements =====`);
  const rows = [...byFac.entries()].sort((a, b) => b[1].income - a[1].income);
  for (const [fac, g] of rows.slice(0, 12)) {
    console.log(`  fac ${String(fac).padStart(3)} ${(order[fac]||"?").padEnd(14)} count=${String(g.count).padStart(3)} totalIncome=${String(g.income).padStart(6)}  ${g.names.slice(0,5).join(" ")}`);
  }
  // Antigonid (player) specifically
  const ant = order.indexOf("antigonid");
  const g = byFac.get(ant);
  if (g) console.log(`  >>> PLAYER antigonid(${ant}): ${g.count} settlements, total settlement income = ${g.income}`);
}
