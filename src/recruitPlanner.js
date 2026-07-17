// Recruitment planner — pure "what would the NEXT upgrade of each building
// chain unlock for recruitment?" computation (2026-07-17).
//
// For every chain built in the selected settlement, simulate upgrading THAT
// chain one level (holding everything else constant), recompute the full
// currently-recruitable set for the hypothetical build state, and report the
// units that are new versus the settlement's real current recruitable set.
//
// GATING SEMANTICS: this module mirrors pass 1 (the building-gated
// "currently recruitable" pass) of `deriveRecruitable` in
// src/regionInfoDerive.js EXACTLY, as of 2026-07-17:
//   - chain levels are cumulative: owning level N walks recruit lines of all
//     levels 0..N in buildingLevelsLookup order (fallback: just the built
//     level name when the ladder is unknown);
//   - EDB recruit-level faction filter with `all` wildcard, owner-faction id
//     and owner CULTURE both accepted;
//   - positive `major_event` lines dropped (negative `not major_event` kept);
//   - `not is_player` AI-freebie lines dropped;
//   - `not factions { ... }` exclusion against owner id and culture;
//   - positive/negative `hidden_resource X` evaluated against the region's
//     comma-separated tag list (info.tags);
//   - strategic `resource X` / `not resource X` evaluated against the
//     region's resource set (resourcesData — optional input, see below);
//   - tier aliases (mic_tier_N / gov_tier_N / colony_tier_N / culture_tier_N)
//     expanded via buildingRecruits.__aliases, OR-joined branches;
//   - `building_present_min_level <chain> <level>` and bare
//     `building_present <chain>` clauses (with `not` negation; `queued`
//     modifier skipped) evaluated against the (hypothetical) built list;
//   - EDU ownership ground truth: unitOwnership[unit] must contain "all",
//     the owner id, or the owner culture; unknown units are dropped.
//
// DOCUMENTED DIVERGENCES from deriveRecruitable:
//   1. `resourceReqAllows` is reimplemented here verbatim rather than
//      imported: regionInfoDerive.js imports the unit-icon cache modules at
//      top level, which this module must stay free of (pure, hermetically
//      testable). Keep the two implementations in sync.
//   2. The owner faction id is an INPUT (`ownerFaction`) instead of being
//      derived from currentOwnerByCity/initialOwnerByCity/r.faction — the
//      caller (App.js) performs that exact derivation; see the wiring spec.
//   3. `resourcesData` is an optional extra input not named in the original
//      signature. Without it the region resource set is empty, so recruit
//      lines with a positive `resource X` requirement (e.g. elephants) are
//      conservatively excluded — same outcome as a region without the
//      resource. Pass App's `resourcesData` to match deriveRecruitable.
//   4. Icon resolution/prefetch is intentionally absent (pure module). The
//      panel resolves display concerns.
//
// Baseline: `recruitableNow` (App's already-derived recruitable prop) is the
// authoritative "current" set — the planner SUBTRACTS it rather than trusting
// its own recomputation. Entries with `available: false` (deriveRecruitable's
// faded "upgrade-only" units) are NOT part of the baseline: they are exactly
// the units this planner exists to attribute to specific upgrades. As a
// belt-and-braces guard against drift between this reimplementation and
// deriveRecruitable, the planner's own recomputed current set is subtracted
// too, so a unit is only ever reported as "new" if BOTH computations agree it
// is not currently recruitable.

// Verbatim reimplementation of regionInfoDerive.resourceReqAllows (see
// divergence note 1). Positive `resource X` (negatives stripped first) must
// be present; `not resource X` must be absent. `\bresource` does NOT match
// inside `hidden_resource` (underscore is a word char).
export function planResourceReqAllows(requires, resourceSet) {
  if (!requires) return true;
  const noNeg = requires.replace(/\bnot\s+resource\s+\S+/g, "");
  for (const m of noNeg.matchAll(/\bresource\s+(\S+)/g)) {
    if (!resourceSet.has(m[1].toLowerCase())) return false;
  }
  for (const m of requires.matchAll(/\bnot\s+resource\s+(\S+)/g)) {
    if (resourceSet.has(m[1].toLowerCase())) return false;
  }
  return true;
}

// Does `builtList` satisfy "chain present at >= level"? level == null means
// bare presence (any built level). Mirrors deriveRecruitable's hasMinLevel.
function hasMinLevel(builtList, buildingLevelsLookup, chain, level) {
  const built = builtList.find((b) => b.type === chain);
  if (!built) return false;
  if (level == null) return true;
  const order = (buildingLevelsLookup && buildingLevelsLookup[chain]) || null;
  if (!order) return built.level === level;
  const haveIdx = order.indexOf(built.level);
  const needIdx = order.indexOf(level);
  return haveIdx >= 0 && needIdx >= 0 && haveIdx >= needIdx;
}

// One recruit line vs all non-building AND building gates, for a given
// (hypothetical) built list. Returns true if the unit passes every filter.
function recPasses(rec, ctx) {
  const { builtList, buildingLevelsLookup, aliasMap, tagSet, resourceSet, ownerId, culture, unitOwnership } = ctx;
  // EDB recruit-level faction filter (`all` wildcard).
  if (rec.factions && rec.factions.length > 0 && ownerId
      && !rec.factions.includes("all")
      && !rec.factions.includes(ownerId)
      && !rec.factions.includes(culture)) return false;
  if (rec.requires) {
    // Positive major_event = reform-gated, drop. Negative form kept.
    if (/(?<!\bnot\s)\bmajor_event\b/.test(rec.requires)) return false;
    // AI-only freebie lines.
    if (/\bnot\s+is_player\b/.test(rec.requires)) return false;
    // Negative faction filter.
    if (/\bnot\s+factions\b/.test(rec.requires)) {
      const nm = rec.requires.match(/not\s+factions\s*\{\s*([^}]*)\}/);
      if (nm) {
        const excluded = nm[1].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
        if (ownerId && excluded.includes(ownerId)) return false;
        if (culture && excluded.includes(culture)) return false;
      }
    }
    // hidden_resource gates vs the region tag set (negatives first).
    {
      const reqs = rec.requires;
      const negRe = /\bnot\s+hidden_resource\s+(\S+)/g;
      let neg;
      while ((neg = negRe.exec(reqs)) !== null) {
        if (tagSet.has(neg[1].toLowerCase())) return false;
      }
      const positives = reqs.replace(/\bnot\s+hidden_resource\s+\S+/g, "");
      const posRe = /\bhidden_resource\s+(\S+)/g;
      let pos;
      while ((pos = posRe.exec(positives)) !== null) {
        if (!tagSet.has(pos[1].toLowerCase())) return false;
      }
    }
    // Strategic-resource gate (e.g. elephants).
    if (!planResourceReqAllows(rec.requires, resourceSet)) return false;
    // Tier aliases (mic_tier_2 etc.) — OR-joined expansion branches.
    const evalTierAlias = (tok) => {
      const branches = aliasMap[tok];
      if (!branches) return false; // unknown alias — unsatisfied
      return branches.some(({ chain, level }) => hasMinLevel(builtList, buildingLevelsLookup, chain, level));
    };
    {
      const re = /(\bnot\s+)?\b(mic_tier|gov_tier|colony_tier|culture_tier)_\d+\b/g;
      let m;
      while ((m = re.exec(rec.requires)) !== null) {
        const negated = !!m[1];
        const tok = m[0].replace(/^not\s+/, "");
        const sat = evalTierAlias(tok);
        if (negated ? sat : !sat) return false;
      }
    }
    // Direct building_present_min_level clauses (optional `not`).
    {
      const re = /(\bnot\s+)?\bbuilding_present_min_level\s+(\S+)\s+(\S+)/g;
      let m;
      while ((m = re.exec(rec.requires)) !== null) {
        const negated = !!m[1];
        const sat = hasMinLevel(builtList, buildingLevelsLookup, m[2], m[3]);
        if (negated ? sat : !sat) return false;
      }
    }
    // Bare building_present <chain> (skip `queued` modifier).
    {
      const re = /(\bnot\s+)?\bbuilding_present(?!_min_level)\s+(\S+)(?:\s+(\w+))?/g;
      let m;
      while ((m = re.exec(rec.requires)) !== null) {
        if (m[3] === "queued") continue;
        const negated = !!m[1];
        const sat = hasMinLevel(builtList, buildingLevelsLookup, m[2], null);
        if (negated ? sat : !sat) return false;
      }
    }
  }
  // EDU ownership is the ground truth (`ownership all` = wildcard).
  if (unitOwnership) {
    const owners = unitOwnership[rec.unit];
    if (!owners) return false;
    if (ownerId
        && !owners.includes("all")
        && !owners.includes(ownerId)
        && !owners.includes(culture)) return false;
  }
  return true;
}

// Full currently-recruitable unit set for a given built list (the pass-1
// walk of deriveRecruitable). Returns a Set of unit names.
function computeAvailableUnits(builtList, ctx) {
  const { buildingRecruits, buildingLevelsLookup } = ctx;
  const out = new Set();
  for (const b of builtList) {
    const lvls = buildingRecruits[b.type];
    if (!lvls) continue;
    const allLevels = (buildingLevelsLookup && buildingLevelsLookup[b.type]) || null;
    let levelsToCheck;
    if (allLevels && allLevels.length > 0) {
      const idx = allLevels.indexOf(b.level);
      levelsToCheck = idx >= 0 ? allLevels.slice(0, idx + 1) : [b.level];
    } else {
      levelsToCheck = [b.level];
    }
    for (const lvl of levelsToCheck) {
      const recs = lvls[lvl];
      if (!Array.isArray(recs)) continue;
      for (const rec of recs) {
        if (out.has(rec.unit)) continue;
        if (recPasses(rec, { ...ctx, builtList })) out.add(rec.unit);
      }
    }
  }
  return out;
}

const prettyName = (s) => String(s || "").replace(/_/g, " ").trim();

/**
 * Plan the recruitment payoff of the NEXT upgrade of every building chain in
 * a settlement.
 *
 * @param {object} args
 * @param {object} args.info                 region info object ({ region, city, tags, faction, ... })
 * @param {Array}  args.buildings            settlement built list — entries need { type, level }
 *                                           (level = level NAME). Use App's getBuildings(r, true).
 * @param {object} args.buildingRecruits     { chain: { level: [{unit, factions?, requires?}] }, __aliases }
 * @param {object} args.buildingLevelsLookup { chain: [level names low→high] }
 * @param {object} args.unitOwnership        { unit: [faction ids / cultures / "all"] } (+ __dictionary sidecar, ignored)
 * @param {string} args.ownerFaction         lowercase owner faction id (see wiring spec)
 * @param {object} args.factionCultures      { factionId: culture }
 * @param {Array}  args.recruitableNow       App's derived recruitable prop — [{unit, available, ...}]
 *                                           or plain unit-name strings. available:false entries are
 *                                           excluded from the baseline.
 * @param {object} [args.resourcesData]      optional { region|city: [{type}] } strategic resources
 *                                           (divergence note 3)
 * @param {boolean} [args.includeUnbuilt]    also propose the FIRST level of chains not present in
 *                                           the settlement when that level would add units. Off by
 *                                           default: construction prerequisites (EDB building
 *                                           `requires`) are not part of the planner's inputs, so
 *                                           buildability itself is not verified — only the recruit
 *                                           gates are. Entries are flagged { notBuilt: true,
 *                                           fromLevel: null }.
 * @returns {Array<{chain, fromLevel, toLevel, newUnits: Array<{unit, displayName}>, alreadyMax}>}
 *   One entry per chain, sorted: upgrades with new units first (most first),
 *   then upgrades with none, then alreadyMax (and ladder-unknown) rows last.
 */
export function planRecruitUpgrades({
  info,
  buildings,
  buildingRecruits,
  buildingLevelsLookup,
  unitOwnership,
  ownerFaction,
  factionCultures,
  recruitableNow,
  resourcesData,
  includeUnbuilt = false,
}) {
  if (!info || !buildingRecruits) return [];
  const builtList = (Array.isArray(buildings) ? buildings : [])
    .filter((b) => b && b.type && b.level != null);
  // First occurrence wins on duplicate chain entries.
  const seenChains = new Set();
  const dedupedBuilt = [];
  for (const b of builtList) {
    if (seenChains.has(b.type)) continue;
    seenChains.add(b.type);
    dedupedBuilt.push({ type: b.type, level: b.level });
  }
  const ownerId = String(ownerFaction || "").toLowerCase();
  const culture = (factionCultures && factionCultures[ownerId]) || null;
  const tagSet = new Set(
    String(info.tags || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  );
  const resourceList = (resourcesData && (resourcesData[info.region] || resourcesData[info.city])) || [];
  const resourceSet = new Set(resourceList.map((x) => String(x.type || "").toLowerCase()).filter(Boolean));
  const ctx = {
    buildingRecruits,
    buildingLevelsLookup,
    aliasMap: buildingRecruits.__aliases || {},
    tagSet,
    resourceSet,
    ownerId,
    culture,
    unitOwnership,
  };
  // Baseline = App's derived current set (available !== false) plus our own
  // recomputation of the current state (drift guard — see header).
  const baseline = new Set();
  for (const e of Array.isArray(recruitableNow) ? recruitableNow : []) {
    if (typeof e === "string") baseline.add(e);
    else if (e && e.unit && e.available !== false) baseline.add(e.unit);
  }
  for (const u of computeAvailableUnits(dedupedBuilt, ctx)) baseline.add(u);

  const entries = [];
  for (const b of dedupedBuilt) {
    const order = (buildingLevelsLookup && buildingLevelsLookup[b.type]) || null;
    const idx = order ? order.indexOf(b.level) : -1;
    if (!order || idx < 0) {
      // Ladder unknown — cannot name a next level. Surface as a dimmed
      // terminal row rather than guessing.
      entries.push({ chain: b.type, fromLevel: b.level, toLevel: null, newUnits: [], alreadyMax: true, unknownLadder: true });
      continue;
    }
    if (idx >= order.length - 1) {
      entries.push({ chain: b.type, fromLevel: b.level, toLevel: null, newUnits: [], alreadyMax: true });
      continue;
    }
    const toLevel = order[idx + 1];
    const hyp = dedupedBuilt.map((x) => (x.type === b.type ? { ...x, level: toLevel } : x));
    // Full recompute over the hypothetical state so cross-chain
    // building_present_min_level unlocks (a stables unit requiring a
    // barracks tier, say) are attributed to the upgrade that enables them.
    const upgraded = computeAvailableUnits(hyp, ctx);
    const newNames = [...upgraded].filter((u) => !baseline.has(u)).sort();
    entries.push({
      chain: b.type,
      fromLevel: b.level,
      toLevel,
      newUnits: newNames.map((u) => ({ unit: u, displayName: prettyName(u) })),
      alreadyMax: false,
    });
  }

  if (includeUnbuilt) {
    for (const chain of Object.keys(buildingRecruits)) {
      if (chain === "__aliases" || seenChains.has(chain)) continue;
      const order = (buildingLevelsLookup && buildingLevelsLookup[chain]) || null;
      if (!order || order.length === 0) continue; // first level indeterminable
      const firstLevel = order[0];
      const hyp = [...dedupedBuilt, { type: chain, level: firstLevel }];
      const withNew = computeAvailableUnits(hyp, ctx);
      const newNames = [...withNew].filter((u) => !baseline.has(u)).sort();
      if (newNames.length === 0) continue; // only propose payoff-bearing builds
      entries.push({
        chain,
        fromLevel: null,
        toLevel: firstLevel,
        newUnits: newNames.map((u) => ({ unit: u, displayName: prettyName(u) })),
        alreadyMax: false,
        notBuilt: true,
      });
    }
  }

  entries.sort((a, b) => {
    const grp = (e) => (e.alreadyMax ? 2 : e.newUnits.length > 0 ? 0 : 1);
    const ga = grp(a), gb = grp(b);
    if (ga !== gb) return ga - gb;
    if (ga === 0 && a.newUnits.length !== b.newUnits.length) return b.newUnits.length - a.newUnits.length;
    return a.chain.localeCompare(b.chain);
  });
  return entries;
}
