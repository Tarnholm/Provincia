"use strict";
const fs=require("fs");
const path=require("path");
const descrGen=require("./descrStratGeneral.js");
function loadModData(modDataDir, { buildInitialOwnership, findRelatedModDirs, getIconSearchRoots }){
let modAiByFaction, modAiPersonalityOrder, modAncillaryData, modAncillaryNames, modBuildingChains, modChainCategories, modChainMaxLevels, modDescrStratCharByName, modDescrStratCharactersByRegion, modDescrStratCharsByFirstName, modDescrStratSurnames, modFactionCultures, modFactionDisplayMap, modFactionDisplayNames, modFactionOrder, modNameLookup, modTraitCharacters, modTraitEpithets, modTraitExcludeCultures, modTraitHidden, modTraitLevels, modTraitNames, modUnitOfficerCounts, modDescrStratFamilies, modHomelandsByFaction, modInitialCreatorByCity, modInitialOwnerByCity, modRegionToCity;
  const nameLookupPath = path.join(modDataDir, "descr_names_lookup.txt");
  const traitsPath = path.join(modDataDir, "export_descr_character_traits.txt");
  const ancillariesPath = path.join(modDataDir, "export_descr_ancillaries.txt");
  const edbPath = path.join(modDataDir, "export_descr_buildings.txt");
  const descrStratPath = path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
  if (!fs.existsSync(nameLookupPath) || !fs.existsSync(traitsPath)) {
    throw new Error("Mod character data files missing in " + modDataDir);
  }
  // Optional: ancillaries. If missing, ancillary names just render as `#<id>`.
  // 0.9.420: also capture per-ancillary Image, Description, EffectsDescription,
  // and Effect lines so the right-click info panel can render the actual icon
  // file (descr_strat's ancillary name is NOT the image filename — e.g.
  // `Ancillary poet` has `Image philosopher2.tga`) plus the effects + desc.
  modAncillaryNames = [];
  modAncillaryData = {}; // { name: { image, descKey, effectsKey, effects: [{name,value}], excludeCultures, unique } }
  if (fs.existsSync(ancillariesPath)) {
    const lines = fs.readFileSync(ancillariesPath, "utf8").split(/\r?\n/);
    let cur = null;
    for (const line of lines) {
      const m = line.match(/^Ancillary\s+(\S+)/);
      if (m) {
        modAncillaryNames.push(m[1]);
        cur = { image: null, descKey: null, effectsKey: null, effects: [], excludeCultures: null, unique: false };
        modAncillaryData[m[1]] = cur;
        continue;
      }
      if (!cur) continue;
      const im = line.match(/^\s*Image\s+(\S+)/);
      if (im) { cur.image = im[1].replace(/\.tga$/i, ""); continue; }
      const dm = line.match(/^\s*Description\s+(\S+)/);
      if (dm) { cur.descKey = dm[1]; continue; }
      const efdm = line.match(/^\s*EffectsDescription\s+(\S+)/);
      if (efdm) { cur.effectsKey = efdm[1]; continue; }
      const efm = line.match(/^\s*Effect\s+(\S+)\s+(-?\d+)/);
      if (efm) { cur.effects.push({ name: efm[1], value: parseInt(efm[2], 10) }); continue; }
      // 0.9.437: capture engine constraints used by the dev-mode picker.
      const exm = line.match(/^\s*ExcludeCultures\s+(.+?)\s*$/);
      if (exm) { cur.excludeCultures = exm[1].split(/\s*,\s*/).map(s => s.toLowerCase()).filter(Boolean); continue; }
      if (/^\s*Unique\b/.test(line)) { cur.unique = true; continue; }
    }
  }
  modNameLookup = fs.readFileSync(nameLookupPath, "utf8").split(/\r?\n/).map(s => s.trim());
  modTraitNames = [];
  // While we walk the traits file we ALSO collect Trait → [{ level, epithetKey }]
  // pairs. The first pass through the file gives us the trait→key skeleton;
  // a second pass on text/export_vnvs.txt fills in epithetKey → text.
  modTraitEpithets = {};
  // 0.9.417: capture FULL per-level data for the right-click character
  // info panel (description text, effects, threshold). Shape:
  //   modTraitLevels[traitName] = [
  //     { levelIdx, levelName, descKey, effectsKey, gainKey,
  //       threshold, effects: [{ name, value }] }, ...
  //   ]
  // The text keys get resolved against export_vnvs.txt below.
  modTraitLevels = {};
  modTraitHidden = {};
  modTraitCharacters = {};
  modTraitExcludeCultures = {};
  {
    const lines = fs.readFileSync(traitsPath, "utf8").split(/\r?\n/);
    let curTrait = null;
    let curLevel = null;     // level name (e.g. "Roman_Conqueror_Messapians")
    let curLevelIdx = 0;     // 1-indexed level position within current trait
    let curLevelObj = null;
    // 0.9.433: track Hidden flag per trait (engine doesn't surface
    // hidden traits in the in-game character info, so the UI should
    // hide them unless devMode is on).
    let curTraitHidden = false;
    for (const line of lines) {
      const tm = line.match(/^Trait\s+(\S+)/);
      if (tm) {
        curTrait = tm[1];
        curLevel = null;
        curLevelIdx = 0;
        curLevelObj = null;
        curTraitHidden = false;
        modTraitNames.push(curTrait);
        continue;
      }
      if (curTrait && /^\s*Hidden\b/.test(line)) {
        curTraitHidden = true;
        if (!modTraitHidden) modTraitHidden = {};
        modTraitHidden[curTrait] = true;
        continue;
      }
      // 0.9.437: capture engine-enforced constraints so the Add Trait
      // picker can filter out options the engine would reject. Two cared
      // about: `Characters` (which agent types can carry the trait —
      // family / admiral / spy / assassin / diplomat / all) and
      // `ExcludeCultures` (cultures the trait is forbidden on).
      if (curTrait) {
        const chm = line.match(/^\s*Characters\s+(.+?)\s*$/);
        if (chm) {
          modTraitCharacters[curTrait] = chm[1].split(/\s*,\s*/).map(s => s.toLowerCase()).filter(Boolean);
          continue;
        }
        const exm = line.match(/^\s*ExcludeCultures\s+(.+?)\s*$/);
        if (exm) {
          modTraitExcludeCultures[curTrait] = exm[1].split(/\s*,\s*/).map(s => s.toLowerCase()).filter(Boolean);
          continue;
        }
      }
      const lm = line.match(/^\s*Level\s+(\S+)/);
      if (lm) {
        curLevel = lm[1];
        curLevelIdx++;
        curLevelObj = {
          levelIdx: curLevelIdx,
          levelName: curLevel,
          descKey: null,
          effectsKey: null,
          gainKey: null,
          threshold: null,
          effects: [],
          desc: null,    // resolved against export_vnvs.txt
          effectsDesc: null,
        };
        if (!modTraitLevels[curTrait]) modTraitLevels[curTrait] = [];
        modTraitLevels[curTrait].push(curLevelObj);
        continue;
      }
      if (curLevelObj) {
        const dm = line.match(/^\s*Description\s+(\S+)/);
        if (dm) { curLevelObj.descKey = dm[1]; continue; }
        const efdm = line.match(/^\s*EffectsDescription\s+(\S+)/);
        if (efdm) { curLevelObj.effectsKey = efdm[1]; continue; }
        const gm = line.match(/^\s*GainMessage\s+(\S+)/);
        if (gm) { curLevelObj.gainKey = gm[1]; continue; }
        const thm = line.match(/^\s*Threshold\s+(\d+)/);
        if (thm) { curLevelObj.threshold = parseInt(thm[1], 10); continue; }
        const efm = line.match(/^\s*Effect\s+(\S+)\s+(-?\d+)/);
        if (efm) { curLevelObj.effects.push({ name: efm[1], value: parseInt(efm[2], 10) }); continue; }
      }
      const em = line.match(/^\s*Epithet\s+(\S+)/);
      if (em && curTrait && curLevel) {
        if (!modTraitEpithets[curTrait]) modTraitEpithets[curTrait] = [];
        modTraitEpithets[curTrait].push({ level: curLevelIdx, levelName: curLevel, key: em[1], text: null });
      }
    }
  }
  // Resolve description/effects/epithet keys → text by scanning export_vnvs.txt.
  // Two formats coexist:
  //   A) `{key}\ttext`  (same line — used for short labels like epithets)
  //   B) `{key}` then text on the next line  (used for long descriptions)
  // Earlier the parser only handled (A); (B) was silently dropped so
  // trait descriptions never made it to the UI.
  {
    const vnvsPath = path.join(modDataDir, "text", "export_vnvs.txt");
    if (fs.existsSync(vnvsPath)) {
      const buf3 = fs.readFileSync(vnvsPath);
      const text = (buf3[0] === 0xff && buf3[1] === 0xfe) ? buf3.toString("utf16le", 2) : buf3.toString("utf8");
      const keyToText = new Map();
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Same-line variant
        const m = line.match(/^\{([^}]+)\}\s*(.+?)\s*$/);
        if (m) { keyToText.set(m[1], m[2]); continue; }
        // Next-line variant: bare `{key}` then text on next non-empty line
        const mk = line.match(/^\{([^}]+)\}\s*$/);
        if (mk) {
          let j = i + 1;
          while (j < lines.length && lines[j].trim() === "") j++;
          if (j < lines.length && !lines[j].startsWith("{")) {
            keyToText.set(mk[1], lines[j].trim());
          }
        }
      }
      // Resolve epithet keys
      for (const trait of Object.keys(modTraitEpithets)) {
        for (const entry of modTraitEpithets[trait]) {
          if (keyToText.has(entry.key)) entry.text = keyToText.get(entry.key);
        }
        modTraitEpithets[trait] = modTraitEpithets[trait].filter(e => e.text);
        if (modTraitEpithets[trait].length === 0) delete modTraitEpithets[trait];
      }
      // Resolve trait-level keys (descKey, effectsKey)
      for (const trait of Object.keys(modTraitLevels)) {
        for (const lvl of modTraitLevels[trait]) {
          if (lvl.descKey && keyToText.has(lvl.descKey)) lvl.desc = keyToText.get(lvl.descKey);
          if (lvl.effectsKey && keyToText.has(lvl.effectsKey)) lvl.effectsDesc = keyToText.get(lvl.effectsKey);
        }
      }
      // Resolve ancillary description keys (0.9.420)
      if (modAncillaryData) {
        for (const name of Object.keys(modAncillaryData)) {
          const a = modAncillaryData[name];
          if (a.descKey && keyToText.has(a.descKey)) a.desc = keyToText.get(a.descKey);
          if (a.effectsKey && keyToText.has(a.effectsKey)) a.effectsDesc = keyToText.get(a.effectsKey);
        }
      }
    }
  }
  modDescrStratSurnames = new Set();
  modDescrStratCharByName = new Map();
  modDescrStratCharsByFirstName = new Map();
  // Try the configured imperial_campaign path AND the alexander variant.
  // Whichever exists provides character coordinates we can use as a fallback
  // for save records whose own commanderUuid doesn't resolve to a position
  // (typically captains attached to leaderless armies — Adymos at Pella, etc.)
  const descrStratPaths = [
    descrStratPath,
    path.join(modDataDir, "world", "maps", "campaign", "alexander", "descr_strat.txt"),
    path.join(modDataDir, "world", "maps", "campaign", "barbarian_invasion", "descr_strat.txt"),
  ];
  // Collect full character records (with traits + ancillaries + age + tags)
  // alongside the name lookup. We need to track state across lines because
  // traits / ancillaries appear on the lines AFTER the character header.
  const fullCharRecords = [];
  for (const dsPath of descrStratPaths) {
    if (!fs.existsSync(dsPath)) continue;
    let currentFaction = null;
    let currentChar = null; // open record awaiting trait / ancillary lines
    const lines = fs.readFileSync(dsPath, "utf8").split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.replace(/\s+$/, "");
      const t = line.trim();
      const factMatch = line.match(/^faction\s+(\S+?),/);
      if (factMatch) { currentFaction = factMatch[1]; currentChar = null; continue; }
      // Vanilla uses `character ` (whitespace), RIS uses `character,` (comma) —
      // accept either separator after the keyword. RIS had 908 character
      // lines silently dropped before this fix (no live generals in the
      // family tree because none were ever parsed).
      const charMatch = line.match(/^character[\s,]+([^,]+?),\s*([^,]+?),.*?\bx\s+(\d+),\s*y\s+(\d+)/);
      if (charMatch) {
        const nameField = charMatch[1].trim();
        const headerRest = charMatch[0]; // entire matched header
        // 0.9.507: skip RIS's sub-faction marker lines (`character
        // sub_faction parni, ...`). Same fix as in bundle-mod-data.js
        // 0.9.506 — these lines don't name a real character, they tag a
        // territory for sub-faction spawning. Without this filter the
        // family tree gets a "sub_faction parni" member with the role
        // string and zero stats, which then surfaces under the in-game
        // commander's slot via name-collision lookups.
        if (/^sub[_\s]faction\b/i.test(nameField)) {
          continue;
        }
        const [first, ...rest] = nameField.split(/\s+/);
        const lastName = rest.join(" ") || null;
        if (lastName) modDescrStratSurnames.add(lastName);
        const x = parseInt(charMatch[3]);
        const y = parseInt(charMatch[4]);
        // Use the FULL line for trailing-field extraction — `charMatch[0]`
        // truncates after `y N`, so e.g. `portrait_index 334` is missed.
        const ageMatch = /\bage\s+(\d+)/.exec(line);
        const ageVal = ageMatch ? parseInt(ageMatch[1]) : null;
        const tags = [];
        if (/\bleader\b/i.test(headerRest)) tags.push("leader");
        if (/\bheir\b/i.test(headerRest)) tags.push("heir");
        if (/\bnamed character\b/i.test(headerRest)) tags.push("named");
        const charSubType = (charMatch[2] || "").trim().toLowerCase();
        // descr_strat optionally specifies the engine's portrait pool index
        // explicitly with `portrait_index N`. Only one character per vanilla
        // descr_strat has this set, but mods (and future-Provincia, once the
        // save byte is cracked) can fill it in for every character.
        const portraitIdxMatch = /\bportrait_index\s+(\d+)/.exec(line);
        const portraitIndex = portraitIdxMatch ? parseInt(portraitIdxMatch[1]) : null;
        // 0.9.421: stats from descr_strat — `command N, influence N,
        // management N, subterfuge N` appear inline on the character line
        // (and sometimes spill onto continuation lines, but rare). Read
        // them so non-live mode has the same stat row as live mode.
        const cmdM = /\bcommand\s+(\d+)/.exec(line);
        const infM = /\binfluence\s+(\d+)/.exec(line);
        const mgmtM = /\bmanagement\s+(\d+)/.exec(line);
        const subM = /\bsubterfuge\s+(\d+)/.exec(line);
        const command = cmdM ? parseInt(cmdM[1]) : null;
        const influence = infM ? parseInt(infM[1]) : null;
        const management = mgmtM ? parseInt(mgmtM[1]) : null;
        const subterfuge = subM ? parseInt(subM[1]) : null;
        const entry = { firstName: first, lastName, x, y, faction: currentFaction };
        const key = first + "|" + (currentFaction || "");
        if (!modDescrStratCharByName.has(key)) modDescrStratCharByName.set(key, entry);
        if (!modDescrStratCharsByFirstName.has(first)) modDescrStratCharsByFirstName.set(first, []);
        modDescrStratCharsByFirstName.get(first).push(entry);
        currentChar = {
          firstName: first, lastName, x, y,
          faction: currentFaction,
          age: ageVal,
          tags,
          charSubType,
          portraitIndex,
          traits: [],
          ancillaries: [],
          command, influence, management, subterfuge,
        };
        fullCharRecords.push(currentChar);
        continue;
      }
      if (!currentChar) continue;
      const tm = /^traits\s+(.+)$/i.exec(t);
      if (tm) {
        const parts = tm[1].split(",").map((p) => p.trim()).filter(Boolean);
        for (const p of parts) {
          const m = /^(\S+)\s+(\d+)$/.exec(p);
          if (m) currentChar.traits.push({ name: m[1], level: parseInt(m[2]) });
          else if (p) currentChar.traits.push({ name: p, level: 1 });
        }
        continue;
      }
      const am = /^ancillaries\s+(.+)$/i.exec(t);
      if (am) {
        const parts = am[1].split(",").map((p) => p.trim()).filter(Boolean);
        for (const p of parts) currentChar.ancillaries.push(p);
        continue;
      }
      // Once we hit `army` or the next `character` line, the current
      // character's metadata is sealed. Leave `currentChar` set so trait
      // and ancillary lines that appear AFTER `army` (rare but seen) are
      // still captured for the same character — they're harmless if the
      // record is overwritten by the next character header.
    }
  }
  // Group full records by region using descr_strat coords + the
  // ownership map's settlement → region lookup if available. The renderer
  // already does its own (X,Y) → region pixel lookup, so we expose the
  // raw list keyed by faction; the renderer joins by coords against
  // startingArmiesByRegion (which already has the same coord→region
  // mapping from the bundled JSON OR from the runtime ownership build).
  // 0.9.422: Estimate stats from trait + ancillary effects when descr_strat
  // didn't set them inline. RIS / vanilla descr_strat doesn't store
  // command/influence/management on the `character` line — the engine
  // derives them at game start from trait Effect lines + base values + tag
  // bonuses (faction leader = +1 to several stats, etc). This sum
  // approximates the in-game values (off by 1-2 because we don't model the
  // engine's base/tag contributions); flag results with _statsEstimated so
  // the UI can distinguish them from live-save reads.
  for (const c of fullCharRecords) {
    if (c.command != null || c.influence != null || c.management != null) continue;
    let cmd = 0, inf = 0, mgmt = 0, sub = 0;
    let touched = false;
    for (const t of c.traits || []) {
      const lvls = modTraitLevels && modTraitLevels[t.name];
      if (!lvls) continue;
      // Engine activates the highest level whose Threshold <= trait points.
      // 0.9.521+: t.points is the raw byte value, t.level is the resolved
      // display level (post-threshold). Use t.points for threshold lookup
      // (falling back to t.level for back-compat with old parser output).
      const pts = t.points != null ? t.points : t.level;
      let chosen = null;
      for (const lvl of lvls) {
        if (lvl.threshold != null && lvl.threshold <= pts) chosen = lvl;
      }
      if (!chosen) chosen = lvls[Math.min(Math.max(0, t.level - 1), lvls.length - 1)];
      if (!chosen) continue;
      for (const e of chosen.effects || []) {
        if (e.name === "Command") { cmd += e.value; touched = true; }
        else if (e.name === "Influence") { inf += e.value; touched = true; }
        else if (e.name === "Management") { mgmt += e.value; touched = true; }
        else if (e.name === "Subterfuge") { sub += e.value; touched = true; }
      }
    }
    for (const ancName of c.ancillaries || []) {
      const data = modAncillaryData && modAncillaryData[ancName];
      if (!data) continue;
      for (const e of data.effects || []) {
        if (e.name === "Command") { cmd += e.value; touched = true; }
        else if (e.name === "Influence") { inf += e.value; touched = true; }
        else if (e.name === "Management") { mgmt += e.value; touched = true; }
        else if (e.name === "Subterfuge") { sub += e.value; touched = true; }
      }
    }
    if (touched) {
      c.command = Math.max(0, cmd);
      c.influence = Math.max(0, inf);
      c.management = Math.max(0, mgmt);
      c.subterfuge = Math.max(0, sub);
      c._statsEstimated = true;
    }
  }
  modDescrStratCharactersByRegion = { byCoord: fullCharRecords };
  // ── Family tree extraction (descr_strat → byFaction) ──
  // Re-scan the same paths capturing `character_record` (wives, children,
  // dead members) and `relative` blocks (the parent/spouse/children graph).
  // This produces the data behind Provincia's mod-data Family Tree view.
  {
    const byFaction = {};
    const upsertFaction = (f) => {
      if (!byFaction[f]) byFaction[f] = { members: [], relatives: [], named: {} };
      return byFaction[f];
    };
    // 0.9.770: key the `named` map by FULL name, not first name. Roman
    // families share praenomina (Gaius, Lucius, Quintus, Gnaeus, Publius,
    // Marcus...), so a first-name-only key collided distinct people. Worse,
    // the character_record merge below then OVERWROTE an adult general's
    // age/gender/alive with a same-praenomen CHILD's values — e.g. the Julii
    // leader Quintus Ogulnius_Gallus (age 60) was clobbered to age 4 by the
    // child "Quintus Iunius_Brutus", dropping 6 of 20 family heads below the
    // age>=16 generals filter (tree showed 14 instead of 20). Full-name keys
    // disambiguate; the relative graph already references full names too.
    // See findings-family-tree-2026-05-31.md.
    const nameKey = (first, last) => `${first}|${(last || "").replace(/_/g, " ")}`;
    // Index named characters (those with `character` lines) so we can
    // merge in their age/tags when they appear in relatives blocks.
    for (const c of fullCharRecords) {
      if (!c.faction) continue;
      const bucket = upsertFaction(c.faction);
      bucket.named[nameKey(c.firstName, c.lastName)] = {
        firstName: c.firstName, lastName: c.lastName,
        age: c.age, alive: true, gender: "male",
        tags: c.tags || [], role: c.charSubType || "named_character",
        isCharacter: true,
        x: c.x, y: c.y,
        faction: c.faction,
        portraitIndex: c.portraitIndex != null ? c.portraitIndex : null,
        traits: c.traits || [],
        ancillaries: c.ancillaries || [],
        // 0.9.421: forward stats. _statsEstimated flag (0.9.422) signals
        // these are summed from trait/ancillary Effect lines, not read
        // from a save — display layer can mark them as approximate.
        command: c.command, influence: c.influence,
        management: c.management, subterfuge: c.subterfuge,
        _statsEstimated: c._statsEstimated || false,
      };
    }
    for (const dsPath of descrStratPaths) {
      if (!fs.existsSync(dsPath)) continue;
      let currentFaction = null;
      const lines = fs.readFileSync(dsPath, "utf8").split(/\r?\n/);
      for (const rawLine of lines) {
        // Strip inline `;` comments (a `;` anywhere starts a comment in
        // descr_strat) BEFORE parsing, so a commented-out tail on a `relative`
        // line — e.g. `…, end;Iolaos, …, end` — isn't read as real family
        // members (it was yielding a bogus "end;Iolaos" card plus stray
        // age-less children). Mirrors the descrStratGeneral.js fix; THIS is the
        // parser behind the mod-data Family Tree view.
        const noComment = rawLine.includes(";") ? rawLine.slice(0, rawLine.indexOf(";")) : rawLine;
        const line = noComment.replace(/\s+$/, "");
        const factMatch = line.match(/^faction\s+(\S+?),/);
        if (factMatch) { currentFaction = factMatch[1]; continue; }
        if (!currentFaction) continue;
        // character_record lines: `character_record Name, gender, command X, influence X, management X, subterfuge X, age X, alive|dead, never_a_leader|...`
        const crMatch = line.match(/^\s*character_record\s+([^,]+?),\s*(male|female)\s*,(.*)$/i);
        if (crMatch) {
          const nameField = crMatch[1].trim();
          const gender = crMatch[2].toLowerCase();
          const rest = crMatch[3];
          const ageM = /\bage\s+(\d+)/.exec(rest);
          const aliveM = /\b(alive|dead)\b/.exec(rest);
          // 0.9.421: also pull command/influence/management/subterfuge so
          // the non-live (descr_strat-only) view matches live-mode stats.
          const cmdM = /\bcommand\s+(\d+)/.exec(rest);
          const infM = /\binfluence\s+(\d+)/.exec(rest);
          const mgmtM = /\bmanagement\s+(\d+)/.exec(rest);
          const subM = /\bsubterfuge\s+(\d+)/.exec(rest);
          const stats = {
            command: cmdM ? parseInt(cmdM[1]) : null,
            influence: infM ? parseInt(infM[1]) : null,
            management: mgmtM ? parseInt(mgmtM[1]) : null,
            subterfuge: subM ? parseInt(subM[1]) : null,
          };
          const [first, ...restName] = nameField.split(/\s+/);
          const lastName = restName.join(" ") || null;
          const bucket = upsertFaction(currentFaction);
          // If this character_record refers to a named character we
          // already recorded, just enrich it. Otherwise add a new member.
          // 0.9.770: match on FULL name. A first-name match let a child's
          // record clobber an adult general who shared the praenomen (see
          // the named-map note above).
          const existing = bucket.named[nameKey(first, lastName)];
          if (existing) {
            if (ageM) existing.age = parseInt(ageM[1]);
            existing.gender = gender;
            existing.alive = aliveM ? aliveM[1] === "alive" : true;
            if (stats.command != null) existing.command = stats.command;
            if (stats.influence != null) existing.influence = stats.influence;
            if (stats.management != null) existing.management = stats.management;
            if (stats.subterfuge != null) existing.subterfuge = stats.subterfuge;
          } else {
            bucket.members.push({
              firstName: first, lastName,
              gender,
              age: ageM ? parseInt(ageM[1]) : null,
              alive: aliveM ? aliveM[1] === "alive" : true,
              tags: [],
              role: "family_member",
              isCharacter: false,
              faction: currentFaction,
              ...stats,
            });
          }
          continue;
        }
        // relative lines: `relative Husband, Wife, Child1, Child2, ... end`
        const relMatch = line.match(/^\s*relative\s+([^,]+?),\s*([^,]+?),\s*(.*)$/);
        if (relMatch) {
          const husband = relMatch[1].trim();
          const wifeField = relMatch[2].trim();
          const wife = (/^none$/i.test(wifeField) ? null : wifeField);
          // Children are comma-separated, terminated by `end`
          const childrenPart = relMatch[3].replace(/\s+end\s*$/i, "");
          const children = childrenPart
            .split(",").map(s => s.trim()).filter(s => s && !/^end$/i.test(s));
          const bucket = upsertFaction(currentFaction);
          bucket.relatives.push({ husband, wife, children });
        }
      }
    }
    // Merge `named` map into members[] for each faction
    for (const f of Object.keys(byFaction)) {
      const bucket = byFaction[f];
      for (const [, c] of Object.entries(bucket.named)) {
        bucket.members.push(c);
      }
      delete bucket.named;
    }
    modDescrStratFamilies = { byFaction };
  }
  // Parse export_descr_unit.txt for officer counts. The save stores only
  // rank-and-file soldiers; the in-game UI shows that count plus any
  // officers/standard-bearers/musicians defined in EDU. Counting `officer`
  // lines per unit type lets us match the in-game number (e.g. Hypaspists:
  // save says 240, EDU has one `officer greek_standard`, so display 241).
  modUnitOfficerCounts = {};
  const eduPath = path.join(modDataDir, "export_descr_unit.txt");
  if (fs.existsSync(eduPath)) {
    const buf2 = fs.readFileSync(eduPath);
    const text = buf2[0] === 0xff && buf2[1] === 0xfe ? buf2.toString("utf16le") : buf2.toString("utf8");
    let curUnit = null, curOfficers = 0;
    const flush = () => {
      if (curUnit) modUnitOfficerCounts[curUnit] = curOfficers;
      curUnit = null; curOfficers = 0;
    };
    for (const rawLine of text.split(/\r?\n/)) {
      const i = rawLine.indexOf(";"); const s = (i >= 0 ? rawLine.slice(0, i) : rawLine).trim();
      if (!s) continue;
      const tm = s.match(/^type\s+(.+)$/);
      if (tm) { flush(); curUnit = tm[1].trim(); continue; }
      if (curUnit && /^officer\s+\S+/.test(s)) curOfficers++;
    }
    flush();
  }
  // Load valid building chain names to filter out event records (volcano,
  // eruption, earthquake, etc.) that share the chain-record binary format.
  // Also extract max-level count per chain (from `levels` line) so the level
  // decoder knows how many levels to consider valid (avoids picking up unrelated
  // uint32 values that happen to be small but are pointers/data).
  modBuildingChains = new Set();
  modChainMaxLevels = {};
  modChainCategories = {};
  if (fs.existsSync(edbPath)) {
    const edbText = fs.readFileSync(edbPath, "utf8");
    const blocks = edbText.split(/^building\s+/m).slice(1);
    for (const b of blocks) {
      const name = b.match(/^(\w+)/)?.[1];
      if (!name) continue;
      modBuildingChains.add(name);
      const levelsLine = b.match(/^\s+levels\s+(.+)/m);
      if (levelsLine) {
        const lvlList = levelsLine[1].trim().split(/\s+/);
        modChainMaxLevels[name] = lvlList.length;
      }
      // RTW EDB declares the build-menu category via `icon <category>`. The
      // game uses `data/ui/building_icons/<category>.tga` as the visual
      // fallback when no per-culture/per-level art exists. Capture it for
      // the icon resolver's final pass.
      const iconLine = b.match(/^\s+icon\s+(\w+)/m);
      if (iconLine) modChainCategories[name] = iconLine[1].toLowerCase();
    }
    // 0.9.465: extract per-faction homeland hidden_resources from EDB
    // `alias <name>_homeland` blocks. Each alias declares which factions
    // it covers + which `homeland_<X>` HR they unlock for. We invert to
    // get faction → Set<homeland_X> for the Homeland map mode. Bundled
    // homelands.json is stale (says antigonid → ["antigonid"] but RIS
    // uses shared `homeland_macedonian` across antigonid/seleucid/
    // ptolemaic) — parsing live keeps it in sync with the mod.
    modHomelandsByFaction = {};
    // EDB alias format:
    //   alias <name>_homeland
    //   {
    //       requires factions { <id1>, <id2>, } and hidden_resource homeland_<X>
    //   }
    // Capture the full `requires …` line (up to newline) so the inner
    // `factions { … }` closing brace is included.
    const aliasRegex = /^alias\s+\S+_homeland\s*\{\s*requires\s+([^\n]+)/gm;
    let am, aliasMatches = 0;
    while ((am = aliasRegex.exec(edbText)) !== null) {
      aliasMatches++;
      const expr = am[1];
      const factionsM = expr.match(/factions\s*\{\s*([^}]*)\}/);
      const hrM = expr.match(/hidden_resource\s+(homeland_\w+)/);
      if (!factionsM || !hrM) continue;
      const factions = factionsM[1].split(/\s*,\s*/).map(s => s.trim()).filter(Boolean);
      const hr = hrM[1];
      for (const f of factions) {
        if (!modHomelandsByFaction[f]) modHomelandsByFaction[f] = [];
        if (!modHomelandsByFaction[f].includes(hr)) modHomelandsByFaction[f].push(hr);
      }
    }
    console.log(`[homelands] parsed ${aliasMatches} EDB alias blocks → ${Object.keys(modHomelandsByFaction).length} factions (e.g. antigonid → ${JSON.stringify(modHomelandsByFaction.antigonid || [])})`);
  }
  // Load faction display-name ↔ internal-id mappings.
  // Two sources matter:
  //   - text/campaign_descriptions.txt — `{<CAMPAIGN_PREFIX>_<FACTION>_TITLE}Display`
  //   - text/expanded_bi.txt           — `{<FACTION>}\tDisplay`
  // expanded_bi.txt is the source for in-game faction names (e.g.
  // "The House of Cornelii" for roman_rebels_2). campaign_descriptions only
  // sometimes uses different titles per campaign — used as fallback.
  modFactionDisplayMap = {};   // lowercase display name → internal id
  modFactionDisplayNames = {}; // internal id → display name (for UI)
  // Read expanded_bi.txt from all known installs. Game installs first so
  // mod-specific overrides (read last) take precedence. Within each file we
  // use LAST-WINS — Alexander's `expanded_bi.txt` has an "ALEXANDER TEXT
  // BEGINS HERE" section with overrides (e.g. PARTHIA → "Persia") below the
  // generic BI defaults (PARTHIA → "Parthia"), so the Alexander overrides win.
  // Load order: game install (defaults) → parent mods → submod (wins via last-wins).
  const expandedSources = [];
  for (const root of getIconSearchRoots()) {
    expandedSources.push(path.join(root, "text", "expanded_bi.txt"));
  }
  // Include submod + all parent mods (innermost last so it overrides).
  const relatedForExpanded = findRelatedModDirs
    ? findRelatedModDirs(modDataDir, "text/expanded_bi.txt").reverse()
    : [modDataDir];
  for (const d of relatedForExpanded) {
    expandedSources.push(path.join(d, "text", "expanded_bi.txt"));
  }
  for (const expandedPath of expandedSources) {
    if (!fs.existsSync(expandedPath)) continue;
    const buf = fs.readFileSync(expandedPath);
    const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8");
    for (const line of text.split(/\r?\n/)) {
      // Match: {FACTION_INTERNAL_ID}<whitespace>Display Name
      // Only accept top-level faction entries — skip _DESCR, EMT_, _LABEL, etc.
      const m = line.match(/^\{([A-Z][A-Z0-9_]*)\}\s*(.+?)\s*$/);
      if (!m) continue;
      const key = m[1];
      if (key.includes("_DESCR") || key.startsWith("EMT_") || key.startsWith("SMW_") ||
          key.endsWith("_LABEL") || key.endsWith("_ORDER") || key.endsWith("_UNREST") ||
          key.endsWith("_TITLE") || key.endsWith("_BODY") || key.endsWith("_MESSAGE")) continue;
      const factionId = key.toLowerCase();
      const display = m[2].trim();
      if (!display || display.length > 60) continue;
      modFactionDisplayMap[display.toLowerCase()] = factionId;
      modFactionDisplayNames[factionId] = display;
    }
  }
  // Fallback: also load campaign_descriptions.txt if expanded_bi missed anything.
  const campDescPath = path.join(modDataDir, "text", "campaign_descriptions.txt");
  if (fs.existsSync(campDescPath)) {
    const buf = fs.readFileSync(campDescPath);
    const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\{([A-Z_0-9]+)_TITLE\}(.+)$/);
      if (!m) continue;
      const key = m[1];
      const display = m[2].trim();
      // Strip any campaign prefix (IMPERIAL_CAMPAIGN_, ALTERNATE_CAMPAIGN_,
      // RIS_CLASSIC_, RIS_CLASSIC_2_, etc.) — anything ending with the faction id.
      const factionId = key
        .replace(/^[A-Z0-9_]*?(ROMANS_JULII|ROMANS_BRUTII|ROMANS_SCIPII|ROMAN_SENATE|ROMAN_REBELS_[12]|EGYPT|SELEUCID|CARTHAGE|PARTHIA|ARMENIA|PONTUS|GREEK_CITIES|MACEDON|THRACE|DACIA|SCYTHIA|GAULS|BRITONS|GERMANS|SPAIN|NUMIDIA|SLAVE)$/, "$1")
        .toLowerCase();
      if (!modFactionDisplayMap[display.toLowerCase()]) modFactionDisplayMap[display.toLowerCase()] = factionId;
      if (!modFactionDisplayNames[factionId]) modFactionDisplayNames[factionId] = display;
    }
  }
  // Parse descr_sm_factions.txt for faction → culture mapping. The culture
  // name matches the `data/ui/<culture>/buildings/` folder convention
  // (one of: roman, greek, barbarian, carthaginian, egyptian, eastern in
  // vanilla). Used to resolve building icons + culture-specific display
  // names per settlement. Fully dynamic — works for any mod that ships
  // descr_sm_factions.txt.
  modFactionCultures = {};
  // 0.9.527: ordered faction list in descr_sm_factions.txt declaration
  // order. The save's cracked faction_id byte (parseFactionTreasuries) is
  // an INDEX into this order, so it identifies each major-faction record's
  // owner directly — replacing the captain-banner heuristic that misses
  // records with no captains. Populated from the FIRST source that yields
  // a non-empty list (mod overrides game), in lockstep with the culture map.
  modFactionOrder = [];
  // Submod + parent mods first (first-wins — mod overrides game).
  const smFactionSources = [];
  for (const d of (findRelatedModDirs ? findRelatedModDirs(modDataDir, "descr_sm_factions.txt") : [modDataDir])) {
    smFactionSources.push(path.join(d, "descr_sm_factions.txt"));
  }
  for (const root of getIconSearchRoots()) {
    smFactionSources.push(path.join(root, "descr_sm_factions.txt"));
  }
  for (const src of smFactionSources) {
    if (!fs.existsSync(src)) continue;
    try {
      const text = fs.readFileSync(src, "utf8");
      let curFaction = null;
      // Only the FIRST source that actually declares factions seeds the
      // order array; later sources just fill culture gaps. Otherwise a
      // parent-mod file appended after the submod would corrupt the index.
      const seedOrder = modFactionOrder.length === 0;
      for (const line of text.split(/\r?\n/)) {
        // Match `"<faction_id>":` optionally followed by a `;comment`.
        const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
        if (fm) { curFaction = fm[1]; continue; }
        if (curFaction) {
          const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/);
          if (cm) {
            if (!(curFaction in modFactionCultures)) {
              modFactionCultures[curFaction] = cm[1];
            }
            // The culture line marks a REAL faction block (structural keys
            // like "namelists"/"logos" never have a culture), so commit to
            // the order array here — declaration order == faction_id index.
            if (seedOrder) modFactionOrder.push(curFaction);
            curFaction = null;
          }
        }
      }
      if (modFactionOrder.length > 0 && seedOrder) {
        console.log(`[sm_factions] order seeded: ${modFactionOrder.length} factions (idx0=${modFactionOrder[0]})`);
      }
    } catch (e) { console.warn("[sm_factions]", src, e.message); }
  }

  // 0.9.527: parse feral_descr_ai_personality.txt declaration order. The
  // save's cracked aiPersonalityIndex byte (parseFactionTreasuries) indexes
  // into this list, so each major-faction record exposes its AI archetype
  // (ai_rome, ai_carthage, ai_lusitani, …). First non-empty source wins.
  modAiPersonalityOrder = [];
  const aiSources = [];
  for (const d of (findRelatedModDirs ? findRelatedModDirs(modDataDir, "feral_descr_ai_personality.txt") : [modDataDir])) {
    aiSources.push(path.join(d, "feral_descr_ai_personality.txt"));
  }
  for (const root of getIconSearchRoots()) {
    aiSources.push(path.join(root, "feral_descr_ai_personality.txt"));
  }
  for (const src of aiSources) {
    if (!fs.existsSync(src)) continue;
    try {
      const text = fs.readFileSync(src, "utf8");
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*personality\s+([A-Za-z0-9_]+)/);
        if (m) modAiPersonalityOrder.push(m[1]);
      }
      if (modAiPersonalityOrder.length > 0) {
        console.log(`[ai_personality] order seeded: ${modAiPersonalityOrder.length} personalities (idx0=${modAiPersonalityOrder[0]})`);
        break;
      }
    } catch (e) { console.warn("[ai_personality]", src, e.message); }
  }

  // Parse descr_strat for `faction X, ai_Y` → modAiByFaction map. Authoritative
  // starting AI personality per faction; doesn't go stale within a campaign in
  // RTW (engine never reassigns ai_type at runtime — it's static-from-descr_strat).
  // Used as fallback when the save-cracked aiPersonalityIndex is unavailable
  // (sub=8 record layout, ~91% of records on RIS T1017) or wrong.
  modAiByFaction = {};
  try {
    const dsCandidates = [
      path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
      path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "original_overrides", "descr_strat.txt"),
    ];
    if (findRelatedModDirs) {
      for (const d of findRelatedModDirs(modDataDir, "world/maps/campaign/imperial_campaign/descr_strat.txt")) {
        dsCandidates.push(path.join(d, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"));
      }
    }
    let parsedDs = null;
    for (const dsPath of dsCandidates) {
      if (!fs.existsSync(dsPath)) continue;
      try {
        parsedDs = descrGen.parseDescrStrat(fs.readFileSync(dsPath, "utf8"));
        break;
      } catch {}
    }
    if (parsedDs && Array.isArray(parsedDs.factions)) {
      for (const f of parsedDs.factions) {
        if (f.name && f.ai) modAiByFaction[f.name.toLowerCase()] = f.ai;
      }
    }
    console.log(`[ai_personality] descr_strat fallback seeded: ${Object.keys(modAiByFaction).length} factions with ai_<type>`);
  } catch (e) { console.warn("[ai_personality] descr_strat fallback failed:", e.message); }

  // Build initial settlement ownership from descr_regions + descr_strat.
  // This is the turn-0 ground truth; conquests during play are not captured
  // by this map (see PROGRESS_LOG Round 21).
  try {
    const own = buildInitialOwnership(modDataDir);
    modInitialOwnerByCity = own.ownerByCity;
    modInitialCreatorByCity = own.creatorByCity || {};
    if (own.error) console.warn("[mod-load] ownership:", own.error);
    console.log(`[mod-load] ownership owners=${Object.keys(modInitialOwnerByCity).length} creators=${Object.keys(modInitialCreatorByCity).length}`);
  } catch (e) {
    console.warn("[mod-load] ownership parse failed:", e.message);
    modInitialOwnerByCity = {};
    modInitialCreatorByCity = {};
  }
  // Region → city map (descr_regions.txt). The save tags every unit with
  // its REGION; the owner / governor lookups are CITY-keyed. This bridge
  // lets the army-faction re-attribution step turn a unit's region into
  // a settlement and then into an owner.
  try {
    const { findDescrRegions, parseDescrRegions } = require("./ownershipParser.js");
    const rPath = findDescrRegions(modDataDir, "imperial_campaign") || findDescrRegions(modDataDir, "ris_classic");
    modRegionToCity = rPath ? parseDescrRegions(rPath) : {};
  } catch (e) {
    console.warn("[mod-load] descr_regions parse failed:", e.message);
    modRegionToCity = {};
  }
  const __summary = {
    names: modNameLookup.length,
    traits: modTraitNames.length,
    surnames: modDescrStratSurnames.size,
    chains: modBuildingChains.size,
    factionDisplay: Object.keys(modFactionDisplayMap).length,
    factionDisplayNames: Object.keys(modFactionDisplayNames).length,
    owners: Object.keys(modInitialOwnerByCity || {}).length,
    descrStratCharCount: modDescrStratCharactersByRegion?.byCoord?.length || 0,
  };
return { modAiByFaction, modAiPersonalityOrder, modAncillaryData, modAncillaryNames, modBuildingChains, modChainCategories, modChainMaxLevels, modDescrStratCharByName, modDescrStratCharactersByRegion, modDescrStratCharsByFirstName, modDescrStratSurnames, modFactionCultures, modFactionDisplayMap, modFactionDisplayNames, modFactionOrder, modNameLookup, modTraitCharacters, modTraitEpithets, modTraitExcludeCultures, modTraitHidden, modTraitLevels, modTraitNames, modUnitOfficerCounts, modDescrStratFamilies, modHomelandsByFaction, modInitialCreatorByCity, modInitialOwnerByCity, modRegionToCity, __summary };
}
module.exports={loadModData};
