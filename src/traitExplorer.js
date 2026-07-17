// src/traitExplorer.js
//
// Pure, renderer-safe helpers for the Trait Explorer feature. No IPC, no Node,
// no React — just transforms over the `traitData` object the renderer already
// holds (from the existing `get-trait-data` IPC) plus an optional flat array of
// live characters (flattened from App's saveCharactersByRegion).
//
// traitData shape (from main.js get-trait-data → modTraitLevels, built in
// src/modDataLoader.js):
//   {
//     levels: {
//       [traitName]: [
//         { levelIdx, levelName, threshold, effects: [{ name, value }],
//           desc, effectsDesc, descKey, effectsKey, gainKey },
//         ...
//       ]
//     },
//     epithets, ancillaries, usesStat, hidden, characters, excludeCultures
//   }
//
// live character shape (one element of a flattened saveCharactersByRegion):
//   { firstName, lastName, faction, traits: [{ name, level, levelName, points }] }

// Build a normalized, searchable index of every trait and the distinct effect
// vocabulary across all trait levels.
//   → {
//        traits: [
//          { name,
//            levels: [{ levelIdx, level, threshold, effects: [{name,value}], desc, effectsDesc }],
//            effectNames: [distinct effect names across this trait's levels] }
//        ],
//        allEffects: [distinct effect names across ALL traits, sorted]
//      }
// `levels` is undefined-safe: a traitData with no `levels` map yields an empty index.
export function buildTraitIndex(traitData) {
  const levelsMap = (traitData && traitData.levels) || {};
  const allEffectsSet = new Set();
  const traits = [];

  for (const name of Object.keys(levelsMap)) {
    const rawLevels = Array.isArray(levelsMap[name]) ? levelsMap[name] : [];
    const perTraitEffects = new Set();
    const levels = rawLevels.map((lv, i) => {
      const effects = (Array.isArray(lv && lv.effects) ? lv.effects : [])
        .map((e) => ({ name: e && e.name, value: Number(e && e.value) || 0 }))
        .filter((e) => e.name);
      for (const e of effects) {
        perTraitEffects.add(e.name);
        allEffectsSet.add(e.name);
      }
      return {
        levelIdx: lv && lv.levelIdx != null ? lv.levelIdx : i + 1,
        // `level` = the human-facing level name (e.g. "Roman_Conqueror"); falls
        // back to the 1-based index when a mod omits a level name.
        level: (lv && lv.levelName) || (lv && lv.level) || String(i + 1),
        levelName: (lv && lv.levelName) || null,
        threshold: lv && lv.threshold != null ? lv.threshold : null,
        effects,
        desc: (lv && lv.desc) || null,
        effectsDesc: (lv && lv.effectsDesc) || null,
      };
    });
    traits.push({
      name,
      levels,
      effectNames: Array.from(perTraitEffects).sort(),
    });
  }

  traits.sort((a, b) => a.name.localeCompare(b.name));
  return {
    traits,
    allEffects: Array.from(allEffectsSet).sort(),
  };
}

// Filter the index's trait list.
//   opts.query  — case-insensitive substring; matches trait name, any level
//                 name, or any level description text.
//   opts.effect — exact effect name; keeps traits with that effect on ANY level.
// Both optional; omitting/blanking a filter means "match all" for that axis.
export function filterTraits(index, opts) {
  const traits = (index && Array.isArray(index.traits)) ? index.traits : [];
  const query = (opts && opts.query ? String(opts.query) : "").trim().toLowerCase();
  const effect = (opts && opts.effect) ? String(opts.effect) : "";

  return traits.filter((t) => {
    if (effect && !(t.effectNames || []).includes(effect)) return false;
    if (query) {
      const inName = t.name.toLowerCase().includes(query);
      const inLevels = (t.levels || []).some((lv) =>
        (lv.level && String(lv.level).toLowerCase().includes(query)) ||
        (lv.desc && String(lv.desc).toLowerCase().includes(query)) ||
        (lv.effectsDesc && String(lv.effectsDesc).toLowerCase().includes(query))
      );
      if (!inName && !inLevels) return false;
    }
    return true;
  });
}

// Display name for a live character (firstName + lastName, tolerant of either
// missing; falls back to a `name` field if the caller supplied a pre-joined one).
export function characterDisplayName(c) {
  if (!c) return "";
  if (c.name) return String(c.name);
  const parts = [c.firstName, c.lastName].filter(Boolean);
  return parts.join(" ").trim();
}

// Group live characters by the traits they carry.
//   → { [traitName]: [{ character, faction, level, levelName }] }
// `level` is the character's numeric trait level; `levelName` its level name if
// present. Characters with no `traits` array are skipped. Passing a falsy /
// non-array argument yields {} (the panel then just hides the carriers section).
export function carriersByTrait(liveCharacters) {
  const out = {};
  if (!Array.isArray(liveCharacters)) return out;
  for (const c of liveCharacters) {
    if (!c || !Array.isArray(c.traits)) continue;
    const character = characterDisplayName(c) || "(unnamed)";
    const faction = c.faction || null;
    for (const t of c.traits) {
      const tn = t && (t.name || t.trait);
      if (!tn) continue;
      (out[tn] || (out[tn] = [])).push({
        character,
        faction,
        level: t.level != null ? t.level : (t.points != null ? t.points : null),
        levelName: t.levelName || null,
      });
    }
  }
  return out;
}

export default { buildTraitIndex, filterTraits, carriersByTrait, characterDisplayName };
