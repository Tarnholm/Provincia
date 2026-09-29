// Which factions are remastered (asked for 2026-09-28): their units are the mod's own new models.
// There is no list of this in the mod, so it is read from the unit file and the model file.
// A remastered unit lists its soldiers as a block of numbered variants of the mod's own models:
//
//   soldiers   40, 0, 0.91
//   {
//       default { roman_velite_remastered1 ... roman_velite_remastered7 }
//   }
//
// Usually 7 of them, but not always: Italiote Hoplites and the scythed chariots have 4
// (italiote_hoplites1..4, east_scythed_chariot_crew1..4). Old units either have one model
// (soldier  corsico_sardinian_infantry, 40, 0, 0.98) or a block whose models are the base
// game's own, "_high" in descr_model_battle.txt (Carthage's core units, the Iberians, the
// Numidians: an old model with shield variants). So: remastered = a block of soldier models,
// none of them a stock "_high" model.
//
// History (2026-09-28/29, each corrected by the team): any block counted as new (Carthage came
// out remastered); then "_high" files alone (the Arab kingdoms, single-model units, came out
// remastered); then "7 models" (Italiote Hoplites and the scythed chariots came out old).
//
// A faction's units are those whose ownership line names it, leaving out the mercenary, AOR
// and horde copies and what every faction shares (the peasant levy and the ships). A faction
// is remastered when most of its own units are.
const fs = require("fs");
const path = require("path");

const SKIP = /^(merc |aor |horde |naval )|^barb peasant slave$/;

// Model name -> the .cas files behind it (descr_model_battle.txt), without the LOD suffix.
function modelFiles(RIS) {
  const cas = new Map();
  let t = null;
  for (const raw of fs.readFileSync(path.join(RIS, "descr_model_battle.txt"), "latin1").split(/\r?\n/)) {
    const l = raw.replace(/;.*$/, "").trim();
    let m = /^type\s+(\S+)/.exec(l);
    if (m) { t = m[1]; if (!cas.has(t)) cas.set(t, new Set()); continue; }
    m = /^(?:no_variation\s+)?model_flexi(?:_m)?\s+(\S+\.cas)/i.exec(l);
    if (m && t) cas.get(t).add(m[1].replace(/.*\//, "").replace(/_lod\d+\.cas$/i, "").replace(/\.cas$/i, ""));
  }
  return cas;
}

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
  const CAS = modelFiles(RIS);
  const byFaction = new Map();
  for (const u of readUnits(RIS)) {
    if (SKIP.test(u.type)) continue;
    const models = [...u.blocks.values()].flatMap((b) => [...b]);
    const files = models.flatMap((x) => [...(CAS.get(x) || [])]);
    const isNew = models.length > 0 && !files.some((c) => /_high$/i.test(c));
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
