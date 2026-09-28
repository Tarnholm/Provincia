// Which factions are remastered (asked for 2026-09-28): their units are RIS's own new models.
// There is no list of this in the mod. The mod author's rule: a remastered unit has 7 soldier
// models. The unit file lists them in the unit's `soldiers` block:
//
//   soldiers   40, 0, 0.91
//   {
//       default { roman_velite_remastered1 ... roman_velite_remastered7 }
//   }
//
// Old units have one model (`soldier  corsico_sardinian_infantry, 40, 0, 0.98`) or a block of 4,
// which is an old model with shield variants (Carthage's core units, the Iberians, the
// Numidians). A block per faction counts on its own; a unit is remastered when any of its
// blocks has 7 or more models.
//
// History (all 2026-09-28): the first version counted any `soldiers` block as new, which made
// Carthage remastered ("Carthage is not remastered yet"); the second looked for stock "_high"
// model files; this one is the author's rule, and gives the same factions as the second.
//
// A faction's units are those whose `ownership` line names it, leaving out the mercenary, AOR
// and horde copies and what every faction shares (the peasant levy and the ships). A faction
// is remastered when most of its own units are.
const fs = require("fs");
const path = require("path");

const SKIP = /^(merc |aor |horde |naval )|^barb peasant slave$/;
const REMASTER_MODELS = 7;

function readUnits(RIS) {
  const units = [];
  let cur = null, depth = 0, block = null, pending = null;
  for (const raw of fs.readFileSync(path.join(RIS, "export_descr_unit.txt"), "latin1").split(/\r?\n/)) {
    const l = raw.replace(/;.*$/, "").trim();
    let m = /^type\s+(.+)$/.exec(l);
    if (m) { cur = { type: m[1].trim(), blocks: new Map(), own: [] }; units.push(cur); depth = 0; continue; }
    if (!cur) continue;
    if (/^soldiers\b/.test(l)) { depth = -1; continue; }   // the block's braces follow
    if (depth !== 0) {
      if (l === "{") { depth = depth < 0 ? 1 : depth + 1; if (depth === 2) block = pending || "default"; continue; }
      if (l === "}") { depth--; if (depth <= 0) depth = 0; continue; }
      if (!l) continue;
      if (depth === 1) { pending = l; continue; }            // a block name: default, carthage...
      if (depth >= 2) { if (!cur.blocks.has(block)) cur.blocks.set(block, new Set()); cur.blocks.get(block).add(l); }
      continue;
    }
    m = /^ownership\s+(.+)$/.exec(l);
    if (m) cur.own = m[1].split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  }
  return units;
}

function remasteredFactions(RIS) {
  const byFaction = new Map();
  for (const u of readUnits(RIS)) {
    if (SKIP.test(u.type)) continue;
    const isNew = [...u.blocks.values()].some((s) => s.size >= REMASTER_MODELS);
    for (const f of u.own) {
      if (!byFaction.has(f)) byFaction.set(f, { newUnits: [], oldUnits: [] });
      byFaction.get(f)[isNew ? "newUnits" : "oldUnits"].push(u.type);
    }
  }
  const out = new Map();
  for (const [f, v] of byFaction) {
    const total = v.newUnits.length + v.oldUnits.length;
    out.set(f, { ...v, total, remastered: total > 0 && v.newUnits.length * 2 > total });
  }
  return out;
}

module.exports = { remasteredFactions };
