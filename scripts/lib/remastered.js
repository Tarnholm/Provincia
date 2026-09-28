// Which factions are remastered (asked for 2026-09-28): their units use the new Rome
// Remastered models instead of the old upscaled ones. There is no list of this in the mod, so it
// is read from export_descr_unit.txt, where the two kinds are written differently:
//
//   old model:  soldier   corsico_sardinian_infantry, 40, 0, 0.98        (one model)
//   new model:  soldiers  40, 0, 0.91  { default { roman_velite_remastered1 ... 7 } }
//
// (measured: 1,115 units with 7 soldier variants, 58 with 4, 569 on a single old model). A
// faction's units are those whose `ownership` line names it, leaving out the mercenary, AOR and
// horde copies and the units every faction shares: the peasant levy and the ships, which are
// old models everywhere. A faction is remastered when most of its own land units use new models.
const fs = require("fs");
const path = require("path");

const SHARED = /^(naval |barb peasant slave$)/;

function remasteredFactions(RIS) {
  const lines = fs.readFileSync(path.join(RIS, "export_descr_unit.txt"), "latin1").split(/\r?\n/);
  const units = [];
  let cur = null;
  for (const raw of lines) {
    const l = raw.replace(/;.*$/, "").trim();
    let m = /^type\s+(.+)$/.exec(l);
    if (m) { cur = { type: m[1].trim(), isNew: null, own: [] }; units.push(cur); continue; }
    if (!cur) continue;
    if (/^soldiers\b/.test(l)) cur.isNew = true;
    else if (/^soldier\b/.test(l)) cur.isNew = false;
    m = /^ownership\s+(.+)$/.exec(l);
    if (m) cur.own = m[1].split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  }
  const byFaction = new Map();
  for (const u of units) {
    if (u.isNew === null || /^(merc|aor|horde) /.test(u.type) || SHARED.test(u.type)) continue;
    for (const f of u.own) {
      if (!byFaction.has(f)) byFaction.set(f, { newUnits: [], oldUnits: [] });
      byFaction.get(f)[u.isNew ? "newUnits" : "oldUnits"].push(u.type);
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
