// dig-unitstats4.js — Find the LARGEST file for each (turn, phase) combination since the archive
// has lots of small truncated copies.

const fs = require("fs");
const path = require("path");

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

// Print sorted by turn
const sorted = [...byTurn.values()].sort((a, b) => (a.turn - b.turn) || (a.phase === "End" ? -1 : 1));
for (const v of sorted.slice(0, 40)) {
  console.log(`T${v.turn} ${v.phase}: ${v.size}b -- ${v.file}`);
}
