// Trait-mapping verification + full turn-1 character trait dump.
// Goal (user 2026-06-15): prove EVERY trait ID used by EVERY turn-1 character
// maps to a real EDCT trait, with effects + display names — and stays correct
// as traits are added. Run: node verify-traits.js [savePath]
const fs = require("fs");
const path = require("path");
const { crackSave } = require("./src/saveCracker.js");
const TE = require("./src/traitEffects.js");

const MOD = "C:/RIS/RIS/data";
const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_julii4 tax.sav";

// 1) Build the id->name table EXACTLY as the app does (EDCT Trait-line order = save IDs).
const edct = fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/);
const names = [];
for (const ln of edct) { const m = ln.match(/^Trait\s+(\S+)/); if (m) names.push(m[1]); }

// duplicate / blank name check (a dup would make two IDs collide on lookup)
const seen = new Map(); const dups = [];
names.forEach((n, i) => { if (seen.has(n)) dups.push(`${n} @${seen.get(n)} & @${i}`); else seen.set(n, i); });

// 2) vnvs display names (level short titles), UTF-16LE.
const vnvs = fs.readFileSync(path.join(MOD, "text/export_vnvs.txt"), "utf16le").split(/\r?\n/);
const disp = {};
for (const ln of vnvs) { const m = ln.match(/^\{([A-Za-z0-9_]+)\}\t(.+)$/); if (m) disp[m[1]] = m[2].trim(); }

// 3) EDCT effect/level parse (the app's own parser) — every trait's levels.
const parsed = TE.parseTraitEffects(MOD);

// 4) crack the turn-1 save, gather ALL characters.
const cracked = crackSave(fs.readFileSync(SAVE), MOD);
const cc = cracked.characters; const chars = Array.isArray(cc) ? cc : (cc && cc.v1 ? cc.v1 : []);

// ---- VERIFY: every trait id on every character resolves to a name ----
const unmapped = new Set(); const usedIds = new Set(); let traitRefs = 0;
for (const ch of chars) {
  if (!ch || !Array.isArray(ch.traits)) continue;
  for (const t of ch.traits) {
    traitRefs++;
    if (t.id != null) usedIds.add(t.id);
    if (!t.name || t.id == null || t.id >= names.length) unmapped.add(`${ch.firstName} ${ch.lastName}: id=${t.id} name=${t.name}`);
  }
}
// which distinct trait NAMES appear, and do they all have an EDCT def parsed?
const usedNames = new Set();
for (const ch of chars) for (const t of (ch.traits || [])) if (t.name) usedNames.add(t.name);
const noLevelDef = [...usedNames].filter(n => !parsed[n]); // (ok if truly no settlement effect)

console.log("=== TRAIT MAP VERIFICATION ===");
console.log("EDCT Trait definitions:", names.length);
console.log("duplicate trait names  :", dups.length ? dups.join("; ") : "NONE ✓");
console.log("turn-1 characters      :", chars.length, " (trait refs:", traitRefs + ")");
console.log("distinct trait IDs used:", usedIds.size, " range", Math.min(...usedIds) + ".." + Math.max(...usedIds));
console.log("UNMAPPED trait refs    :", unmapped.size ? [...unmapped].slice(0, 20).join("\n   ") : "NONE ✓");
console.log("used names w/ no econ-effect def (display-only, expected):", noLevelDef.length, "->", noLevelDef.join(", "));

// ---- META-RATING CAVEAT: ICERating/STRating displayed level != stored points ----
console.log("\n=== META-RATING NOTE (ICE/ST recomputed by engine) ===");
console.log("These store a points value whose THRESHOLD level is NOT the in-game displayed");
console.log("level (engine recomputes the bitmask from the underlying stats each turn).");

// ---- FULL DUMP to file ----
const out = [];
for (const ch of chars) {
  if (!ch || !Array.isArray(ch.traits) || !ch.traits.length) continue;
  out.push(`${ch.firstName || "?"} ${ch.lastName || ""} [${ch.faction || "?"}]${ch.isLeader ? " LEADER" : ch.isHeir ? " HEIR" : ""} mgmt=${ch.management} cmd=${ch.command} infl=${ch.influence}`);
  for (const t of ch.traits) {
    const def = parsed[t.name];
    let lvlName = "", eff = "";
    if (def && def.length) {
      let chosen = null; for (const L of def) if (L.threshold <= t.points) chosen = L; if (!chosen) chosen = def[0];
      const fx = [];
      for (const k of ["Farming","Fertility","Health","Squalor","TaxCollection","Trading","Mining","Influence","Law","Unrest","LocalPopularity","Management"]) if (chosen[k]) fx.push(`${k}${chosen[k] > 0 ? "+" : ""}${chosen[k]}`);
      eff = fx.join(",");
    }
    out.push(`    ${String(t.id).padStart(4)} ${(t.name || "?").padEnd(26)} pts=${String(t.points).padStart(3)}${eff ? "  [" + eff + "]" : ""}`);
  }
  out.push("");
}
const dumpPath = path.join(__dirname, "turn1-all-traits.txt");
fs.writeFileSync(dumpPath, out.join("\n"), "utf8");
console.log("\nFull per-character dump written:", dumpPath, `(${out.length} lines)`);
