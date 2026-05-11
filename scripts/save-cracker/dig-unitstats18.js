// dig-unitstats18.js — Strong cross-validation of +20=XP:
// Find a save pair where the SAME unit transitions +20 from 0→1 (i.e. gained a chevron between turns).
// Verify across multiple pairs that the +20 byte is the XP / chevron field.

const fs = require("fs");
const path = require("path");
const { findUnitRecords } = require("../../src/unitParser.js");

const ARCHIVE = "C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z";

const allFiles = fs.readdirSync(ARCHIVE).filter(f => f.endsWith(".sav"));
const byTurn = new Map();
for (const f of allFiles) {
  const m = f.match(/Turn (\d+) (End|Start)/);
  if (!m) continue;
  const turn = parseInt(m[1], 10);
  const phase = m[2];
  const stat = fs.statSync(path.join(ARCHIVE, f));
  const k = `${turn}|${phase}`;
  const prev = byTurn.get(k);
  if (!prev || prev.size < stat.size) byTurn.set(k, { file: f, size: stat.size, turn, phase });
}

function regionEnd(buf, u) {
  const len = buf.readUInt16LE(u.offset);
  const ns = u.offset + 2, ne = ns + len - 1;
  for (let q = ne + 1; q < ne + 80; q++) {
    const rlen = buf[q];
    if (rlen < 3 || rlen > 50 || buf[q + 1] !== 0) continue;
    const rs = q + 2, re = rs + rlen * 2;
    if (re + 8 > buf.length) continue;
    let ok = true;
    for (let j = rs; j < re; j += 2) {
      if (buf[j + 1] !== 0 || buf[j] < 0x20 || buf[j] > 0x7e) { ok = false; break; }
    }
    if (!ok) continue;
    return re + 4;
  }
  return -1;
}

// Across all consecutive (N End, N+1 Start) pairs, find units that survived AND +20 went up
let totalXpGains = 0;
let totalSurvivors = 0;
const sequence = [];
for (let t = 1; t <= 30; t++) {
  const ent = byTurn.get(`${t}|End`);
  const ns = byTurn.get(`${t+1}|Start`);
  if (!ent || !ns) continue;
  sequence.push({ from: ent, to: ns });
}

for (const pair of sequence) {
  const bBuf = fs.readFileSync(path.join(ARCHIVE, pair.from.file));
  const aBuf = fs.readFileSync(path.join(ARCHIVE, pair.to.file));
  const before = findUnitRecords(bBuf);
  const after = findUnitRecords(aBuf);
  function key(u) { return `${u.name}|${u.region}|${u.commanderUuid || 0}|${u.maxSoldiers}`; }
  const bMap = new Map();
  // For matching, need disambiguation: same key may appear for multiple units. Use file-order index.
  for (const u of before) {
    const k = key(u);
    if (!bMap.has(k)) bMap.set(k, []);
    bMap.get(k).push(u);
  }
  const aSeen = new Map();
  for (const u of after) {
    const k = key(u);
    aSeen.set(k, (aSeen.get(k) || 0) + 1);
  }

  // For each "after" unit, match its N-th occurrence to before's N-th occurrence
  const aCount = new Map();
  for (const ua of after) {
    const k = key(ua);
    const idx = aCount.get(k) || 0;
    aCount.set(k, idx + 1);
    const beforeList = bMap.get(k);
    if (!beforeList || beforeList.length <= idx) continue;
    const ub = beforeList[idx];
    const bE = regionEnd(bBuf, ub);
    const aE = regionEnd(aBuf, ua);
    if (bE < 0 || aE < 0) continue;
    const xpB = bBuf[bE + 20], xpA = aBuf[aE + 20];
    if (xpA > xpB) {
      totalXpGains++;
      console.log(`  [T${pair.from.turn}→T${pair.to.turn}] ${ua.name} @ ${ua.region}: +20 = ${xpB}→${xpA}  soldiers=${ub.soldiers}→${ua.soldiers}/${ua.maxSoldiers}`);
    }
    if (ub.soldiers > ua.soldiers) totalSurvivors++;
  }
}

console.log(`\nTotal XP gains: ${totalXpGains}`);
console.log(`Total survivors: ${totalSurvivors}`);

// Distribution: across the whole save set, what +20 values are seen?
const allValues = new Map();
for (const k of byTurn.keys()) {
  const ent = byTurn.get(k);
  const buf = fs.readFileSync(path.join(ARCHIVE, ent.file));
  const units = findUnitRecords(buf);
  for (const u of units) {
    const rE = regionEnd(buf, u);
    if (rE < 0) continue;
    const v = buf[rE + 20];
    allValues.set(v, (allValues.get(v) || 0) + 1);
  }
}
console.log(`\nAcross all ${byTurn.size} saves, +20 byte distribution:`);
const sortedV = [...allValues.entries()].sort((a, b) => a[0] - b[0]);
for (const [v, c] of sortedV.slice(0, 15)) console.log(`  +20=${v}: ${c}`);
