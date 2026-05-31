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
