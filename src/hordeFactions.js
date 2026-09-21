// Which factions can HORDE, read from the mod's descr_sm_factions.txt.
//
// Why it matters (user rule 2026-09-21): a faction is destroyed when its last
// settlement is taken — UNLESS it is a hording faction that has not used up its
// horde attempts, in which case it takes to the field instead. Extinction Watch
// needs to know which factions have that escape.
//
// The file is Remastered's JSON-like format: each faction is a one-tab-deep
// `"<id>":` key, and a horde-capable one carries a `"horde": { … }` block.
// `;` starts a comment anywhere on a line — stripped first, so a commented-out
// horde block does not count. Same block walk as parseSmFactionNamelists.
"use strict";

function parseHordeFactions(text) {
  const out = {};
  if (!text) return out;
  const clean = text.split(/\r?\n/).map((l) => { const i = l.indexOf(";"); return i < 0 ? l : l.slice(0, i); }).join("\n");
  const ids = [...clean.matchAll(/^\t"(\w+)":/gm)];
  for (let i = 0; i < ids.length; i++) {
    const blk = clean.slice(ids[i].index, i + 1 < ids.length ? ids[i + 1].index : clean.length);
    const h = /"horde"\s*:\s*\{/.exec(blk);
    if (!h) continue;
    const body = blk.slice(h.index);
    const num = (key) => { const m = new RegExp(`"${key}"\\s*:\\s*([\\d.]+)`).exec(body); return m ? Number(m[1]) : null; };
    out[ids[i][1].toLowerCase()] = {
      minUnits: num("min horde units"),
      maxUnits: num("max horde units"),
      reductionPerHorde: num("horde unit reduction per horde"),
      minNamedCharacters: num("min named characters"),
    };
  }
  return out;
}

module.exports = { parseHordeFactions };
