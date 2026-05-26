// dig-traits-level-decode.js
//
// Decode the displayed LEVEL from stored POINTS via the export_descr_character_traits
// Threshold ladder, and resolve the level NAME (the in-game trait title shown
// to the player) via export_vnvs.txt. This proves the points->level->title chain.
//
// The engine rule (RTW): a trait with N levels has N thresholds. The displayed
// level is the highest level whose Threshold <= stored points. Each level has
// its own EffectsDescription/Description title in export_vnvs.
//
// Usage: node dig-traits-level-decode.js [savePath]

const fs = require("fs");
const path = require("path");
const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const MOD = "C:\\RIS\\RIS\\data";
const savePath = process.argv[2] || path.join(SAVE_DIR, "save_macedon t0.sav");

// Parse traits + levels (with threshold + descKey + effectsKey)
const edctLines = fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/);
const traitNames = [];
const traitLevels = {}; // name -> [{idx, levelName, threshold, descKey, effectsKey}]
let cur = null, curLvl = null;
for (const l of edctLines) {
  const m = l.match(/^Trait\s+(\S+)/); if (m) { cur = m[1]; curLvl = null; traitNames.push(cur); traitLevels[cur] = []; continue; }
  const lm = l.match(/^\s*Level\s+(\S+)/); if (lm && cur) { curLvl = { idx: traitLevels[cur].length + 1, levelName: lm[1], threshold: null, descKey: null, effectsKey: null }; traitLevels[cur].push(curLvl); continue; }
  if (curLvl) {
    const th = l.match(/^\s*Threshold\s+(\d+)/); if (th) { curLvl.threshold = parseInt(th[1], 10); continue; }
    const dk = l.match(/^\s*Description\s+(\S+)/); if (dk) { curLvl.descKey = dk[1]; continue; }
    const ek = l.match(/^\s*EffectsDescription\s+(\S+)/); if (ek) { curLvl.effectsKey = ek[1]; }
  }
}

// Resolve vnv key -> display text
const vb = fs.readFileSync(path.join(MOD, "text", "export_vnvs.txt"));
const vtext = (vb[0] === 0xff && vb[1] === 0xfe) ? vb.toString("utf16le", 2) : vb.toString("utf8");
const vlines = vtext.split(/\r?\n/);
const keyText = new Map();
for (let i = 0; i < vlines.length; i++) {
  const mk = vlines[i].match(/^\{([^}]+)\}\s*$/);
  if (mk) { let j = i + 1; while (j < vlines.length && vlines[j].trim() === "") j++; if (j < vlines.length && !vlines[j].startsWith("{")) keyText.set(mk[1], vlines[j].trim()); continue; }
  const m2 = vlines[i].match(/^\{([^}]+)\}\s*(.+?)\s*$/); if (m2) keyText.set(m2[1], m2[2]);
}

function loadNameLookup() {
  const b = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"));
  const t = (b[0] === 0xff && b[1] === 0xfe) ? b.toString("utf16le", 2) : b.toString("utf8");
  return t.split(/\r?\n/).map(s => s.trim());
}
const nameLookup = loadNameLookup();
const { findCharacterRecords } = require("C:/dev/Provincia/src/characterParser.js");
const buf = fs.readFileSync(savePath);
const chars = findCharacterRecords(buf, nameLookup, traitNames, null);

function resolve(name, pts) {
  const levels = traitLevels[name] || [];
  let chosen = null;
  for (const lv of levels) { if (lv.threshold != null && pts >= lv.threshold) chosen = lv; }
  const title = chosen ? (keyText.get(chosen.effectsKey) || keyText.get(chosen.descKey) || chosen.levelName) : null;
  return { level: chosen ? chosen.idx : 0, levelName: chosen ? chosen.levelName : null, title, nLevels: levels.length };
}

// Read full trait list (incl last slot).
function fullTraits(c) {
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

// Show the multi-level traits (>1 level) for the top-3 trait-rich generals,
// resolving point->level->title.
const rich = chars.filter(c => c.traits.length > 8).sort((a, b) => b.traits.length - a.traits.length).slice(0, 3);
for (const c of rich) {
  console.log(`\n=== ${c.firstName} ${c.lastName||""} @0x${c.offset.toString(16)} (cmd=${c.command} inf=${c.influence} mgmt=${c.management}) ===`);
  for (const t of fullTraits(c)) {
    const r = resolve(t.name, t.points);
    if (r.nLevels <= 1) continue; // only show graded traits
    console.log(`  ${t.name.padEnd(24)} pts=${String(t.points).padStart(4)} -> L${r.level}/${r.nLevels} "${r.title || r.levelName}"`);
  }
}

// Targeted: find any char with a graded command trait to sanity-check titles.
console.log("\n=== Sample GoodCommander holders (points -> level title) ===");
let shown = 0;
for (const c of chars) {
  if (shown >= 6) break;
  const ft = fullTraits(c);
  const gc = ft.find(t => t.name === "GoodCommander");
  if (gc) {
    const r = resolve("GoodCommander", gc.points);
    console.log(`  ${(c.firstName+" "+(c.lastName||"")).padEnd(28)} GoodCommander pts=${gc.points} -> L${r.level} "${r.title}"`);
    shown++;
  }
}
// Print GoodCommander threshold ladder for reference
console.log("\nGoodCommander threshold ladder:");
for (const lv of traitLevels["GoodCommander"]) console.log(`  L${lv.idx} ${lv.levelName} thr=${lv.threshold} title="${keyText.get(lv.effectsKey)||keyText.get(lv.descKey)||""}"`);
