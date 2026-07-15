// Save-snapshot diffing + autosave-filename classification, extracted from
// main.js (2026-07-15). Pure functions over already-parsed snapshot objects
// and filenames — no state, no I/O. Powers the live-watch "what changed this
// turn" event feed.
"use strict";

// Diff two parsed save snapshots → a flat array of change events (buildings,
// armies, construction queues). Both args are the shape parseSaveData emits.
function diffSaveData(prev, curr) {
  const events = [];

  // Buildings
  const prevB = prev.buildings || {};
  const currB = curr.buildings || {};
  const allCities = new Set([...Object.keys(prevB), ...Object.keys(currB)]);
  for (const city of allCities) {
    const b1 = prevB[city] || {};
    const b2 = currB[city] || {};
    // Only report cities present in BOTH snapshots (reduce noise).
    if (!prevB[city] || !currB[city]) continue;
    const allBn = new Set([...Object.keys(b1), ...Object.keys(b2)]);
    for (const bn of allBn) {
      const v1 = b1[bn];
      const v2 = b2[bn];
      if (v1 === undefined && v2 !== undefined) {
        events.push({ type: "building_new", city, building: bn, level: v2.level, health: v2.health });
      } else if (v1 !== undefined && v2 === undefined) {
        events.push({ type: "building_removed", city, building: bn, prevLevel: v1.level });
      } else if (v1 && v2) {
        if (v1.level !== v2.level && v1.level !== null && v2.level !== null) {
          events.push({ type: "building_upgrade", city, building: bn, from: v1.level, to: v2.level });
        }
        if (v1.health !== v2.health && v1.health !== null && v2.health !== null) {
          events.push({ type: "building_damaged", city, building: bn, from: v1.health, to: v2.health });
        }
      }
    }
  }

  // Armies — movement, new armies, size changes
  const prevA = prev.armies || {};
  const currA = curr.armies || {};
  const allRegions = new Set([...Object.keys(prevA), ...Object.keys(currA)]);
  for (const region of allRegions) {
    const u1 = prevA[region] || [];
    const u2 = currA[region] || [];
    const prevTotal = u1.reduce((s, u) => s + (u.soldiers || 0), 0);
    const currTotal = u2.reduce((s, u) => s + (u.soldiers || 0), 0);
    if (u1.length === 0 && u2.length > 0) {
      events.push({ type: "army_arrived", region, units: u2.length, soldiers: currTotal });
    } else if (u1.length > 0 && u2.length === 0) {
      events.push({ type: "army_left", region, units: u1.length, soldiers: prevTotal });
    } else if (u1.length > 0 && u2.length > 0 && Math.abs(u2.length - u1.length) > 0) {
      events.push({ type: "army_changed", region, prevUnits: u1.length, units: u2.length,
                     prevSoldiers: prevTotal, soldiers: currTotal });
    }
  }

  // Construction queues — an entry that disappeared = building completed.
  const prevQ = prev.queues || {};
  const currQ = curr.queues || {};
  const allCities2 = new Set([...Object.keys(prevQ), ...Object.keys(currQ)]);
  for (const city of allCities2) {
    const before = new Set(prevQ[city] || []);
    const after = new Set(currQ[city] || []);
    for (const chain of before) {
      if (!after.has(chain)) events.push({ type: "building_completed", city, chain });
    }
    for (const chain of after) {
      if (!before.has(chain)) events.push({ type: "building_queued", city, chain });
    }
  }

  return events;
}

// "Turn N End" autosaves are superseded moments later by "Turn N+1 Start", so
// auto-detection skips them (they stay selectable manually). True = skip.
//
// FIX (2026-07-15): the old pattern started with \bAutosave\b, but the standard
// filename is "save_Autosave …" and the underscore is a word char, so there was
// NO boundary before "Autosave" — the regex failed to match and End autosaves
// were never actually skipped. Drop the leading boundary (keep the trailing one
// so "Autosaves" wouldn't false-match) so the real "save_Autosave … Turn N End"
// filenames match as intended.
function isEndAutosave(filename) {
  return /Autosave\b.*\bTurn\s+\d+\s+End\b/i.test(filename);
}

module.exports = { diffSaveData, isEndAutosave };
