/**
 * Links for recruitment requirements, shared by the faction pages and the unit pages so a
 * condition reads, and links, the same on both.
 *
 *   const RL = makeReqLinks({ edb, OUT, bName, chainNames });
 *   RL.linkAlias("mic_tier_1", "Garrison Building or Tier 1 Military Industrial Complex")
 *   RL.levelLink("smiths_workshop")        // "[Armourer (Industry)](../buildings/smith.md)"
 *   RL.tagClause("aor_achaian")            // "[Achaian area of recruitment](../tags/…)"
 *
 * All hrefs are written from a page one folder down (../buildings/…), which is where both
 * callers write.
 */
const fs = require("fs");
const path = require("path");

const humanise = (t) => String(t).replace(/^(aor|homeland|rel)_/, "").replace(/_/g, " ")
  .replace(/\b\w/g, (c) => c.toUpperCase());

function makeReqLinks({ edb, OUT, bName, chainNames = {} }) {
  // Aliases nest (`aor_tier_1` is `gov_tier_1 and not colony_tier_2`), so an alias's chains are
  // its own `building_present` chains plus those of every alias it names, followed through.
  const bodies = {};
  for (const m of edb.matchAll(/^alias\s+([A-Za-z0-9_]+)[^\n]*\n\s*\{([\s\S]*?)\n\s*\}/gm)) {
    bodies[m[1].toLowerCase()] = m[2].split(/\bdisplay_string\b/)[0];
  }
  const resolve = (k, seen = new Set()) => {
    if (seen.has(k) || !bodies[k]) return [];
    seen.add(k);
    const out = [];
    const body = bodies[k];
    for (const b of body.matchAll(/building_present(?:_min_level)?\s+([A-Za-z0-9_]+)/g)) {
      const c = b[1].toLowerCase(); if (!out.includes(c)) out.push(c);
    }
    for (const w of body.toLowerCase().split(/[^a-z0-9_]+/)) {
      if (w !== k && bodies[w]) for (const c of resolve(w, seen)) if (!out.includes(c)) out.push(c);
    }
    return out;
  };
  const ALIAS_CHAINS = {};
  for (const k of Object.keys(bodies)) { const c = resolve(k); if (c.length) ALIAS_CHAINS[k] = c; }

  // A chain's words: its token, then every level's display name ("Dependency" is the name of
  // governmentA's only level), so a label can be matched to the building it names. Also the
  // reverse, level token -> chain, for linking a level named on its own.
  const CHAIN_WORDS = {};
  const CHAIN_OF_LEVEL = {};
  let cur = null;
  for (const line of edb.split(/\r?\n/)) {
    const bm = /^building\s+(\S+)/.exec(line);
    if (bm) { cur = bm[1].toLowerCase(); CHAIN_WORDS[cur] = [cur.replace(/_/g, " ")]; continue; }
    const lm = /^\s*levels\s+(.+)$/.exec(line);
    if (lm && cur) for (const l of lm[1].trim().split(/\s+/)) {
      CHAIN_WORDS[cur].push(bName(l) || l);
      if (!CHAIN_OF_LEVEL[l.toLowerCase()]) CHAIN_OF_LEVEL[l.toLowerCase()] = cur;
    }
  }

  const readJson = (...f) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, ...f), "utf8")); } catch { return {}; } };
  const TAG_REFS = readJson("tags", "index.json");
  let pages = null;
  const buildingPages = () => pages || (pages = new Set((() => {
    try { return fs.readdirSync(path.join(OUT, "buildings")).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)); } catch { return []; }
  })()));

  // A chain's display name: the caller's table, else the game's own `<chain>_name` text entry
  // ("governmentA_name" is "Government").
  const chainName = (c) => chainNames[c] || bName(`${c}_name`) || null;
  const chainPage = (c) => (c && buildingPages().has(String(c).toLowerCase()) ? `../buildings/${String(c).toLowerCase()}.md` : null);
  // What a reader calls a chain: its only level's name where it has one level (the four
  // government chains are all "Government" but their levels are Dependency, Indirect Rule, …).
  const chainLabel = (c) => {
    const levels = (CHAIN_WORDS[c] || []).slice(1);
    return levels.length === 1 ? levels[0] : (chainName(c) || humanise(c));
  };
  // A building level by its display name, linked to its chain's page.
  const levelLink = (level, chain) => {
    const name = bName(level) || null;
    const page = chainPage(chain || CHAIN_OF_LEVEL[String(level).toLowerCase()]);
    return name ? (page ? `[${name}](${page})` : name) : null;
  };

  // Names a sentence-style alias can mention, to their pages: every building level's display
  // name (to its chain) and every trade good that has a page. "Requires horses resource, if not
  // available locally you can build Fine Horse Exports to supply it" names both.
  let phrasesCache = null;
  const phrases = () => phrasesCache || (phrasesCache = (() => {
    const out = new Map();   // exact text -> href
    for (const [c, w] of Object.entries(CHAIN_WORDS)) {
      if (!chainPage(c)) continue;
      for (const name of w.slice(1)) if (name && name.length >= 5 && !/^[a-z0-9_]+$/.test(name) && !out.has(name)) out.set(name, chainPage(c));
    }
    try {
      for (const f of fs.readdirSync(path.join(OUT, "goods")).filter((n) => n.endsWith(".md"))) {
        out.set(f.slice(0, -3).replace(/_/g, " "), `../goods/${f}`);
      }
    } catch { /* no goods pages yet */ }
    return [...out].sort((a, b) => b[0].length - a[0].length);
  })());
  function linkPhrases(label) {
    const slots = [];
    let s = label;
    for (const [name, href] of phrases()) {
      // Loose enough for how the mod's prose names its own buildings: a trailing "(Rural)" tag
      // dropped and a plural optional ("Fine Horse Exports" is the level "Fine Horses Exports
      // (Rural)"). Only for names of two or more words, so single words stay exact.
      const core = name.replace(/\s*\([^)]*\)\s*$/, "").trim();
      const multi = core.split(/\s+/).length >= 2;
      const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const body = multi ? core.split(/\s+/).map((w) => `${esc(w.replace(/s$/i, ""))}s?`).join("\\s+") : esc(name);
      const m = new RegExp(`\\b${body}\\b`, "i").exec(s);
      if (!m) continue;
      slots.push(`[${m[0]}](${href})`);
      s = s.slice(0, m.index) + `\u0000${slots.length - 1}\u0000` + s.slice(m.index + m[0].length);
    }
    return slots.length ? s.replace(/\u0000(\d+)\u0000/g, (x, i) => slots[+i]) : null;
  }

  // An alias's display string links each part ("A or B | C not built") to the building it
  // names, matched by shared words, since the display string and the alias body need not name
  // them in the same order (the garrison alias tests the Military Industrial Complex first but
  // says "Garrison Building" first). A part matching several buildings equally means ANY of them
  // ("Government Building"), so those are spelled out. A sentence links the names inside it.
  function linkAlias(k, label) {
    if (!/\s+or\s+|\|/i.test(label) && label.split(/\s+/).length > 6) {
      const p = linkPhrases(label);
      if (p) return p;
    }
    const chains = (ALIAS_CHAINS[k] || []).filter((c) => chainPage(c));
    if (!chains.length || /\]\(/.test(label)) return label;
    const words = (s) => new Set(String(s).toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !["not", "built", "tier", "any", "building"].includes(w)));
    const bits = label.split(/(\s+or\s+|\s*\|\s*)/i);
    let hits = 0;
    const linked = bits.map((p, i) => {
      if (i % 2) return p;
      const pw = words(p);
      let best = null, bestScore = 0, tied = [];
      for (const c of chains) {
        const cw = words(`${(CHAIN_WORDS[c] || [c]).join(" ")} ${chainName(c) || ""}`);
        const score = [...pw].filter((w) => cw.has(w)).length;
        if (score > bestScore) { bestScore = score; best = c; tied = [c]; } else if (score && score === bestScore) tied.push(c);
      }
      if (!best) return p;
      hits++;
      if (tied.length === 1) return `[${p.trim()}](${chainPage(best)})`;
      const names = tied.map((c) => `[${chainLabel(c)}](${chainPage(c)})`);
      return `${p.trim()} (${names.slice(0, -1).join(", ")} or ${names[names.length - 1]})`;
    });
    if (hits) return linked.join("");
    return chains.length === 1 ? `[${label}](${chainPage(chains[0])})` : `[${label}](../buildings.md)`;
  }

  // A region tag named in a condition: a recruitment zone as "X area of recruitment", any other
  // documented tag as "in a X region", linked to its section on the region-tag reference. null
  // when the reference does not cover the tag, so the caller keeps its own wording.
  function tagClause(tok) {
    const t = String(tok).toLowerCase();
    const ref = TAG_REFS[t];
    if (/^aor_/.test(t)) {
      const label = `${humanise(t)} area of recruitment`;
      return ref && ref.page && ref.anchor ? `[${label}](../tags/${ref.page}#${ref.anchor})` : label;
    }
    if (ref && ref.page && ref.anchor) return `in a [${ref.name || humanise(t)} region](../tags/${ref.page}#${ref.anchor})`;
    return null;
  }

  return { ALIAS_CHAINS, CHAIN_WORDS, CHAIN_OF_LEVEL, TAG_REFS, chainPage, chainLabel, levelLink, linkPhrases, linkAlias, tagClause };
}

module.exports = { makeReqLinks };
