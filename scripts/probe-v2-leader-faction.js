// scripts/probe-v2-leader-faction.js
// Runs characterParserV2.findScriptedCharacters (the LIVE-path char parser,
// which carries the new /_rebel$/ faction-marker guard) and reports the
// faction attributed to the player faction's leader(s). Confirms whether the
// guard nulls the leader's faction (which would break the portrait swap, since
// the live v1-faction-tag pass prefers the v2 faction).

"use strict";
const fs = require("fs");
const path = require("path");
const cp2 = require("../src/characterParserV2.js");

function loadNameLookup(mod) {
  for (const src of [path.join(mod, "descr_names_lookup.txt"),
                     path.join(mod, "world/maps/campaign/imperial_campaign/descr_names_lookup.txt")]) {
    if (fs.existsSync(src)) return fs.readFileSync(src, "utf8").replace(/^﻿/, "").split(/\r?\n/).map(s => s.trim());
  }
  return [];
}
function loadTraitNames(mod) {
  const src = path.join(mod, "export_descr_character_traits.txt");
  if (!fs.existsSync(src)) return [];
  const names = [];
  for (const line of fs.readFileSync(src, "utf8").split(/\r?\n/)) {
    const m = line.match(/^Trait\s+(\S+)/);
    if (m) names.push(m[1]);
  }
  return names;
}

const save = process.argv[2];
const mod = process.argv[3] || "C:\\RIS\\RIS\\data";
const buf = fs.readFileSync(save);
const nl = loadNameLookup(mod);
const tn = loadTraitNames(mod);
console.log(`nameLookup=${nl.length} traitNames=${tn.length}`);

const chars = cp2.findScriptedCharacters(buf, nl, tn);
console.log(`v2 chars parsed: ${chars.length}`);

const leaders = chars.filter(c => (c.traits || []).some(t => t.name === "Factionleader"));
console.log(`v2 leaders (Factionleader trait): ${leaders.length}`);

// Player is romans_julii in these saves. Report all leaders + faction.
const byFaction = {};
let nullFac = 0;
for (const c of leaders) {
  const f = c.faction || "(NULL)";
  byFaction[f] = (byFaction[f] || 0) + 1;
  if (!c.faction) nullFac++;
}
console.log(`leaders with NULL faction: ${nullFac}`);
console.log(`leaders by faction:`);
for (const [f, n] of Object.entries(byFaction).sort((a,b)=>b[1]-a[1])) console.log(`   ${f}: ${n}`);

const playerLeaders = leaders.filter(c => String(c.faction || "").toLowerCase() === "romans_julii");
console.log(`\nromans_julii leaders (v2): ${playerLeaders.length}`);
for (const c of playerLeaders) {
  console.log(`   ${c.firstName} ${c.lastName || ""} faction=${c.faction} offset=${c.offset} primaryUuid=${c.primaryUuid ? (c.primaryUuid>>>0).toString(16) : "-"} cmdUuid=${c.commanderUuid ? (c.commanderUuid>>>0).toString(16) : "-"}`);
}
// Any leader that the guard could have nulled? Show NULL-faction leaders.
const nullLeaders = leaders.filter(c => !c.faction);
if (nullLeaders.length) {
  console.log(`\nNULL-faction leaders (could be guard victims): ${nullLeaders.length}`);
  for (const c of nullLeaders.slice(0, 15)) console.log(`   ${c.firstName} ${c.lastName || ""} offset=${c.offset}`);
}
