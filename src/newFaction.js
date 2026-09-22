// Create a BRAND-NEW faction by cloning a donor's scaffolding.  (2026-09-22)
//
// Not the same job as waking a dormant one (src/factionTransfer.js): that
// faction already exists everywhere the engine looks. A new one has to be
// registered from nothing, and the engine is unforgiving about where.
//
// WHICH FILES, MEASURED NOT GUESSED. For every candidate file I tested whether
// ALL 239 declared RIS factions appear in it. All → the engine needs it for
// every faction; only some → a faction can live without it. Mandatory:
//
//   descr_sm_factions.txt          the 103-line entry (culture, namelists, art
//                                  indices, colours, …)
//   descr_character.txt            several blocks — one per character-type section
//   descr_model_strat.txt          faction-tagged texture/model lines, 51 for parni
//                                  across 6 model types
//   descr_banners.txt              5 lines: standard / rebels / routing / ally
//   feral_descr_ai_personality.txt a `personality ai_<id>` block
//   the campaign's descr_strat.txt (handled by the caller — a new faction also
//                                  needs a leader, an heir and a town)
//   descr_win_conditions.txt       238 of 239 (all but the rebels)
//   text/expanded_bi.txt           {ID} and {ID_DESCR}, or the game shows the raw key
//
// Optional, and deliberately left alone: export_descr_buildings and
// export_descr_unit (recruitment — `gauls`, `germanics`, `greeks` and
// `scythians` have no entries at all and still exist), formations, logos,
// traits, battle models, ancillaries, rebel entries.
//
// NAMES ARE NOT PER-FACTION. descr_names_lookup and descr_namelists hold no
// faction tokens; descr_sm_factions points at a NAMELIST (85 pools serve 239
// factions), so a new faction reuses a pool and needs no new names.
//
// ART. Each cloned entry points at the donor's textures. The caller is given
// `artCopies` — copy the donor's file to the new faction's name and the entries
// already point at the copy, so replacing the art later is overwriting a file.
//
// Pure text: every function takes strings and returns strings. Nothing here
// reads or writes a disk.
"use strict";

const TOKEN = /^[a-z][a-z0-9_]*$/;
const strip = (l) => { const i = l.indexOf(";"); return i < 0 ? l : l.slice(0, i); };
const eolOf = (t) => (t.includes("\r\n") ? "\r\n" : "\n");
const linesOf = (t) => t.split(/\r?\n/);
// the faction token as a whole word, for substitution inside a cloned block
const tokenRe = (id) => new RegExp("(^|[^A-Za-z0-9_])" + id + "(?![A-Za-z0-9_])", "g");
const swapToken = (line, from, to) => line.replace(tokenRe(from), (m, p) => p + to);

// ── descr_sm_factions: the entry, from `\t"id":` to the next one ───────────
function smEntry(text, id) {
  const lines = linesOf(text);
  const heads = [];
  for (let i = 0; i < lines.length; i++) {
    const m = strip(lines[i]).match(/^\t"(\w+)":\s*$/);
    if (m) heads.push({ id: m[1], i });
  }
  const k = heads.findIndex((h) => h.id === id);
  if (k < 0) return null;
  const end = k + 1 < heads.length ? heads[k + 1].i : lines.length;
  return { start: heads[k].i, end, lines: lines.slice(heads[k].i, end), all: heads.map((h) => h.id) };
}

// ── blocks that start with `faction <id>` and run to the next such line ────
function factionBlocks(text, id, startRe) {
  const lines = linesOf(text);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = strip(lines[i]).match(startRe);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && !startRe.test(strip(lines[j]))) j++;
    if (m[1] === id) {
      // trim trailing blank lines so the clone inserts tidily
      let e = j;
      while (e > i + 1 && !strip(lines[e - 1]).trim()) e--;
      out.push({ start: i, end: j, lines: lines.slice(i, e) });
    }
    i = j - 1;
  }
  return out;
}

// Add a cloned block after the donor's last block of that kind.
function cloneBlocks(text, donor, newId, startRe, renamePath) {
  const blocks = factionBlocks(text, donor, startRe);
  if (!blocks.length) return null;
  const eol = eolOf(text);
  const lines = linesOf(text);
  const copies = [];
  let added = 0;
  for (const b of blocks.slice().reverse()) {
    const clone = b.lines.map((l) => {
      // paths FIRST: `.../ris/parni/eastern_general_parni.tga` has its directory
      // swapped by the token pass too, and then the recorded source would be a
      // path that never existed
      const withPaths = renamePath ? renamePath(l, copies) : l;
      return swapToken(withPaths, donor, newId);
    });
    lines.splice(b.end, 0, ...clone, "");
    added += clone.length;
  }
  return { text: lines.join(eol), blocks: blocks.length, added, copies };
}

// Rewrite a texture path that carries the donor's name, and record the copy.
function pathRenamer(donor, newId) {
  const re = new RegExp("([\\w./\\\\-]*" + donor + "[\\w./-]*\\.(?:tga|dds|png))", "gi");
  return (line, copies) => line.replace(re, (p) => {
    const to = p.replace(new RegExp(donor, "gi"), newId);
    if (p !== to && !copies.some((c) => c.from === p)) copies.push({ from: p, to });
    return to;
  });
}

/**
 * Everything a new faction needs, as edited text plus a list of art to copy.
 *
 *   files      { smFactions, character, modelStrat, banners, aiPersonality,
 *                winConditions?, expandedText? } — raw contents
 *   donor      the faction to clone
 *   newId      the new faction token
 *   displayName / description   shown in game (written to expandedText)
 *   culture / namelists / colours   optional overrides of the donor's values
 *
 * Returns { edits, artCopies, summary, warnings, errors }. Any error → no edits.
 */
function planNewFaction({ files = {}, donor, newId, displayName, description, culture = null, namelists = null, colours = null } = {}) {
  const errors = [], warnings = [], edits = {}, artCopies = [];
  const fail = (m) => ({ edits: {}, artCopies: [], summary: null, warnings, errors: [m] });

  if (!donor || !newId) return fail("a donor faction and a new faction id are required");
  const id = String(newId).toLowerCase();
  if (!TOKEN.test(id)) return fail(`"${newId}" is not a usable faction id — lower case letters, digits and underscores, starting with a letter`);
  if (id === String(donor).toLowerCase()) return fail("the new faction needs a different id from its donor");

  const sm = files.smFactions ? smEntry(files.smFactions, donor) : null;
  if (!files.smFactions) return fail("descr_sm_factions.txt is required");
  if (!sm) return fail(`"${donor}" has no entry in descr_sm_factions.txt`);
  if (sm.all.includes(id)) return fail(`"${id}" already exists in this mod`);

  const summary = { newId: id, donor, factionCountBefore: sm.all.length, files: {}, art: 0 };

  // 1. descr_sm_factions — the entry itself
  {
    const eol = eolOf(files.smFactions);
    const lines = linesOf(files.smFactions);
    const renameArt = pathRenamer(donor, id);
    // Only the KEY is renamed here, never the body. The body names the donor in
    // four other places and each must stay: "parni_men"/"parni_women" are
    // namelist pools that exist (and are meant to be shared), and
    // "horde parni horse archers" and friends are UNIT names out of
    // export_descr_unit — renaming those invents units the mod does not have.
    // The one exception is the faction icon, which is art and gets copied.
    const clone = sm.lines.map((l, ix) => {
      let out = ix === 0 ? l.replace(/"\w+"\s*:/, `"${id}":`) : l;
      out = renameArt(out, artCopies);
      const s = strip(out);
      if (/^\s*"string"\s*:/.test(s)) out = out.replace(/"string"\s*:\s*"[^"]*"/, `"string":      "${id.toUpperCase()}"`);
      if (/^\s*"description"\s*:/.test(s)) out = out.replace(/"description"\s*:\s*"[^"]*"/, `"description": "${id.toUpperCase()}_DESCR"`);
      if (culture && /^\s*"culture"\s*:/.test(s)) out = out.replace(/"culture"\s*:\s*"[^"]*"/, `"culture":   "${culture}"`);
      if (namelists) {
        if (namelists.men && /^\s*"men"\s*:/.test(s)) out = out.replace(/"men"\s*:\s*"[^"]*"/, `"men":      "${namelists.men}"`);
        if (namelists.women && /^\s*"women"\s*:/.test(s)) out = out.replace(/"women"\s*:\s*"[^"]*"/, `"women":    "${namelists.women}"`);
        if (namelists.surnames && /^\s*"surnames"\s*:/.test(s)) out = out.replace(/"surnames"\s*:\s*"[^"]*"/, `"surnames": "${namelists.surnames}"`);
      }
      if (colours) {
        if (colours.primary && /^\s*"primary"\s*:/.test(s)) out = out.replace(/"primary"\s*:\s*\[[^\]]*\]/, `"primary":   [ ${colours.primary.join(", ")}, ]`);
        if (colours.secondary && /^\s*"secondary"\s*:/.test(s)) out = out.replace(/"secondary"\s*:\s*\[[^\]]*\]/, `"secondary": [ ${colours.secondary.join(", ")}, ]`);
      }
      return out;
    });
    lines.splice(sm.end, 0, ...clone);
    edits.smFactions = lines.join(eol);
    summary.files.smFactions = clone.length + " lines";
  }

  // 2. descr_banners / 3. descr_character — `faction <id>` blocks, art renamed
  for (const [key, label] of [["banners", "descr_banners.txt"], ["character", "descr_character.txt"]]) {
    if (!files[key]) { warnings.push(`${label} was not supplied — the faction may not display correctly`); continue; }
    const r = cloneBlocks(files[key], donor, id, /^faction\s+(\w+)\s*$/, pathRenamer(donor, id));
    if (!r) { errors.push(`"${donor}" has no block in ${label}`); continue; }
    edits[key] = r.text;
    artCopies.push(...r.copies);
    summary.files[key] = `${r.blocks} block(s)`;
  }

  // 4. feral_descr_ai_personality — a personality that REFERENCES the donor's
  //    priority tables, rather than duplicating them
  if (files.aiPersonality) {
    const r = cloneBlocks(files.aiPersonality, "ai_" + donor, "ai_" + id, /^personality\s+(\w+)\s*$/, null);
    if (r) { edits.aiPersonality = r.text; summary.files.aiPersonality = "personality ai_" + id; }
    else errors.push(`"${donor}" has no personality block in feral_descr_ai_personality.txt`);
  } else warnings.push("feral_descr_ai_personality.txt was not supplied — the faction may have no AI behaviour");

  // 5. descr_model_strat — duplicate every faction-tagged line
  if (files.modelStrat) {
    const eol = eolOf(files.modelStrat);
    const lines = linesOf(files.modelStrat);
    const re = tokenRe(donor);
    const out = [];
    let tagged = 0;
    const copies = [];
    const rename = pathRenamer(donor, id);
    for (const l of lines) {
      out.push(l);
      re.lastIndex = 0;
      if (!re.test(strip(l))) continue;
      // only lines that TAG a faction, not prose or a path that merely contains it
      if (!/^\s*(texture|pbr_texture|model|no_variation)\b/.test(strip(l))) continue;
      out.push(swapToken(rename(l, copies), donor, id)); // paths first — see cloneBlocks
      tagged++;
    }
    edits.modelStrat = out.join(eol);
    artCopies.push(...copies);
    summary.files.modelStrat = tagged + " line(s)";
    if (!tagged) warnings.push("no strat-model lines found for the donor — the new faction may show no map models");
  } else warnings.push("descr_model_strat.txt was not supplied — the faction may show no models on the map");

  // 6. descr_win_conditions — every faction but the rebels has an entry
  if (files.winConditions) {
    // this file names the faction on a bare line, with its conditions under it
    const r = cloneBlocks(files.winConditions, donor, id, /^(\w+)\s*$/, null);
    if (r) { edits.winConditions = r.text; summary.files.winConditions = `${r.blocks} block(s)`; }
    else warnings.push(`"${donor}" has no block in descr_win_conditions.txt — the new faction will have no victory conditions`);
  }

  // 7. the display name, or the game shows the raw key
  if (files.expandedText != null) {
    const eol = eolOf(files.expandedText) || "\r\n";
    const key = id.toUpperCase();
    if (new RegExp("^\\{" + key + "\\}", "m").test(files.expandedText)) warnings.push(`{${key}} already exists in the text file — left as it is`);
    else {
      const name = displayName || id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const desc = (description || name).replace(/\r?\n/g, "\\n");
      edits.expandedText = files.expandedText.replace(/\s*$/, "") + eol +
        `{${key}}\t\t\t\t\t${name}` + eol +
        `{${key}_DESCR}\t\t\t\t\t${desc}` + eol;
      summary.files.expandedText = `{${key}} and {${key}_DESCR}`;
    }
  } else warnings.push("no text file supplied — the faction will show as its raw key in game");

  if (errors.length) return { edits: {}, artCopies: [], summary: null, warnings, errors };

  // de-duplicate the art list; the same texture is often named by several lines
  const seen = new Set();
  const art = artCopies.filter((c) => (seen.has(c.from + "|" + c.to) ? false : seen.add(c.from + "|" + c.to)));
  summary.art = art.length;
  summary.factionCountAfter = sm.all.length + 1;
  return { edits, artCopies: art, summary, warnings, errors: [] };
}

module.exports = { planNewFaction, smEntry, factionBlocks, cloneBlocks, pathRenamer, TOKEN };
