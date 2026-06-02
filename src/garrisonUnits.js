// garrisonUnits.js — building the non-live GARRISON unit list for a region.
//
// The garrison panel swaps a general's bodyguard unit card for his face by
// reading `commanderName`/`commanderLastName`/`commanderFaction` off the FIRST
// unit. That tag has to survive every transform in the garrison-prop builder.
//
// REGRESSION GUARD (v0.9.837): when a region had a pending or already-applied
// army-units OVERLAY, the merge rebuilt the unit list as {unit,xp,armour,weapon}
// and DROPPED the commander tag — so governors with an overlay (Appius@Pisae,
// Decimus@Iguvium) lost their portrait and showed the plain bodyguard icon,
// while regions without an overlay were fine (it looked random). This module
// extracts the tagging so a unit test pins it and it can't silently regress.

"use strict";

// Find the region's NAMED garrison commander army — skipping the generic
// "Garrison of <region>" placeholder stacks and the test dummy.
export function findNamedGarrisonCommander(garrisonArmies) {
  if (!Array.isArray(garrisonArmies)) return null;
  return (
    garrisonArmies.find((g) => {
      const nm = ((g && g.character) || "").toLowerCase();
      return nm && !nm.startsWith("garrison of") && nm !== "biggus dickus";
    }) || null
  );
}

// Derive the {firstName, lastName, faction} commander tag from a region's
// garrison armies. `ownerId` is the fallback faction. Returns all-null when
// there's no named commander.
export function garrisonCommanderTag(garrisonArmies, ownerId) {
  const gar = findNamedGarrisonCommander(garrisonArmies);
  const parts = gar && gar.character ? String(gar.character).split(/\s+/) : [];
  const firstName = parts[0] || null;
  const lastName = parts.slice(1).join(" ") || null;
  const faction = ((gar && gar.faction) || ownerId || "").toString().toLowerCase() || null;
  return { firstName, lastName, faction };
}

// Build the garrison unit list from a pending/applied OVERLAY, re-tagging the
// FIRST unit with the region's named commander so the portrait swap survives.
// (This is the exact path that regressed in pre-0.9.837 builds.)
export function tagOverlayGarrisonUnits(pendingUnits, garrisonArmies, ownerId) {
  const { firstName, lastName, faction } = garrisonCommanderTag(garrisonArmies, ownerId);
  return (pendingUnits || []).map((u, ui) => ({
    unit: u.unit,
    xp: u.exp || 0,
    armour: u.armour || 0,
    weapon: u.weapon || 0,
    commanderName: ui === 0 && firstName ? firstName : null,
    commanderLastName: ui === 0 && firstName ? lastName : null,
    commanderFaction: ui === 0 && firstName ? faction : null,
  }));
}
