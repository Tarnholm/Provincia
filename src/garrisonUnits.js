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
  const list = pendingUnits || [];
  // 0.9.856: if the edited list ALREADY carries a per-unit commander tag (it
  // does once the user has edited a selected army — the original units keep
  // their commanderName), preserve those tags so drag-reorder / duplicate keep
  // the general's face on the RIGHT card instead of snapping it back to unit 0.
  // Only when NO unit is tagged (a fresh overlay built from untagged units) do
  // we fall back to tagging unit 0 from the region's named commander — the
  // original v0.9.837 governor-portrait guard. Also read both key spellings
  // (xp/exp, weapon/weapon_lvl) since staged adds use exp/weapon_lvl while the
  // original garrison units use xp/weapon — so edits don't zero out upgrades.
  const anyTagged = list.some((u) => u && u.commanderName);
  const { firstName, lastName, faction } = garrisonCommanderTag(garrisonArmies, ownerId);
  return list.map((u, ui) => {
    const keepOwn = anyTagged && !!u.commanderName;
    const tagIdx0 = !anyTagged && ui === 0 && !!firstName;
    return {
      unit: u.unit,
      xp: u.xp != null ? u.xp : (u.exp || 0),
      armour: u.armour || 0,
      weapon: u.weapon != null ? u.weapon : (u.weapon_lvl || 0),
      upgradeLevel: typeof u.upgradeLevel === "number" ? u.upgradeLevel : null,
      soldiers: typeof u.soldiers === "number" ? u.soldiers : null,
      max: typeof u.max === "number" ? u.max : null,
      commanderUuid: keepOwn ? (u.commanderUuid || null) : null,
      commanderName: keepOwn ? u.commanderName : (tagIdx0 ? firstName : null),
      commanderLastName: keepOwn ? (u.commanderLastName || null) : (tagIdx0 ? lastName : null),
      commanderFaction: keepOwn ? (u.commanderFaction || null) : (tagIdx0 ? faction : null),
    };
  });
}
