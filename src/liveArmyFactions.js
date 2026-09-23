// Live mode: which faction each army on the map belongs to.
//
// MEASURED 2026-09-23 against the running game (C:\dev\RTWHook parity check,
// a turn-1 RIS campaign, 949 generals paired by tile with the engine's own
// character → faction):
//   captain_card marker (parseCharactersAndUnits)          46.2% right
//   + the old patch (governor → city owner; trait-less
//     armies → region owner; everyone else keeps marker)  ~88%  (112 wrong on the map)
//   verified character label (characterFactionBlocks)      100%  of the 86.8% it answers
//   label, else region owner, else marker                  98.9%
// The marker fallback is right for 14 of the 125 armies the label cannot
// answer; the region owner for 115. The label is the only source that is right
// for a general standing in someone else's land, so it goes first.
//
// Order, per army:
//   1. its commander's verified character label        (factionSource "character")
//   2. a settlement governor → that settlement's owner  ("governor")
//   3. the owner of the region its bodyguard is in       ("region")
//   4. whatever it already had (the marker guess)        ("marker")
"use strict";
const { labelByFactionBlocks } = require("./characterFactionBlocks.js");

// v1 records are shared with the character panels, and the labeller rewrites
// .faction in place (null when unverifiable) — so label COPIES.
function characterLabels(v1Chars, { ownerByCity, governorByCity, factionOrder }) {
  const copies = (v1Chars || []).filter((c) => c && c.offset != null).map((c) => ({
    offset: c.offset, secondaryUuid: c.secondaryUuid, primaryUuid: c.primaryUuid,
    fatherUuid: c.fatherUuid, spouseUuid: c.spouseUuid, childUuids: c.childUuids, faction: c.faction || null,
  }));
  const settlementFields = {};
  for (const [city, g] of Object.entries(governorByCity || {})) if (g && g.uuid != null) settlementFields[city] = { governorUuid: g.uuid };
  let report = null;
  try { report = labelByFactionBlocks(copies, { settlementFields, ownerByCity: ownerByCity || {}, factionOrder: factionOrder || [] }); } catch { /* no labels */ }
  const byUuid = new Map();
  for (const c of copies) {
    if (!c.faction) continue;
    if (c.secondaryUuid != null) byUuid.set(c.secondaryUuid >>> 0, c.faction);
    if (c.primaryUuid != null && c.primaryUuid !== 0xffffffff) byUuid.set(c.primaryUuid >>> 0, c.faction);
  }
  return { byUuid, report };
}

// Mutates liveArmies[].faction and sets .factionSource. Returns counts by source.
function relabelLiveArmies(liveArmies, v1Chars, { ownerByCity, governorByCity, regionToCity, factionOrder } = {}) {
  const counts = { character: 0, governor: 0, region: 0, marker: 0 };
  if (!Array.isArray(liveArmies) || !liveArmies.length) return counts;
  const own = ownerByCity || {};
  const { byUuid } = characterLabels(v1Chars, { ownerByCity: own, governorByCity, factionOrder });
  const governorOwner = new Map();
  for (const [city, g] of Object.entries(governorByCity || {})) {
    if (g && g.uuid != null && own[city]) governorOwner.set(g.uuid >>> 0, own[city]);
  }
  for (const army of liveArmies) {
    if (!army || army.armyClass === "navy") continue;
    const ids = [army.commanderUuid, army.primaryUuid].filter((u) => u != null).map((u) => u >>> 0);
    const label = ids.map((u) => byUuid.get(u)).find(Boolean);
    if (label) { army.faction = label; army.factionSource = "character"; counts.character++; continue; }
    const gov = ids.map((u) => governorOwner.get(u)).find(Boolean);
    if (gov) { army.faction = gov; army.factionSource = "governor"; counts.governor++; continue; }
    const region = army.units && army.units[0] && army.units[0].region;
    const city = region && ((regionToCity && regionToCity[region]) || region);
    const owner = city && own[city];
    if (owner) { army.faction = owner; army.factionSource = "region"; counts.region++; continue; }
    army.factionSource = "marker"; counts.marker++;
  }
  return counts;
}

module.exports = { relabelLiveArmies, characterLabels };
