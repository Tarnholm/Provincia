// descrStratGeneral.js — backend for the "Add General to a faction" feature.
//
// Edits descr_strat.txt (new-campaign characters) with culture-correct, UNIQUE
// names + a configurable family (wife / sons / daughters, each with age + name),
// per the RTW naming-list mechanic (see memory reference_rtw_naming_lists):
//   * names.txt maps a UNIQUE token -> a DISPLAY name; many tokens share one
//     display via trailing-letter suffixes ({Gaius}/{GaiusA}/{GaiusB} = "Gaius").
//   * descr_names_lookup.txt is the flat validation list of legal tokens.
//   * descr_strat references a character by `<firstToken> <familyToken>`.
// To add a character we pick a culture display name, resolve it to a FREE token
// variant not already used by a LIVING character of that faction; if every
// variant is taken we mint the next one into BOTH names.txt and the lookup.
//
// All functions are pure (no disk writes); the caller (main.js) does the I/O
// + backups. Validated by scripts/save-cracker/dig-addgeneral-test.js.
"use strict";

// ── names.txt (UTF-16LE) ─────────────────────────────────────────────────────
// Returns { tokenToDisplay: Map, displayToTokens: Map(display -> [token,...]) }.
function parseNamesTxt(text) {
  const tokenToDisplay = new Map();
  const displayToTokens = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^﻿/, "").trim();
    const m = line.match(/^\{([^}]+)\}(.+)$/);
    if (!m) continue;
    const token = m[1], display = m[2].trim();
    tokenToDisplay.set(token, display);
    if (!displayToTokens.has(display)) displayToTokens.set(display, []);
    displayToTokens.get(display).push(token);
  }
  return { tokenToDisplay, displayToTokens };
}

// ── descr_names_lookup.txt (flat token list) ────────────────────────────────
function parseLookup(text) {
  const set = new Set();
  for (const raw of text.split(/\r?\n/)) { const t = raw.replace(/^﻿/, "").trim(); if (t) set.add(t); }
  return set;
}

// A name token in descr_strat is a first name (single word) or a family name
// (contains "_", e.g. Ogulnius_Gallus). A character is `<first> <family>`.
function isFamilyToken(tok) { return tok.includes("_"); }

// ── descr_strat ──────────────────────────────────────────────────────────────
// Parse into per-faction structures + the raw line array (so we can splice).
// Each faction: { name, ai, startLine, endLine (exclusive), characters,
//   characterRecords, relatives, generalUnit, settlements, usedFirstTokens,
//   usedFamilyTokens, usedFullKeys, subFactions }.
function parseDescrStrat(text) {
  const lines = text.split(/\r?\n/);
  const factionStarts = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^faction\s+([a-z_0-9]+)\s*,\s*([a-z_0-9]+)/i);
    if (m) factionStarts.push({ i, name: m[1], ai: m[2] });
  }
  const factions = [];
  for (let f = 0; f < factionStarts.length; f++) {
    const start = factionStarts[f].i;
    const end = f + 1 < factionStarts.length ? factionStarts[f + 1].i : lines.length;
    const fac = {
      name: factionStarts[f].name, ai: factionStarts[f].ai, startLine: start, endLine: end,
      characters: [], characterRecords: [], relatives: [], settlements: [],
      generalUnit: null, generalUnits: [], usedFirstTokens: new Set(), usedFamilyTokens: new Set(),
      usedFullKeys: new Set(), subFactions: [],
      firstCharLine: -1, firstFamilyDefLine: -1,
    };
    let lastComment = null;
    for (let i = start; i < end; i++) {
      const line = lines[i];
      const rawT = line.trim();
      // ;CityName comment lines precede a settlement's governor character — they
      // are how descr_strat encodes each settlement's tile (the governor's x,y).
      const cm0 = rawT.match(/^;\s*(.+?)\s*$/);
      if (cm0) { lastComment = cm0[1]; continue; }
      // Strip INLINE comments (a `;` anywhere starts a comment in descr_strat) so
      // a commented-out tail isn't parsed as data — e.g. a `relative …, end;Iolaos,
      // …, end` line was yielding a bogus family member literally named "end;Iolaos".
      const t = rawT.includes(";") ? rawT.slice(0, rawT.indexOf(";")).trim() : rawT;
      if (!t) continue;
      // character, <First> <Family>, named character, [leader|heir|male|female], age N, , x X, y Y
      // Tolerant of every descr_strat dialect: optional comma after `character`,
      // optional leader/heir tag OR command/influence/… stat fields between
      // `named character` and `age`, and negative coords.
      let m = t.match(/^character\s*,?\s*([^,]+?)\s*,\s*named character\s*,\s*(.*?)\s*age\s+(\d+)\b.*?\bx\s+(-?\d+)\s*,\s*y\s+(-?\d+)/i);
      if (m) {
        if (fac.firstCharLine < 0) fac.firstCharLine = i;
        const nameParts = m[1].trim().split(/\s+/);
        const firstTok = nameParts[0];
        const famTok = nameParts.length > 1 ? nameParts[nameParts.length - 1] : null;
        const mid = (m[2] || "").toLowerCase();
        const tag = /\bleader\b/.test(mid) ? "leader" : /\bheir\b/.test(mid) ? "heir" : "";
        const ch = { line: i, firstTok, famTok, tag, age: +m[3], x: +m[4], y: +m[5],
          leader: tag === "leader", heir: tag === "heir", settlementHint: lastComment };
        fac.characters.push(ch);
        lastComment = null;
        fac.usedFirstTokens.add(firstTok);
        if (famTok) { fac.usedFamilyTokens.add(famTok); fac.usedFullKeys.add(firstTok + " " + famTok); }
        else fac.usedFullKeys.add(firstTok);
        continue;
      }
      // character_record <Name...>, <gender>, age N, alive|dead, ...
      m = t.match(/^character_record\s+([^,]+?)\s*,\s*(male|female)\s*,.*?\bage\s+(\d+)\s*,\s*(alive|dead)/i);
      if (m) {
        if (fac.firstFamilyDefLine < 0) fac.firstFamilyDefLine = i;
        const nameParts = m[1].trim().split(/\s+/);
        const firstTok = nameParts[0];
        const famTok = nameParts.length > 1 ? nameParts[nameParts.length - 1] : null;
        fac.characterRecords.push({ line: i, firstTok, famTok, gender: m[2].toLowerCase(), age: +m[3], alive: m[4].toLowerCase() === "alive" });
        fac.usedFirstTokens.add(firstTok);
        if (famTok && isFamilyToken(famTok)) { fac.usedFamilyTokens.add(famTok); fac.usedFullKeys.add(firstTok + " " + famTok); }
        else fac.usedFullKeys.add(firstTok);
        continue;
      }
      // relative <Head full>, <Wife first>, [<child>...], end
      if (/^relative\s/i.test(t)) {
        if (fac.firstFamilyDefLine < 0) fac.firstFamilyDefLine = i;
        const body = t.replace(/^relative\s+/i, "").replace(/,?\s*end\s*$/i, "");
        const fields = body.split(",").map((s) => s.trim()).filter(Boolean);
        if (fields.length) {
          const head = fields[0];
          const headParts = head.split(/\s+/);
          fac.relatives.push({ line: i, headFirst: headParts[0], headFam: headParts[1] || null, fields });
          // classify children for gender pools: sons = "First Family", daughters = single token
          for (let k = 1; k < fields.length; k++) {
            const parts = fields[k].split(/\s+/);
            if (parts.length > 1) { fac._sons = fac._sons || []; fac._sons.push(parts[0]); fac.usedFamilyTokens.add(parts[parts.length - 1]); }
            else { fac._females = fac._females || []; fac._females.push(parts[0]); } // wife (k==1) or daughter
            fac.usedFirstTokens.add(parts[0]);
          }
        }
        continue;
      }
      // Capture the faction's general/bodyguard unit(s). The unit name is the
      // full string between `unit` and `exp` (e.g. "pergamene general's
      // bodyguard") — truncating at "general" produces a non-existent unit that
      // RTW rejects. Keep only names containing "general" (the bodyguard units).
      { const gm = t.match(/^unit\s+(.+?)\s+exp\b/i); if (gm && /\bgeneral\b/i.test(gm[1])) { const u = gm[1].trim(); if (!fac.generalUnit) fac.generalUnit = u; if (!fac.generalUnits.includes(u)) fac.generalUnits.push(u); } }
      // settlement region name
      const rm = t.match(/^region\s+(.+)$/i); if (rm) fac.settlements.push({ region: rm[1].trim() });
      // sub_faction marker (rebels)
      const sf = t.match(/^sub_faction\s+([a-z_0-9]+)/i); if (sf) fac.subFactions.push({ line: i, name: sf[1] });
    }
    factions.push(fac);
  }
  return { lines, factions };
}

// Build a settlement-name -> { faction, x, y } index from the `;CityName`
// governor-comment placements (descr_strat-space coords; no transform needed).
// Prefers clean city comments over "Outside …"/"Port of …"/region hints.
function buildSettlementCoordIndex(parsed) {
  const idx = new Map();
  const norm = (s) => s.toLowerCase().replace(/^(outside|port of)\s+/i, "").trim();
  // Guard: a malformed / empty parse (or a caller that passed undefined) must
  // not throw "Cannot read properties of undefined (reading 'factions')" —
  // return an empty index so the caller cleanly falls back instead of crashing.
  if (!parsed || !Array.isArray(parsed.factions)) return idx;
  for (const fac of parsed.factions) {
    for (const c of fac.characters) {
      if (!c.settlementHint) continue;
      const clean = !/^(outside|port of)\b/i.test(c.settlementHint);
      const key = norm(c.settlementHint);
      const cur = idx.get(key);
      if (!cur || (clean && cur._dirty)) idx.set(key, { faction: fac.name, x: c.x, y: c.y, hint: c.settlementHint, _dirty: !clean });
    }
  }
  return idx;
}
// Resolve a settlement name (city) to placement coords + creator faction. Falls
// back to the faction's capital (leader) if the name isn't a known governor spot.
function resolveSettlement(parsed, settlementName, factionHint) {
  if (!parsed || !Array.isArray(parsed.factions)) return null;
  const idx = buildSettlementCoordIndex(parsed);
  const hit = idx.get(String(settlementName || "").toLowerCase().trim());
  if (hit) return { faction: hit.faction, x: hit.x, y: hit.y, via: "settlement" };
  if (factionHint) {
    const fac = parsed.factions.find((f) => f.name === factionHint);
    const leader = fac && fac.characters.find((c) => c.leader);
    if (leader) return { faction: fac.name, x: leader.x, y: leader.y, via: "capital-fallback" };
  }
  return null;
}

// Suffix-letter → regnal numeral, matching src/displayName.js so the Add-General
// join dropdown reads the same as the in-app family tree: AttalosB → "Attalos II",
// AttalosC → "Attalos III"; the base token (no suffix) stays plain "Attalos".
const ROMAN_FOR_SUFFIX = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

// Parse descr_sm_factions.txt → { factionId: { men, women } } namelist assignment.
// Faction ids sit at one-tab indent ("\t\"id\":"); each block has a "namelists"
// object naming its men/women lists (e.g. taras → greek_men / greek_women).
function parseSmFactionNamelists(text) {
  const out = {};
  if (!text) return out;
  const ids = [...text.matchAll(/^\t"(\w+)":/gm)];
  for (let i = 0; i < ids.length; i++) {
    const blk = text.slice(ids[i].index, i + 1 < ids.length ? ids[i + 1].index : text.length);
    const nl = /"namelists"\s*:\s*\{([\s\S]*?)\}/.exec(blk);
    if (!nl) continue;
    const men = /"men"\s*:\s*"([^"]+)"/.exec(nl[1]);
    const women = /"women"\s*:\s*"([^"]+)"/.exec(nl[1]);
    out[ids[i][1]] = { men: men ? men[1] : null, women: women ? women[1] : null };
  }
  return out;
}

// Parse descr_namelists.txt → { namelistName: [token, ...] } (e.g. greek_men → [...]).
function parseNamelistPools(text) {
  const out = {};
  if (!text) return out;
  const re = /"(\w+)"\s*:\s*\{\s*"names"\s*:\s*\[([\s\S]*?)\]/g;
  let m;
  while ((m = re.exec(text))) out[m[1]] = (m[2].match(/"([^"]+)"/g) || []).map((s) => s.slice(1, -1));
  return out;
}

// 0.9.869: insert name tokens into a descr_namelists.txt pool's `names` array.
// RTW validates EVERY descr_strat character name against the faction's culture
// namelist; a minted token that's only in names.txt + descr_names_lookup.txt
// (but not here) breaks campaign start. Inserts right after the pool's `[`,
// matching the file's `\t\t\t"Name",` style. Skips tokens already present.
// Returns the modified raw text, or null if the pool isn't found / nothing to do.
function insertNamelistTokens(raw, poolName, tokens, eol = "\r\n") {
  if (!raw || !poolName || !Array.isArray(tokens) || !tokens.length) return null;
  const esc = poolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`("${esc}"\\s*:\\s*\\{\\s*"names"\\s*:\\s*\\[)([\\s\\S]*?)\\]`, "m");
  const m = re.exec(raw);
  if (!m) return null;
  const existing = new Set((m[2].match(/"([^"]+)"/g) || []).map((s) => s.slice(1, -1)));
  const add = tokens.filter((t) => t && !existing.has(t));
  if (!add.length) return null;
  const insertAt = m.index + m[1].length; // right after the opening '['
  const block = add.map((t) => `${eol}\t\t\t"${t}",`).join("");
  return raw.slice(0, insertAt) + block + raw.slice(insertAt);
}

// Per-faction display-name pools for the UI, classified by gender + family.
// `extra` (optional) carries the faction's LIVE culture namelist tokens
// ({ men:[…], women:[…] }) so names registered in descr_namelists.txt that no
// character uses yet are still offered in the dropdowns.
function buildPools(fac, names, extra) {
  const male = new Set(), female = new Set();
  const disp = (tok) => names.tokenToDisplay.get(tok) || tok.replace(/_/g, " ");
  const regnal = (tok) => {
    const m = /^(.+?[a-z])([A-Z])$/.exec(tok || "");
    if (!m) return disp(tok);
    return disp(m[1]) + " " + (ROMAN_FOR_SUFFIX[m[2].charCodeAt(0) - 65] || m[2]);
  };
  for (const c of fac.characters) male.add(disp(c.firstTok));
  for (const r of fac.characterRecords) (r.gender === "female" ? female : male).add(disp(r.firstTok));
  for (const rel of fac.relatives) male.add(disp(rel.headFirst));
  for (const t of (fac._sons || [])) male.add(disp(t));
  for (const t of (fac._females || [])) female.add(disp(t));
  // Live culture namelist names (caller passes the faction's greek_men/greek_women
  // etc. token lists) — surfaces namelist names not yet used by any character.
  if (extra) {
    for (const t of (extra.men || [])) male.add(disp(t));
    for (const t of (extra.women || [])) female.add(disp(t));
  }
  // Surname culture (Roman: First_Family) vs single-name (Greek/Eastern: First).
  const usesSurnames = fac.characters.some((c) => c.famTok) || fac.relatives.some((r) => r.headFam)
    || fac.characterRecords.some((r) => r.famTok && isFamilyToken(r.famTok));
  // families = each relative-line HEAD (a household) — works for BOTH cultures.
  // id uniquely identifies the line so JOIN can attach the new general as a child.
  const families = [];
  const seen = new Set();
  for (const rel of fac.relatives) {
    const id = rel.headFirst + "|" + (rel.headFam || "");
    if (seen.has(id)) continue; seen.add(id);
    // fields[0]=head, fields[1]=wife (single-name female token, by convention).
    const wifeField = rel.fields && rel.fields[1] ? rel.fields[1].trim() : "";
    const mother = wifeField && !wifeField.includes(" ") ? regnal(wifeField.split(/\s+/)[0]) : null;
    families.push({
      id, headFirst: rel.headFirst, headFam: rel.headFam || null,
      display: regnal(rel.headFirst) + (rel.headFam ? " " + disp(rel.headFam) : ""),
      head: regnal(rel.headFirst), mother,
    });
  }
  families.sort((a, b) => a.display.localeCompare(b.display, undefined, { numeric: true }));
  return { maleFirst: [...male].sort(), femaleFirst: [...female].sort(), families, usesSurnames };
}

// Detect duplicate character name tokens within a faction (and sub_faction) —
// duplicates cause engine issues. Returns [{ key, count }].
function findDuplicateNames(fac) {
  const counts = new Map();
  const add = (k) => counts.set(k, (counts.get(k) || 0) + 1);
  for (const c of fac.characters) add(c.famTok ? `${c.firstTok} ${c.famTok}` : c.firstTok);
  for (const r of fac.characterRecords) add(r.famTok ? `${r.firstTok} ${r.famTok}` : r.firstTok);
  return [...counts.entries()].filter(([, n]) => n > 1).map(([key, count]) => ({ key, count }));
}

// Resolve a DISPLAY name to a FREE unique token not in `used`. Prefers existing
// variants ({X},{XA},{XB}...); if all taken, mints the next letter (caller must
// append it to names.txt + lookup). gender/family unused here — validity is via
// the existing variants' presence.
function resolveFreeToken(display, names, used, opts = {}) {
  const variants = (names.displayToTokens.get(display) || []).filter((t) => opts.family ? isFamilyToken(t) : !isFamilyToken(t));
  for (const v of variants) if (!used.has(v)) return { token: v, mint: false };
  // mint next letter on the base token
  const base = variants.find((v) => !/[A-Z]$/.test(v)) || variants[0] || (opts.family ? display.replace(/\s+/g, "_") : display.replace(/\s+/g, ""));
  for (let code = 65; code <= 90; code++) {
    const cand = base + String.fromCharCode(code);
    if (!used.has(cand) && !names.tokenToDisplay.has(cand)) return { token: cand, mint: true, display };
  }
  return null;
}

// Compose the descr_strat edit + any name-list additions.
// selection = {
//   factionName, x, y,
//   general: { firstDisplay, age },
//   familyName: <family display>  (existing family display OR a new surname display),
//   familyToken?: <existing family token to JOIN>  (omit for a new line),
//   wife?:    { firstDisplay, age },
//   children: [ { firstDisplay, gender: "son"|"daughter", age } ],
// }
// Returns { lines: newLinesArray, namesAppend: [{token,display}], lookupAppend: [token], summary }.
function composeAddGeneral(parsed, names, selection) {
  const fac = parsed.factions.find((f) => f.name === selection.factionName);
  if (!fac) throw new Error(`faction not found: ${selection.factionName}`);
  const generalUnit = selection.generalUnit || fac.generalUnit || "roman general";
  const used = new Set([...fac.usedFirstTokens, ...fac.usedFamilyTokens, ...fac.usedFullKeys]);
  const namesAppend = [], lookupAppend = [];
  const take = (display, opts = {}) => {
    const r = resolveFreeToken(display, names, used, opts);
    if (!r) throw new Error(`no free token for "${display}"`);
    used.add(r.token);
    if (r.mint) {
      // 0.9.869: tag gender so the writer can register a minted token in the
      // RIGHT culture namelist (men vs women) in descr_namelists.txt — RTW
      // validates every descr_strat character name against the faction's
      // namelist, so a minted token missing from it breaks campaign start.
      const gender = opts.female ? "female" : (opts.family ? null : "male");
      namesAppend.push({ token: r.token, display: r.display, gender });
      lookupAppend.push(r.token);
    }
    return r.token;
  };

  // Resolve the family. Two cultures:
  //   * surname cultures (Roman): characters are `<First> <Surname>`.
  //   * single-name cultures (Greek/Eastern/most factions): just `<First>` —
  //     a "family" is a relative-line household identified by the head's name.
  // JOIN existing: inherit the chosen head's surname (or none) and ALSO add the
  // general as a child of that head's relative line. NEW line: own surname (if
  // surname culture) + own relative line.
  let famTok = null, joinHead = null;
  if (selection.familyId) {
    joinHead = fac.relatives.find((r) => (r.headFirst + "|" + (r.headFam || "")) === selection.familyId);
    famTok = (joinHead && joinHead.headFam) || null;
    if (famTok) used.add(famTok);
  } else if (selection.familyName) {
    const surnameTok = take(selection.familyName, { family: true });
    famTok = isFamilyToken(surnameTok) ? surnameTok : null; // single-name culture → no surname
  }
  const sur = famTok ? ` ${famTok}` : "";
  const genFirst = take(selection.general.firstDisplay);
  const nameTok = `${genFirst}${sur}`;

  // on-map general character block. Format MUST match the mod's descr_strat:
  //   character,\t<Name>, named character, age N, , x N, y N
  // (comma after `character`; an optional leader/heir tag goes where we leave
  // nothing; NO gender word and NO stat fields — adding either makes RTW
  // reject the campaign.)
  // Location comment above the character (descr_strat convention). On the
  // settlement's own tile → just the city name; moved off it (dragged) → it's
  // standing in the field/region → "Outside <City>".
  const block = [];
  if (selection.settlement) {
    const onCity = selection.homeX != null && selection.x === selection.homeX && selection.y === selection.homeY;
    block.push(`;${onCity ? selection.settlement : "Outside " + selection.settlement}`);
  }
  block.push(`character,\t${nameTok}, named character, age ${selection.general.age}, , x ${selection.x}, y ${selection.y}`);
  block.push(`traits ReligionAssigned 1, GoodCommander 1, TurnsAlive 1`);
  block.push(`army`);
  block.push(`unit\t\t${generalUnit}\t\t\t\texp 0 armour 0 weapon_lvl 0`);
  block.push(``);

  // wife + children as off-map character_records + the general's own relative line
  const famDef = [];
  const relChildren = [];
  let wifeTok;
  // character_record format MUST match the mod's descr_strat:
  //   character_record\t<Name>, <gender>, age N, (alive|dead), never_a_leader
  // (no stat fields).
  if (selection.wife) {
    wifeTok = take(selection.wife.firstDisplay, { female: true });
    const wifeState = selection.wife.dead ? "dead" : "alive";
    famDef.push(`character_record\t${wifeTok}, \tfemale, age ${selection.wife.age}, ${wifeState}, never_a_leader`);
  }
  for (const kid of (selection.children || [])) {
    if (kid.gender === "son") {
      const kTok = take(kid.firstDisplay);
      famDef.push(`character_record\t${kTok}${sur}, \tmale, age ${kid.age}, alive, never_a_leader`);
      relChildren.push(`${kTok}${sur}`);
    } else {
      const kTok = take(kid.firstDisplay, { female: true });
      famDef.push(`character_record\t${kTok}, \tfemale, age ${kid.age}, alive, never_a_leader`);
      relChildren.push(kTok);
    }
  }
  const relParts = [nameTok];
  if (wifeTok) relParts.push(wifeTok);
  for (const c of relChildren) relParts.push(c);
  const relativeLine = (relParts.length > 1) ? `relative\t${relParts.join(", ")}, end` : null;

  const lines = parsed.lines.slice();
  // JOIN: insert the general (a son) into the chosen head's existing relative
  // line, BEFORE the splices below (so its line index isn't shifted yet).
  let joinedInto = null;
  if (joinHead && joinHead.line >= 0 && joinHead.line < lines.length) {
    const ln = lines[joinHead.line];
    const m = ln.match(/^(.*?),?\s*end\s*$/i);
    if (m) { lines[joinHead.line] = `${m[1]}, ${nameTok}, end`; joinedInto = `${joinHead.headFirst}${joinHead.headFam ? " " + joinHead.headFam : ""}`; }
  }
  // descr_strat REQUIRES this order within a faction: on-map `character` blocks,
  // then ALL `character_record` lines, then ALL `relative` lines. Inserting the
  // new records after the existing relatives triggers RTW's
  //   "Unexpected section after relative: character_record"
  // error. So: records go before the first relative; the new relative goes after
  // the last one (faction end); the character block stays in the on-map section.
  // Splice high index → low so earlier insertion points don't shift.
  const firstRelLine = fac.relatives.length ? Math.min(...fac.relatives.map((r) => r.line)) : fac.endLine;
  const recordsAt = firstRelLine;
  const relativeAt = fac.endLine;
  const charAt = fac.firstFamilyDefLine >= 0 ? fac.firstFamilyDefLine : firstRelLine;
  if (relativeLine) lines.splice(relativeAt, 0, relativeLine, ``);
  if (famDef.length) lines.splice(recordsAt, 0, ...famDef);
  lines.splice(charAt, 0, ...block);

  return {
    lines, namesAppend, lookupAppend,
    summary: { faction: fac.name, general: nameTok, generalUnit, surname: famTok || null,
      wife: selection.wife ? true : false, children: (selection.children || []).length,
      minted: namesAppend.map((n) => n.token), joinedInto, relativeLine, charAt, recordsAt, relativeAt },
  };
}

// descr_regions.txt: each region block is `RegionName \n <city> \n <creator> \n
// <rebel> \n <r g b> \n <resources> ...`. Returns region->{city,rgb} and rgb->region.
function parseDescrRegions(text) {
  const lines = text.split(/\r?\n/);
  const regionToCity = {}, rgbToRegion = {};
  for (let i = 0; i < lines.length; i++) {
    const name = lines[i];
    if (!name || /^[;\s]/.test(name)) continue; // region names start at col 0
    if (!/^[A-Za-z]/.test(name)) continue;
    const city = (lines[i + 1] || "").trim();
    const rgbLine = (lines[i + 4] || "").trim();
    const m = rgbLine.match(/^(\d+)\s+(\d+)\s+(\d+)/);
    if (city && m) {
      const region = name.trim();
      regionToCity[region] = city;
      rgbToRegion[`${+m[1]},${+m[2]},${+m[3]}`] = region;
    }
  }
  return { regionToCity, rgbToRegion };
}

// Resolve every settlement's tile from map_regions.tga: each settlement is a
// BLACK pixel; its region = the surrounding region colour. Returns region ->
// {x,y} in descr_strat space (descr_y = H-1 - tga_y_top). 24bpp uncompressed,
// bottom-left origin assumed (verified: 1020x700).
function buildRegionCoords(tgaBuf, rgbToRegion) {
  const W = tgaBuf.readUInt16LE(12), H = tgaBuf.readUInt16LE(14), desc = tgaBuf[17];
  const dataOff = 18 + tgaBuf[0];
  const bottomLeft = (desc & 0x20) === 0;
  const px = (col, rowTop) => { const r = bottomLeft ? (H - 1 - rowTop) : rowTop; const o = dataOff + (r * W + col) * 3; return [tgaBuf[o + 2], tgaBuf[o + 1], tgaBuf[o]]; };
  const out = {};
  for (let yTop = 0; yTop < H; yTop++) {
    for (let col = 0; col < W; col++) {
      const [r, g, b] = px(col, yTop);
      if (r !== 0 || g !== 0 || b !== 0) continue; // settlements are black
      // sample neighbours for the region colour
      let region = null;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
        const nx = col + dx, ny = yTop + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const [nr, ng, nb] = px(nx, ny);
        if (nr === 0 && ng === 0 && nb === 0) continue;
        const reg = rgbToRegion[`${nr},${ng},${nb}`];
        if (reg) { region = reg; break; }
      }
      if (region && !out[region]) out[region] = { x: col, y: H - 1 - yTop };
    }
  }
  return out;
}

// Per-faction OWNED settlements (from descr_strat settlement blocks = the
// regions listed under each faction section), resolved to city name + coords.
// Coords from the black-pixel region map, falling back to the governor-comment
// index. Returns { factionName: [{ city, region, x, y }] }.
function factionOwnedSettlements(parsed, regionToCity, regionCoords, coordIndex) {
  const out = {};
  for (const fac of parsed.factions) {
    const list = [];
    const seen = new Set();
    for (const s of fac.settlements) {
      const region = s.region;
      if (seen.has(region)) continue; seen.add(region);
      const city = (regionToCity && regionToCity[region]) || region;
      let c = regionCoords && regionCoords[region];
      if (!c && coordIndex) { const hit = coordIndex.get(String(city).toLowerCase()); if (hit) c = { x: hit.x, y: hit.y }; }
      list.push({ city, region, x: c ? c.x : null, y: c ? c.y : null });
    }
    list.sort((a, b) => a.city.localeCompare(b.city));
    out[fac.name] = list;
  }
  return out;
}

// Parse the descr_strat diplomacy section. Three value types per faction pair:
//   core_attitudes        — starting AI disposition (-10..1000)
//   faction_relationships — starting relation STATE (<199 ally / 200 neutral / >201 war)
//   faction_agression     — post-turn-1 aggression (-200..700)  [sic: one 'g']
// Returns byFaction[from][to] = { core, rel, agg }, plus per-(kind,from,to) line
// indices for in-place edits and the last line per kind (insert point).
const DIPLO_KW = { core_attitudes: "core", faction_relationships: "rel", faction_agression: "agg", faction_aggression: "agg" };
const DIPLO_WORD = { core: "core_attitudes", rel: "faction_relationships", agg: "faction_agression" };
function parseDiplomacy(text) {
  const lines = text.split(/\r?\n/);
  const byFaction = {};   // from -> { to: { core, rel, agg } }
  const lineOf = {};      // `${kind}|${from}|${to}` -> line index
  const lastLine = {};    // kind -> last line index (insert point for new ones)
  const re = /^\s*(core_attitudes|faction_relationships|faction_ag+ression)\s+([a-z_0-9]+)\s*,\s*(-?\d+)\s+([a-z_0-9]+)/i;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*;/.test(lines[i])) continue;
    const m = lines[i].match(re);
    if (!m) continue;
    const kind = DIPLO_KW[m[1].toLowerCase()] || "core";
    const to = m[2].toLowerCase(), value = parseInt(m[3], 10), from = m[4].toLowerCase();
    const f = byFaction[from] || (byFaction[from] = {});
    (f[to] || (f[to] = {}))[kind] = value;
    lineOf[`${kind}|${from}|${to}`] = i;
    lastLine[kind] = i;
  }
  return { byFaction, lineOf, lastLine };
}
// Build a descr_strat diplomacy line for a given kind/from/to/value.
function diploLine(kind, from, to, value) {
  return `\t\t${DIPLO_WORD[kind] || "core_attitudes"}\t\t\t${to},\t\t\t\t\t${value}\t\t\t\t\t${from}`;
}

module.exports = {
  parseNamesTxt, parseLookup, parseDescrStrat, buildPools, findDuplicateNames,
  parseSmFactionNamelists, parseNamelistPools, insertNamelistTokens,
  resolveFreeToken, composeAddGeneral, isFamilyToken,
  buildSettlementCoordIndex, resolveSettlement,
  parseDescrRegions, buildRegionCoords, factionOwnedSettlements,
  parseDiplomacy, diploLine,
};
