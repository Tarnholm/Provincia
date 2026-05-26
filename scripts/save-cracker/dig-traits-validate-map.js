// dig-traits-validate-map.js
//
// GOAL (research/diagnostic only — no app code changes):
//   1. Confirm per-character trait storage layout in the .sav.
//   2. Build trait id -> NAME mapping from export_descr_character_traits.txt
//      declaration order, and verify known characters resolve to sensible names.
//   3. Inspect stored LEVEL/POINTS values.
//
// Usage: node dig-traits-validate-map.js [savePath]

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const DEFAULT_SAVE = path.join(SAVE_DIR, "save_macedon t0.sav");
const savePath = process.argv[2] || DEFAULT_SAVE;
const MOD = "C:\\RIS\\RIS\\data";

// ── Build the trait id->name map (declaration order) ─────────────────────────
const edctLines = fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/);
const traitNames = [];          // index -> trait name
const traitLevelsByName = {};   // name -> [{levelIdx, levelName, threshold}]
let curTrait = null;
for (const line of edctLines) {
  const tm = line.match(/^Trait\s+(\S+)/);
  if (tm) { curTrait = tm[1]; traitNames.push(curTrait); traitLevelsByName[curTrait] = []; continue; }
  const lm = line.match(/^\s*Level\s+(\S+)/);
  if (lm && curTrait) {
    traitLevelsByName[curTrait].push({ levelIdx: traitLevelsByName[curTrait].length + 1, levelName: lm[1], threshold: null });
    continue;
  }
  const thm = line.match(/^\s*Threshold\s+(\d+)/);
  if (thm && curTrait && traitLevelsByName[curTrait].length) {
    traitLevelsByName[curTrait][traitLevelsByName[curTrait].length - 1].threshold = parseInt(thm[1], 10);
  }
}
console.log(`Trait declarations parsed: ${traitNames.length}`);

// ── Load name lookup ─────────────────────────────────────────────────────────
function loadNameLookup() {
  const p = path.join(MOD, "descr_names_lookup.txt");
  if (!fs.existsSync(p)) { console.log("WARN: descr_names_lookup.txt not found"); return []; }
  const buf = fs.readFileSync(p);
  const text = (buf[0] === 0xff && buf[1] === 0xfe) ? buf.toString("utf16le", 2) : buf.toString("utf8");
  return text.split(/\r?\n/).map(s => s.trim()).filter((s, i, a) => true);
}
const nameLookup = loadNameLookup();
console.log(`Name lookup entries: ${nameLookup.length}`);

// ── Parse characters ─────────────────────────────────────────────────────────
const { findCharacterRecords } = require("C:/dev/Provincia/src/characterParser.js");
const buf = fs.readFileSync(savePath);
console.log(`\nSave: ${path.basename(savePath)} (${buf.length} bytes)\n`);

const chars = findCharacterRecords(buf, nameLookup, traitNames, null);
console.log(`Characters parsed: ${chars.length}\n`);

// ── 1. Validate trait-name resolution ────────────────────────────────────────
// Every trait id parsed should map to a real declared trait name (already
// gated by the parser, but re-confirm and count).
let totalTraits = 0, resolved = 0;
const traitFreq = new Map();
for (const c of chars) {
  for (const t of c.traits) {
    totalTraits++;
    if (t.name && traitNames[t.id] === t.name) {
      resolved++;
      traitFreq.set(t.name, (traitFreq.get(t.name) || 0) + 1);
    }
  }
}
console.log(`Trait instances: ${totalTraits}, resolved to real declared names: ${resolved} (${(100*resolved/Math.max(1,totalTraits)).toFixed(1)}%)`);

// ── 2. Show faction leaders / heirs and their traits ─────────────────────────
const leaders = chars.filter(c => c.isLeader);
const heirs = chars.filter(c => c.isHeir);
console.log(`\nFaction leaders found: ${leaders.length}, heirs: ${heirs.length}`);

function showChar(c, label) {
  const name = `${c.firstName}${c.lastName ? " " + c.lastName : ""}`;
  console.log(`\n  [${label}] ${name}  age=${c.age} cmd=${c.command} inf=${c.influence} mgmt=${c.management} @0x${c.offset.toString(16)}`);
  console.log(`     traitCount=${c.traits.length}`);
  for (const t of c.traits) {
    // resolve display level from points via threshold lookup
    const levels = traitLevelsByName[t.name] || [];
    let dispLevel = 0, thrUsed = null;
    for (let li = 0; li < levels.length; li++) {
      if (levels[li].threshold != null && t.points >= levels[li].threshold) { dispLevel = li + 1; thrUsed = levels[li].threshold; }
    }
    const thrList = levels.map(l => l.threshold).join("/");
    console.log(`       id=${String(t.id).padStart(4)} ${t.name.padEnd(28)} points=${String(t.points).padStart(4)} -> dispLevel=${dispLevel} (thresholds: ${thrList || "none"})`);
  }
}

for (const c of leaders.slice(0, 4)) showChar(c, "LEADER");
for (const c of heirs.slice(0, 2)) showChar(c, "HEIR");

// ── 3. Top traits across the campaign (sanity: should be Command/Influence/etc) ─
console.log(`\nMost common traits across all ${chars.length} chars:`);
const sortedFreq = Array.from(traitFreq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 25);
for (const [n, f] of sortedFreq) console.log(`   ${String(f).padStart(4)}  ${n}`);

// ── 4. Raw byte dump of one leader's trait block for layout proof ────────────
if (leaders.length) {
  const c = leaders[0];
  const off = c.layoutB ? { tc: 298, ts: 304 } : { tc: 302, ts: 308 };
  // Re-derive layout: lastName presence
  const layoutB = c.lastName == null;
  const tcOff = c.offset + (layoutB ? 298 : 302);
  const tsOff = c.offset + (layoutB ? 304 : 308);
  const tc = buf.readUInt16LE(tcOff);
  console.log(`\nRAW trait block proof for leader ${c.firstName} @0x${c.offset.toString(16)} (layout${layoutB ? "B" : "A"}):`);
  console.log(`   traitCount u16 @ +${layoutB ? 298 : 302} (0x${tcOff.toString(16)}) = ${tc}`);
  console.log(`   trait records start @ +${layoutB ? 304 : 308} (0x${tsOff.toString(16)})`);
  for (let i = 0; i < Math.min(tc, 8); i++) {
    const base = tsOff + i * 8;
    const tid = buf.readUInt32LE(base);
    const lvl = buf.readUInt16LE(base + 4);
    const pad = buf.readUInt16LE(base + 6);
    const hex = buf.slice(base, base + 8).toString("hex");
    console.log(`     [${i}] ${hex}  tid=${tid}(${traitNames[tid]||"?"}) u16@+4=${lvl} u16@+6=${pad}`);
  }
}
