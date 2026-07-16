// RegionInfo prop derivation — extracted verbatim from App.js (2026-07-16,
// the "split App.js" backlog item). Each derive* function is the body of what
// was a giant inline closure on the <RegionInfo> element; App.js still wraps
// them in memoInline with the same keys and dep lists, so caching behaviour is
// unchanged. ctx carries the App component state each body reads (verified
// with scripts/check-freevars.cjs — it must report zero free identifiers for
// this module). Pure module imports (unit icons, garrison classify, display
// names) are imported here directly instead of travelling through ctx.
import { getCachedUnitIcon, prefetchUnitIcons } from "./unitIcons";
import { isGarrisonUnit } from "./garrisonClassify";
import { tagOverlayGarrisonUnits } from "./garrisonUnits";
import { displayFullName } from "./displayName";

// Evaluate strategic-`resource` recruit gates against a region's resource set
// (from resources_*.json — e.g. elephants). Elephant units are gated on
// `resource elephants` (NOT a hidden_resource), so the recruit/AOR filters must
// honour it or elephants show in regions with no elephant resource. NOTE:
// `\bresource` does NOT match inside `hidden_resource` — the underscore is a
// word char, so there's no word boundary before "resource" there.
export function resourceReqAllows(requires, resourceSet) {
  if (!requires) return true;
  // Positive `resource X` (with `not resource X` stripped first) must be present.
  const noNeg = requires.replace(/\bnot\s+resource\s+\S+/g, "");
  for (const m of noNeg.matchAll(/\bresource\s+(\S+)/g)) {
    if (!resourceSet.has(m[1].toLowerCase())) return false;
  }
  // Excluded `not resource X` must be absent.
  for (const m of requires.matchAll(/\bnot\s+resource\s+(\S+)/g)) {
    if (resourceSet.has(m[1].toLowerCase())) return false;
  }
  return true;
}

export function deriveCharacters(ctx) {
  const { lockedRegionInfo, regionInfo, armiesToRender, saveCharactersByRegion, saveUnitsByRegion, startingArmiesByRegion, startingCharactersFromMod, statsCache, liveLogActive, liveDeadCharUuids, liveCharPositionsVersion, liveAssaultWipedSettlements } = ctx;
  const r = lockedRegionInfo || regionInfo;
  if (!r) return null;
  // Build a name → live region map from armiesToRender.
  // CRITICAL: when an epithet trait fires (e.g. "the
  // Eagle"), Marcus's display name becomes "Marcus
  // Livius Drusus the Eagle" — but saveCharacters-
  // ByRegion stores lastName with the epithet baked
  // in too. Normalize BOTH sides identically:
  // lowercase + underscores→spaces + KEEP epithets.
  // (The 0.9.302 attempt stripped epithets on one
  // side only, causing the filter to miss every
  // character with a trait nickname.)
  const normName = (full) => String(full || "").toLowerCase().replace(/_/g, " ").trim();
  const liveRegionByCharName = new Map();
  if (Array.isArray(armiesToRender)) {
    for (const a of armiesToRender) {
      if (!a || !a.region || !a.character) continue;
      liveRegionByCharName.set(normName(a.character), a.region);
      // Also register the birth name (pre-epithet)
      // for the case where saveCharactersByRegion's
      // lastName carries the epithet but the army
      // entry's character was constructed pre-trait.
      if (a.firstName && a.originalLastName) {
        liveRegionByCharName.set(normName(a.firstName + " " + a.originalLastName), a.region);
      }
    }
  }
  const isMovedAway = (firstName, lastName) => {
    const fullName = normName(firstName + " " + (lastName || ""));
    const liveRegion = liveRegionByCharName.get(fullName);
    return liveRegion && liveRegion !== r.region;
  };
  // Non-live fallback: synthesize a character list
  // from descr_strat so traits / ancillaries / age
  // are browsable without a save loaded. Live-save
  // data takes precedence whenever it's available.
  // Source priority:
  //   1. Runtime descr_strat from the loaded mod
  //      (`startingCharactersFromMod`) — works for
  //      ANY mod or vanilla, not just the dev's
  //      bundled one.
  //   2. Bundled `startingArmiesByRegion` —
  //      contains traits only if the dev rebundled
  //      with the trait-capturing version of the
  //      bundle script.
  const liveCharsReady = saveCharactersByRegion && Object.keys(saveCharactersByRegion).length > 0;
  if (!liveLogActive || !liveCharsReady) {
    // Use the bundled per-region structure as the
    // index of which characters live where (it has
    // correct region bucketing because the bundle
    // script does TGA pixel lookup), then merge in
    // runtime trait data from descr_strat by
    // firstName+faction match. The runtime data
    // wins when present so live mod edits show up
    // even without rebuilding the bundle.
    const reg = startingArmiesByRegion?.[r.region];
    if (!reg) return null;
    const all = [...(reg.garrison || []), ...(reg.field || [])];
    const real = all.filter((g) => {
      const nm = (g.character || "").toLowerCase();
      if (!nm || nm.startsWith("garrison of") || nm === "biggus dickus") return false;
      // Drop chars who moved away per the live log.
      const parts = (g.character || "").split(/\s+/);
      const firstName = parts[0] || "";
      const lastName = parts.slice(1).join("_");
      if (isMovedAway(firstName, lastName)) return false;
      return true;
    });
    if (real.length === 0) return null;
    // Build a runtime lookup keyed by firstName+
    // faction for fast merge.
    const runtimeByKey = new Map();
    if (Array.isArray(startingCharactersFromMod)) {
      for (const c of startingCharactersFromMod) {
        const key = (c.firstName || "") + "|" + (c.faction || "");
        runtimeByKey.set(key, c);
      }
    }
    const mapToChar = (g) => {
      const parts = (g.character || "").split(/\s+/);
      const firstName = parts[0] || g.character || "";
      const lastName = parts.slice(1).join("_");
      const rt = runtimeByKey.get(firstName + "|" + (g.faction || ""));
      const traits = rt && Array.isArray(rt.traits) && rt.traits.length > 0
        ? rt.traits
        : (Array.isArray(g.traits) ? g.traits : []);
      const ancRaw = rt && Array.isArray(rt.ancillaries) && rt.ancillaries.length > 0
        ? rt.ancillaries
        : (Array.isArray(g.ancillaries) ? g.ancillaries : []);
      const tags = rt && Array.isArray(rt.tags) && rt.tags.length > 0
        ? rt.tags
        : (Array.isArray(g.tags) ? g.tags : []);
      const age = rt && rt.age != null ? rt.age : (g.age ?? null);
      // 0.9.421: forward stats from the runtime descr_strat
      // record (rt) if present, else from the bundled
      // starting-armies seed (g). Either source has
      // command/influence/management/subterfuge parsed
      // from the `character` or `character_record` line.
      const pickStat = (k) => rt && rt[k] != null ? rt[k] : (g[k] != null ? g[k] : null);
      // 0.9.425: cache key lookup with faction
      // fallback. v1 parser sometimes returns
      // faction=null while the renderer always has
      // g.faction from descr_strat. So write side
      // had an empty faction component; read side
      // tries the FULL key first, then a fallback
      // with empty faction, then a name-only key.
      const lnNorm = (lastName || "").replace(/_/g, " ");
      const cacheKeys = [
        `${firstName}|${lnNorm}|${g.faction || ""}`,
        `${firstName}|${lnNorm}|`,
        `${firstName}||${g.faction || ""}`,
        `${firstName}||`,
      ].map((k) => k.toLowerCase());
      let cached = null;
      let hitKey = null;
      if (statsCache) {
        for (const k of cacheKeys) {
          if (statsCache[k]) { cached = statsCache[k]; hitKey = k; break; }
        }
      }
      const useCache = cached != null;
      // 0.9.426: log lookup outcome ONCE per char per
      // session — sampled to avoid log spam on every
      // re-render. Keyed off firstName so each char
      // logs only once.
      if (typeof window !== "undefined") {
        window.__statsCacheLogged ||= new Set();
        if (!window.__statsCacheLogged.has(firstName)) {
          window.__statsCacheLogged.add(firstName);
          if (useCache) {
            console.log(`[stats-cache] HIT ${firstName}|${g.faction || ""} via "${hitKey}" → ${cached.command}/${cached.influence}/${cached.management}/${cached.loyalty}`);
          } else if (statsCache && Object.keys(statsCache).length > 0) {
            console.log(`[stats-cache] MISS ${firstName}|${g.faction || ""} (tried ${cacheKeys.length} key variants: ${cacheKeys.map(k => `"${k}"`).join(", ")}). Cache size: ${Object.keys(statsCache).length}.`);
          }
        }
      }
      return {
        firstName,
        lastName,
        age,
        isLeader: tags.includes("leader"),
        isHeir: tags.includes("heir"),
        gender: null,
        isDead: false,
        faction: g.faction || null,
        traits,
        ancillaries: ancRaw.map((a) => (typeof a === "string" ? { name: a } : a)),
        command: useCache ? cached.command : pickStat("command"),
        influence: useCache ? cached.influence : pickStat("influence"),
        management: useCache ? cached.management : pickStat("management"),
        loyalty: useCache ? cached.loyalty : null,
        subterfuge: useCache ? null : pickStat("subterfuge"),
        // Estimate marker only when no cache hit AND
        // the value comes from trait summing.
        _statsEstimated: !useCache && (rt && rt._statsEstimated) || false,
        _statsCached: useCache,
        _source: "starting",
      };
    };
    const localMapped = real.map(mapToChar);
    // Inverse: pull in chars from OTHER bundled
    // regions whose live position resolved here
    // (same as the live path's incoming pass).
    const alreadyInLocal = new Set();
    for (const c of localMapped) {
      const k = (c.firstName + " " + (c.lastName || "").replace(/_/g, " ")).toLowerCase().trim();
      alreadyInLocal.add(k);
    }
    const incomingStart = [];
    for (const [region, regData] of Object.entries(startingArmiesByRegion || {})) {
      if (region === r.region) continue;
      const all = [...(regData.garrison || []), ...(regData.field || [])];
      for (const g of all) {
        const nm = (g.character || "").toLowerCase();
        if (!nm || nm.startsWith("garrison of") || nm === "biggus dickus") continue;
        const parts = (g.character || "").split(/\s+/);
        const fullName = (parts[0] + " " + parts.slice(1).join(" ")).toLowerCase().trim();
        if (alreadyInLocal.has(fullName)) continue;
        if (liveRegionByCharName.get(fullName) !== r.region) continue;
        incomingStart.push(mapToChar(g));
        alreadyInLocal.add(fullName);
      }
    }
    return [...localMapped, ...incomingStart];
  }
  // Referencing liveCharPositionsVersion forces this
  // IIFE to re-evaluate after death events / assault
  // wipes flip the filter state.
  void liveCharPositionsVersion;
  // Don't bail out when the region has no save-time
  // chars — incoming chars (moved INTO the region
  // via live log / settlement-tile re-bucketing)
  // still need a chance to populate the list. The
  // user reported empty Characters row in Uria
  // after conquest because the original Messapian
  // governors were gone and the early-exit fired
  // before Aulus could be added via the incoming
  // pass.
  const list = saveCharactersByRegion[r.region] || [];
  // Build a primary-uuid → char lookup across ALL
  // regions so children of a character in this
  // region can be resolved by name even when the
  // child is governing a different settlement.
  // Save-cracker session 13: child slots store
  // primary uuids of the children.
  const byPrimary = new Map();
  for (const arr of Object.values(saveCharactersByRegion)) {
    for (const c of arr) {
      if (c.primaryUuid) byPrimary.set(c.primaryUuid, c);
    }
  }
  // Resolve each character's children to names.
  // Unresolvable uuids (dead child whose slot is
  // preserved, or character not parsed) are dropped.
  const enriched = list.map((c) => {
    if (!Array.isArray(c.childUuids) || c.childUuids.length === 0) return c;
    const childNames = [];
    for (const u of c.childUuids) {
      const ch = byPrimary.get(u);
      if (ch) {
        const nm = ch.lastName
          ? `${ch.firstName} ${ch.lastName.replace(/_/g, " ")}`
          : ch.firstName;
        childNames.push(nm);
      }
    }
    return childNames.length > 0 ? { ...c, _resolvedChildren: childNames } : c;
  });
  const deadUuids = liveDeadCharUuids.current;
  const wiped = liveAssaultWipedSettlements.current;
  const filtered = enriched.filter((c) => {
    if (c.secondaryUuid && deadUuids.has(c.secondaryUuid.toString(16).padStart(8, "0"))) return false;
    // Drop chars whose bodyguard is inside a wiped
    // settlement. Find a unit they command in
    // saveUnitsByRegion and check its region tag
    // against the assault-wipe list. Skip the
    // check if no wipes are active (the common case).
    if (wiped.size > 0 && c.secondaryUuid && saveUnitsByRegion) {
      for (const units of Object.values(saveUnitsByRegion)) {
        for (const u of units) {
          if (u.commanderUuid === c.secondaryUuid && u.region && wiped.has(u.region.toLowerCase())) return false;
        }
      }
    }
    // Drop chars whose live-log position has moved
    // them to a different region — same filter as
    // the non-live path above.
    if (isMovedAway(c.firstName, c.lastName)) return false;
    return true;
  });
  // Inverse: ADD chars from OTHER regions whose live
  // position resolved to r.region. After a merge,
  // Marcus moves from Metapontion to Aulus's tile in
  // Taras — the live filter drops him from
  // Metapontion, but saveCharactersByRegion["Taras"]
  // still doesn't list him (the save hasn't caught
  // up). Pull him in here via liveRegionByCharName.
  const alreadyIn = new Set();
  for (const c of filtered) {
    if (c.firstName) {
      const k = (c.firstName + " " + (c.lastName || "").replace(/_/g, " ")).toLowerCase().trim();
      alreadyIn.add(k);
    }
  }
  const incoming = [];
  for (const [region, arr] of Object.entries(saveCharactersByRegion)) {
    if (region === r.region) continue;
    for (const c of arr) {
      if (!c.firstName) continue;
      const fullName = (c.firstName + " " + (c.lastName || "").replace(/_/g, " ")).toLowerCase().trim();
      const birthName = c.originalLastName
        ? (c.firstName + " " + c.originalLastName.replace(/_/g, " ")).toLowerCase().trim()
        : null;
      if (alreadyIn.has(fullName)) continue;
      const liveRegion = liveRegionByCharName.get(fullName)
        || (birthName ? liveRegionByCharName.get(birthName) : null);
      if (liveRegion !== r.region) continue;
      // Dead/wiped filter — same as above.
      if (c.secondaryUuid && deadUuids.has(c.secondaryUuid.toString(16).padStart(8, "0"))) continue;
      // Enrich with children resolution (same shape).
      let enrichedChar = c;
      if (Array.isArray(c.childUuids) && c.childUuids.length > 0) {
        const childNames = [];
        for (const u of c.childUuids) {
          const ch = byPrimary.get(u);
          if (ch) {
            const nm = ch.lastName ? `${ch.firstName} ${ch.lastName.replace(/_/g, " ")}` : ch.firstName;
            childNames.push(nm);
          }
        }
        if (childNames.length > 0) enrichedChar = { ...c, _resolvedChildren: childNames };
      }
      incoming.push(enrichedChar);
      alreadyIn.add(fullName);
    }
  }
  const combined = [...filtered, ...incoming];
  return combined.length > 0 ? combined : null;
}

export function deriveFieldArmies(ctx) {
  const { lockedRegionInfo, regionInfo, liveLogActive, saveUnitsByRegion, liveUnitsByRegion, startingArmiesByRegion, cityPixels, regions, imgSize, saveCharactersByRegion, mergedPairsBySecondary, currentOwnerByCity, initialOwnerByCity, saveGovernorByCity, armiesToRender, pendingArmyUnits, appliedArmyUnits, unitOwnership, factionCultures, activeDataDir, bumpIconCacheVersionCoalesced } = ctx;
  // Live mode: use commander coords (extracted from
  // the save's world-object records) to classify each
  // army as garrison (on settlement tile), player's
  // own field army, or foreign. Falls back to EDU-
  // ownership heuristic when coords aren't available.
  // If live mode is on but live data hasn't loaded
  // yet, fall through to the non-live path so the
  // panel never looks empty during save-parse.
  const liveDataReady = saveUnitsByRegion && Object.keys(saveUnitsByRegion).length > 0;
  if (liveLogActive && liveDataReady) {
    const r = lockedRegionInfo || regionInfo;
    if (!r) return null;
    // Same liveUnitsByRegion path as the Garrison
    // panel — armies that moved mid-turn show up
    // here under the destination region instead of
    // their stale save-time region.
    const raw = liveUnitsByRegion?.[r.region];
    if (!raw || raw.length === 0) return null;
    const ownerId = (
      (currentOwnerByCity && currentOwnerByCity[r.city])
      || (initialOwnerByCity && initialOwnerByCity[r.city])
      || r.faction
      || ""
    ).toLowerCase();
    const culture = factionCultures?.[ownerId] || null;
    let settlementTile = startingArmiesByRegion?.[r.region]?.settlement || null;
    if (!settlementTile && cityPixels && cityPixels.length) {
      const cp = cityPixels.find(p => regions[p.rgbKey]?.region === r.region);
      if (cp) settlementTile = { x: cp.x, y: cp.y };
    }
    const byCmd = new Map();
    for (const u of raw) {
      // Group by inferredCmd (sequential-grouping pass
      // from main.js) so non-bodyguard units follow
      // their stack's bodyguard rather than all
      // falling into the cmd=0 garrison bucket.
      // Fall back to raw commanderUuid if inference
      // is absent (e.g. old save payload).
      const key = u.inferredCmd || u.commanderUuid || 0;
      if (!byCmd.has(key)) byCmd.set(key, []);
      byCmd.get(key).push(u);
    }
    // Build uuid → character info (from save) for
    // position and name lookup.
    const charByUuid = new Map();
    for (const list of Object.values(saveCharactersByRegion || {})) {
      for (const c of list) {
        if (c.secondaryUuid) charByUuid.set(c.secondaryUuid, c);
      }
    }
    const ownerFactionOfUnits = (units) => {
      if (!unitOwnership) return null;
      for (const u of units) {
        const o = unitOwnership[u.name];
        if (o && (o.includes("all") || (ownerId && o.includes(ownerId)) || (culture && o.includes(culture)))) return "own";
      }
      for (const u of units) {
        const o = unitOwnership[u.name];
        if (o) return o.find((f) => f !== "slave" && f !== "mercs") || o[0];
      }
      return null;
    };
    // Merge unidentified commander groups into one
    // "Unknown armies" bucket per faction — cleaner
    // than dozens of "Army #XXX" single-unit entries
    // when the save parser's character coverage is
    // incomplete.
    // The settlement's governor commands the
    // garrison stack — those units now appear in the
    // Garrison panel above. Skip the governor's group
    // here so it doesn't also appear in "Region
    // owners armies".
    const governorUuidForFA = (saveGovernorByCity && r.city && saveGovernorByCity[r.city] && !saveGovernorByCity[r.city].unresolved)
      ? saveGovernorByCity[r.city].uuid
      : null;
    // Same settlement-tile garrison promotion as the
    // Garrison panel above — symmetrically skip
    // commanders that ARE the garrison (own-faction
    // stack on the settlement tile) so they don't
    // double-list. Besiegers (foreign faction
    // standing on or near the tile) are NOT
    // garrison; they belong in this panel.
    let settlementTileFA = startingArmiesByRegion?.[r.region]?.settlement || null;
    if (!settlementTileFA && cityPixels && cityPixels.length) {
      const cp = cityPixels.find(p => regions[p.rgbKey]?.region === r.region);
      if (cp) settlementTileFA = { x: cp.x, y: (imgSize.height - 1) - cp.y };
    }
    const cmdsAtSettlementFA = new Set();
    if (settlementTileFA) {
      for (const a of (armiesToRender || [])) {
        if (!a.commanderUuid) continue;
        if (a.x !== settlementTileFA.x || a.y !== settlementTileFA.y) continue;
        // Faction guard: only OWN-faction stacks on
        // the tile count as garrison and get
        // skipped here.
        // See Garrison panel: only gate save-derived
        // on-tile stacks by faction when the position is
        // live-attributed (possible besieger mis-snap).
        if (a.liveTracked && ownerId && a.faction && a.faction.toLowerCase() !== ownerId.toLowerCase()) continue;
        cmdsAtSettlementFA.add(a.commanderUuid);
      }
    }
    const mergedOwn = []; // identified own-faction armies
    const mergedOthers = []; // identified foreign armies
    const unknownByFaction = new Map(); // fac → units[]
    // commanderUuid → "x,y" tile, for merging multi-general
    // stacks. RTW armies hold up to 20 units, any number
    // of which can be general units; when Marcus is
    // transferred into Aulus's stack mid-turn, the save
    // still records two separate cmd-grouped unit lists
    // (the bodyguard unit's `cmd` field stays = Marcus's
    // own char uuid). They share a tile, so merge by
    // (faction, x, y).
    const cmdPos = new Map();
    const cmdLive = new Map(); // commanderUuid → bool (liveTracked or logOnly)
    for (const a of (armiesToRender || [])) {
      if (a.commanderUuid && typeof a.x === "number" && typeof a.y === "number") {
        cmdPos.set(a.commanderUuid, `${a.x},${a.y}`);
        cmdLive.set(a.commanderUuid, !!(a.liveTracked || a.logOnly));
      }
    }
    for (const [cmd, units] of byCmd) {
      if (!cmd) continue; // commander-less = Garrison panel
      if (governorUuidForFA && cmd === governorUuidForFA) continue; // governor stack handled by Garrison panel
      if (cmdsAtSettlementFA.has(cmd)) continue; // settlement-tile stack handled by Garrison panel
      const commander = charByUuid.get(cmd);
      // Every commanded army shows in the field-armies
      // panel (named or aggregated). The previous
      // "commander on settlement tile = garrison"
      // shortcut required exact-pixel x/y match against
      // a settlement tile we can't always resolve, and
      // hid governor armies the user expected to see.
      // Garrison panel now strictly = commander-LESS
      // defenders; everything with a commander is here.
      // Prefer the commander's actual faction (from
      // the save's character record) over guessing
      // from unit ownership. Parmenion's hoplites can
      // be recruited by greek_cities, but Parmenion
      // himself is macedon — use macedon for him.
      const commanderFaction = commander?.faction || null;
      const factionGuess = commanderFaction || ownerFactionOfUnits(units);
      const isOwnFieldArmy = commanderFaction
        ? commanderFaction === ownerId
        : factionGuess === "own";
      const fac = isOwnFieldArmy ? ownerId : (commanderFaction || factionGuess || "");
      const entry = {
        character: commander ? displayFullName(commander.firstName, commander.lastName) : null,
        faction: fac,
        _units: units,
        _pos: cmdPos.get(cmd) || null,
        _live: cmdLive.get(cmd) || false,
        _secondary: cmd, // the commanderUuid itself, used by mergeByTile's flow-event matching
      };
      if (!commander) {
        // Aggregate unknown commanders by faction so
        // Parmenion-in-hostile-region doesn't render
        // as 10 separate one-unit "armies".
        const key = (isOwnFieldArmy ? "__own__" : fac) || "__unknown__";
        if (!unknownByFaction.has(key)) unknownByFaction.set(key, { fac, isOwn: isOwnFieldArmy, units: [] });
        unknownByFaction.get(key).units.push(...units);
        continue;
      }
      (isOwnFieldArmy ? mergedOwn : mergedOthers).push(entry);
    }
    for (const { fac, isOwn, units } of unknownByFaction.values()) {
      (isOwn ? mergedOwn : mergedOthers).push({
        character: "(unidentified army)",
        faction: fac,
        _units: units,
        _pos: null,
      });
    }
    // Post-pass: merge entries that share (faction, tile).
    // RTW lets up to 20 units (any number generals) live
    // in a single army. When two named generals end up
    // on the same tile after a mid-turn unit-transfer,
    // they're really one combined stack — show them as
    // one block with both names instead of two markers
    // stacked at the same coords.
    const mergeByTile = (list) => {
      // Iterate entries; for each, compute its merge
      // key from (faction, target-secondary-uuid):
      //   - If the entry's commander has been merged
      //     INTO another army (per the live log's
      //     transfer events), use the target's
      //     secondary uuid as the merge key.
      //   - Else if the entry's own commander IS a
      //     known target (someone has merged INTO
      //     them), still use their own uuid as the
      //     key so donors aggregate to them.
      //   - Otherwise fall back to exact coords.
      const allTargets = new Set(mergedPairsBySecondary.values());
      const out = [];
      const idx = new Map();
      for (const e of list) {
        const mergedInto = e._secondary ? mergedPairsBySecondary.get(e._secondary) : null;
        let mergeKey;
        if (mergedInto) {
          mergeKey = (e.faction || "") + "@target:" + mergedInto;
        } else if (e._secondary && allTargets.has(e._secondary)) {
          mergeKey = (e.faction || "") + "@target:" + e._secondary;
        } else if (e._pos) {
          mergeKey = (e.faction || "") + "@pos:" + e._pos;
        } else {
          out.push({ ...e, _characters: [e.character] });
          continue;
        }
        const hit = idx.get(mergeKey);
        if (hit == null) {
          idx.set(mergeKey, out.length);
          out.push({ ...e, _characters: [e.character] });
        } else {
          const target = out[hit];
          target._units = target._units.concat(e._units);
          target._characters.push(e.character);
        }
      }
      for (const e of out) {
        if (e._characters && e._characters.length > 1) {
          e.character = e._characters.filter(Boolean).join(" + ");
        }
        delete e._characters;
        delete e._live;
        delete e._secondary;
      }
      return out;
    };
    const mergedOwnFinal = mergeByTile(mergedOwn);
    const mergedOthersFinal = mergeByTile(mergedOthers);
    const dictMap = unitOwnership?.__dictionary || {};
    // Same starting-values fallback as the garrison path
    // — save format doesn't carry exp/armour/weapon, so
    // we seed from descr_strat's turn-0 values matched
    // by unit name within the region.
    const fieldStartingByName = new Map();
    for (const a of (startingArmiesByRegion?.[r.region]?.field || [])) {
      for (const u of a.units || []) {
        if (!fieldStartingByName.has(u.name)) fieldStartingByName.set(u.name, []);
        fieldStartingByName.get(u.name).push(u);
      }
    }
    const buildEntry = (e) => {
      // Sort: bodyguard units (real commanderUuid)
      // first, foot last. After a merge like
      // Marcus + Aulus, both bodyguards must lead
      // the roster — not get scattered by file order.
      const sortedUnits = e._units.slice().sort((u1, u2) => {
        const bg1 = u1.commanderUuid ? 0 : 1;
        const bg2 = u2.commanderUuid ? 0 : 1;
        return bg1 - bg2;
      });
      prefetchUnitIcons(activeDataDir, sortedUnits.map((u) => [e.faction, u.name, dictMap[u.name]]), bumpIconCacheVersionCoalesced);
      // 0.9.651: surface (x, y) for the field-army edit
      // selector / pendingArmyUnits keying. _pos came from
      // cmdPos and survived mergeByTile; split it back
      // into numeric coords for RegionInfo.
      let posX = null, posY = null;
      if (e._pos && typeof e._pos === "string") {
        const [px, py] = e._pos.split(",");
        const nx = Number(px), ny = Number(py);
        if (Number.isFinite(nx) && Number.isFinite(ny)) { posX = nx; posY = ny; }
      }
      return {
        character: e.character,
        faction: e.faction,
        x: posX,
        y: posY,
        units: sortedUnits.map((u) => {
          const queue = fieldStartingByName.get(u.name);
          const seed = queue && queue.length ? queue.shift() : null;
          // Prefer live XP / weapon / armour from the
          // save (save-cracker session 10). Fall back
          // to descr_strat starting seed only when the
          // save value is 0/missing.
          return {
            unit: u.name,
            xp: u.xp || seed?.exp || 0,
            armour: u.armour || seed?.armour || 0,
            weapon: u.weapon || seed?.weapon || 0,
            // Combined smithy weapon/armor upgrade level
            // (unitParser H+17). Live save value only —
            // descr_strat seeds have no per-instance
            // upgrade, so null when the save lacks it.
            upgradeLevel: typeof u.upgradeLevel === "number" ? u.upgradeLevel : null,
            soldiers: typeof u.soldiers === "number" ? u.soldiers : null,
            max: typeof u.maxSoldiers === "number" ? u.maxSoldiers : null,
            faction: e.faction,
            icon: e.faction ? getCachedUnitIcon(activeDataDir, e.faction, u.name) : null,
            commanderUuid: u.commanderUuid || null,
          };
        }),
      };
    };
    const own = mergedOwnFinal.map(buildEntry);
    const others = mergedOthersFinal.map(buildEntry);
    // 0.9.651: live-merge pendingArmyUnits for each field
    // army (same idea as the garrison prop). If the user
    // has staged adds/removes for an army at (faction,
    // x, y), replace its units with the pending list so
    // recruit-clicks and × removes show up immediately
    // — not just after Save to Mod.
    const mergeFieldPending = (army) => {
      if (!army || army.x == null || army.y == null || !army.faction) return army;
      const key = `${String(army.faction).toLowerCase()}|c:${army.x},${army.y}`;
      // 0.9.657: pending first, then applied (already-saved overlay).
      const pending = pendingArmyUnits.get(key) || appliedArmyUnits.get(key);
      if (!pending) return army;
      // Prefetch icons for the STAGED units — including ones
      // ADDED via the recruitable panel that the original
      // buildEntry prefetch never saw — so edited armies don't
      // show blank cards (0.9.881). Same dictMap as buildEntry.
      prefetchUnitIcons(activeDataDir, (pending.units || []).map((u) => [army.faction, u.unit, dictMap[u.unit]]), bumpIconCacheVersionCoalesced);
      return {
        ...army,
        units: (pending.units || []).map((u) => ({
          unit: u.unit,
          xp: u.xp != null ? u.xp : (u.exp || 0),
          armour: u.armour || 0,
          weapon: u.weapon != null ? u.weapon : (u.weapon_lvl || 0),
          faction: army.faction,
          icon: army.faction ? getCachedUnitIcon(activeDataDir, army.faction, u.unit) : null,
          // 0.9.856: preserve the bodyguard-swap tags so a
          // general's face card survives editing (was dropped
          // → reverted to the plain bodyguard icon).
          commanderUuid: u.commanderUuid || null,
          commanderName: u.commanderName || null,
          commanderLastName: u.commanderLastName || null,
          commanderFaction: u.commanderFaction || null,
        })),
      };
    };
    const ownMerged = own.map(mergeFieldPending);
    const othersMerged = others.map(mergeFieldPending);
    if (ownMerged.length === 0 && othersMerged.length === 0) return null;
    return { own: ownMerged, others: othersMerged };
  }
  const r = lockedRegionInfo || regionInfo;
  if (!r) return null;
  const regData = startingArmiesByRegion?.[r.region];
  const armies = regData?.field || [];
  if (armies.length === 0) return null;
  const ownerFaction = (
    (currentOwnerByCity && currentOwnerByCity[r.city])
    || (initialOwnerByCity && initialOwnerByCity[r.city])
    || r.faction
    || ""
  ).toLowerCase();
  // Use each army's OWN faction for unit card lookup —
  // a Macedon character standing in a Parthian region
  // still has Macedonian units; their cards live under
  // ui/units/macedon/, not ui/units/parthia/.
  const triples = [];
  const dictMap = unitOwnership?.__dictionary || {};
  for (const a of armies) {
    const fac = (a.faction || "").toLowerCase();
    for (const u of a.units || []) if (fac) triples.push([fac, u.name, dictMap[u.name]]);
  }
  if (triples.length) prefetchUnitIcons(activeDataDir, triples, bumpIconCacheVersionCoalesced);
  const own = [];
  const others = [];
  for (const a of armies) {
    const fac = (a.faction || "").toLowerCase();
    // 0.9.429: tag the first unit of each army with
    // commanderName so RegionInfo's bodyguard-swap path
    // can render the general's face card in non-live
    // mode. Live mode uses unit.commanderUuid (from the
    // save); non-live falls back to commanderName +
    // statsCache lookup.
    const cmdParts = a.character ? String(a.character).split(/\s+/) : [];
    const cmdFirstName = cmdParts[0] || null;
    const cmdLastName = cmdParts.slice(1).join(" ") || null;
    const entry = {
      // 0.9.431: display-form name for the army label
      // (AntigonosB → Antigonos II). Live path goes
      // through saveCharactersByRegion which is
      // already display-converted at the build site.
      character: cmdFirstName ? displayFullName(cmdFirstName, cmdLastName) : a.character,
      faction: fac,
      // 0.9.651: descr_strat tile coords for field-army
      // edit selection (pendingArmyUnits keyed by x,y).
      x: typeof a.x === "number" ? a.x : null,
      y: typeof a.y === "number" ? a.y : null,
      units: (a.units || []).map((u, ui) => ({
        unit: u.name, xp: u.exp || 0,
        armour: u.armour || 0, weapon: u.weapon || 0,
        faction: fac || null,
        icon: fac ? getCachedUnitIcon(activeDataDir, fac, u.name) : null,
        commanderName: ui === 0 && cmdFirstName ? cmdFirstName : null,
        // 0.9.778: tag surname too so the non-live resolver
        // keys statsCache by the FULL name (matches the
        // family tree; disambiguates same-firstName generals).
        commanderLastName: ui === 0 && cmdFirstName ? cmdLastName : null,
        commanderFaction: ui === 0 && cmdFirstName ? fac : null,
      })),
    };
    (fac && ownerFaction && fac === ownerFaction ? own : others).push(entry);
  }
  // 0.9.651: live-merge pendingArmyUnits for each field
  // army (descr_strat fallback path — mirrors the live
  // path's behaviour). Recruit-clicks / × removes show
  // up immediately, not just after Save to Mod.
  const mergeFieldPending = (army) => {
    if (!army || army.x == null || army.y == null || !army.faction) return army;
    const key = `${String(army.faction).toLowerCase()}|c:${army.x},${army.y}`;
    // 0.9.657: pending first, then applied (already-saved overlay).
    const pending = pendingArmyUnits.get(key) || appliedArmyUnits.get(key);
    if (!pending) return army;
    // Prefetch icons for the STAGED units — including ones ADDED
    // via the recruitable panel the original prefetch never saw —
    // so edited armies don't show blank cards (0.9.881).
    prefetchUnitIcons(activeDataDir, (pending.units || []).map((u) => [army.faction, u.unit, dictMap[u.unit]]), bumpIconCacheVersionCoalesced);
    return {
      ...army,
      units: (pending.units || []).map((u) => ({
        unit: u.unit,
        xp: u.xp != null ? u.xp : (u.exp || 0),
        armour: u.armour || 0,
        weapon: u.weapon != null ? u.weapon : (u.weapon_lvl || 0),
        faction: army.faction || null,
        icon: army.faction ? getCachedUnitIcon(activeDataDir, army.faction, u.unit) : null,
        // 0.9.856: preserve the bodyguard-swap tags from the
        // staged unit so the general's face card survives
        // add/remove/duplicate/reorder. Previously these were
        // nulled, so any edit reverted the general to the
        // plain bodyguard icon. The original units carry
        // commanderName (non-live) / commanderUuid (live);
        // edits keep them on the same object.
        commanderUuid: u.commanderUuid || null,
        commanderName: u.commanderName || null,
        commanderLastName: u.commanderLastName || null,
        commanderFaction: u.commanderFaction || null,
      })),
    };
  };
  return { own: own.map(mergeFieldPending), others: others.map(mergeFieldPending) };
}

export function deriveRecruitable(ctx) {
  const { lockedRegionInfo, regionInfo, buildingRecruits, buildingLevelsLookup, unitOwnership, resourcesData, currentOwnerByCity, initialOwnerByCity, factionCultures, activeDataDir, getBuildings, bumpIconCacheVersionCoalesced } = ctx;
  // Compute the union of recruit entries the city can
  // currently train. RTW building chains are cumulative:
  // owning level N satisfies the requirements for all
  // levels 0..N in the same chain (army_barracks lets
  // you train hastati/principes/triarii because the
  // lower militia/city levels are implicitly still
  // present). We therefore walk every level UP TO AND
  // INCLUDING the current one in each built chain.
  const r = lockedRegionInfo || regionInfo;
  if (!r || !buildingRecruits) return null;
  let builtList = null;
  try { builtList = getBuildings(r, true); } catch {}
  if (!builtList || builtList.length === 0) return null;
  const ownerId = (
    (currentOwnerByCity && currentOwnerByCity[r.city])
    || (initialOwnerByCity && initialOwnerByCity[r.city])
    || r.faction
    || ""
  ).toLowerCase();
  const culture = factionCultures?.[ownerId] || null;
  // Region strategic resources — elephant units require
  // `resource elephants`; without this gate they'd appear
  // in every region. Same set used by the AOR roster.
  const recruitResourceList = (resourcesData && (resourcesData[r.region] || resourcesData[r.city])) || [];
  const regionResourceSet = new Set(recruitResourceList.map(x => String(x.type || "").toLowerCase()).filter(Boolean));
  const seen = new Set();
  const result = [];
  // unit name → Set of chain types that expose it.
  const gatedByMap = {};
  // unit name → Set of hidden_resource names that gate it.
  // Captured from positive `hidden_resource X` clauses in
  // recruit rules. Lets RegionInfo light up recruits when
  // the user hovers an HR chip in the tags row.
  const hrGatesMap = {};
  // upgrade-only unit name → [{chain, level}, ...]
  const upgradeRequiresMap = {};
  // Units added during the first (building-gated) pass —
  // these are CURRENTLY recruitable. Second pass adds
  // upgrade-only candidates without touching this set.
  const availableSet = new Set();
  for (const b of builtList) {
    const lvls = buildingRecruits[b.type];
    if (!lvls) continue;
    // Levels in EDB order (low → high tier). buildingLevelsLookup
    // is keyed by chain name. Trim to <= current level.
    const allLevels = (buildingLevelsLookup && buildingLevelsLookup[b.type]) || null;
    let levelsToCheck;
    if (allLevels && allLevels.length > 0) {
      const idx = allLevels.indexOf(b.level);
      if (idx >= 0) {
        levelsToCheck = allLevels.slice(0, idx + 1);
      } else {
        // Current level not found in the ordered list —
        // fall back to whatever the level happens to be.
        levelsToCheck = [b.level];
      }
    } else {
      levelsToCheck = [b.level];
    }
    for (const lvl of levelsToCheck) {
      const recs = lvls[lvl];
      if (!recs) continue;
      for (const rec of recs) {
        // EDB recruit-level faction filter. RIS uses
        // `factions { all, }` as a wildcard (every
        // faction passes — narrowing happens via
        // hidden_resource / `not factions { ... }`).
        // Without the wildcard handling, AOR recruits
        // (which dominate Seleucid's recruit pool)
        // get rejected and many provinces show empty.
        if (rec.factions && rec.factions.length > 0 && ownerId
            && !rec.factions.includes("all")
            && !rec.factions.includes(ownerId)
            && !rec.factions.includes(culture)) continue;
        if (rec.requires) {
          // Drop event-gated recruits where the player
          // needs to TRIGGER a reform — but only the
          // positive form (`major_event "X"`). The
          // negative form (`not major_event "X"`) means
          // "available BEFORE reform" — that's what
          // gates pre-Marian Roman troops, dropping
          // them was leaving Rome with only AOR units.
          if (/(?<!\bnot\s)\bmajor_event\b/.test(rec.requires)) continue;
          // Drop AI-only recruit lines. Many chains
          // ship a `not is_player ... noisland` variant
          // that hands the AI free units regardless of
          // building progression. RIS Rorarii had 6+
          // such lines; without filtering they showed
          // up in every Roman city's recruit list.
          if (/\bnot\s+is_player\b/.test(rec.requires)) continue;
          // Negative faction filter.
          if (/\bnot\s+factions\b/.test(rec.requires)) {
            const nm = rec.requires.match(/not\s+factions\s*\{\s*([^}]*)\}/);
            if (nm) {
              const excluded = nm[1].split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
              if (ownerId && excluded.includes(ownerId)) continue;
              if (culture && excluded.includes(culture)) continue;
            }
          }
          // hidden_resource <X> / not hidden_resource <Y>
          // — evaluate against the region's tag list
          // from descr_regions. Hidden resources are
          // stored as plain tokens in the comma-separated
          // tag list (e.g. "italic", "sicel", "merc_center").
          // Without this Roman recruits at Pisae were
          // dropped because every Roman recruit line has
          // `hidden_resource italic` AND that's a valid
          // requirement Pisae satisfies.
          {
            const tagSet = new Set(
              String(r.tags || "")
                .split(",")
                .map(s => s.trim().toLowerCase())
                .filter(Boolean)
            );
            const reqs = rec.requires;
            // First check NEGATIVE requirements so we
            // reject before validating positives.
            const negRe = /\bnot\s+hidden_resource\s+(\S+)/g;
            let neg, hrOk = true;
            while ((neg = negRe.exec(reqs)) !== null) {
              if (tagSet.has(neg[1].toLowerCase())) { hrOk = false; break; }
            }
            if (!hrOk) continue;
            // Positive requirements: every `hidden_resource X`
            // (NOT preceded by `not`) must be in the tag set.
            // Strip the negative clauses from the search
            // so the regex doesn't match them.
            const positives = reqs.replace(/\bnot\s+hidden_resource\s+\S+/g, "");
            const posRe = /\bhidden_resource\s+(\S+)/g;
            let pos;
            while ((pos = posRe.exec(positives)) !== null) {
              if (!tagSet.has(pos[1].toLowerCase())) { hrOk = false; break; }
            }
            if (!hrOk) continue;
          }
          // Strategic-resource gate (e.g. elephant units
          // need `resource elephants` present in the region).
          if (!resourceReqAllows(rec.requires, regionResourceSet)) continue;
          // Building / tier requirements. Two flavours:
          //   - Tier aliases (mic_tier_2, gov_tier_3, colony_tier_1, culture_tier_2)
          //     expand to one or more building_present_min_level clauses (OR-joined).
          //   - Direct `building_present_min_level <chain> <level>` clauses.
          // Both can be negated with `not`. Negation flips the satisfied check.
          const aliasMap = buildingRecruits.__aliases || {};
          // hasMinLevel(chain, level): does builtList satisfy this clause?
          const hasMinLevel = (chain, level) => {
            const built = builtList.find(b => b.type === chain);
            if (!built) return false;
            // Bare `building_present X` clauses (captured
            // from aliases / direct requires with no
            // level) — any built level satisfies.
            if (level == null) return true;
            const order = (buildingLevelsLookup && buildingLevelsLookup[chain]) || null;
            if (!order) return built.level === level;
            const haveIdx = order.indexOf(built.level);
            const needIdx = order.indexOf(level);
            return haveIdx >= 0 && needIdx >= 0 && haveIdx >= needIdx;
          };
          const evalTierAlias = (tok) => {
            const branches = aliasMap[tok];
            if (!branches) return false; // unknown alias — treat as unsatisfied
            return branches.some(({ chain, level }) => hasMinLevel(chain, level));
          };
          let ok = true;
          // 1) Tier aliases. Walk the requires string and capture each token
          //    along with whether it's preceded by `not`.
          {
            const re = /(\bnot\s+)?\b(mic_tier|gov_tier|colony_tier|culture_tier)_\d+\b/g;
            let m;
            while ((m = re.exec(rec.requires)) !== null) {
              const negated = !!m[1];
              const tok = m[0].replace(/^not\s+/, "");
              const sat = evalTierAlias(tok);
              if (negated ? sat : !sat) { ok = false; break; }
            }
          }
          if (!ok) continue;
          // 2) Direct building_present_min_level clauses (with optional `not`).
          {
            const re = /(\bnot\s+)?\bbuilding_present_min_level\s+(\S+)\s+(\S+)/g;
            let m;
            while ((m = re.exec(rec.requires)) !== null) {
              const negated = !!m[1];
              const sat = hasMinLevel(m[2], m[3]);
              if (negated ? sat : !sat) { ok = false; break; }
            }
          }
          if (!ok) continue;
          // 3) Bare `building_present <chain>` (no level) — chain at any
          //    built level satisfies. The `(?!_min_level)` negative
          //    lookahead avoids re-matching `building_present_min_level`.
          //    Skip the `queued` modifier (refers to build queue, not
          //    built buildings — we have no queue data).
          {
            const re = /(\bnot\s+)?\bbuilding_present(?!_min_level)\s+(\S+)(?:\s+(\w+))?/g;
            let m;
            while ((m = re.exec(rec.requires)) !== null) {
              if (m[3] === "queued") continue;
              const negated = !!m[1];
              const sat = hasMinLevel(m[2], null);
              if (negated ? sat : !sat) { ok = false; break; }
            }
          }
          if (!ok) continue;
        }
        // EDU ownership is the ground truth. RIS uses
        // `ownership all` for AOR units — treat as
        // wildcard, same as the EDB factions filter.
        if (unitOwnership) {
          const owners = unitOwnership[rec.unit];
          if (!owners) continue;
          if (ownerId
              && !owners.includes("all")
              && !owners.includes(ownerId)
              && !owners.includes(culture)) continue;
        }
        // Track which building chain gated this unit so
        // RegionInfo can cross-highlight on hover. A
        // unit can be reached via multiple chains (tier
        // aliases or duplicate recruit lines); merge
        // them into a Set per unit.
        if (!seen.has(rec.unit)) {
          seen.add(rec.unit);
          result.push(rec.unit);
        }
        availableSet.add(rec.unit);
        if (!gatedByMap[rec.unit]) gatedByMap[rec.unit] = new Set();
        gatedByMap[rec.unit].add(b.type);
        if (rec.requires) {
          if (!hrGatesMap[rec.unit]) hrGatesMap[rec.unit] = new Set();
          const positives = rec.requires.replace(/\bnot\s+hidden_resource\s+\S+/g, "");
          for (const pm of positives.matchAll(/\bhidden_resource\s+(\S+)/g)) {
            hrGatesMap[rec.unit].add(pm[1].toLowerCase());
          }
        }
      }
    }
  }
  // Second pass: every unit the region COULD recruit
  // if all building chains were upgraded to max — i.e.
  // skip the building-present and tier-alias filters,
  // but keep faction / hidden_resource / EDU ownership
  // / negative-faction / not-is-player / major_event
  // checks (these are not building-related). Used to
  // render "future" recruits faded after the
  // currently-available ones.
  const tagSetForPotential = new Set(
    String(r.tags || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
  );
  for (const chain of Object.keys(buildingRecruits)) {
    if (chain === "__aliases") continue;
    const lvls = buildingRecruits[chain];
    if (!lvls || typeof lvls !== "object") continue;
    for (const lvl of Object.keys(lvls)) {
      const recs = lvls[lvl];
      if (!recs) continue;
      for (const rec of recs) {
        if (rec.factions && rec.factions.length > 0 && ownerId
            && !rec.factions.includes("all")
            && !rec.factions.includes(ownerId)
            && !rec.factions.includes(culture)) continue;
        if (rec.requires) {
          if (/(?<!\bnot\s)\bmajor_event\b/.test(rec.requires) || /\bnot\s+is_player\b/.test(rec.requires)) continue;
          const negFm = rec.requires.match(/not\s+factions\s*\{\s*([^}]*)\}/);
          if (negFm) {
            const ex = negFm[1].split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
            if (ex.includes(ownerId) || ex.includes(culture)) continue;
          }
          let hrOk = true;
          for (const m of rec.requires.matchAll(/\bnot\s+hidden_resource\s+(\S+)/g)) {
            if (tagSetForPotential.has(m[1].toLowerCase())) { hrOk = false; break; }
          }
          if (!hrOk) continue;
          const positives = rec.requires.replace(/\bnot\s+hidden_resource\s+\S+/g, "");
          for (const m of positives.matchAll(/\bhidden_resource\s+(\S+)/g)) {
            if (!tagSetForPotential.has(m[1].toLowerCase())) { hrOk = false; break; }
          }
          if (!hrOk) continue;
        }
        // Strategic-resource gate (elephants need resource elephants).
        if (!resourceReqAllows(rec.requires, regionResourceSet)) continue;
        if (unitOwnership) {
          const owners = unitOwnership[rec.unit];
          if (!owners) continue;
          if (ownerId
              && !owners.includes("all")
              && !owners.includes(ownerId)
              && !owners.includes(culture)) continue;
        }
        if (!seen.has(rec.unit)) {
          seen.add(rec.unit);
          result.push(rec.unit);
        }
        if (!gatedByMap[rec.unit]) gatedByMap[rec.unit] = new Set();
        gatedByMap[rec.unit].add(chain);
        if (rec.requires) {
          if (!hrGatesMap[rec.unit]) hrGatesMap[rec.unit] = new Set();
          const positives = rec.requires.replace(/\bnot\s+hidden_resource\s+\S+/g, "");
          for (const pm of positives.matchAll(/\bhidden_resource\s+(\S+)/g)) {
            hrGatesMap[rec.unit].add(pm[1].toLowerCase());
          }
        }
        // For upgrade-only units, capture every (chain,
        // level) that would unlock them so we can show
        // the cheapest upgrade path in the tooltip.
        if (!availableSet.has(rec.unit)) {
          if (!upgradeRequiresMap[rec.unit]) upgradeRequiresMap[rec.unit] = [];
          upgradeRequiresMap[rec.unit].push({ chain, level: lvl });
        }
      }
    }
  }
  if (result.length === 0) return null;
  if (ownerId) {
    const dictMap = unitOwnership?.__dictionary || {};
    prefetchUnitIcons(activeDataDir, result.map((n) => [ownerId, n, dictMap[n]]), bumpIconCacheVersionCoalesced);
  }
  // Sort: currently-available first, then upgrade-only.
  result.sort((a, b) => {
    const aAvail = availableSet.has(a) ? 0 : 1;
    const bAvail = availableSet.has(b) ? 0 : 1;
    return aAvail - bAvail;
  });
  // Index of the built level within each chain's ladder
  // — used to compute the cheapest upgrade option.
  const builtChainIdx = {};
  for (const b of builtList) {
    const order = (buildingLevelsLookup && buildingLevelsLookup[b.type]) || null;
    builtChainIdx[b.type] = order ? order.indexOf(b.level) : 0;
  }
  const computeUpgradeHint = (unit) => {
    const opts = upgradeRequiresMap[unit];
    if (!opts || opts.length === 0) return null;
    // Score each (chain, level) by how many upgrades away
    // it is from the current build state. Lower = closer
    // to recruitable. If a chain isn't built at all the
    // cost is needIdx + 1 (one extra step to construct
    // the chain from scratch).
    const scored = opts.map(({ chain, level }) => {
      const order = (buildingLevelsLookup && buildingLevelsLookup[chain]) || null;
      const needIdx = order ? order.indexOf(level) : 0;
      const haveIdx = chain in builtChainIdx ? builtChainIdx[chain] : -1;
      const gap = haveIdx >= 0 ? (needIdx - haveIdx) : (needIdx + 1);
      return { chain, level, gap, alreadyBuilt: haveIdx >= 0 };
    }).sort((a, b) => a.gap - b.gap);
    const best = scored[0];
    const chainLabel = best.chain.replace(/_/g, " ");
    const levelLabel = best.level.replace(/_/g, " ");
    return best.alreadyBuilt
      ? `Upgrade ${chainLabel} → ${levelLabel}`
      : `Build ${levelLabel} (${chainLabel})`;
  };
  return result.map((name) => ({
    unit: name,
    faction: ownerId,
    icon: ownerId ? getCachedUnitIcon(activeDataDir, ownerId, name) : null,
    gatedBy: gatedByMap[name] ? [...gatedByMap[name]] : [],
    hrGates: hrGatesMap[name] ? [...hrGatesMap[name]] : [],
    available: availableSet.has(name),
    upgradeHint: !availableSet.has(name) ? computeUpgradeHint(name) : null,
  }));
}

export function deriveAorUnits(ctx) {
  const { colorMode, lockedRegionInfo, regionInfo, buildingRecruits, resourcesData, unitOwnership, currentOwnerByCity, initialOwnerByCity, activeDataDir, bumpIconCacheVersionCoalesced } = ctx;
  // AOR MODE ONLY: the FULL Area-of-Recruitment roster a
  // region's land enables — owner- and building-INDEPENDENT,
  // so the correct AOR units show no matter who holds it.
  // A unit qualifies if some `hidden_resource aor_X` it
  // requires is present in the region's tags (and no
  // `not hidden_resource` it lists is present). Faction
  // gating is NOT used to include/exclude — instead we
  // capture it as a per-unit note ("Carthage only", "all
  // except Achaea") so e.g. Achaian Hoplites still appear
  // under aor_achaian, flagged as unavailable to Achaea.
  if (colorMode !== "aor") return null;
  const r = lockedRegionInfo || regionInfo;
  if (!r || !buildingRecruits) return null;
  const tagSet = new Set(
    String(r.tags || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
  );
  // Region strategic resources (elephants, etc.) — elephant
  // units are gated on `resource elephants`, not an aor_ tag.
  const resourceList = (resourcesData && (resourcesData[r.region] || resourcesData[r.city])) || [];
  const resourceSet = new Set(resourceList.map(x => String(x.type || "").toLowerCase()).filter(Boolean));
  if (![...tagSet].some(t => t.startsWith("aor_")) && resourceSet.size === 0) return [];
  const byUnit = new Map(); // unit → {unit, aors:Set, only:Set, except:Set}
  for (const chain of Object.keys(buildingRecruits)) {
    if (chain === "__aliases") continue;
    const lvls = buildingRecruits[chain];
    if (!lvls || typeof lvls !== "object") continue;
    for (const lvl of Object.keys(lvls)) {
      const recs = lvls[lvl];
      if (!Array.isArray(recs)) continue;
      for (const rec of recs) {
        const reqs = rec.requires || "";
        if (!reqs) continue;
        // AI-only freebie lines duplicate the player line — skip.
        if (/\bnot\s+is_player\b/.test(reqs)) continue;
        // Positives only (strip negative hidden_resource / resource).
        const positives = reqs.replace(/\bnot\s+hidden_resource\s+\S+/g, "").replace(/\bnot\s+resource\s+\S+/g, "");
        const posAors = [];
        for (const m of positives.matchAll(/\bhidden_resource\s+(aor_\w+)/g)) posAors.push(m[1].toLowerCase());
        const posResources = [];
        for (const m of positives.matchAll(/\bresource\s+(\S+)/g)) posResources.push(m[1].toLowerCase());
        // AOR-zone line = gated by an aor_ hidden_resource OR a
        // strategic resource (e.g. elephants → resource elephants).
        if (posAors.length === 0 && posResources.length === 0) continue;
        // Every positive hidden_resource must be in the region.
        let ok = true;
        for (const m of positives.matchAll(/\bhidden_resource\s+(\S+)/g)) {
          if (!tagSet.has(m[1].toLowerCase())) { ok = false; break; }
        }
        if (!ok) continue;
        // Strategic-resource gates (resource / not resource).
        if (!resourceReqAllows(reqs, resourceSet)) continue;
        // No excluded hidden_resource may be present.
        for (const m of reqs.matchAll(/\bnot\s+hidden_resource\s+(\S+)/g)) {
          if (tagSet.has(m[1].toLowerCase())) { ok = false; break; }
        }
        if (!ok) continue;
        const matchedAors = posAors.filter(a => tagSet.has(a));
        const matchedResources = posResources.filter(rr => resourceSet.has(rr));
        const zones = [...matchedAors, ...matchedResources];
        if (zones.length === 0) continue;
        // Faction notes. `not factions {…}` → except; a
        // positive `factions {…}` without `all` → only.
        let only = null, except = null;
        const noNeg = reqs.replace(/\bnot\s+factions\s*\{[^}]*\}/g, "");
        const posF = noNeg.match(/\bfactions\s*\{\s*([^}]*)\}/);
        if (posF) {
          const ids = posF[1].split(/[,\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean).filter(x => x !== "all");
          if (ids.length) only = ids;
        }
        const negF = reqs.match(/\bnot\s+factions\s*\{\s*([^}]*)\}/);
        if (negF) {
          const ids = negF[1].split(/[,\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
          if (ids.length) except = ids;
        }
        let e = byUnit.get(rec.unit);
        if (!e) { e = { unit: rec.unit, aors: new Set(), only: new Set(), except: new Set() }; byUnit.set(rec.unit, e); }
        for (const a of zones) e.aors.add(a);
        if (only) for (const f of only) e.only.add(f);
        if (except) for (const f of except) e.except.add(f);
      }
    }
  }
  const names = [...byUnit.keys()];
  if (names.length === 0) return [];
  // Resolve unit-card icons exactly like the recruitable
  // grid so AOR cards look identical. AOR units are
  // `ownership all`; use the region owner for card art.
  const ownerId = (
    (currentOwnerByCity && currentOwnerByCity[r.city])
    || (initialOwnerByCity && initialOwnerByCity[r.city])
    || r.faction || ""
  ).toLowerCase();
  const dictMap = unitOwnership?.__dictionary || {};
  if (ownerId) {
    prefetchUnitIcons(activeDataDir, names.map((n) => [ownerId, n, dictMap[n]]), bumpIconCacheVersionCoalesced);
  }
  return [...byUnit.values()].map(e => ({
    unit: e.unit,
    faction: ownerId,
    icon: ownerId ? getCachedUnitIcon(activeDataDir, ownerId, e.unit) : null,
    aors: [...e.aors], only: [...e.only], except: [...e.except],
  }));
}

export function deriveGarrison(ctx) {
  const { lockedRegionInfo, regionInfo, liveLogActive, saveUnitsByRegion, liveUnitsByRegion, saveArmiesData, startingArmiesByRegion, cityPixels, regions, imgSize, saveCharactersByRegion, currentOwnerByCity, initialOwnerByCity, saveGovernorByCity, armiesToRender, pendingArmyUnits, appliedArmyUnits, unitOwnership, activeDataDir, bumpIconCacheVersionCoalesced } = ctx;
  // Live mode: use the save-file parser data (fresh =
  // saveUnitsByRegion, legacy = saveArmiesData fallback).
  // Non-live: fall back to startingArmiesByRegion — the
  // descr_strat turn-0 garrison resolved to regions
  // during import.
  const r = lockedRegionInfo || regionInfo;
  if (!r) return null;
  let normalised = null;
  // Live mode is on but live data hasn't loaded yet
  // (save parse takes a few seconds). Fall back to
  // the descr_strat starting garrison so the panel
  // never looks broken in the gap.
  const liveDataReady = saveUnitsByRegion && Object.keys(saveUnitsByRegion).length > 0;
  if (liveLogActive && liveDataReady) {
    // liveUnitsByRegion re-buckets save units by each
    // commander's CURRENT region (from log-position
    // events), so an army that moved mid-turn shows
    // up under its destination region's panel as
    // soon as the log fires the move event — same
    // as the map markers, no save snapshot required.
    const fresh = liveUnitsByRegion?.[r.region];
    const legacy = saveArmiesData?.[r.region] || saveArmiesData?.[r.city];
    const rawFresh = fresh || null;
    // Coord-based garrison definition: units whose
    // commander is at the settlement tile, plus units
    // with no commander (generic garrison defenders).
    // Prefer the pre-bundled `startingArmiesByRegion`
    // settlement coords. Fall back to cityPixels (the
    // black-pixel position derived from the map TGA),
    // which is always available — fixes regions like
    // Poseidonia whose bundled armies file uses the
    // older flat format with no per-region settlement.
    let settlementTile = startingArmiesByRegion?.[r.region]?.settlement || null;
    if (!settlementTile && cityPixels && cityPixels.length) {
      const cp = cityPixels.find(p => regions[p.rgbKey]?.region === r.region);
      // cityPixels.y is TOP-DOWN; army positions are
      // BOTTOM-UP world coords. Flip when building
      // the settlement tile so settlementTile.y
      // matches army.y for exact comparison below.
      if (cp) settlementTile = { x: cp.x, y: (imgSize.height - 1) - cp.y };
    }
    const charByUuid = new Map();
    for (const list of Object.values(saveCharactersByRegion || {})) {
      for (const c of list) { if (c.secondaryUuid) charByUuid.set(c.secondaryUuid, c); }
    }
    if (rawFresh) {
      // Garrison = (a) commander-LESS units AND
      // (b) units commanded by the appointed
      // governor AND (c) units whose commander is
      // standing on the settlement tile WITH the
      // same faction as the region owner.
      //
      // The faction guard on (c) excludes besiegers
      // / passers-through whose stack happens to
      // sit on the settlement tile (or whose live
      // log position resolved to it incorrectly).
      // Without it the user saw foreign Roman
      // bodyguards (Marcus Ogulnius_Gallus 55, etc.)
      // in messapian-held Brundisium's garrison
      // because the live-position attribution had
      // pulled them into that bucket.
      const ownerFaction = ((currentOwnerByCity && currentOwnerByCity[r.city])
        || (initialOwnerByCity && initialOwnerByCity[r.city])
        || r.faction || "").toLowerCase();
      const governorUuid = (saveGovernorByCity && r.city && saveGovernorByCity[r.city] && !saveGovernorByCity[r.city].unresolved)
        ? saveGovernorByCity[r.city].uuid
        : null;
      const cmdsAtSettlement = new Set();
      if (settlementTile) {
        for (const a of (armiesToRender || [])) {
          if (!a.commanderUuid) continue;
          if (a.x !== settlementTile.x || a.y !== settlementTile.y) continue;
          // Faction guard only for LIVE-tracked positions:
          // those can be mis-attributed by the log onto a
          // settlement tile (foreign besieger). A SAVE-
          // derived position exactly on the tile is the
          // engine's own placement — only the owner can
          // occupy a settlement tile — so trust it even if
          // the captain_card faction tag is wrong (e.g.
          // messapian Titus mis-tagged "massalia").
          if (a.liveTracked && ownerFaction && a.faction && a.faction.toLowerCase() !== ownerFaction) continue;
          cmdsAtSettlement.add(a.commanderUuid);
        }
      }
      // For commanded units the commander's faction
      // must match the region owner — keeps a Roman
      // siege bodyguard from showing up in a
      // messapian city's defender list even when
      // his live position resolves to that region.
      // 0.9.77x garrison/field-army fix.
      //
      // A unit belongs in the GARRISON panel iff it is
      // physically INSIDE the settlement. The only
      // honest in-settlement signals the save gives us:
      //   (1) commander-LESS defenders (cmd==0) — the
      //       engine's leaderless town garrison;
      //   (2) the appointed GOVERNOR's stack (his
      //       bodyguard + foot) — the governor commands
      //       the city's defence from inside the walls;
      //   (3) any commander standing EXACTLY on the
      //       settlement tile (cmdsAtSettlement) — a
      //       general who has marched his stack into the
      //       city to defend it.
      //
      // What is NOT garrison: a same-faction general
      // whose stack sits on a FIELD tile in the
      // settlement's region (possibly 1-3 tiles from the
      // walls). That is a FIELD ARMY and the engine draws
      // it as a separate stack on the map.
      //
      // The previous "sameFaction → garrison" clause
      // folded EVERY friendly general in the region into
      // the garrison. Live bug (Rome, romans_julii,
      // turn 1): the settlement tile is (285,404) where
      // the governor Quintus Ogulnius_Gallus stands with
      // his 15-unit garrison stack; two OTHER Roman
      // generals — Marcus at (283,402) and Servius at
      // (282,404) — stand on field tiles a couple of
      // tiles away. All three are romans_julii, so the
      // sameFaction clause wrongly swept Marcus's and
      // Servius's field stacks into Rome's Garrison
      // panel. The Field-armies panel already excludes
      // ONLY the governor + on-tile stacks (see below),
      // so those two also (correctly) appeared as field
      // armies — i.e. they were double-listed, wrong in
      // the garrison. Dropping the sameFaction clause
      // makes the two panels symmetric: in-settlement =
      // garrison, everything else commanded = field.
      const garrisonDecisions = []; // [garrison] diag
      const garrisonCtx = { governorUuid, cmdsAtSettlement };
      normalised = rawFresh
        .filter((u) => {
          const cmd = u.commanderUuid || u.inferredCmd || null;
          const inGarrison = isGarrisonUnit(u, garrisonCtx);
          const reason = inGarrison
            ? (!cmd ? "leaderless defender (cmd=0)"
               : (governorUuid && (u.commanderUuid === governorUuid || u.inferredCmd === governorUuid)) ? "governor's stack"
               : "commander on settlement tile")
            : "field-army (commander off settlement tile)";
          garrisonDecisions.push({ unit: u.name, cmd: cmd ? cmd.toString(16) : null, inGarrison, reason });
          return inGarrison;
        })
        .map((u) => ({
          unit: u.name,
          soldiers: u.soldiers,
          max: u.maxSoldiers,
          // Live XP / weapon / armour read directly from
          // the save record (save-cracker session 10:
          // u8 at regionEnd+20 / +17 / +16). Replaces
          // the descr_strat seed fallback used here
          // before, which missed mid-campaign recruits
          // and just-fought chevron gains.
          xp: u.xp || 0,
          weapon: u.weapon || 0,
          armour: u.armour || 0,
          // Combined smithy weapon/armor upgrade level
          // (unitParser H+17, CONFIRMED on RIS). null
          // when unreadable — never a fake 0.
          upgradeLevel: typeof u.upgradeLevel === "number" ? u.upgradeLevel : null,
          // Preserved so RegionInfo can swap the unit
          // card for the commander's portrait card
          // (0.9.410). Only set on bodyguard units.
          commanderUuid: u.commanderUuid || null,
        }));
      // [garrison] diagnostic — grouping decisions +
      // counts for the region currently shown. Reaches
      // provincia.log (the auto-update diagnosis window).
      try {
        const kept = garrisonDecisions.filter((d) => d.inGarrison);
        const dropped = garrisonDecisions.filter((d) => !d.inGarrison);
        const droppedCmds = [...new Set(dropped.map((d) => d.cmd).filter(Boolean))];
        const _gmsg = `[garrison] ${r.city || r.region}: ${rawFresh.length} region units → ${kept.length} garrison, ${dropped.length} routed to field armies` +
          `${droppedCmds.length ? ` (field cmds: ${droppedCmds.join(", ")})` : ""}` +
          ` | settlementTile=${settlementTile ? `${settlementTile.x},${settlementTile.y}` : "?"} cmdsAtSettlement=${cmdsAtSettlement.size} governorUuid=${governorUuid ? governorUuid.toString(16) : "none"}`;
        // 0.9.833: this fires in the garrison-grouping RENDER; throttle
        // identical lines (same region+counts) so a long live run doesn't
        // re-log it every re-render (was 16k+ lines in a 9h AI run).
        if (typeof window !== "undefined") {
          window.__garrisonLogged = window.__garrisonLogged || new Set();
          if (!window.__garrisonLogged.has(_gmsg)) {
            if (window.__garrisonLogged.size > 4000) window.__garrisonLogged.clear();
            window.__garrisonLogged.add(_gmsg);
            console.log(_gmsg);
          }
        }
      } catch (e) { /* logging must never break render */ }
    } else if (legacy) {
      normalised = legacy.map((u) => ({
        unit: typeof u === "string" ? u : (u.unit || u.name),
        soldiers: u.soldiers ?? null,
        max: u.max ?? u.maxSoldiers ?? null,
      }));
    }
    // Seed exp/armour/weapon from the bundled
    // starting_armies_<suffix>.json — ONLY for units
    // that the save didn't already provide a value for
    // (legacy path / mid-campaign recruits absent from
    // descr_strat). The fresh path above already reads
    // live values from the unit record, so we don't
    // overwrite them.
    if (normalised && normalised.length > 0) {
      const startingByName = new Map();
      const startingArms = startingArmiesByRegion?.[r.region]?.garrison || [];
      for (const a of startingArms) {
        for (const u of a.units || []) {
          if (!startingByName.has(u.name)) startingByName.set(u.name, []);
          startingByName.get(u.name).push(u);
        }
      }
      normalised = normalised.map((u) => {
        const queue = startingByName.get(u.unit);
        const seed = queue && queue.length ? queue.shift() : null;
        return {
          ...u,
          xp: u.xp || seed?.exp || 0,
          armour: u.armour || seed?.armour || 0,
          weapon: u.weapon || seed?.weapon || 0,
        };
      });
    }
  } else {
    // startingArmiesByRegion is now { region: {
    //   garrison: [armies], field: [armies] } }. The
    // garrison prop shows only units on the settlement
    // tile; field armies render in a separate section.
    const regData = startingArmiesByRegion?.[r.region];
    const garrisonArmies = regData?.garrison || [];
    if (garrisonArmies.length > 0) {
      normalised = [];
      for (const a of garrisonArmies) {
        // 0.9.429: tag first unit per army with the
        // commander's firstName so non-live bodyguard
        // swap can resolve a face card via statsCache.
        // 0.9.778: ALSO tag the surname. The non-live
        // resolver keys statsCache by the FULL `fn|ln|fac`
        // name (matching the family tree) — firstName alone
        // can't disambiguate two same-firstName generals in
        // a faction (Servius Ogulnius Gallus vs Servius
        // Fulvius Flaccus), which dropped the surname and
        // painted a wrong/hash face.
        const cmdParts = a.character ? String(a.character).split(/\s+/) : [];
        const cmdFirstName = cmdParts[0] || null;
        const cmdLastName = cmdParts.slice(1).join(" ") || null;
        const cmdFac = (a.faction || "").toLowerCase();
        (a.units || []).forEach((u, ui) => {
          normalised.push({
            unit: u.name,
            xp: u.exp || 0,
            armour: u.armour || 0,
            weapon: u.weapon || 0,
            commanderName: ui === 0 && cmdFirstName ? cmdFirstName : null,
            commanderLastName: ui === 0 && cmdFirstName ? cmdLastName : null,
            commanderFaction: ui === 0 && cmdFirstName ? cmdFac : null,
          });
        });
      }
    }
    // 0.9.836 DIAG (throttled per region): pin why some
    // governors' garrison cards render without a portrait.
    // Logs the region key, whether startingArmiesByRegion
    // had it, the garrison army count + their characters,
    // and the tagged commanderNames actually produced.
    try {
      if (typeof window !== "undefined") {
        window.__garrNonliveLogged = window.__garrNonliveLogged || new Set();
        if (!window.__garrNonliveLogged.has(r.region)) {
          window.__garrNonliveLogged.add(r.region);
          const chars = garrisonArmies.map((a) => a.character || "?").join(" | ");
          const cmds = (normalised || []).filter((u) => u.commanderName).map((u) => `${u.commanderName} ${u.commanderLastName || ""}`.trim()).join(" | ");
          console.log(`[garr-nonlive] region="${r.region}" city="${r.city}" hasKey=${!!regData} garrisonArmies=${garrisonArmies.length} chars=[${chars}] taggedCmds=[${cmds}]`);
        }
      }
    } catch {}
  }
  const ownerId =
    (currentOwnerByCity && currentOwnerByCity[r.city])
    || (initialOwnerByCity && initialOwnerByCity[r.city])
    || r.faction;
  // 0.9.650: merge pendingArmyUnits for THIS garrison so
  // recruit-clicks and × removes show up in the panel
  // immediately, not just after Save to Mod. Key must
  // match what RegionInfo passes to onSelectArmy — which
  // uses `info.faction` (== r.faction, the descr_strat
  // starting owner), NOT the live current owner. So we
  // try BOTH: r.faction first (matches the selection
  // path 1:1), ownerId as a fallback. Without the
  // r.faction-first lookup the merge silently misses
  // when a settlement has changed hands in-game.
  const pendingKey1 = r.faction && r.region
    ? `${String(r.faction).toLowerCase()}|r:${r.region}`
    : null;
  const pendingKey2 = ownerId && r.region && ownerId !== r.faction
    ? `${String(ownerId).toLowerCase()}|r:${r.region}`
    : null;
  // 0.9.657: fall back to appliedArmyUnits after pending
  // so already-saved edits keep overlaying the stale live
  // garrison without inflating pendingCount.
  const pendingEntry =
    (pendingKey1 && pendingArmyUnits.get(pendingKey1))
    || (pendingKey2 && pendingArmyUnits.get(pendingKey2))
    || (pendingKey1 && appliedArmyUnits.get(pendingKey1))
    || (pendingKey2 && appliedArmyUnits.get(pendingKey2))
    || null;
  if (pendingEntry) {
    // 0.9.837: an army-units overlay (pending edit OR an
    // already-applied one) REPLACES the garrison units —
    // but it must KEEP the commander tag on the first unit,
    // or the general's portrait swap is lost and the card
    // shows the plain bodyguard icon (Appius@Pisae,
    // Decimus@Iguvium). 0.9.838: extracted to the
    // unit-tested tagOverlayGarrisonUnits so this can't
    // silently regress again (src/garrisonUnits.test.js).
    normalised = tagOverlayGarrisonUnits(
      pendingEntry.units,
      startingArmiesByRegion?.[r.region]?.garrison,
      ownerId
    );
  }
  // 0.9.664: diagnostic — surfaces in provincia.log when
  // the panel count doesn't match the file count. Logs
  // region, city, starting-army count, raw + post-merge
  // unit counts, and which pending/applied keys hit (if
  // any). Remove after the Reate "1 unit shown vs 3 in
  // file" mystery is resolved.
  try {
    const debug = (r.city === "Reate" || r.region === "Sabinia-Aequia");
    if (debug) {
      const regData = startingArmiesByRegion?.[r.region];
      const garrisonArmies = regData?.garrison || [];
      const rawUnits = garrisonArmies.reduce((n, a) => n + (a.units?.length || 0), 0);
      const pendK1 = pendingKey1 && pendingArmyUnits.get(pendingKey1) ? "pendK1✓" : "pendK1✗";
      const pendK2 = pendingKey2 && pendingArmyUnits.get(pendingKey2) ? "pendK2✓" : "pendK2✗";
      const applK1 = pendingKey1 && appliedArmyUnits.get(pendingKey1) ? "applK1✓" : "applK1✗";
      const applK2 = pendingKey2 && appliedArmyUnits.get(pendingKey2) ? "applK2✓" : "applK2✗";
      console.log(`[gar-dbg] region=${r.region} city=${r.city} r.faction=${r.faction} ownerId=${ownerId} startingArmies=${garrisonArmies.length} rawUnits=${rawUnits} pendK1=${pendingKey1} pendK2=${pendingKey2} ${pendK1} ${pendK2} ${applK1} ${applK2} pendingEntry=${pendingEntry ? pendingEntry.units.length + "u" : "null"} normalised=${normalised?.length ?? "null"}`);
    }
  } catch {}
  if (!normalised || normalised.length === 0) {
    // Empty pending state is still a valid display: an
    // empty garrison the user is editing toward. Return
    // an empty array (NOT null) so the panel still
    // renders the "click to select" affordance.
    if (pendingEntry) return [];
    return null;
  }
  if (ownerId) {
    const dictMap = unitOwnership?.__dictionary || {};
    const triples = normalised.map((u) => [ownerId, u.unit, dictMap[u.unit]]).filter(([, n]) => n);
    prefetchUnitIcons(activeDataDir, triples, bumpIconCacheVersionCoalesced);
  }
  return normalised.map((u) => ({
    ...u,
    faction: ownerId,
    icon: ownerId ? getCachedUnitIcon(activeDataDir, ownerId, u.unit) : null,
  }));
}
