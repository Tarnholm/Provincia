// Which factions are remastered (asked for 2026-09-28): their units are RIS's own new models,
// not the stock game models. There is no list of this in the mod, so it is read from the model
// files each unit's soldiers are drawn with:
//
//   remastered:  achaian_epilektoi1..7_lodN.cas, roman_velite_remastered1..7_lodN.cas
//                (RIS's own models, several numbered soldier variants per unit)
//   stock:       carthaginian_sacred_band_high_lodN.cas, celtic_light_spearman_high_lodN.cas
//                (the game's own models, "_high", with RIS textures)
//
// First version (same day) went by the unit file's syntax alone (`soldiers` block = new), which
// counted Carthage as remastered: its core units use that block but point at the stock
// "_high" models. Corrected by the author: "Carthage is not remastered yet."
//
// export_descr_unit.txt names each unit's soldier models; descr_model_battle.txt names the .cas
// files behind each model. A unit is remastered when none of its models is a stock "_high" one.
// A faction's units are those whose `ownership` line names it, leaving out the mercenary, AOR
// and horde copies and what every faction shares (the peasant levy and the ships). A faction is
// remastered when most of its own units are.
const fs = require("fs");
const path = require("path");

const SKIP = /^(merc |aor |horde |naval )|^barb peasant slave$/;

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

function remasteredFactions(RIS) {
  const CAS = modelFiles(RIS);
  const units = [];
  let cur = null, inBlock = false;
  for (const raw of fs.readFileSync(path.join(RIS, "export_descr_unit.txt"), "latin1").split(/\r?\n/)) {
    const l = raw.replace(/;.*$/, "").trim();
    let m = /^type\s+(.+)$/.exec(l);
    if (m) { cur = { type: m[1].trim(), models: [], own: [] }; units.push(cur); inBlock = false; continue; }
    if (!cur) continue;
    if (/^soldiers\b/.test(l)) { inBlock = true; cur.variants = true; continue; }
    if (/^officer\b/.test(l)) inBlock = false;
    m = /^soldier\s+([^,]+)/.exec(l);
    if (m) { cur.models.push(m[1].trim()); continue; }
    if (inBlock && l && !/[{}]/.test(l) && l !== "default") cur.models.push(l);
    m = /^ownership\s+(.+)$/.exec(l);
    if (m) cur.own = m[1].split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  }
  const byFaction = new Map();
  for (const u of units) {
    if (SKIP.test(u.type)) continue;
    const files = [...new Set(u.models.flatMap((x) => [...(CAS.get(x) || [])]))];
    if (!files.length) continue;
    // Both signs: a block of soldier variants (the old single `soldier` line is never a
    // remastered unit: the Arab kingdoms' units use it with models not named "_high"), and none
    // of the models a stock "_high" one (Carthage, Iberia and the Numidians use the block with
    // those).
    const isNew = !!u.variants && !files.some((c) => /_high$/i.test(c));
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
