// The EDB as a catalogue: chain → levels, per-level settlement_min and
// `requires`, slot tags. Lifted out of the get-building-catalogue IPC
// (src/modEditingHandlers.js, 0.9.437–0.9.600) so the main process can check
// a building against a settlement too — Compare Settlements warns before it
// copies a building the target town could not hold.  (2026-10-16)
"use strict";

const EMPTY = () => ({ chains: {}, categories: {}, settlementMins: {}, settlementTiers: [], levelRequires: {}, tags: {} });

function readBuildingCatalogue(edbText) {
  if (!edbText) return EMPTY();
  const blocks = edbText.split(/^building\s+/m).slice(1);
  const chains = {};            // chainName → [levelName, ...]
  const categories = {};        // chainName → category (icon line)
  // 0.9.441: per-level settlement_min, keyed by `${chain}|${level}` →
  // settlement-tier name (e.g. "village", "town", "large_town", ...). The
  // dev-mode building editor uses this to gate the ⬆ button — you can only
  // upgrade past a level whose settlement_min is met by the settlement's
  // core_building level.
  const settlementMins = {};
  // 0.9.443: raw `requires` expression per level, keyed by `${chain}|${level}`.
  // The renderer side parses this into a structured filter (factions /
  // hidden_resource / resource etc.) so the dev-mode Add Building picker
  // only shows chains the engine would actually accept for the current
  // region. Concatenating multiple `and / or` continuation lines means
  // the renderer gets a single string with the full clause to parse.
  const levelRequires = {};
  // 0.9.600: capture each chain's `tag` (government / temple / civic / port /
  // heavy_ind / …). A settlement holds at most ONE building per tag — the
  // engine enforces it via the `no_other_<tag>` requirement on every tagged
  // building — so the Add-building picker uses this to hide a second building
  // of an already-occupied slot (you must replace, not stack).
  const tags = {};
  for (const b of blocks) {
    const name = b.match(/^(\w+)/)?.[1];
    if (!name) continue;
    const lvLine = b.match(/^\s+levels\s+(.+)/m);
    const chainLevels = lvLine ? lvLine[1].trim().split(/\s+/).filter(Boolean) : [];
    if (chainLevels.length) chains[name] = chainLevels;
    const iconLine = b.match(/^\s+icon\s+(\w+)/m);
    if (iconLine) categories[name] = iconLine[1].toLowerCase();
    const tagLine = b.match(/^\s+tag\s+(\w+)/m);
    if (tagLine) tags[name] = tagLine[1].toLowerCase();
    // Walk the block line-by-line to find each level's settlement_min.
    // EDB structure inside a `building <chain> { ... }` block:
    //   levels lvl1 lvl2 lvl3
    //   { ... }      <- begin levels container
    //   lvl1
    //   {
    //     settlement_min village
    //     ...
    //   }
    //   lvl2
    //   { ... }
    const lvlSet = new Set(chainLevels);
    const blockLines = b.split(/\r?\n/);
    let curLevel = null;
    for (const ln of blockLines) {
      // Level header. RTW EDB declares each level as either a bare
      // identifier or `<name> requires <expr>` on the same line, e.g.
      //   farms+2
      //   farms+3 requires factions { romans_julii, } and resource grain
      //   level core_building
      // Accept both forms. Level names can include `+`, `-`, digits, etc.
      const lm = ln.match(/^\s*(?:level\s+)?([A-Za-z][A-Za-z0-9_+\-]*)\b/);
      if (lm && lvlSet.has(lm[1])) {
        curLevel = lm[1];
        // 0.9.443: capture per-level `requires` expression so the picker
        // can hide chains the engine would refuse. We collect the header
        // line PLUS subsequent lines up until the next sibling level so
        // multi-line `requires` clauses are captured. Then parse out the
        // bits we care about (factions / hidden_resource / resource).
        if (!levelRequires[`${name}|${curLevel}`]) levelRequires[`${name}|${curLevel}`] = "";
        // Append everything after the level name (handles `farms requires …`)
        const tail = ln.slice(ln.indexOf(lm[1]) + lm[1].length);
        levelRequires[`${name}|${curLevel}`] += " " + tail;
        continue;
      }
      if (!curLevel) continue;
      const sm = ln.match(/^\s*settlement_min\s+(\S+)/);
      if (sm) {
        settlementMins[`${name}|${curLevel}`] = sm[1].toLowerCase();
        continue;
      }
      // Pick up multi-line `requires` clauses. They typically start with
      // `requires …` on the level header but can continue with `and …`
      // / `or …` lines or appear inside a `capability { … }` block (which
      // we DON'T want to swallow). Be conservative: only pick up top-level
      // lines that look like a requires-clause continuation.
      if (/^\s*requires\s+/.test(ln) || /^\s*and\s+/.test(ln) || /^\s*or\s+/.test(ln)) {
        levelRequires[`${name}|${curLevel}`] += " " + ln.trim();
      }
      // Heuristic block-end: an opening of another top-level directive
      // resets curLevel so we don't bleed settings between sibling levels.
      if (/^\s*levels\s+/.test(ln)) curLevel = null;
    }
  }
  // Ordered settlement tier list — derived from the core_building chain
  // since that IS the settlement-level ladder (village → town → ... →
  // huge_city). UI uses it to compare settlement_min "is >= " requirements.
  const settlementTiers = (chains.core_building || []).slice();
  return { chains, categories, settlementMins, settlementTiers, levelRequires, tags };
}

// Does a level's `requires` clause let this region have it? The same reading
// as the building editor's (src/RegionInfo.js requiresClauseAllows): faction
// lists (`all` is a wildcard; RIS lists also name CULTURES — `roman`,
// `greek` — so the owner's culture counts as well), negated lists, and hidden_resource / resource
// against the region's descr_regions tags. Anything else (event_counter,
// building_present, …) counts as met — better to say nothing than to be wrong.
// Returns null when allowed, else { kind: "faction" | "resource", what }.
function requiresBlocks(raw, { faction = null, culture = null, tags = null } = {}) {
  if (!raw || typeof raw !== "string") return null;
  const text = raw.toLowerCase();
  const fac = faction ? String(faction).toLowerCase() : null;
  const cul = culture ? String(culture).toLowerCase() : null;
  const names = (l) => l.includes(fac) || (cul != null && l.includes(cul));
  const positive = [], negative = [];
  const factionRegex = /(?:^|\s)(not\s+)?factions\s*\{([^}]*)\}/g;
  let fm;
  while ((fm = factionRegex.exec(text)) !== null) {
    const ids = fm[2].split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    (fm[1] ? negative : positive).push(ids);
  }
  if (fac && positive.length && !positive.some((l) => l.includes("all") || names(l))) return { kind: "faction", what: fac };
  if (fac) for (const l of negative) if (names(l)) return { kind: "faction", what: fac };
  const tagSet = tags instanceof Set ? tags : new Set((tags || []).map((t) => String(t).toLowerCase()));
  if (!tagSet.size) return null;
  const pos = [], neg = [];
  const hrRegex = /(?:^|\s)(not\s+)?(?:hidden_resource|resource)\s+([a-z][a-z0-9_]*)/g;
  let hm;
  while ((hm = hrRegex.exec(text)) !== null) (hm[1] ? neg : pos).push(hm[2]);
  if (pos.length && !pos.some((r) => tagSet.has(r))) return { kind: "resource", what: pos.join(" or ") };
  for (const r of neg) if (tagSet.has(r)) return { kind: "resource", what: "not " + r };
  return null;
}

module.exports = { readBuildingCatalogue, requiresBlocks };
