// garrisonClassify.js — the single rule that decides whether a region unit
// belongs in the settlement's GARRISON panel or is part of a FIELD ARMY.
//
// In-settlement signals (garrison):
//   1. commander-LESS defenders (no commanderUuid and no inferredCmd);
//   2. the appointed GOVERNOR's stack (governorUuid);
//   3. a commander standing EXACTLY on the settlement tile (cmdsAtSettlement).
// Anything else commanded is a FIELD ARMY — a general standing on a field tile
// in the settlement's region (possibly a few tiles from the walls) is NOT
// garrison even if he shares the region owner's faction.
//
// Extracted from App.js's live garrison filter so the rule is unit-testable.
// Keep this function in sync with that filter.

/**
 * @param {{commanderUuid?: number|null, inferredCmd?: number|null}} unit
 * @param {{ governorUuid?: number|null, cmdsAtSettlement?: Set<number> }} ctx
 * @returns {boolean} true if the unit is part of the settlement garrison
 */
export function isGarrisonUnit(unit, ctx) {
  const cmd = unit.commanderUuid || unit.inferredCmd || null;
  if (!cmd) return true; // (1) leaderless defender
  const governorUuid = ctx && ctx.governorUuid;
  if (governorUuid && (unit.commanderUuid === governorUuid || unit.inferredCmd === governorUuid)) return true; // (2)
  const at = ctx && ctx.cmdsAtSettlement;
  if (at && (at.has(unit.commanderUuid) || at.has(unit.inferredCmd))) return true; // (3)
  return false; // field army
}

// isOnSettlementTile — the NON-LIVE (descr_strat import / bundle) garrison rule.
//
// The live save path identifies the garrison by commander UUID + position
// (isGarrisonUnit above). The non-live path has no UUIDs: it only knows each
// descr_strat army's (x,y) and the region's settlement tile, which it derives
// by scanning map_regions.tga for the black (0,0,0) pixel adjacent to the
// region's colour. That scan can land 1 pixel off from where descr_strat
// actually places the settlement's named commander (it picks the FIRST adjacent
// black pixel it finds, and a settlement footprint is often a small black
// cluster). An EXACT-coordinate match then drops a faction leader / governor —
// e.g. Appius Claudius Pulcher at (263,431) in Pisae — into the FIELD bucket,
// so the Garrison panel never tags his bodyguard unit with a commanderName and
// his commander card renders with NO portrait (plain bodyguard icon).
//
// The live overlay already reclassifies an army to garrison when it sits within
// ONE tile of the settlement tile (changelog 0.9.x conqueror-marker fix). This
// applies the SAME Chebyshev-≤1 tolerance to the non-live classifier so the two
// paths agree and a settlement's own commander is never mis-bucketed by a 1-px
// settlement-tile scan offset. Returns true when (ax,ay) is at or within one
// tile of (sx,sy).
export function isOnSettlementTile(ax, ay, sx, sy) {
  if (ax == null || ay == null || sx == null || sy == null) return false;
  return Math.abs(ax - sx) <= 1 && Math.abs(ay - sy) <= 1;
}
