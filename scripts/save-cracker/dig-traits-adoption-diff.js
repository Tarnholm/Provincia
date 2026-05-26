// dig-traits-adoption-diff.js
//
// Cross-validate trait POINTS evolution across turns. Track the SAME character
// (by primaryUuid) across the t0..t6 + adoption save series and report how
// each trait's points change. Validates:
//   - points accumulate over turns (engine adds points per turn/event)
//   - displayed level derives from points via thresholds
//   - id->name mapping is stable across saves
//
// Usage: node dig-traits-adoption-diff.js

const fs = require("fs");
const path = require("path");
const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const MOD = "C:\\RIS\\RIS\\data";

const edctLines = fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/);
const traitNames = [];
const traitThresholds = {};
let cur = null;
for (const l of edctLines) {
  const m = l.match(/^Trait\s+(\S+)/); if (m) { cur = m[1]; traitNames.push(cur); traitThresholds[cur] = []; continue; }
  const th = l.match(/^\s*Threshold\s+(\d+)/); if (th && cur) traitThresholds[cur].push(parseInt(th[1], 10));
}
function loadNameLookup() {
  const b = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"));
  const t = (b[0] === 0xff && b[1] === 0xfe) ? b.toString("utf16le", 2) : b.toString("utf8");
  return t.split(/\r?\n/).map(s => s.trim());
}
const nameLookup = loadNameLookup();
const { findCharacterRecords } = require("C:/dev/Provincia/src/characterParser.js");

function dispLevel(name, pts) {
  const thr = traitThresholds[name] || [];
  let lvl = 0;
  for (let i = 0; i < thr.length; i++) if (pts >= thr[i]) lvl = i + 1;
  return lvl;
}

// Read the FULL trait list (including last slot) for one char.
function fullTraits(buf, c) {
  const layoutB = c.lastName == null;
  const tsOff = c.offset + (layoutB ? 304 : 308);
  const tc = buf.readUInt16LE(c.offset + (layoutB ? 298 : 302));
  const out = [];
  for (let i = 0; i < tc; i++) {
    const tid = buf.readUInt32LE(tsOff + i * 8);
    const pts = buf.readUInt16LE(tsOff + i * 8 + 4);
    if (tid < traitNames.length && traitNames[tid]) out.push({ id: tid, name: traitNames[tid], points: pts });
  }
  return out;
}

const series = [
  "save_t0.sav", "save_t1.sav", "save_t1adoption.sav", "save_t2.sav",
  "save_t3.sav", "save_t4.sav", "save_t5.sav", "save_t6.sav",
];

// Load all saves, index chars by primaryUuid.
const saves = [];
for (const f of series) {
  const p = path.join(SAVE_DIR, f);
  if (!fs.existsSync(p)) { console.log(`(missing) ${f}`); continue; }
  const buf = fs.readFileSync(p);
  const chars = findCharacterRecords(buf, nameLookup, traitNames, null);
  const byUuid = new Map();
  for (const c of chars) if (c.primaryUuid && c.primaryUuid !== 0xffffffff) {
    if (!byUuid.has(c.primaryUuid)) byUuid.set(c.primaryUuid, c);
  }
  saves.push({ f, buf, chars, byUuid });
  console.log(`${f}: ${chars.length} chars, ${byUuid.size} with primaryUuid`);
}

if (saves.length < 2) { console.log("not enough saves"); process.exit(0); }

// Pick the faction leader in the first save and track them.
const base = saves[0];
const leader = base.chars.filter(c => c.isLeader)[0] ||
               base.chars.sort((a, b) => b.traits.length - a.traits.length)[0];
console.log(`\nTracking: ${leader.firstName} ${leader.lastName||""} primaryUuid=${leader.primaryUuid}\n`);

// Build a per-trait timeline.
const timeline = []; // [{save, traits: Map name->points}]
for (const s of saves) {
  const c = s.byUuid.get(leader.primaryUuid);
  if (!c) { timeline.push({ f: s.f, found: false }); continue; }
  const ft = fullTraits(s.buf, c);
  const m = new Map();
  for (const t of ft) m.set(t.name, t.points);
  timeline.push({ f: s.f, found: true, age: c.age, m });
}

// Collect every trait name seen.
const allNames = new Set();
for (const t of timeline) if (t.found) for (const n of t.m.keys()) allNames.add(n);

console.log("trait".padEnd(26) + timeline.map(t => t.f.replace("save_","").replace(".sav","").slice(0,8).padStart(9)).join(""));
for (const n of Array.from(allNames).sort()) {
  let row = n.slice(0, 25).padEnd(26);
  let changed = false;
  let prev = null;
  for (const t of timeline) {
    if (!t.found) { row += "    --   "; continue; }
    const p = t.m.has(n) ? t.m.get(n) : null;
    if (prev !== null && p !== prev) changed = true;
    prev = p;
    const lv = p == null ? "" : `L${dispLevel(n, p)}`;
    row += (p == null ? "·" : `${p}${lv?"/"+lv:""}`).padStart(9);
  }
  console.log((changed ? "*" : " ") + row);
}
console.log("\n(* = points changed across the series; value shown is points/displayLevel)");
console.log("age row:".padEnd(26) + timeline.map(t => (t.found ? String(t.age) : "--").padStart(9)).join(""));
