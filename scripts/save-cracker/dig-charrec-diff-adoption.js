// dig-charrec-diff-adoption.js
// Diff the SAME character (matched by primaryUuid) across two saves and report
// u32-LE deltas in the stat/effect zone (+94..+300) alongside trait deltas.
// Goal: discover which effect-array slot maps to which trait by observing the
// engine's recompute when a trait's points change (e.g. age tick, adoption,
// FasterCharacters increment).
const fs = require("fs");
const path = require("path");
const SAVES_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const modPath = "C:/RIS/RIS";
const names = fs.readFileSync(path.join(modPath, "data/descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traits = [];
for (const m of fs.readFileSync(path.join(modPath, "data/export_descr_character_traits.txt"), "utf8").matchAll(/^Trait\s+([A-Za-z0-9_]+)/gm)) traits.push(m[1]);
const { findCharacterRecords } = require("../../src/characterParser.js");

const fileA = process.argv[2];
const fileB = process.argv[3];
const bufA = fs.readFileSync(path.join(SAVES_DIR, fileA));
const bufB = fs.readFileSync(path.join(SAVES_DIR, fileB));
const recA = findCharacterRecords(bufA, names, traits, null);
const recB = findCharacterRecords(bufB, names, traits, null);
console.log(`A=${fileA} (${recA.length} chars)  B=${fileB} (${recB.length} chars)`);

// Index by primaryUuid (stable identity across saves)
const idxA = new Map(); for (const c of recA) if (c.primaryUuid && c.primaryUuid !== 0xffffffff) idxA.set(c.primaryUuid, c);
const idxB = new Map(); for (const c of recB) if (c.primaryUuid && c.primaryUuid !== 0xffffffff) idxB.set(c.primaryUuid, c);

let changed = 0;
for (const [uuid, a] of idxA) {
  const b = idxB.get(uuid);
  if (!b) continue;
  const lb = a.lastName === null;
  // Compare u32 zone +90..+300
  const deltas = [];
  for (let p = 90; p <= 300; p += 4) {
    const va = bufA.readInt32LE(a.offset + p);
    const vb = bufB.readInt32LE(b.offset + p);
    if (va !== vb) deltas.push({ p, va, vb });
  }
  // trait deltas
  const tA = new Map((a.traits||[]).map(t=>[t.name,t.points]));
  const tB = new Map((b.traits||[]).map(t=>[t.name,t.points]));
  const traitChanges = [];
  for (const [n,pa] of tA) { const pb = tB.get(n); if (pb===undefined) traitChanges.push(`-${n}(${pa})`); else if (pb!==pa) traitChanges.push(`${n}:${pa}->${pb}`); }
  for (const [n,pb] of tB) if (!tA.has(n)) traitChanges.push(`+${n}(${pb})`);
  if (deltas.length === 0 && traitChanges.length === 0) continue;
  changed++;
  if (changed > 40) { console.log("...(truncated)"); break; }
  console.log("\n" + "-".repeat(70));
  console.log(`${a.firstName}${a.lastName?(" "+a.lastName):""} uuid=${uuid} age ${a.age}->${b.age} layout=${lb?"B":"A"}`);
  if (traitChanges.length) console.log(`  TRAITS: ${traitChanges.join("  ")}`);
  if (deltas.length) console.log(`  BYTES:  ${deltas.map(d=>`+${d.p}:${d.va}=>${d.vb}`).join("  ")}`);
}
console.log(`\nTotal changed chars: ${changed}`);
