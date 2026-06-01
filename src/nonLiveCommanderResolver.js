// src/nonLiveCommanderResolver.js — NON-LIVE / starting-state commander-card
// portrait + identity resolver (SHARED, PURE, CommonJS).
//
// WHY THIS MODULE EXISTS
// ----------------------
// In the NON-LIVE / starting "Region owners armies" view, a bodyguard unit has
// no live `commanderUuid` to bridge into the commanderInfo map, so the field-
// and garrison-army commander CARDS fall back to name-based resolution. Every
// prior fallback resolved the portrait ONLY from `statsCache` by name keys
// (`fn|ln|fac` / stripped). For the starting ROYAL FAMILY that statsCache entry
// frequently carries NO portrait (writeBest can overwrite it with a same-
// firstName stub), so savePath came back null → the renderer's DJB2 hash pool
// painted an arbitrary face (Rome's Quintus Ogulnius_Gallus showing a steppe
// portrait — file 110.tga — was the reported bug).
//
// THE FAMILY TREE — correct in non-live too — does NOT rely on statsCache for
// these characters. It resolves the identical char via the COORD bridge:
// `coordToPortrait.get("<x>,<y>")` into `v1PortraitsByCoord` (the persisted,
// engine-exact per-tile portrait map; see FamilyTree.js `coordToSave`). The
// descr_strat `character` line for a starting royal sits on the SAME tile the
// save's v1 record does (verified: Quintus 285,404 → cards/old/generals/000.tga,
// Marcus 283,402, Servius 282,404), so the coord lookup hits the real portrait.
// statsCache name keys are only the family tree's SECONDARY fallback.
//
// This module rebuilds that SAME resolution headlessly so the commander card and
// the family tree can never diverge. `buildNonLivePortraitMap` folds the three
// sources into one map keyed EXACTLY like FamilyTree.js's coordToSave:
//   1. `<x>,<y>`               from v1PortraitsByCoord (engine-exact, PRIMARY)
//   2. `name:<fn>|<ln>|<fac>`  (+ stripped) — derived by joining the descr_strat
//      character coords to (1), AND from the persisted statsCache portrait.
// `resolveNonLiveCommanderInfo` then consults that map (coord first, then name
// keys) BEFORE statsCache, and leaves savePath null (hash pool) only as a
// genuine last resort. Respects the no-fabricated-fallback rule: when the
// portrait is genuinely unknown we return null savePath, never a placeholder.
"use strict";

function lc(s) { return (s || "").toLowerCase(); }
function lnNorm(s) { return (s || "").replace(/_/g, " ").toLowerCase(); }

// Build the non-live engine-exact portrait map, keyed identically to
// FamilyTree.js `coordToSave`. Returns a plain object (JSON-serializable, so it
// can cross the IPC boundary / be memoized in React state) whose values are the
// engine-exact /cards/ portrait path string.
//   v1PortraitsByCoord : { "<x>,<y>": { cards?, fulls? } | string }  (persisted)
//   startingCharacters : [{ firstName, lastName, faction, x, y }]    (descr_strat)
//   statsCache         : { "<fn>|<ln>|<fac>": { portrait } }         (persisted)
function buildNonLivePortraitMap(v1PortraitsByCoord, startingCharacters, statsCache) {
  const map = {};
  // 1. v1 coord → portrait (PRIMARY, engine-exact). Mirror coordToSave: prefer
  //    the small /cards/ path (`cards`), fall back to `fulls`, accept a bare
  //    string (older persisted shape).
  const coordPortrait = (v) => {
    if (!v) return null;
    if (typeof v === "string") return v;
    return v.cards || v.fulls || null;
  };
  if (v1PortraitsByCoord && typeof v1PortraitsByCoord === "object") {
    for (const [coord, v] of Object.entries(v1PortraitsByCoord)) {
      const p = coordPortrait(v);
      if (p) map[coord] = p;
    }
  }
  // 2a. Join descr_strat character coords to the v1 coord map → name keys.
  //     This is what lets a name-only commander-card lookup (no coord in hand)
  //     still resolve the COORD-derived engine-exact portrait the family tree
  //     shows. Full `name:fn|ln|fac` first, then stripped fallbacks; never
  //     overwrite a key already set by an earlier (more specific) char.
  if (Array.isArray(startingCharacters)) {
    for (const c of startingCharacters) {
      if (!c || !c.firstName) continue;
      if (c.x == null || c.y == null) continue;
      const p = map[`${c.x},${c.y}`];
      if (!p) continue;
      const fn = lc(c.firstName);
      const ln = lnNorm(c.lastName);
      const fac = lc(c.faction);
      const keys = [
        ln ? `name:${fn}|${ln}|${fac}` : null,
        ln ? `name:${fn}|${ln}|` : null,
        `name:${fn}||${fac}`,
        `name:${fn}||`,
      ];
      for (const k of keys) {
        if (k && map[k] == null) map[k] = p;
      }
    }
  }
  // 2b. Fold persisted statsCache portraits under `name:<key>` (the family
  //     tree's secondary fallback). Only fills keys the coord join didn't.
  if (statsCache && typeof statsCache === "object") {
    for (const [k, v] of Object.entries(statsCache)) {
      if (!v || !v.portrait) continue;
      const nk = `name:${k}`;
      if (map[nk] == null) map[nk] = v.portrait;
    }
  }
  return map;
}

// Look the engine-exact portrait up in the map by the SAME key order the family
// tree uses: coord first (when available), then the name keys. `coord` is the
// optional "<x>,<y>" string for the character (descr_strat tile).
function lookupNonLivePortrait(portraitMap, fn, ln, fac, coord) {
  if (!portraitMap) return null;
  if (coord && portraitMap[coord]) return portraitMap[coord];
  const f = lc(fn);
  const l = lnNorm(ln);
  const c = lc(fac);
  const keys = [
    l ? `name:${f}|${l}|${c}` : null,
    l ? `name:${f}|${l}|` : null,
    `name:${f}||${c}`,
    `name:${f}||`,
  ];
  for (const k of keys) {
    if (k && portraitMap[k]) return portraitMap[k];
  }
  return null;
}

// NON-LIVE commander-info resolver. Recovers the full surname / faction / age
// from descr_strat (the `characters` list), then resolves the portrait the SAME
// way the family tree does:
//   1. the engine-exact portrait map (coord, then name keys)  — PRIMARY
//   2. statsCache by name key                                 — fallback
//   3. null savePath (renderer hash pool)                     — last resort
// `portraitMap` is the output of buildNonLivePortraitMap (may be null in a
// degraded state, in which case we fall back to statsCache only).
function resolveNonLiveCommanderInfo(commanderName, commanderLastName, commanderFaction, statsCache, characters, portraitMap) {
  if (!commanderName) return null;
  const fn = lc(commanderName);
  const fac = lc(commanderFaction);
  // 1. Determine the full surname (+ faction/age/coord). The caller's
  //    commanderLastName (tagged from the army's full `a.character` name) is the
  //    precise surname — prefer it; fall back to a descr_strat firstName match
  //    only when the surname wasn't tagged.
  let lastName = commanderLastName ? commanderLastName.replace(/\s+/g, "_") : null;
  let faction = commanderFaction || null, age = null, coord = null;
  if (Array.isArray(characters)) {
    const lnLookup = lnNorm(lastName);
    const ds = characters.find((c) =>
      c && typeof c.firstName === "string" &&
      c.firstName.toLowerCase() === fn &&
      (lnLookup ? lnNorm(c.lastName) === lnLookup : true) &&
      (!fac || !c.faction || c.faction.toLowerCase() === fac)
    );
    if (ds) {
      if (!lastName) lastName = ds.lastName || null;
      faction = commanderFaction || ds.faction || null;
      age = typeof ds.age === "number" ? ds.age : null;
      if (ds.x != null && ds.y != null) coord = `${ds.x},${ds.y}`;
    }
  }
  // 2. Portrait — engine-exact map FIRST (coord, then name keys), matching the
  //    family tree's key order exactly; statsCache name keys next; hash last.
  let savePath = null, cached = null;
  savePath = lookupNonLivePortrait(portraitMap, commanderName, lastName, faction, coord);
  if (statsCache) {
    const ln = lnNorm(lastName);
    const facKey = lc(faction);
    const keys = [
      ln ? `${fn}|${ln}|${facKey}` : null,
      ln ? `${fn}|${ln}|` : null,
      `${fn}||${facKey}`,
      `${fn}||`,
    ].filter(Boolean);
    for (const k of keys) {
      if (statsCache[k]) { cached = statsCache[k]; break; }
    }
    if (cached) {
      // Only take the statsCache portrait when the engine-exact map missed.
      if (!savePath && cached.portrait) savePath = cached.portrait;
      if (!lastName && cached.lastName) lastName = cached.lastName;
      if (age == null && typeof cached.age === "number") age = cached.age;
      if (!faction && cached.faction) faction = cached.faction;
    }
  }
  // Return an info object only when we have SOMETHING to render with: a resolved
  // portrait or at least a name. Null lets the caller leave the bodyguard unit
  // icon (no swap).
  if (!savePath && lastName == null && !cached) return null;
  return { firstName: commanderName, lastName, faction, age, savePath };
}

module.exports = {
  buildNonLivePortraitMap,
  lookupNonLivePortrait,
  resolveNonLiveCommanderInfo,
};
