// Victory progress computation — pure, no IPC, no React.
//
// Input shapes (mirroring App.js state exactly):
//   victoryConditions — parseVictoryConditions output:
//       { [factionId]: { hold_regions: string[], take_regions: number|null } }
//     hold_regions entries are CITY/settlement names in stock RTW files
//     (see the 0.9.644 note above parseVictoryConditions in App.js), but
//     dev-mode Victory paint inserts REGION names — so each entry is matched
//     against BOTH the city and region name, case-insensitively (same
//     convention as DiplomacyEditor's vcTargets).
//   regions — App.js `regions` state: { [rgbKey]: { region, city, faction,
//     rebelDefault, ... } }.
//   currentOwnerByCity — { city: factionId } live-save ownership (or null).
//   initialOwnerByCity — { city: factionId } turn-0 descr_strat ownership (or null).
//
// Ownership of a region resolves in App.js priority order:
//   currentOwnerByCity[city] → initialOwnerByCity[city] → region.faction → region.rebelDefault
//
// Output: array sorted by pct desc (tie: faction id asc), one entry per
// faction that has at least one requirement:
//   { faction, requiredCount, heldCount, pct, missing: [{ region, city,
//     currentOwner, unmatched? }], conditionsText,
//     holdRequired, holdHeld, takeRequired, takeHeld, ownedCount }
//
// take_regions N ("take/hold N regions total") contributes N requirement
// units with held = min(N, regions currently owned). hold_regions contributes
// one unit per listed settlement. pct = heldCount / requiredCount * 100.
// Factions whose conditions are empty (no hold list, no take count) are
// omitted — there is nothing to track. Defensive: missing/invalid inputs → [].

function lc(v) {
  return v == null ? "" : String(v).toLowerCase();
}

export function computeVictoryProgress({ victoryConditions, regions, currentOwnerByCity, initialOwnerByCity } = {}) {
  if (!victoryConditions || typeof victoryConditions !== "object") return [];

  const regionEntries = regions && typeof regions === "object"
    ? Object.values(regions).filter((r) => r && typeof r === "object")
    : [];

  // Lookup maps: lowercase city/region name → region object (city wins on clash,
  // mirroring DiplomacyEditor: cityKey checked before regionKey).
  const byCity = {};
  const byRegion = {};
  const ownerCache = new Map(); // region object → resolved lowercase owner id (or null)

  const ownerOf = (r) => {
    if (ownerCache.has(r)) return ownerCache.get(r);
    const own =
      (r.city && currentOwnerByCity && currentOwnerByCity[r.city]) ||
      (r.city && initialOwnerByCity && initialOwnerByCity[r.city]) ||
      r.faction || r.rebelDefault || null;
    const norm = own ? lc(own) : null;
    ownerCache.set(r, norm);
    return norm;
  };

  const ownedCountByFaction = {};
  for (const r of regionEntries) {
    if (r.city) byCity[lc(r.city)] = r;
    if (r.region) byRegion[lc(r.region)] = r;
    const own = ownerOf(r);
    if (own) ownedCountByFaction[own] = (ownedCountByFaction[own] || 0) + 1;
  }

  const out = [];
  for (const [faction, vc] of Object.entries(victoryConditions)) {
    if (!vc || typeof vc !== "object") continue;
    const fid = lc(faction);
    const holdList = Array.isArray(vc.hold_regions) ? vc.hold_regions : [];
    const takeN = typeof vc.take_regions === "number" && isFinite(vc.take_regions) && vc.take_regions > 0
      ? vc.take_regions : 0;

    const holdRequired = holdList.length;
    let holdHeld = 0;
    const missing = [];
    for (const nm of holdList) {
      const r = byCity[lc(nm)] || byRegion[lc(nm)];
      if (!r) {
        // Name not resolvable against the loaded map — still a requirement,
        // surfaced as unmatched so the UI can flag it.
        missing.push({ region: String(nm), city: null, currentOwner: null, unmatched: true });
        continue;
      }
      const own = ownerOf(r);
      if (own && own === fid) holdHeld++;
      else missing.push({ region: r.region || String(nm), city: r.city || null, currentOwner: own });
    }

    const ownedCount = ownedCountByFaction[fid] || 0;
    const takeRequired = takeN;
    const takeHeld = takeN ? Math.min(takeN, ownedCount) : 0;

    const requiredCount = holdRequired + takeRequired;
    if (requiredCount === 0) continue; // no conditions → nothing to track

    const heldCount = holdHeld + takeHeld;
    const pct = (heldCount / requiredCount) * 100;

    const parts = [];
    if (holdRequired) parts.push(`Hold ${holdRequired} settlement${holdRequired === 1 ? "" : "s"}`);
    if (takeRequired) parts.push(`Take ${takeRequired} regions total`);
    out.push({
      faction, requiredCount, heldCount, pct, missing,
      conditionsText: parts.join(" · "),
      holdRequired, holdHeld, takeRequired, takeHeld, ownedCount,
    });
  }

  out.sort((a, b) => (b.pct - a.pct) || (a.faction < b.faction ? -1 : a.faction > b.faction ? 1 : 0));
  return out;
}

export default computeVictoryProgress;
