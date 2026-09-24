#!/usr/bin/env node
/**
 * RIS wiki: one page per revolt / breakaway / civil war, plus revolts.md and revolts/index.json.
 *
 *   node scripts/gen-ris-revolt-pages.js [--ris C:/RIS/RIS/data] [--out C:/RIS/_wiki] [--dry-run]
 *
 * Revolts live in RIS_Campaign_Script.txt as numbered sections ("27. THESSALY REVOLTS"). Each
 * marks regions with a hidden resource (`thessaly_has_revolted`), calls provoke_rebellion on
 * their settlements, and a spawn script registered in descr_strat (`spawn_script thessaly,
 * revolt, spawn_scripts/thessaly_revolt.txt`) hands every settlement carrying that resource to
 * the emerging faction. A message_prompt then offers the player the rebels.
 *
 * WHAT IS COMPUTED HERE (never left to the model): which sections are live, the emerging
 * factions (resource -> spawn script -> faction), their playable status and emergence garrison,
 * money and armies the spawn scripts grant, the settlements named in the code with their
 * starting owners, how many settlements each tested resource covers per starting owner, the
 * prompts' own text and picture, and the turn/year for every turn number in the code.
 *
 * WHAT THE MODEL WRITES (scripts/lib/aiProse.js): the plain-English account of what sets the
 * revolt off, what happens, and what the player is offered - from those facts plus the code.
 * The civil wars are ~5,000 lines of flags; rules cannot say what they are FOR, and the mod
 * team asked for pages a non-coder can read. Answers are cached and committed; the model only
 * runs when a section's code or facts change.
 *
 * --dry-run writes each model input to <temp>/ris-wiki-ai-inputs/revolts/ and calls nothing.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { writeProse, storeProse, buildInput, SYSTEM, haveCredentials, MODEL } = require("./lib/aiProse.js");

const argv = process.argv.slice(2);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const RIS = valOf("--ris", "C:/RIS/RIS/data");
const OUT = valOf("--out", "C:/RIS/_wiki");
const DRY = argv.includes("--dry-run");
const IMPORT = valOf("--import", null);   // folder of <key>.json answers written outside the build
const say = (s) => console.log(s);

const rd = (...f) => { try { return fs.readFileSync(path.join(RIS, ...f), "latin1"); } catch { return null; } };
const rd16 = (...f) => { try { return fs.readFileSync(path.join(RIS, ...f), "utf16le"); } catch { return null; } };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const cell = (s) => String(s).replace(/\|/g, "\\|");
const num = (n) => Number(n).toLocaleString("en-US");
const lut16 = (file) => {
  const m = {};
  const t = rd16("text", file);
  if (t) for (const x of t.matchAll(/\{([^}]+)\}([^\r\n]*)/g)) { const k = x[1].trim(); if (!(k in m)) m[k] = x[2].trim(); }
  return m;
};
const uncomment = (l) => l.replace(/;.*$/, "");
const orList = (a, w = "or") => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} ${w} ${a[a.length - 1]}`);
const andList = (a) => orList(a, "and");

// ── names and links ─────────────────────────────────────────────────────────
const FACTION_NAMES = (() => {
  const out = {};
  const low = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
  const camp = low(lut16("campaign_descriptions.txt"));
  const exp = low(lut16("expanded_bi.txt"));
  for (const [k, v] of Object.entries(camp)) { const m = /^imperial_campaign_([a-z0-9_]+)_title$/.exec(k); if (m && v) out[m[1]] = v; }
  for (const [k, v] of Object.entries(exp)) if (v && !(k in out)) out[k] = v;
  return out;
})();
const prettyTok = (t) => String(t).split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
const factionName = (f) => FACTION_NAMES[String(f).toLowerCase()] || prettyTok(f);
const pagesIn = (dir) => { try { return new Set(fs.readdirSync(path.join(OUT, dir)).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))); } catch { return new Set(); } };
const FACTION_PAGES = pagesIn("factions");
const SETTLEMENT_PAGES = pagesIn("settlements");
const NAME_USES = (() => { const n = {}; for (const [k, v] of Object.entries(FACTION_NAMES)) if (/^[a-z0-9_]+$/.test(k)) n[v] = (n[v] || 0) + 1; return n; })();
const factionLabel = (f) => { const n = factionName(f); return NAME_USES[n] > 1 ? `${n} (\`${f}\`)` : n; };
const factionLink = (f, pre = "../") => {
  const k = String(f).toLowerCase();
  if (FACTION_PAGES.has(k)) return `[${factionName(k)}](${pre}factions/${k}.md)`;
  if (FACTION_PAGES.has("non-playable") && FACTION_NAMES[k]) {
    const label = factionLabel(k);
    const anchor = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return `[${label}](${pre}factions/non-playable.md${NAME_USES[factionName(k)] > 1 ? `#${anchor}` : ""})`;
  }
  return factionName(k);
};
const PLACE_NAMES = lut16("imperial_campaign_regions_and_settlement_names.txt");
const placeName = (tok) => PLACE_NAMES[tok] || String(tok).replace(/_/g, " ");
const settlementLink = (tok, pre = "../") => (SETTLEMENT_PAGES.has(tok) ? `[${placeName(tok)}](${pre}settlements/${encodeURIComponent(tok)}.md)` : placeName(tok));
const EDU = rd("export_descr_unit.txt") || "";
const TYPE_DICT = {};
{ let type = null; for (const raw of EDU.split(/\r?\n/)) { const t = uncomment(raw).trim(); let m = /^type\s+(.+)$/.exec(t); if (m) { type = m[1].trim().toLowerCase(); continue; } m = /^dictionary\s+(\S+)/.exec(t); if (m && type) { TYPE_DICT[type] = m[1].trim(); type = null; } } }
const UNIT_TEXT = Object.fromEntries(Object.entries(lut16("export_units.txt")).map(([k, v]) => [k.toLowerCase(), v]));
const unitName = (t) => { const d = TYPE_DICT[t.toLowerCase()]; return (d && UNIT_TEXT[d.toLowerCase()]) || t; };
const unitLink = (t) => { const d = TYPE_DICT[t.toLowerCase()]; return d ? `[${unitName(t)}](../units/${slug(d)}.md)` : unitName(t); };
const EXPANDED = lut16("expanded_bi.txt");

// ── map: regions, settlements, starting owners ──────────────────────────────
const REGION_SETTLEMENT = {}, SETTLEMENT_REGION = {}, RESOURCE_REGIONS = {};
{
  const lines = (rd("world", "maps", "base", "descr_regions.txt") || "").split(/\r?\n/).map(uncomment).filter((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    if (/^\S/.test(lines[i]) && i + 5 < lines.length && /^\s/.test(lines[i + 1]) && /^\s*\d+\s+\d+\s+\d+\s*$/.test(lines[i + 4])) {
      const region = lines[i].trim(), sett = lines[i + 1].trim();
      REGION_SETTLEMENT[region] = sett; SETTLEMENT_REGION[sett] = region;
      for (const r of lines[i + 5].split(",").map((x) => x.trim()).filter(Boolean)) (RESOURCE_REGIONS[r] = RESOURCE_REGIONS[r] || []).push(region);
    }
  }
}
const STRAT = rd("world", "maps", "campaign", "imperial_campaign", "descr_strat.txt") || "";
const START_YEAR = (() => { const m = /^\s*start_date\s+(-?\d+)/m.exec(STRAT); return m ? parseInt(m[1], 10) : -270; })();
const REGION_OWNER = {};
{
  let fac = null;
  for (const raw of STRAT.split(/\r?\n/)) {
    const t = uncomment(raw).trim();
    let m = /^faction\s+([a-z0-9_]+)/.exec(t);
    if (m) { fac = m[1]; continue; }
    m = /^region\s+(\S+)/.exec(t);
    if (m && fac) REGION_OWNER[m[1]] = fac;
  }
}
const ownerOfSettlement = (s) => REGION_OWNER[SETTLEMENT_REGION[s]] || null;
const listBetween = (a, b) => { const m = new RegExp(`^${a}\\s*$([\\s\\S]*?)^${b}\\s*$`, "m").exec(STRAT.split(/\r?\n/).map(uncomment).join("\n")); return m ? m[1].split(/[\s,]+/).filter(Boolean) : []; };
const PLAYABLE = new Set([...listBetween("playable", "end"), ...listBetween("unlockable", "end")]);
const STARTS_DEAD = new Set([...STRAT.matchAll(/^faction\s+([a-z0-9_]+)[^\n]*\n(?:[^\n]*\n){0,3}?\s*dead_until_resurrected/gm)].map((m) => m[1]));

// ── spawn scripts: resource -> emerging faction, money, armies ──────────────
const SPAWN = {};   // faction -> { file, resources:Set, money:[{settlement, amount, to}], armies:[{settlement, general, units:[]}] }
for (const m of STRAT.matchAll(/^spawn_script\s+([a-z0-9_]+)\s*,\s*revolt\s*,\s*(\S+)/gm)) {
  const fac = m[1], file = m[2];
  const src = rd("world", "maps", "campaign", "imperial_campaign", ...file.split("/"));
  if (!src) continue;
  const e = { file, resources: new Set(), money: [], armies: [] };
  let sett = null, army = null;
  for (const raw of src.split(/\r?\n/)) {
    const t = uncomment(raw).trim();
    let x;
    if ((x = /HasResource\s+(\S+)/.exec(t))) e.resources.add(x[1]);
    if ((x = /SettlementName\s+(\S+)/.exec(t))) sett = x[1];
    if ((x = /add_money\s+(\S+)\s+(-?\d+)/.exec(t))) e.money.push({ settlement: sett, to: x[1], amount: parseInt(x[2], 10) });
    if (/^spawn_army\b/.test(t)) army = { settlement: sett, general: null, units: [] };
    else if (army && (x = /^character\s+([^,]+)/.exec(t))) army.general = x[1].trim();
    else if (army && (x = /^unit\s+(.+?)\s*,?\s+exp\s+/.exec(t))) army.units.push(x[1].replace(/,\s*$/, "").trim());
    else if (army && /^end\b/.test(t)) { e.armies.push(army); army = null; }
  }
  // The same army written once per candidate map tile (Egypt tries three spots and places
  // the first free one): one army, with the number of spots it may appear on.
  const uniq = new Map();
  for (const a of e.armies) {
    const k = JSON.stringify([a.settlement, a.general, a.units]);
    if (uniq.has(k)) uniq.get(k).spots++; else uniq.set(k, { ...a, spots: 1 });
  }
  e.armies = [...uniq.values()];
  SPAWN[fac] = e;
}
const RESOURCE_FACTION = {};
for (const [fac, e] of Object.entries(SPAWN)) for (const r of e.resources) (RESOURCE_FACTION[r] = RESOURCE_FACTION[r] || new Set()).add(fac);

const EMERGENCE = {};
{
  const src = (rd("descr_sm_factions.txt") || "").replace(/;[^\n]*/g, "");
  const re = /^\t"([a-z0-9_]+)":\s*\n\t\{([\s\S]*?)\n\t\}/gm;
  let m;
  while ((m = re.exec(src))) {
    const em = /"emergence":\s*\{([\s\S]*?)\}/.exec(m[2]);
    if (!em) continue;
    const units = /"settlement units":\s*\[([\s\S]*?)\]/.exec(em[1]);
    const str = /"strength":\s*([\d.]+)/.exec(em[1]);
    EMERGENCE[m[1]] = { units: units ? [...units[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [], strength: str ? Number(str[1]) : null };
  }
}

// ── campaign script sections ────────────────────────────────────────────────
const CS_LINES = (rd("world", "maps", "campaign", "imperial_campaign", "RIS_Campaign_Script.txt") || "").split(/\r?\n/);
// The file opens with a table of contents (";;;;;   27.  THESSALY REVOLTS"). Only lines that
// repeat a TOC entry are section headers: section 8 has numbered steps of its own inside it
// ("; 1. Trigger betrayal offer ..."), and matching any "N. Title" line split it in pieces.
const TOC = [];
for (const l of CS_LINES.slice(0, 60)) {
  const m = /^;+\s+(\d{1,2})\.\s+(.+?)\s*$/.exec(l);
  if (m) TOC.push({ num: parseInt(m[1], 10), title: m[2].replace(/\s+-\s+.*$/, "").trim() });
}
const tocKey = (t) => t.toUpperCase().replace(/[^A-Z]+/g, " ").trim().split(" ").slice(0, 2).join(" ");
const HEADERS = [];
CS_LINES.forEach((l, i) => {
  if (i < 60) return;
  const m = /^\s*;+\s*=*\s*(\d{1,2})\.\s+(.+?)\s*=*\s*$/.exec(l);
  if (!m) return;
  const n = parseInt(m[1], 10);
  const toc = TOC.find((x) => x.num === n && tocKey(m[2]).startsWith(tocKey(x.title).split(" ")[0]));
  if (toc) HEADERS.push({ line: i + 1, num: n, title: toc.title });
});
// A header repeated as a banner (";== 27. X ==" inside ";;;;") counts once.
const SECTIONS = [];
for (let i = 0; i < HEADERS.length; i++) {
  const h = HEADERS[i];
  if (SECTIONS.length && SECTIONS[SECTIONS.length - 1].num === h.num) continue;
  const next = HEADERS.slice(i + 1).find((x) => x.num !== h.num);
  SECTIONS.push({ ...h, end: next ? next.line - 1 : CS_LINES.length });
}
const EMERGENTS = SECTIONS.find((s) => /PLAYABLE EMERGENTS/i.test(s.title));
const liveLines = (a, b) => CS_LINES.slice(a - 1, b).map((l, i) => ({ n: a + i, t: l })).filter((x) => uncomment(x.t).trim());
const excerpt = (lines) => lines.map((x) => `${x.n}: ${x.t.replace(/\t/g, "    ")}`).join("\n");

/** Top-level blocks (monitor ... end_monitor, if ... end_if) of a line range. */
function topBlocks(a, b) {
  const out = [];
  let depth = 0, start = null;
  for (const x of liveLines(a, b)) {
    const t = uncomment(x.t).trim();
    const opens = /^(monitor_event|monitor_conditions|if|while|for_each)\b/.test(t);
    const closes = /^(end_monitor|end_if|end_while|end_for)\b/.test(t);
    if (opens) { if (depth === 0) start = x.n; depth++; }
    if (closes) { depth--; if (depth === 0 && start != null) { out.push({ a: start, b: x.n }); start = null; } }
  }
  return out;
}

// ── the revolts ─────────────────────────────────────────────────────────────
const REVOLTS = [];
const SKIPPED = [];
for (const s of SECTIONS) {
  if (!/REVOLT|CIVIL WAR|DISTURBANCE|REBELLION/i.test(s.title)) continue;
  const live = liveLines(s.line, s.end);
  const text = live.map((x) => uncomment(x.t)).join("\n");
  if (!/\bprovoke_rebellion\b/.test(text)) { SKIPPED.push(`${s.num}. ${s.title} (no live provoke_rebellion)`); continue; }
  const resources = [...new Set([...text.matchAll(/add_hidden_resource\s+\S+\s+(\S+)/g)].map((m) => m[1]))];
  const factions = [...new Set(resources.flatMap((r) => [...(RESOURCE_FACTION[r] || [])]))];
  if (!factions.length) { SKIPPED.push(`${s.num}. ${s.title} (no spawn script takes its settlements)`); continue; }
  // Section 34 blocks for these factions, only where the faction is playable (else unreachable).
  // Section 34 ("Playable emergents") is NOT fed to the writer: its turn-0 blocks do not
  // matter when you start as the faction - the game plays forward to the faction's normal
  // emergence (mod team, 2026-09-25). Kept as a switch in case that changes.
  const INCLUDE_EMERGENT_BLOCKS = false;
  const extra = [];
  if (EMERGENTS && INCLUDE_EMERGENT_BLOCKS) for (const bl of topBlocks(EMERGENTS.line, EMERGENTS.end)) {
    const t = liveLines(bl.a, bl.b).map((x) => uncomment(x.t)).join("\n");
    const who = [...t.matchAll(/I_LocalFaction\s+([a-z0-9_]+)/g)].map((m) => m[1]);
    if (who.some((f) => factions.includes(f) && PLAYABLE.has(f))) extra.push(bl);
  }
  REVOLTS.push({ section: s, live, text, resources, factions, extra });
}

// ── reforms: which a revolt needs, and which follow from it ─────────────────
// Computed here (this generator runs BEFORE the reform generator, which reads the result from
// revolts/index.json to link back). A revolt NEEDS a reform its code tests with
// MajorEventActive. A reform FOLLOWS a revolt when its trigger - or a campaign-script counter
// or resource the trigger tests, two levels deep - uses something the revolt creates: its
// region marker, its emerging faction, or a counter its section sets.
const REFORM_CATALOG = (() => {
  const out = {};
  const src = (rd("descr_sm_major_events.txt") || "").replace(/;[^\n]*/g, "");
  const MAJOR_TEXT = lut16("major_events.txt");
  const EDB = rd("export_descr_buildings.txt") || "";
  const tested = new Set([...EDB.matchAll(/major_event\s+"([A-Za-z0-9_]+)"/g)].map((m) => m[1]));
  for (const m of src.matchAll(/"([A-Za-z0-9_]+)":\s*\{\s*"affects"[\s\S]*?"trigger conditions":\s*"([^"]+)"[\s\S]*?"title":\s*"([^"]+)"/g)) {
    const [, name, trig, titleKey] = m;
    if (/^(winter|summer|spring|autumn|empire_size\d+)$/i.test(name)) continue;
    if (!/reform/i.test(name) && !tested.has(name)) continue;
    if (name in out) continue;
    out[name] = { title: MAJOR_TEXT[titleKey] || prettyTok(name), trigger: rd(...trig.split("/")) || "" };
  }
  return out;
})();
const CS_TEXT = CS_LINES.map(uncomment).join("\n");
const WHOLE_BLOCKS = topBlocks(1, CS_LINES.length).map((b) => ({ ...b, text: liveLines(b.a, b.b).map((x) => uncomment(x.t)).join("\n") }));
/** The trigger plus every script block that sets a counter or places a resource it tests, 2 deep. */
function reformDependencyText(name) {
  const seen = new Set();
  let text = REFORM_CATALOG[name].trigger;
  let frontier = [text];
  for (let depth = 0; depth < 2; depth++) {
    const next = [];
    for (const t of frontier) {
      const keys = [...t.matchAll(/I_CompareCounter\s+(\S+)/g), ...t.matchAll(/HasResource\s+(\S+)/g)].map((m) => m[1]);
      for (const k of keys) {
        if (seen.has(k)) continue;
        seen.add(k);
        const re = new RegExp(`\\b(set_counter|inc_counter)\\s+${k}\\b|add_hidden_resource\\s+\\S+\\s+${k}\\b`);
        for (const b of WHOLE_BLOCKS) if (re.test(b.text)) { next.push(b.text); text += "\n" + b.text; }
      }
    }
    frontier = next;
  }
  return text;
}
function reformLinks(r) {
  const needs = [...new Set([...r.text.matchAll(/MajorEventActive\s+"([^"]+)"/g)].map((m) => m[1]))].filter((x) => REFORM_CATALOG[x]);
  const counters = [...new Set([...r.text.matchAll(/(?:set_counter|inc_counter)\s+(\S+)/g)].map((m) => m[1]))];
  const tokens = [...r.resources, ...counters];
  // A faction counts only where the reform needs it to EXIST (FactionIsAlive / FactionType):
  // Polybian merely counts the Roman Rebels' settlements, which does not make it follow the
  // civil wars.
  const factionRe = r.factions.map((f) => new RegExp(`\\b(FactionIsAlive|FactionType)\\s+${f}\\b`));
  const follows = Object.keys(REFORM_CATALOG).filter((name) => {
    if (needs.includes(name)) return false;
    const t = reformDependencyText(name);
    return tokens.some((k) => new RegExp(`\\b${k.replace(/[^A-Za-z0-9_]/g, "")}\\b`).test(t)) || factionRe.some((re) => re.test(t));
  });
  return { needs, follows };
}

const revoltKey = (r) => slug(r.section.title.replace(/\b(revolts?|rebellion|disturbance)\b/gi, "").replace(/\bin\b.*$/i, "").trim() || r.section.title) || `section_${r.section.num}`;
/** The page title another revolt's cached text gave it (links are written before that page is). */
const revoltTitle = (r) => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, "ai-prose", "revolts", `${revoltKey(r)}.json`), "utf8")).prose.title; }
  catch { return prettyTok(r.section.title.toLowerCase()); }
};
/** Revolt b follows revolt a when b's code tests a counter or region marker a's section sets. */
function revoltFollows(b, a) {
  const setByA = new Set([...a.text.matchAll(/(?:set_counter|inc_counter)\s+(\S+)/g)].map((m) => m[1]));
  const testedByB = new Set([...b.text.matchAll(/I_CompareCounter\s+(\S+)/g)].map((m) => m[1]));
  const setByB = new Set([...b.text.matchAll(/(?:set_counter|inc_counter)\s+(\S+)/g)].map((m) => m[1]));
  if ([...testedByB].some((c) => setByA.has(c) && !setByB.has(c))) return true;
  return a.resources.some((x) => new RegExp(`HasResource\\s+${x}\\b`).test(b.text));
}

function factsFor(r) {
  const named = new Set();
  for (const m of r.text.matchAll(/provoke_rebellion\s+(\S+)/g)) if (m[1] !== "local") named.add(m[1]);
  for (const m of r.text.matchAll(/add_hidden_resource\s+(\S+)\s+\S+/g)) if (REGION_SETTLEMENT[m[1]]) named.add(REGION_SETTLEMENT[m[1]]);
  for (const m of r.text.matchAll(/SettlementName\s+(\S+)/g)) if (SETTLEMENT_REGION[m[1]]) named.add(m[1]);
  const tested = [...new Set([...r.text.matchAll(/HasResource\s+(\S+)/g)].map((m) => m[1]))].filter((x) => RESOURCE_REGIONS[x] && !r.resources.includes(x));
  const byOwner = (regions) => { const c = {}; for (const g of regions) { const o = factionName(REGION_OWNER[g] || "slave"); c[o] = (c[o] || 0) + 1; } return c; };
  const prompts = [...r.text.matchAll(/title\s+(\S+)[\s\S]*?body\s+(\S+)[\s\S]*?image\s+(\S+)/g)].map((m) => ({
    title: EXPANDED[m[1]] || m[1], text: (EXPANDED[m[2]] || "").replace(/\\n/g, "\n").slice(0, 1200), picture: m[3],
  }));
  const reforms = [...new Set([...r.text.matchAll(/MajorEventActive\s+"([^"]+)"/g)].map((m) => m[1]))];
  return {
    section: r.section.title,
    emerging_factions: r.factions.map((f) => ({
      name: factionLabel(f),
      playable_by_player: PLAYABLE.has(f),
      starts_the_campaign: STARTS_DEAD.has(f) ? "dead - comes into being through this revolt" : "alive",
      garrison_when_it_emerges: EMERGENCE[f] ? { units: EMERGENCE[f].units.map(unitName), strength_multiplier: EMERGENCE[f].strength } : null,
      money_on_emergence: (SPAWN[f] ? SPAWN[f].money : []).map((x) => ({ when_this_settlement_revolts: placeName(x.settlement || ""), faction_receiving: factionLabel(x.to), amount: x.amount })),
      army_spawned: (SPAWN[f] ? SPAWN[f].armies : []).map((a) => ({ when_this_settlement_revolts: placeName(a.settlement || ""), general: a.general, units: a.units.map(unitName), ...(a.spots > 1 ? { placed_on_the_first_free_of_this_many_map_spots: a.spots } : {}) })),
    })),
    settlements_named_in_the_code: [...named].map((s) => ({ settlement: placeName(s), region: placeName(SETTLEMENT_REGION[s] || ""), owner_at_campaign_start: ownerOfSettlement(s) ? factionName(ownerOfSettlement(s)) : "rebels" })),
    regions_tested_by_resource: Object.fromEntries(tested.map((x) => [x, { regions: RESOURCE_REGIONS[x].length, owners_at_campaign_start: byOwner(RESOURCE_REGIONS[x]) }])),
    player_prompts: prompts,
    reforms_it_depends_on: reforms,
    campaign_starts: `${-START_YEAR} BC`,
    turns_per_year_as_the_player_sees_them: 4,
  };
}
function turnTable(text) {
  const out = {};
  for (const m of text.matchAll(/I_TurnNumber\s*(>=|>|<=|<|==|=)\s*(\d+)/g)) {
    for (const n of [parseInt(m[2], 10), parseInt(m[2], 10) + 1]) {
      const y = START_YEAR + Math.floor(n / 2);
      // Turn 0 is the campaign's first turn(s). The mod's "(I_TurnNumber*2)+2" converts its own
      // thresholds and means nothing at 0 - it turned "at the start" into "turn 2 ... turn 4".
      out[n] = n === 0 ? `the start of the campaign (${y < 0 ? `${-y} BC` : `AD ${y}`})` : `turn ${2 * n + 2} (${y < 0 ? `${-y} BC` : `AD ${y}`})`;
    }
  }
  return out;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "breaks_away_from", "who_it_can_happen_to", "what_sets_it_off", "what_happens", "playing_as_the_rebels"],
  properties: {
    title: { type: "string", description: "Short page title in plain words, e.g. 'The Thessalian Revolt'." },
    summary: { type: "string", description: "Two or three sentences: who breaks away from whom, and roughly when or why." },
    breaks_away_from: { type: "string", description: "Display name(s) of the faction(s) that lose the settlements, as a short phrase." },
    who_it_can_happen_to: { type: "string", description: "One sentence: in which campaigns this can happen (e.g. only when a human plays Rome; any campaign)." },
    what_sets_it_off: { type: "array", items: { type: "string" }, description: "Each way it can start, as one plain sentence. Only routes that can really happen. Chances and turns exact." },
    what_happens: { type: "array", items: { type: "string" }, description: "What happens when it fires, in order: which settlements go, to whom, armies, money, wars declared." },
    playing_as_the_rebels: { type: "string", description: "Who is offered to play as the rebels and what accepting does, or that no offer is made." },
  },
};
const TASK = `Write the wiki page for this revolt: what it is, what sets it off, what happens, and whether the player can take over the rebels. Readers are players, not modders.`;

// ── build ───────────────────────────────────────────────────────────────────
(async () => {
  fs.mkdirSync(path.join(OUT, "revolts"), { recursive: true });
  const index = { revolts: {}, factions: {} };
  const stats = { cache: 0, model: 0, missing: [] };
  for (const r of REVOLTS) {
    const key = revoltKey(r);
    const lines = [...r.live, ...r.extra.flatMap((b) => liveLines(b.a, b.b))];
    const code = `(${r.section.num}. ${r.section.title}, RIS_Campaign_Script.txt)\n${excerpt(r.live)}${r.extra.length ? `\n\n(The same factions in section ${EMERGENTS.num}, "${EMERGENTS.title}")\n${r.extra.map((b) => excerpt(liveLines(b.a, b.b))).join("\n\n")}` : ""}${r.factions.map((f) => SPAWN[f] ? `\n\n(spawn script for ${factionLabel(f)}: ${SPAWN[f].file})\n${(rd("world", "maps", "campaign", "imperial_campaign", ...SPAWN[f].file.split("/")) || "").split(/\r?\n/).map((t, i) => ({ n: i + 1, t })).filter((x) => uncomment(x.t).trim()).map((x) => `${x.n}: ${x.t}`).join("\n")}` : "").join("")}`;
    const facts = factsFor(r);
    const turns = turnTable(lines.map((x) => uncomment(x.t)).join("\n"));
    if (IMPORT) {
      const f = path.join(IMPORT, `${key}.json`);
      if (fs.existsSync(f)) {
        const r2 = storeProse({ kind: "revolts", key, task: TASK, facts, code, turns, schema: SCHEMA }, JSON.parse(fs.readFileSync(f, "utf8")), "claude-opus-5-5 (Claude Code session)");
        say(`  import ${key}: ${r2.ok ? "stored" : `REJECTED - ${r2.note}`}`);
      }
    }
    if (DRY) {
      const dir = valOf("--dry-run-dir", path.join(require("os").tmpdir(), "ris-wiki-ai-inputs", "revolts"));
      fs.mkdirSync(dir, { recursive: true });
      // Exactly what the model would get: system prompt, input, and the answer's JSON schema.
      fs.writeFileSync(path.join(dir, `${key}.txt`), `SYSTEM\n${SYSTEM}\n\n${buildInput({ task: TASK, facts, code, turns })}\n\nANSWER SCHEMA\n${JSON.stringify(SCHEMA, null, 1)}\n`, "utf8");
      say(`  dry-run ${key}: ${lines.length} code lines, ~${Math.round((code.length + JSON.stringify(facts).length) / 3.5 / 1000)}k tokens`);
      continue;
    }
    let res;
    try { res = await writeProse({ kind: "revolts", key, task: TASK, facts, code, turns, schema: SCHEMA }); }
    catch (e) { res = { prose: null, note: `API error: ${e.message}` }; }
    if (!res.prose) { stats.missing.push(`${key}: ${res.note}`); continue; }
    stats[res.source]++;
    const sep = (v) => (typeof v === "string" ? v.replace(/\b\d{4,}\b/g, (n) => num(n)) : Array.isArray(v) ? v.map(sep) : v);
    const p = Object.fromEntries(Object.entries(res.prose).map(([k, v]) => [k, sep(v)]));

    // page
    const md = [];
    md.push(`# ${p.title}`, "");
    const pic = (facts.player_prompts[0] || {}).picture;
    const picFile = pic ? eventpic(pic) : null;
    if (picFile) md.push('<div class="reform-banner">', "", `![${cell(p.title)}](${picFile})`, "", "</div>", "");
    md.push(`**Breaks away:** ${andList(r.factions.map((f) => factionLink(f)))} from ${p.breaks_away_from}`, "");
    md.push(p.summary, "", `_${p.who_it_can_happen_to}_`, "");
    md.push("## What sets it off", "", ...grouped(p.what_sets_it_off), "");
    md.push("## What happens", "", ...grouped(p.what_happens), "");
    const named = facts.settlements_named_in_the_code;
    const provoked = [...new Set([...r.text.matchAll(/provoke_rebellion\s+(\S+)/g)].map((m) => m[1]).filter((x) => x !== "local"))];
    if (provoked.length) {
      md.push(`**The settlements that revolt** (${provoked.length}):`, "", "| Settlement | Held at the campaign start by |", "|---|---|",
        ...provoked.map((s) => `| ${settlementLink(s)} | ${ownerOfSettlement(s) ? factionLink(ownerOfSettlement(s)) : "the rebels"} |`), "");
    }
    for (const f of r.factions) {
      const em = EMERGENCE[f];
      for (const a of (SPAWN[f] ? SPAWN[f].armies : [])) {
        const counts = {}; for (const u of a.units) counts[u] = (counts[u] || 0) + 1;
        md.push(`**Army raised when ${placeName(a.settlement || "")} revolts**${a.general ? ` (general ${a.general})` : ""}:`, "", "| Unit | Number |", "|---|---:|", ...Object.entries(counts).map(([u, n]) => `| ${unitLink(u)} | ${n} |`), "");
      }
    }
    md.push("## Playing as the rebels", "", p.playing_as_the_rebels, "");
    // The messages in full (the model's facts carry a shortened copy). Each ONCE: the civil
    // wars raise the same message from several code paths (per player faction, per war), and
    // listing every call site put 24 folds on the page for 10 messages. One fold if there is
    // one message; otherwise one fold holding them all, each under its own title.
    const msgs = [];
    const seenMsg = new Set();
    for (const m of r.text.matchAll(/title\s+(\S+)[\s\S]*?body\s+(\S+)/g)) {
      const full = (EXPANDED[m[2]] || "").replace(/\\n/g, "\n");
      const title = EXPANDED[m[1]] || m[1];
      if (!full.trim() || seenMsg.has(m[1] + "|" + m[2])) continue;
      seenMsg.add(m[1] + "|" + m[2]);
      msgs.push({ title, lines: full.split("\n").filter((l) => l.trim()) });
    }
    if (msgs.length === 1) {
      md.push("<details>", `<summary>The in-game message: ${cell(msgs[0].title)}</summary>`, "", ...msgs[0].lines.map((l) => `> ${l}\n>`), "", "</details>", "");
    } else if (msgs.length > 1) {
      md.push("<details>", `<summary>The in-game messages (${msgs.length})</summary>`, "");
      for (const x of msgs) md.push(`#### ${x.title}`, "", ...x.lines.map((l) => `> ${l}\n>`), "");
      md.push("</details>", "");
    }
    const links = reformLinks(r);
    const rl = (x) => `[${cell(REFORM_CATALOG[x].title)}](../reforms/${x}.md)`;
    const vl = (o) => `[${cell(revoltTitle(o))}](${revoltKey(o)}.md)`;
    const afterRevolts = REVOLTS.filter((o) => o !== r && revoltFollows(r, o));
    const opensRevolts = REVOLTS.filter((o) => o !== r && revoltFollows(o, r));
    const afterAll = [...links.needs.map(rl), ...afterRevolts.map(vl)];
    const opensAll = [...links.follows.map(rl), ...opensRevolts.map(vl)];
    if (afterAll.length) md.push(`**Comes after:** ${afterAll.join(", ")}.`, "");
    if (opensAll.length) md.push(`**Opens the way to:** ${opensAll.join(", ")}.`, "");
    fs.writeFileSync(path.join(OUT, "revolts", `${key}.md`), md.join("\n").replace(/\n{3,}/g, "\n\n"), "utf8");
    index.revolts[key] = { page: `${key}.md`, title: p.title, factions: r.factions, from: p.breaks_away_from, summary: p.summary, needs_reforms: links.needs, leads_to_reforms: links.follows };
    for (const f of r.factions) (index.factions[f] = index.factions[f] || []).push(key);
    // Factions this revolt creates, and whether they exist before it (faction pages say so).
    index.emerging = index.emerging || {};
    for (const f of r.factions) { const e = (index.emerging[f] = index.emerging[f] || { revolts: [], starts_dead: STARTS_DEAD.has(f) }); e.revolts.push(key); }
    for (const s of provoked) { const o = ownerOfSettlement(s); if (o) (index.factions[o] = index.factions[o] || []).includes(key) || index.factions[o].push(key); }
  }
  if (DRY) { say(`revolts: ${REVOLTS.length} live sections (dry run, nothing written). Skipped: ${SKIPPED.join("; ")}`); return; }

  // index page (only revolts that have a page). With none written yet - no credentials and an
  // empty cache - there is no index either, so nothing links to an empty page.
  if (!Object.keys(index.revolts).length) {
    for (const f of [path.join(OUT, "revolts.md"), path.join(OUT, "revolts", "index.json")]) { try { fs.unlinkSync(f); } catch { /* absent */ } }
    say(`revolts: ${REVOLTS.length} live sections · no pages yet, so no index written`);
    for (const m of stats.missing) say(`    ${m}`);
    return;
  }
  const rows = Object.entries(index.revolts).map(([k, v]) => `| [${cell(v.title)}](revolts/${k}.md) | ${andList(v.factions.map((f) => factionLink(f, "")))} | ${cell(v.from)} |`);
  fs.writeFileSync(path.join(OUT, "revolts.md"), `# Revolts

Revolts, breakaways and civil wars the campaign script can set off. Each page says what starts it, what happens and whether you can take over the rebels.

| Revolt | Who breaks away | From |
|---|---|---|
${rows.join("\n")}
`, "utf8");
  fs.writeFileSync(path.join(OUT, "revolts", "index.json"), JSON.stringify(index, null, 1), "utf8");
  say(`revolts: ${REVOLTS.length} live sections · pages ${Object.keys(index.revolts).length} (${stats.cache} from cache, ${stats.model} written by ${MODEL})`);
  if (SKIPPED.length) say(`  left out (not live): ${SKIPPED.join("; ")}`);
  if (stats.missing.length) { say(`  NO PAGE YET (${stats.missing.length}):`); for (const m of stats.missing) say(`    ${m}`); }
  say("next: gen-ris-faction-pages.js (reads revolts/index.json)");
})().catch((e) => { console.error(e); process.exit(1); });

// A list whose items share "Label: ..." prefixes (the civil wars: "First civil war: ...") is
// grouped under ### Label headings instead of one long run of bullets.
function grouped(items) {
  const pre = (x) => { const m = /^([A-Z][^:.]{2,40}):\s+(.+)$/s.exec(x); return m ? m : null; };
  const labelled = items.map(pre);
  const counts = {};
  labelled.forEach((m) => { if (m) counts[m[1]] = (counts[m[1]] || 0) + 1; });
  if (Object.values(counts).filter((n) => n >= 2).length < 1 || labelled.filter(Boolean).length < items.length * 0.6) return items.map((x) => `- ${x}`);
  const out = [];
  let cur = null;
  items.forEach((x, i) => {
    const m = labelled[i];
    const label = m ? m[1] : null;
    if (label !== cur) { if (label) out.push("", `### ${label}`, ""); cur = label; }
    out.push(`- ${m ? m[2].charAt(0).toUpperCase() + m[2].slice(1) : x}`);
  });
  return out;
}

// The prompt's picture (ui/<culture>/eventpics/<name>.tga), as a banner PNG.
function eventpic(name) {
  const dg = require(path.join(__dirname, "..", "src", "descrStratGeneral.js"));
  const { convert } = require(path.join(__dirname, "lib", "tgaPng.js"));
  let dirs = [];
  try { dirs = fs.readdirSync(path.join(RIS, "ui")); } catch { return null; }
  for (const c of ["generic", ...dirs]) {
    const d = path.join(RIS, "ui", c, "eventpics");
    let files; try { files = fs.readdirSync(d); } catch { continue; }
    const hit = files.find((f) => f.toLowerCase() === `${name.toLowerCase()}.tga`);
    if (!hit) continue;
    const out = path.join(OUT, "revolt-images", `${slug(name)}.png`);
    if (!fs.existsSync(out) || fs.statSync(out).mtimeMs < fs.statSync(path.join(d, hit)).mtimeMs) {
      const p = convert(dg, path.join(d, hit), 1);
      if (!p) return null;
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, p.buf);
    }
    return `../revolt-images/${slug(name)}.png`;
  }
  return null;
}
