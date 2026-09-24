#!/usr/bin/env node
/**
 * RIS wiki: one page per reform, plus reforms.md and reforms/index.json.
 *
 *   node scripts/gen-ris-reform-pages.js [--ris C:/RIS/RIS/data] [--out C:/RIS/_wiki]
 *
 * A reform is a "major event" in descr_sm_major_events.txt. Each one names a trigger script in
 * major_event_scripts/ that the engine runs at the end of every round; when it returns true the
 * reform fires for the factions in its `affects` list. What a reform DOES is spread over three
 * files, and a player page needs all three:
 *
 *   - export_descr_buildings.txt   `recruit "<unit>" ... requires ... major_event "<name>"`
 *                                  opens a unit; `not major_event "<name>"` closes one.
 *   - descr_sm_major_events.txt    `"unit switches"` turn units already in the field into
 *                                  their reformed type.
 *   - text/major_events.txt        the title and the message the player is shown.
 *
 * REQUIREMENTS ARE TRANSLATED, NOT HAND-WRITTEN. The trigger scripts are small programs
 * (if / for_each / counters / return), and most of their counters are fed by monitors in
 * RIS_Campaign_Script.txt ("each battle Achaea fights adds 1"). Both are parsed into one tree
 * and rendered with a fixed vocabulary. A construct outside that vocabulary is printed as the
 * script writes it and counted on the console, so a new kind of condition shows up as a
 * number here instead of as a plausible-sounding sentence on a page.
 *
 * TURNS. The scripts compare `I_TurnNumber`, the engine's own turn count. RIS runs a
 * turns-per-year script over an engine timescale of 0.5, and every trigger that compares a
 * turn says how the two relate: "TPY makes it (I_TurnNumber*2)+2". So engine turn N is the
 * turn the player sees as 2N+2, and falls in the year start + N/2 (no `timescale` line in
 * descr_strat, so the engine default of two turns a year applies).
 *
 * The unit pages read reforms/index.json and link back to the reforms that open or close a
 * unit, so this generator runs BEFORE gen-ris-unit-pages.js.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const RIS = valOf("--ris", "C:/RIS/RIS/data");
const OUT = valOf("--out", "C:/RIS/_wiki");
const say = (s) => console.log(s);

const rd = (...f) => { try { return fs.readFileSync(path.join(RIS, ...f), "latin1"); } catch { return null; } };
const rd16 = (...f) => { try { return fs.readFileSync(path.join(RIS, ...f), "utf16le"); } catch { return null; } };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const cell = (s) => String(s).replace(/\|/g, "\\|");
const num = (n) => Number(n).toLocaleString("en-US");
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : (many || one + "s")}`;
const readJson = (...f) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, ...f), "utf8")); } catch { return {}; } };
const lut16 = (file) => {
  const m = {};
  const t = rd16("text", file);
  if (t) for (const x of t.matchAll(/\{([^}]+)\}([^\r\n]*)/g)) { const k = x[1].trim(); if (!(k in m)) m[k] = x[2].trim(); }
  return m;
};

// ── names and links ─────────────────────────────────────────────────────────
const FACTION_NAMES = (() => {
  const out = {};
  const low = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
  const camp = low(lut16("campaign_descriptions.txt"));
  const exp = low(lut16("expanded_bi.txt"));
  for (const [k, v] of Object.entries(camp)) {
    const m = /^imperial_campaign_([a-z0-9_]+)_title$/.exec(k);
    if (m && v) out[m[1]] = v;
  }
  for (const [k, v] of Object.entries(exp)) if (v && !(k in out)) out[k] = v;
  return out;
})();
const prettyTok = (t) => String(t).split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
const factionName = (f) => FACTION_NAMES[String(f).toLowerCase()] || prettyTok(f);
const pagesIn = (dir) => { try { return new Set(fs.readdirSync(path.join(OUT, dir)).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))); } catch { return new Set(); } };
const FACTION_PAGES = pagesIn("factions");
// Every faction the game declares. A script that loops over a name not in this list loops
// over nothing (the Gracchi farm count names "roman", and there is no such faction).
const DECLARED_FACTIONS = new Set([...(fs.existsSync(path.join(RIS, "descr_sm_factions.txt")) ? fs.readFileSync(path.join(RIS, "descr_sm_factions.txt"), "latin1") : "").matchAll(/^\s*"([a-z0-9_]+)":/gim)].map((m) => m[1].toLowerCase()).filter((f) => f !== "factions"));
const isFactionKey = (f) => !DECLARED_FACTIONS.size || DECLARED_FACTIONS.has(String(f).toLowerCase());
// `for_each settlement in faction "roman"` names a CULTURE, and the engine matches it against
// the owner's culture (confirmed by the mod team, 2026-09-24): the Gracchi farm count covers
// every settlement held by any Roman-culture faction, AI factions included.
const DECLARED_CULTURES = () => new Set(Object.values(FACTION_CULTURE).map((c) => String(c).toLowerCase()));
const isCultureKey = (f) => !isFactionKey(f) && DECLARED_CULTURES().has(String(f).toLowerCase());
const isFaction = (f) => isFactionKey(f) || isCultureKey(f);
/** "held by Rome" / "held by any Roman-culture faction, AI factions included". */
const heldBy = (f) => (isCultureKey(f) ? `held by any ${cultureLink(String(f).toLowerCase())}-culture faction (AI factions included)` : `held by ${factionLink(f)}`);
const NO_SUCH_FACTION = new Set();
const SETTLEMENT_PAGES = pagesIn("settlements");
// roman_rebels_1 and roman_rebels_2 are both "Roman Rebels" in every text file the mod ships.
// Where a name is shared, the faction key goes with it so the two stay two - the same label
// the non-playable page gives them as headings, which is also where the link lands.
const NAME_USES = (() => {
  const n = {};
  for (const k of Object.keys(FACTION_NAMES)) if (/^[a-z0-9_]+$/.test(k) && !/_(descr|title)$/.test(k)) n[FACTION_NAMES[k]] = (n[FACTION_NAMES[k]] || 0) + 1;
  return n;
})();
const factionLink = (f, pre = "../") => {
  const k = String(f).toLowerCase();
  if (FACTION_PAGES.has(k)) return `[${factionName(k)}](${pre}factions/${k}.md)`;
  if (FACTION_PAGES.has("non-playable") && FACTION_NAMES[k]) {
    const name = factionName(k);
    if (NAME_USES[name] > 1) {
      const label = `${name} (\`${k}\`)`;
      const anchor = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      return `[${label}](${pre}factions/non-playable.md#${anchor})`;
    }
    return `[${name}](${pre}factions/non-playable.md)`;
  }
  return factionName(k);
};
const PLACE_NAMES = lut16("imperial_campaign_regions_and_settlement_names.txt");
const settlementLink = (tok) => {
  const name = PLACE_NAMES[tok] || String(tok).replace(/_/g, " ");
  return SETTLEMENT_PAGES.has(tok) ? `[${name}](../settlements/${encodeURIComponent(tok)}.md)` : name;
};
const CULTURES = readJson("cultures", "index.json");
const cultureLink = (c) => {
  const e = CULTURES[c];
  return e ? `[${e.name}](../cultures/${e.page || `${c}.md`}${e.anchor ? `#${e.anchor}` : ""})` : `${prettyTok(c)}`;
};
const SIZES = readJson("sizes", "index.json");
const sizeLink = (s) => {
  const e = SIZES[s];
  return e ? `[${e.name.toLowerCase()}](../sizes/${e.page})` : prettyTok(s).toLowerCase();
};
const TAGS = readJson("tags", "index.json");
const tagLink = (t) => {
  const e = TAGS[t];
  return e ? `[${e.name}](../tags/${e.page}${e.anchor ? `#${e.anchor}` : ""})` : `\`${t}\``;
};

// Units: EDU `type` -> dictionary, which is what a unit page is keyed on.
const EDU = rd("export_descr_unit.txt") || "";
const TYPE_DICT = {};
{
  let type = null;
  for (const raw of EDU.split(/\r?\n/)) {
    const t = raw.replace(/;.*$/, "").trim();
    let m = /^type\s+(.+)$/.exec(t);
    if (m) { type = m[1].trim().toLowerCase(); continue; }
    m = /^dictionary\s+(\S+)/.exec(t);
    if (m && type) { TYPE_DICT[type] = m[1].trim(); type = null; }
  }
}
const UNIT_TEXT = Object.fromEntries(Object.entries(lut16("export_units.txt")).map(([k, v]) => [k.toLowerCase(), v]));
const unitSlug = (type) => slug(TYPE_DICT[type] || type);
const unitName = (type) => {
  const d = TYPE_DICT[type];
  const n = d && UNIT_TEXT[d.toLowerCase()];
  return n || type;
};
const unitLink = (type) => `[${unitName(type)}](../units/${unitSlug(type)}.md)`;
const unitTypeLink = (raw) => {
  const t = String(raw).trim().toLowerCase();
  return TYPE_DICT[t] ? unitLink(t) : `\`${raw}\``;
};

// Regions and the resources (hidden ones included) each carries, from descr_regions.txt.
// A block is: region, settlement, faction, rebels, colour, resources, ... ; the resource line
// is the sixth non-comment line of the block.
const REGION_PAGES = pagesIn("regions");
const RESOURCE_REGIONS = (() => {
  const out = new Map();
  const src = rd("world", "maps", "base", "descr_regions.txt") || "";
  const lines = src.split(/\r?\n/).map((l) => l.replace(/;.*$/, "")).filter((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    if (/^\S/.test(lines[i]) && i + 5 < lines.length && /^\s/.test(lines[i + 1]) && /^\s*\d+\s+\d+\s+\d+\s*$/.test(lines[i + 4])) {
      const region = lines[i].trim();
      for (const r of lines[i + 5].split(",").map((x) => x.trim()).filter(Boolean)) {
        if (!out.has(r)) out.set(r, []);
        out.get(r).push(region);
      }
    }
  }
  return out;
})();
const regionLink = (r) => {
  const name = PLACE_NAMES[r] || String(r).replace(/_/g, " ");
  return REGION_PAGES.has(r) ? `[${name}](../regions/${encodeURIComponent(r)}.md)` : name;
};
/** Where a region tag is, in words: its reference page, or the regions themselves if few. */
function resourcePlace(res) {
  if (/^aor_/.test(res) && TAGS[res]) return `the ${tagLink(res)} recruitment area`;
  if (TAGS[res]) return `a region tagged ${tagLink(res)}`;
  const regions = RESOURCE_REGIONS.get(res) || [];
  if (regions.length && regions.length <= 12) return orList(regions.map(regionLink));
  if (regions.length) return `${prettyTok(res)} (${plural(regions.length, "region")})`;
  return null;
}

const BUILDING_TEXT = Object.fromEntries(Object.entries(lut16("export_buildings.txt")).map(([k, v]) => [k.toLowerCase(), v]));
const buildingName = (lvl) => { const n = BUILDING_TEXT[String(lvl).toLowerCase()]; return n ? `**${n}**` : `\`${lvl}\``; };
const aOr = (s) => (/^[*`\[]*[AEIOUaeiou]/.test(s) ? "an" : "a");

// ── campaign timing ─────────────────────────────────────────────────────────
const STRAT = rd("world", "maps", "campaign", "imperial_campaign", "descr_strat.txt") || "";
const START_YEAR = (() => { const m = /^\s*start_date\s+(-?\d+)/m.exec(STRAT); return m ? parseInt(m[1], 10) : null; })();
const END_YEAR = (() => { const m = /^\s*end_date\s+(-?\d+)/m.exec(STRAT); return m ? parseInt(m[1], 10) : null; })();
const yearText = (y) => (y < 0 ? `${-y} BC` : `AD ${y}`);
const engineYear = (n) => (START_YEAR == null ? null : START_YEAR + Math.floor(n / 2));
/** Engine turn N as the player meets it: the turn counter they see, and the year. */
function turnText(n) {
  const y = engineYear(n);
  return `turn ${num(2 * n + 2)}${y != null ? ` (${yearText(y)})` : ""}`;
}

// ── event declarations ──────────────────────────────────────────────────────
const EVENTS = (() => {
  const src = (rd("descr_sm_major_events.txt") || "").replace(/;[^\n]*/g, "");
  const out = [];
  const re = /"([A-Za-z0-9_]+)":\s*\{\s*"affects":\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(src))) {
    // The block runs to the next event header; slice at it so one event cannot read another's keys.
    const rest = src.slice(m.index + m[0].length);
    const next = /\n\s*"[A-Za-z0-9_]+":\s*\{\s*"affects"/.exec(rest);
    const body = next ? rest.slice(0, next.index) : rest;
    const activation = body.split(/"deactivation"/)[0];
    const g = (k) => { const x = new RegExp(`"${k}":\\s*"([^"]*)"`).exec(activation); return x ? x[1] : null; };
    const gb = (k) => { const x = new RegExp(`"${k}":\\s*(true|false)`).exec(body); return x ? x[1] === "true" : null; };
    const switches = [];
    const sw = /"unit switches":\s*\{([^}]*)\}/.exec(activation);
    if (sw) for (const p of sw[1].matchAll(/"([^"]+)":\s*"([^"]+)"/g)) switches.push([p[1].trim().toLowerCase(), p[2].trim().toLowerCase()]);
    out.push({
      name: m[1],
      affects: [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]),
      global: gb("global"),
      trigger: g("trigger conditions"),
      title: g("title"),
      body: g("body"),
      image: g("image"),
      switches,
    });
  }
  return out;
})();

// ── recruitment lines ───────────────────────────────────────────────────────
const EDB = rd("export_descr_buildings.txt") || "";
const RECRUIT = [];
{
  let chain = null;
  for (const raw of EDB.split(/\r?\n/)) {
    const t = raw.replace(/;.*$/, "").trim();
    let m = /^building\s+(\S+)/.exec(t);
    if (m) { chain = m[1]; continue; }
    m = /^recruit\s+"([^"]+)"\s+\d+\s+requires\s+(.+)$/.exec(t);
    if (m) RECRUIT.push({ unit: m[1].trim().toLowerCase(), expr: m[2], chain });
  }
}
const EVENT_TESTS = new Set([...EDB.matchAll(/major_event\s+"([A-Za-z0-9_]+)"/g)].map((x) => x[1]));

// A reform is a major event with "reform" in its name or one the buildings file tests. That
// leaves out the intro messages, the seasons and the empire-size steps, which are engine
// plumbing and not something a player does anything to get.
const NOT_REFORMS = /^(winter|summer|spring|autumn|empire_size\d+)$/i;
const REFORMS = EVENTS.filter((e) => !NOT_REFORMS.test(e.name) && (/reform/i.test(e.name) || EVENT_TESTS.has(e.name)));
const REFORM_BY_NAME = Object.fromEntries(REFORMS.map((r) => [r.name, r]));

const TEXT = lut16("major_events.txt");
const textOf = (k) => (k && TEXT[k] != null ? TEXT[k] : null);
const titleOf = (r) => textOf(r.title) || prettyTok(r.name);
const reformLink = (n, pre = "") => (REFORM_BY_NAME[n] ? `[${titleOf(REFORM_BY_NAME[n])}](${pre}${n}.md)` : `\`${n}\``);

// ── event pictures ──────────────────────────────────────────────────────────
// Each reform names an "image"; the file is ui/<culture>/eventpics/<image>.tga. The engine
// looks in the culture of the faction it is showing the message to, so the first affected
// faction's culture is tried first, then ui/generic, then any culture that has it. A reform
// that names a picture the mod does not ship shows the stock one most reforms use instead.
const FALLBACK_IMAGE = "player_faction_strongest";
const FACTION_CULTURE = (() => {
  const out = {};
  const src = rd("descr_sm_factions.txt") || "";
  const re = /^\s*"([a-z0-9_]+)":\s*(?:;[^\n]*)?\n([\s\S]*?)(?=^\s*"[a-z0-9_]+":\s*(?:;[^\n]*)?\n\s*\{|(?![\s\S]))/gim;
  let m;
  while ((m = re.exec(src))) {
    const c = /"culture":\s*"([^"]+)"/.exec(m[2]);
    if (c && !(m[1] in out)) out[m[1].toLowerCase()] = c[1];
  }
  return out;
})();
const EVENTPIC_DIRS = (() => {
  try { return fs.readdirSync(path.join(RIS, "ui"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); }
  catch { return []; }
})();
const eventpicIn = (culture, image) => {
  const dir = path.join(RIS, "ui", culture, "eventpics");
  let files;
  try { files = fs.readdirSync(dir); } catch { return null; }
  const hit = files.find((f) => f.toLowerCase() === `${image.toLowerCase()}.tga`);
  return hit ? path.join(dir, hit) : null;
};
function resolveEventpic(r, image = r.image) {
  if (!image) return null;
  const order = [...new Set([...r.affects.map((f) => FACTION_CULTURE[f.toLowerCase()]).filter(Boolean), "generic", ...EVENTPIC_DIRS])];
  for (const c of order) { const f = eventpicIn(c, image); if (f) return { file: f, culture: c }; }
  return undefined; // named, but no file in the mod
}
const IMAGE_STATS = { written: 0, stock: 0, missing: [] };
const dgTga = require(path.join(__dirname, "..", "src", "descrStratGeneral.js"));
const { convert: tgaToPng } = require(path.join(__dirname, "lib", "tgaPng.js"));
function reformImage(r) {
  let hit = resolveEventpic(r);
  if (hit === null) return null;
  let image = r.image;
  if (hit === undefined) {
    IMAGE_STATS.missing.push(`${r.name} -> ${r.image}`);
    image = FALLBACK_IMAGE;
    hit = resolveEventpic(r, image);
    if (!hit) return null;
  }
  // Stock pictures differ by culture, so the culture is part of the file name.
  const stock = /^(player_faction_strongest|faction_strongest|faction_defeated)$/i.test(image);
  if (stock) IMAGE_STATS.stock++;
  const name = stock ? `${slug(image)}_${slug(hit.culture)}` : slug(image);
  const file = hit.file;
  const out = path.join(OUT, "reform-images", `${name}.png`);
  if (!fs.existsSync(out) || fs.statSync(out).mtimeMs < fs.statSync(file).mtimeMs) {
    const p = tgaToPng(dgTga, file, 1);
    if (!p) { IMAGE_STATS.missing.push(`${r.name} -> ${r.image} (unreadable)`); return null; }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, p.buf);
  }
  IMAGE_STATS.written++;
  return `../reform-images/${name}.png`;
}

// ── the script language ─────────────────────────────────────────────────────
// Lines -> tree. Conditions are kept as their token lists; an `if` holds the whole
// multi-line condition (continuation lines start with and / && / or / ||).
function parseScript(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.replace(/;.*$/, "").trim()).filter(Boolean);
  const root = { kind: "block", body: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^(script|end_script)$/i.test(l)) continue;
    let m;
    if ((m = /^if\s+(.+)$/i.exec(l)) || (m = /^while\s+(.+)$/i.exec(l))) {
      const cond = [m[1]];
      while (i + 1 < lines.length && /^(and|&&|or|\|\|)\s/i.test(lines[i + 1])) cond.push(lines[++i]);
      const node = { kind: "if", cond, body: [], else: null };
      top().body.push(node);
      stack.push(node);
      continue;
    }
    if (/^else$/i.test(l)) { const n = top(); n.else = { kind: "block", body: [] }; stack.push(n.else); continue; }
    if (/^end_if$/i.test(l) || /^end_while$/i.test(l)) {
      // an `else` pushed its own block; close it with the if
      if (stack.length > 1 && top().kind === "block" && stack[stack.length - 2].else === top()) stack.pop();
      if (stack.length > 1) stack.pop();
      continue;
    }
    if ((m = /^for_each\s+(settlement|unit|character)\s+in\s+(world|faction\s+"?([A-Za-z0-9_]+)"?)$/i.exec(l))) {
      const node = { kind: "for", what: m[1].toLowerCase(), faction: m[3] || null, body: [] };
      top().body.push(node);
      stack.push(node);
      continue;
    }
    if (/^end_for$/i.test(l)) { if (stack.length > 1) stack.pop(); continue; }
    if ((m = /^return\s+(true|false)$/i.exec(l))) { top().body.push({ kind: "return", value: m[1] === "true" }); continue; }
    if ((m = /^(declare_counter|declare_persistent_counter)\s+(\S+)/i.exec(l))) continue;
    if ((m = /^(set_counter|inc_counter)\s+(\S+)\s+(-?\d+)/i.exec(l))) { top().body.push({ kind: m[1].toLowerCase(), counter: m[2], n: parseInt(m[3], 10) }); continue; }
    if ((m = /^set_counter\s+(\S+)\s+([A-Za-z_]\w*)\s*$/i.exec(l))) { top().body.push({ kind: "set_counter", counter: m[1], n: null, from: m[2] }); continue; }
    if ((m = /^monitor_event\s+(\S+)\s*(.*)$/i.exec(l))) {
      const cond = [m[2]];
      while (i + 1 < lines.length && /^(and|&&|or|\|\|)\s/i.test(lines[i + 1])) cond.push(lines[++i]);
      const node = { kind: "monitor", event: m[1], cond: cond.filter(Boolean), body: [] };
      top().body.push(node);
      stack.push(node);
      continue;
    }
    if (/^end_monitor$/i.test(l)) { if (stack.length > 1) stack.pop(); continue; }
    top().body.push({ kind: "stmt", text: l });
  }
  return root;
}

/** Split a condition (list of lines) into clauses joined by and/or. */
function clauses(cond) {
  const out = [];
  for (const [i, line] of cond.entries()) {
    let op = i === 0 ? null : "and";
    let t = line.trim();
    const m = /^(and|&&|or|\|\|)\s+(.*)$/i.exec(t);
    if (m) { op = /^(or|\|\|)$/i.test(m[1]) ? "or" : "and"; t = m[2].trim(); }
    // A single line can also chain with && / || / and / or.
    const parts = t.split(/\s+(&&|\|\||and|or)\s+(?=(?:not\s+)?[A-Za-z_]+\b)/i);
    out.push({ op, text: parts[0].trim() });
    for (let k = 1; k < parts.length; k += 2) out.push({ op: /^(or|\|\|)$/i.test(parts[k]) ? "or" : "and", text: parts[k + 1].trim() });
  }
  return out;
}

const OPS = { ">": "more than", ">=": "at least", "<": "fewer than", "<=": "at most", "=": "exactly", "==": "exactly", "!=": "other than" };
/** "> 14" -> "at least 15", which is how a player counts. */
function atLeast(op, n) {
  if (op === ">") return { word: "at least", n: n + 1 };
  if (op === "<") return { word: "fewer than", n };
  return { word: OPS[op] || op, n };
}

const UNTRANSLATED = new Map();
const NEVER_RESOURCES = new Set();
const unknown = (t, where) => {
  const k = t.trim();
  UNTRANSLATED.set(k, (UNTRANSLATED.get(k) || 0) + 1);
  return `\`${k}\``;
};

// ── campaign-script counters ────────────────────────────────────────────────
const CAMPAIGN = rd("world", "maps", "campaign", "imperial_campaign", "RIS_Campaign_Script.txt") || "";
const CAMPAIGN_TREE = parseScript(CAMPAIGN);
/** Every place a counter is set or raised, with the monitor and the ifs around it. */
const COUNTER_SITES = (() => {
  const out = new Map();
  const walk = (node, ctx) => {
    for (const n of node.body || []) {
      if (n.kind === "monitor") walk(n, { monitor: n, ifs: [], fors: [] });
      else if (n.kind === "if") {
        walk(n, { ...ctx, ifs: [...ctx.ifs, n.cond] });
        if (n.else) walk(n.else, { ...ctx, ifs: [...ctx.ifs, ["not (" + n.cond.join(" ") + ")"]] });
      } else if (n.kind === "for") walk(n, { ...ctx, fors: [...ctx.fors, { ...n, ifDepth: ctx.ifs.length }] });
      else if (n.kind === "set_counter" || n.kind === "inc_counter") {
        if (!out.has(n.counter)) out.set(n.counter, []);
        out.get(n.counter).push({ ...ctx, op: n.kind, n: n.n, from: n.from || null });
      }
    }
  };
  walk(CAMPAIGN_TREE, { monitor: null, ifs: [], fors: [] });
  return out;
})();
/** Where the campaign script hands a region a hidden resource. */
const RESOURCE_GRANTS = (() => {
  const out = new Map();
  for (const m of CAMPAIGN.matchAll(/^\s*add_hidden_resource\s+(\S+)\s+(\S+)/gim)) {
    if (!out.has(m[2])) out.set(m[2], new Set());
    out.get(m[2]).add(m[1]);
  }
  return out;
})();

// ── rendering conditions ────────────────────────────────────────────────────
// ctx: { forFaction, forWhat, local counters: Map name -> description }
function renderClause(text, ctx) {
  let t = text.trim(), neg = false;
  let m;
  if ((m = /^not\s+(.+)$/i.exec(t))) { neg = true; t = m[1].trim(); }
  const N = (s) => (neg ? s.no : s.yes);

  if ((m = /^I_TurnNumber\s*(>=|>|<=|<|==|=)\s*(\d+)$/i.exec(t))) {
    let n = parseInt(m[2], 10);
    const op = m[1];
    if (op === ">" && n === 0) return null; // the "counter not yet defined on turn 0" guard
    if (op === ">") n += 1;
    if (op === ">=" || op === ">") {
      const y = engineYear(n);
      if (END_YEAR != null && y != null && y > END_YEAR) return `turn ${num(2 * n + 2)} has been reached — which is after the campaign ends in ${yearText(END_YEAR)}, so this can never happen`;
      return `it is ${turnText(n)} or later`;
    }
    if (op === "<" || op === "<=") return `it is before ${turnText(op === "<=" ? n + 1 : n)}`;
    return `it is exactly ${turnText(n)}`;
  }
  if ((m = /^I_CompareCounter\s+(\S+)\s*(>=|>|<=|<|==|=|!=)\s*(-?\d+)$/i.exec(t))) {
    const [, c, op, v] = m;
    const local = ctx.locals && ctx.locals.get(c);
    const { word, n } = atLeast(op, parseInt(v, 10));
    if (!local && !(ctx.locals && ctx.locals.has(c))) {
      const d = describeCounter(c, word, n, ctx);
      if (d) return d;
      if (ctx.complex) ctx.complex.set(c, { word, n });
      const g = glossFor(c);
      if (g && word === "at least") return `${plural(n, "turn")}${aboutYears(n)} have passed since ${g.since}`;
      return "the conditions below are met";
    }
    if (local) {
      const pl = (x) => (n === 1 ? x.replace(/^it /, "")
        : x.replace(/^it is /, "are ").replace(/^it lies /, "lie ").replace(/^it has been /, "have been ").replace(/^it has /, "have ").replace(/^it carries /, "carry ").replace(/^its owner is /, "whose owner is ").replace(/^it /, ""));
      const w = local.where.length ? ` that ${local.where.map(pl).join(" and ")}` : "";
      if (n === 1 && word === "at least") return `a settlement ${local.passive.replace(/ between them$/, "")}${local.where.length ? ` ${local.where.map((x) => x.replace(/^it /, "")).join(" and ")}` : " exists"}`;
      return `${word} ${plural(n, local.noun, local.nouns)}${w} ${n === 1 ? "is" : "are"} ${local.passive}`;
    }
  }
  if ((m = /^I_SettlementLevel\s+local\s*(>=|>|==|=)\s*(\S+)$/i.exec(t))) {
    const s = sizeLink(m[2]);
    return m[1] === ">=" ? N({ yes: `it is a ${s} or larger`, no: `it is smaller than a ${s}` }) : N({ yes: `it is a ${s}`, no: `it is not a ${s}` });
  }
  if ((m = /^HasResource\s+(\S+)$/i.exec(t))) {
    const res = m[1];
    const place = resourcePlace(res);
    if (place) return N({ yes: `it lies in ${place}`, no: `it does not lie in ${place}` });
    if (RESOURCE_GRANTS.has(res)) {
      const where = [...RESOURCE_GRANTS.get(res)];
      return N({ yes: `it has been marked \`${res}\` by the campaign script (it marks ${orList(where.slice(0, 8).map(regionLink))}${where.length > 8 ? ` and ${where.length - 8} more` : ""})`, no: `it has not been marked \`${res}\`` });
    }
    // Declared, but no region carries it and no script places it.
    NEVER_RESOURCES.add(res);
    return N({ yes: `it carries \`${res}\` — **which no region has and no script ever places, so this can never happen**`, no: `it does not carry \`${res}\`` });
  }
  if ((m = /^I_SettlementOwner\s+local\s*(==|=)\s*(\S+)$/i.exec(t))) {
    if (ctx.forFaction && ctx.forFaction.toLowerCase() === m[2].toLowerCase()) return null; // restates the loop
    return N({ yes: `it is held by ${factionLink(m[2])}`, no: `it is not held by ${factionLink(m[2])}` });
  }
  if ((m = /^I_SettlementOwner\s+(\S+)\s*(==|=)\s*(\S+)$/i.exec(t))) return N({ yes: `${settlementLink(m[1])} is held by ${factionLink(m[3])}`, no: `${settlementLink(m[1])} is not held by ${factionLink(m[3])}` });
  if ((m = /^I_SettlementOwnerCulture\s+local\s*(==|=)\s*(\S+)$/i.exec(t))) return N({ yes: `its owner is of ${cultureLink(m[2])} culture`, no: `its owner is not of ${cultureLink(m[2])} culture` });
  if ((m = /^SettlementName\s+(\S+)$/i.exec(t))) return N({ yes: `it is ${settlementLink(m[1])}`, no: `it is not ${settlementLink(m[1])}` });
  if ((m = /^SettlementBuildingExists\s*(>=|=)?\s*(\S+)$/i.exec(t))) { const b = buildingName(m[2]); return N({ yes: `it has ${aOr(b)} ${b}`, no: `it has no ${b}` }); }
  if ((m = /^I_LocalFaction\s+(\S+)$/i.exec(t)) && ctx.who) { (neg ? ctx.who.not : ctx.who.play).push(m[1].toLowerCase()); return null; }
  if ((m = /^I_LocalFaction\s+(\S+)$/i.exec(t))) return N({ yes: `you are playing ${factionLink(m[1])}`, no: `you are not playing ${factionLink(m[1])}` });
  if ((m = /^FactionIsLocal$/i.exec(t))) return N({ yes: "it is your faction", no: "it is not your faction" });
  if ((m = /^RandomPercent\s*<\s*(\d+)$/i.exec(t))) return `a ${m[1]}% chance each round`;
  if ((m = /^FactionIsAlive\s+(\S+)$/i.exec(t))) return N({ yes: `the faction ${factionLink(m[1])} is still alive`, no: `the faction ${factionLink(m[1])} has been destroyed` });
  if ((m = /^I_NumberOfSettlements\s+(\S+)\s*(>=|>|<=|<|==|=)\s*(\d+)$/i.exec(t))) {
    const { word, n } = atLeast(m[2], parseInt(m[3], 10));
    return `${word} ${plural(n, "settlement")} ${n === 1 ? "is" : "are"} held by ${factionLink(m[1])}`;
  }
  if ((m = /^MajorEventActive\s+"?([A-Za-z0-9_]+)"?(?:\s*,\s*(\S+))?$/i.exec(t))) return N({ yes: `${reformLink(m[1])} has happened`, no: `${reformLink(m[1])} has not happened` });
  if ((m = /^TestFaction\s+(\S+)$/i.exec(t)) || (m = /^FactionType\s+(\S+)$/i.exec(t))) return N({ yes: `the faction is ${factionLink(m[1])}`, no: `the faction is not ${factionLink(m[1])}` });
  if ((m = /^UnitType\s+(.+)$/i.exec(t))) return N({ yes: `it is ${unitTypeLink(m[1])}`, no: `it is not ${unitTypeLink(m[1])}` });
  if ((m = /^DiplomaticStanceFromFaction\s+(\S+)\s*(=|==)\s*AtWar$/i.exec(t))) return N({ yes: `at war with ${factionLink(m[1])}`, no: `not at war with ${factionLink(m[1])}` });
  if ((m = /^I_CompareCounter\s+(\S+)\s*(>=|>|<=|<|==|=|!=)\s*(-?\d+)$/i.exec(t))) return null;
  if (/^TrueCondition$/i.test(t)) return null;
  return unknown(neg ? `not ${t}` : t);
}

/** A list of clauses as one English phrase ("A, B and C" / "A or B"). */
function renderCond(cond, ctx) {
  let cs = clauses(cond);
  if (cs.length > 1 && cs.every((c, i) => /^UnitType\s+/i.test(c.text) && (i === 0 || c.op === "or"))) {
    return `it is ${orList(cs.map((c) => unitTypeLink(c.text.replace(/^UnitType\s+/i, ""))))}`;
  }
  const parts = [];
  for (const c of cs) {
    const r = renderClause(c.text, ctx);
    if (r == null) continue;
    parts.push({ op: c.op, r });
  }
  if (!parts.length) return null;
  const hasOr = parts.some((p, i) => i > 0 && p.op === "or");
  if (!hasOr) return joinAnd(parts.map((p) => p.r));
  // Mixed and/or with no brackets: the engine's grouping is not stated. Keep the file's order.
  return parts.map((p, i) => (i === 0 ? p.r : `${p.op} ${p.r}`)).join(" ");
}
const joinAnd = (a0) => {
  // Fold runs of "<place> is held by <X>" with the same X (Syracuse must hold 16 settlements).
  const a = [];
  for (const x of a0) {
    const m = /^(.+) is held by (.+)$/.exec(x);
    const prev = a[a.length - 1];
    if (m && prev && prev.heldBy === m[2]) { prev.places.push(m[1]); continue; }
    a.push(m ? { heldBy: m[2], places: [m[1]] } : { text: x });
  }
  const t = a.map((x) => (x.text != null ? x.text : x.places.length > 1 ? `${x.places.slice(0, -1).join(", ")} and ${x.places[x.places.length - 1]} are all held by ${x.heldBy}` : `${x.places[0]} is held by ${x.heldBy}`));
  return t.length <= 1 ? t.join("") : `${t.slice(0, -1).join(", ")} and ${t[t.length - 1]}`;
};

// Monitor events as a player meets them.
function describeMonitor(mon) {
  const cs = clauses(mon.cond);
  let who = null;
  const quals = [];
  for (const c of cs) {
    const t = c.text.trim();
    let m;
    if ((m = /^(?:FactionType|TestFaction)\s+(\S+)$/i.exec(t))) { who = factionLink(m[1].toLowerCase()); continue; }
    if ((m = /^FactionCultureType\s+(\S+)$/i.exec(t))) { who = `any ${cultureLink(m[1])} faction`; continue; }
    if (/^TrueCondition$/i.test(t) || !t) continue;
    quals.push({ op: c.op, text: t });
  }
  return { event: mon.event, who, quals };
}

/** Fold "not against A", "not against B", ... into one clause. */
function foldQuals(quals, ctx) {
  const negC = [], negF = [], rest = [];
  for (const q of quals) {
    let m;
    if ((m = /^not\s+GeneralFoughtCulture\s+(\S+)$/i.exec(q.text.trim()))) negC.push(cultureLink(m[1]));
    else if ((m = /^not\s+GeneralFoughtFaction\s+(\S+)$/i.exec(q.text.trim()))) negF.push(factionLink(m[1]));
    else rest.push(q);
  }
  const out = rest.map((q) => qualText(q, ctx)).filter(Boolean);
  if (negC.length) out.push(`except against ${orList(negC)} armies${negF.length ? ` or ${orList(negF)}` : ""}`);
  else if (negF.length) out.push(`except against ${orList(negF)}`);
  return out;
}
function qualText(q, ctx) {
  let t = q.text, neg = false, m;
  if ((m = /^not\s+(.+)$/i.exec(t))) { neg = true; t = m[1]; }
  if (/^IsGeneral$/i.test(t)) return neg ? "not led by a general" : "led by a general";
  if ((m = /^GeneralFoughtCulture\s+(\S+)$/i.exec(t))) return `${neg ? "not " : ""}against ${cultureLink(m[1])} armies`;
  if ((m = /^GeneralFoughtFaction\s+(\S+)$/i.exec(t))) return `${neg ? "not " : ""}against ${factionLink(m[1])}`;
  return renderClause(q.text, ctx);
}

/**
 * A campaign-script counter compared against n, as a requirement. Handles the shapes the
 * reform counters actually take; anything else is left as the comparison itself.
 */
function describeCounter(c, word, n, ctx0) {
  const ctx = { locals: new Map() };
  const KNOWN = /^(PostBattle|UnitTrained|HireMercenaries|GeneralCaptureSettlement|FactionTurnStart)$/;
  const sites = (COUNTER_SITES.get(c) || []).filter((s) => s.monitor);
  const incs = sites.filter((s) => s.op === "inc_counter");
  const sets = sites.filter((s) => s.op === "set_counter");
  // Pure tallies: every site is an increment inside a monitor.
  if (incs.length && !sets.some((s) => s.n !== 0 || s.from)) {
    // One entry per increment site. Sites that differ only in WHO counts (Odrysians, Paeonia,
    // Cabyle each have a monitor) or in which culture they fought (Labeatae has an if per
    // culture) are the same requirement and are merged; only a different step is a weighting.
    if (incs.some((s) => !KNOWN.test(s.monitor.event))) return null;
    const groups = new Map();
    for (const s of incs) {
      const d = describeMonitor(s.monitor);
      const ifQuals = s.ifs.flatMap((cond) => clauses(cond));
      const all = [...d.quals, ...ifQuals];
      const ifUnits = ifQuals.map((q) => /^UnitType\s+(.+)$/i.exec(q.text.trim())).filter(Boolean).map((m) => unitTypeLink(m[1]));
      const monUnits = [], against = [], other = [];
      for (const q of all) {
        const t = q.text.trim();
        let m;
        if ((m = /^UnitType\s+(.+)$/i.exec(t))) monUnits.push(unitTypeLink(m[1]));
        else if ((m = /^GeneralFoughtCulture\s+(\S+)$/i.exec(t))) against.push(`${cultureLink(m[1])} armies`);
        else if ((m = /^GeneralFoughtFaction\s+(\S+)$/i.exec(t))) against.push(factionLink(m[1]));
        else other.push(q);
      }
      const units = [...new Set(ifUnits.length ? ifUnits : monUnits)];
      const qs = foldQuals(other, ctx);
      let verb, noun, nouns;
      // Passive voice throughout: faction names are singular ("Rome") and plural
      // ("Boeotians") alike, and "has fought" would be wrong for half of them.
      switch (d.event) {
        case "PostBattle": verb = "fought"; noun = "battle"; nouns = "battles"; break;
        case "UnitTrained": verb = "recruited"; noun = units.length ? `unit of ${orList(units)}` : "unit"; nouns = units.length ? `units of ${orList(units)}` : "units"; break;
        case "HireMercenaries": verb = "hired"; noun = "mercenary unit"; nouns = "mercenary units"; break;
        case "GeneralCaptureSettlement": verb = "captured"; noun = "settlement"; nouns = "settlements"; break;
        default: verb = null;
      }
      if (!verb) return null;
      const key = [verb, noun, qs.join("|"), s.n].join("#");
      if (!groups.has(key)) groups.set(key, { verb, noun, nouns, qs, step: s.n, who: new Set(), against: new Set() });
      const g = groups.get(key);
      g.who.add(d.who || "the faction");
      for (const a of against) g.against.add(a);
    }
    const tailOf = (g) => {
      const parts = [...g.qs];
      if (g.against.size) parts.push(`against ${orList([...g.against])}`);
      return parts.length ? `, ${joinAnd(parts)}` : "";
    };
    const gs = [...groups.values()];
    if (gs.length === 1 && gs[0].step === 1) {
      const g = gs[0];
      // HireMercenaries fires once per hiring ("A General has hired some mercenaries"), not
      // once per unit - so the count is of hirings.
      if (g.verb === "hired") return `mercenaries have been hired by ${orList([...g.who])} ${word} ${plural(n, "time")}${tailOf(g)} (each hiring counts once, however many units it takes on)`;
      return `${word} ${plural(n, g.noun, g.nouns)} ${n === 1 ? "has" : "have"} been ${g.verb} by ${orList([...g.who])}${tailOf(g)}`;
    }
    // Weighted tallies (Miletus counts a Cretan archer unit as 2): points.
    const who = orList([...new Set(gs.flatMap((g) => [...g.who]))]);
    return `${word} ${num(n)} points have been scored by ${who}, where ${joinAnd(gs.map((g) => `each ${g.noun} ${g.verb}${tailOf(g)} scores ${g.step}`))}`;
  }
  // A flag the script sets to 1 while a condition holds (Pergamon at war with the Seleucids).
  const setters = sets.filter((s) => s.n !== 0);
  if (setters.length === 1 && word === "at least" && n === 1) {
    const s = setters[0];
    const d = describeMonitor(s.monitor);
    const inner = s.ifs.map((cond) => renderCond(cond, ctx)).filter(Boolean);
    if (inner.length && s.monitor.event === "FactionTurnStart") return `${d.who ? `${d.who} is ` : ""}${joinAnd(inner)} at the start of its turn`;
  }
  return null; // caller decides: complex counter
}

// ── a trigger script as a list of routes ────────────────────────────────────
/**
 * Every `return true` is a route; its requirements are the conditions around it. `return
 * false` inside an if ends that branch, so a later route also carries "not that" — the
 * polybian script uses exactly this to split player and AI. Local counters filled by a
 * for_each are turned into counts ("Achaea holds at least 15 settlements").
 */
function routesOf(tree, reform, complexCounters) {
  const routes = [];
  const locals = new Map();
  const complex = [];
  const guards = []; // conditions that ended in `return false` earlier at this level

  const walk = (node, conds, fors, who = { play: [], not: [] }) => {
    for (const n of node.body) {
      if (n.kind === "for") {
        n.depth = conds.length;
        // Is this a counting loop? for_each ... [if cond] inc_counter X
        const incs = [];
        const collect = (b, ifs) => {
          for (const x of b.body) {
            if (x.kind === "inc_counter") incs.push({ counter: x.counter, ifs });
            else if (x.kind === "if") collect(x, [...ifs, x.cond]);
          }
        };
        collect(n, []);
        const hasReturn = JSON.stringify(n).includes('"kind":"return"');
        if (incs.length && !hasReturn) {
          for (const inc of incs) {
            const scope = { forFaction: n.faction, locals };
            const where = inc.ifs.flatMap((c) => (clauses(c).some((cl) => cl.op === "or") ? [renderCond(c, scope)] : clauses(c).map((cl) => renderClause(cl.text, scope)))).filter(Boolean);
            const prev = locals.get(inc.counter);
            const owner = n.faction ? (isCultureKey(n.faction) ? `any ${cultureLink(n.faction.toLowerCase())}-culture faction` : factionLink(n.faction)) : null;
            if (n.what === "settlement") {
              const subjects = prev ? [...prev.owners, owner] : [owner];
              locals.set(inc.counter, {
                owners: subjects,
                passive: n.faction ? `held by ${joinOwners(subjects)}${subjects.length > 1 ? " between them" : ""}` : "on the map",
                noun: "settlement", nouns: "settlements",
                where,
              });
            } else if (n.what === "unit") {
              locals.set(inc.counter, {
                owners: [owner],
                passive: owner ? `fielded by ${owner}` : "on the map",
                noun: "unit", nouns: "units",
                where,
              });
            }
          }
          continue;
        }
        walk(n, conds, [...fors, n], who);
        continue;
      }
      if (n.kind === "if") {
        const ctx = { forFaction: (fors[fors.length - 1] || {}).faction, locals, complex: complexCounters, who: { play: [], not: [] } };
        const r = renderCond(n.cond, ctx);
        const who2 = { play: [...who.play, ...ctx.who.play], not: [...who.not, ...ctx.who.not] };
        const endsFalse = n.body.length && n.body[n.body.length - 1].kind === "return" && !n.body[n.body.length - 1].value
          && !JSON.stringify(n.body).includes('"value":true');
        walk(n, r ? [...conds, r] : conds, fors, who2);
        if (n.else) walk(n.else, r ? [...conds, `not (${r})`] : conds, fors, who);
        // An if whose body returns (true or false) and never falls through narrows what comes
        // after it: the rest of the script only runs when this condition failed.
        const last = n.body[n.body.length - 1];
        if (r && last && last.kind === "return" && !n.else && fors.length === 0) guards.push({ r, endsFalse, after: routes.length });
        continue;
      }
      if (n.kind === "return" && n.value) {
        const inLoop = fors[fors.length - 1];
        const g = guards.filter((x) => x.after <= routes.length);
        routes.push({ conds: [...conds], loop: inLoop || null, guardsBefore: g.map((x) => x.r), who });
        continue;
      }
      if (n.kind === "stmt") unknown(n.text);
    }
  };
  walk(tree, [], []);
  return { routes, complex };
}
/**
 * The polybian script repeats one test four times, once per faction you might be playing.
 * Routes identical apart from "you are playing X" are folded into one, and a run of
 * "you are not playing X" clauses into one list. Names are de-duplicated: roman_rebels_1
 * and _2 are both "Roman Rebels".
 */
function mergeRoutes(texts) {
  const PLAY = /^you are playing (.+?)(?: and |$)/;
  const groups = new Map();
  const order = [];
  for (const t of texts) {
    const m = PLAY.exec(t);
    const key = m ? t.slice(m[0].length) : t;
    const k = (m ? "P|" : "N|") + key;
    if (!groups.has(k)) { groups.set(k, { key, play: [], plain: !m }); order.push(k); }
    if (m) groups.get(k).play.push(m[1]);
  }
  return order.map((k) => {
    const g = groups.get(k);
    let t = g.plain ? g.key : `you are playing ${orList([...new Set(g.play)])}${g.key ? ` and ${g.key}` : ""}`;
    // "you are not playing A, you are not playing B and you are not playing C"
    t = t.replace(/((?:,? (?:and )?)?you are not playing [^,]+?(?=,| and |$))+/g, (run) => {
      const names = [...new Set([...run.matchAll(/you are not playing (\[[^\]]+\]\([^)]+\)|[^,]+?)(?=,| and |$)/g)].map((x) => x[1]))];
      const lead = /^,/.test(run) ? ", " : / and /.test(run.slice(0, 6)) ? " and " : "";
      return names.length > 1 ? `${lead}you are playing none of ${orList(names, "and")}` : run;
    });
    return t;
  });
}
const orList = (a, w = "or") => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} ${w} ${a[a.length - 1]}`);
/**
 * Routes split by who is at the keyboard. A trigger that tests I_LocalFaction is written
 * twice over: one test for when you play the faction, another for when the AI does (the
 * Polybian reform fires for a human Rome at 71 settlements, and for an AI Rome at turn 72 or
 * when it is down to 14). Phrasing both as one list read as if all of them applied to you.
 * The faction tests are lifted out of the sentences and become the section headings.
 */
function playerAiSections(routes, texts) {
  const names = (toks) => orList([...new Set(toks.map((f) => factionLink(f)))]);
  const player = new Map(), ai = [], any = [];
  const aiWho = new Set();
  routes.forEach((r, i) => {
    const t = texts[i];
    if (r.who.play.length) {
      if (!player.has(t)) player.set(t, new Set());
      for (const f of r.who.play) player.get(t).add(f);
    } else if (r.who.not.length) { ai.push(t); for (const f of r.who.not) aiWho.add(f); }
    else any.push(t);
  });
  const list = (ts) => {
    const u = [...new Set(ts)];
    const chance = u.length === 1 && /^(.*?)(?:,| and) a (\d+)% chance each round$/.exec(u[0]);
    if (chance) return `once ${chance[1]}, it has a ${chance[2]}% chance to fire each round.`;
    return u.length === 1 ? `it fires when ${u[0]}.` : `it fires when **any one** of these holds:\n\n${u.map((x) => `- ${x}`).join("\n")}`;
  };
  if (!player.size && !ai.length) return [list(any).replace(/^./, (x) => x.toUpperCase())];
  const out = [];
  // Routes identical apart from which faction you play fold into one heading.
  const byText = new Map();
  for (const [t, fs] of player) {
    const key = [...fs].sort().join(",");
    if (!byText.has(key)) byText.set(key, { fs: [...fs], ts: [] });
    byText.get(key).ts.push(t);
  }
  for (const { fs, ts } of byText.values()) out.push(`**If you are playing ${names(fs)}:** ${list(ts)}`);
  if (ai.length) out.push(`**If nobody is playing ${names([...aiWho])}** (the AI runs them): ${list(ai)}`);
  if (any.length) out.push(`**In any campaign:** ${list(any)}`);
  return out;
}
/** A parsed trigger script as its routes and one sentence per route. */
function renderRoutes(tree, reform, complexCounters) {
  const { routes } = routesOf(tree, reform, complexCounters);
  // The script runs once per affected faction; "not Carthage" in a Carthage-and-Gades reform
  // is the route for Gades, and a reader should not have to work that out.
  const whoIs = (t) => t.replace(/the faction is (not )?\[([^\]]+)\]\(\.\.\/factions\/([a-z0-9_]+)\.md\)/g, (all, not, name, tok) => {
    const aff = reform.affects.map((f) => f.toLowerCase());
    if (!aff.includes(tok) || aff.includes("all")) return all;
    const rest = aff.filter((f) => f !== tok);
    if (!not) return `the faction is ${factionLink(tok)}`;
    return rest.length ? `the faction is ${orList(rest.map((f) => factionLink(f)))} (not ${factionLink(tok)})` : all;
  });
  const texts0 = routes.map((route) => {
    const conds = route.conds.slice();
    let t;
    if (route.loop) {
      const who = route.loop.faction ? factionLink(route.loop.faction) : null;
      const lead = route.loop.what === "settlement" ? (who ? `a settlement held by ${who}` : "a settlement anywhere on the map") : (who ? `a unit of ${who}` : "a unit");
      const outer = conds.slice(0, route.loop.depth || 0), inner = conds.slice(route.loop.depth || 0);
      // "it is a huge city or larger" reads as "a settlement held by X is a huge city or larger"
      const loopText = `${lead} ${joinAnd(inner.map((x, i) => (i === 0 ? x.replace(/^it /, "") : x))) || "exists"}`;
      t = joinAnd([...outer, loopText]);
    } else t = joinAnd(conds);
    return t || "nothing — it fires on the first check";
  });
  const texts = texts0.map(whoIs);
  return { routes, texts };
}
function joinOwners(list) {
  const u = [...new Set(list.filter(Boolean))];
  return u.length > 1 ? `${u.slice(0, -1).join(", ")} and ${u[u.length - 1]}` : u[0];
}

/** One route as a player-facing sentence. */
function routeText(route, reform) {
  const bits = [];
  if (route.loop) {
    const who = route.loop.faction ? factionLink(route.loop.faction) : null;
    const lead = route.loop.what === "settlement"
      ? (who ? `${who} holds a settlement where` : "any settlement anywhere where")
      : (who ? `${who} has a unit where` : "any unit where");
    const inner = route.conds.slice(route.loopDepth || 0);
    bits.push(`${lead} ${joinAnd(inner) || "—"}`);
  } else if (route.conds.length) bits.push(joinAnd(route.conds));
  return bits.join("; ");
}

// Counters too tangled for the tally/flag shapes: say which campaign-script counter it is and
// render each place it is set, so the reader still sees the real conditions.
// The mod's own one-line description of a counter, from the comment on its declaration.
/**
 * Plain words for campaign-script counters too tangled to translate clause by clause (the
 * Roman civil war machinery). Each entry is written FROM the code: `from` names the counters
 * whose monitors it describes, and `sig` fingerprints those monitors. If the mod changes any
 * of them the fingerprint moves, the gloss is dropped (the page falls back to the generic
 * text) and the console says which entry to re-check - a stale sentence is never published.
 */
const COUNTER_GLOSS = {
  // RIS_Campaign_Script.txt: cw2_wait rises each turn once cw1_resolved = 1 (with the war-one
  // flags set); cw1_resolved is set when the losing side is down to one settlement
  // (I_NumberOfSettlements roman_rebels_1 = 1, or romans_julii = 1 when you play the rebels).
  cw2_wait: {
    since: "Rome's first civil war was decided",
    // cw2_wait_done is set at cw2_wait > 49 (the AI fuse), which the second war's cw2_armed
    // monitors require - so 25 turns is halfway to the earliest second civil war.
    how: "The first civil war counts as decided once the losing side — Rome or the Roman Rebels — is down to its last settlement. 25 turns is roughly halfway to the second civil war, which cannot begin until the same count passes 50.",
    // cw2_wait_done too: the fuse length lives in ITS setter ("cw2_wait > 50"), and a testing
    // value there (2, shipped until 2026-09-24) silently stopped the count below 25.
    from: ["cw2_wait", "cw1_resolved", "cw2_wait_done"],
    sig: "a8a061851cd0",
  },
};
function counterSig(names) {
  const parts = names.map((c) => (COUNTER_SITES.get(c) || []).map((x) => [x.monitor ? x.monitor.event : "", x.monitor ? x.monitor.cond.join(" ") : "", x.ifs.map((i) => i.join(" ")).join("|"), x.op, x.n, x.from || ""].join("#")).join("\n"));
  return require("crypto").createHash("sha1").update(parts.join("\n--\n")).digest("hex").slice(0, 12);
}
const GLOSS_STALE = [];
const glossFor = (c) => {
  const g = COUNTER_GLOSS[c];
  if (!g) return null;
  const now = counterSig(g.from);
  if (now !== g.sig) { if (!GLOSS_STALE.some((x) => x.c === c)) GLOSS_STALE.push({ c, now }); return null; }
  return g;
};
const aboutYears = (turns) => { const y = turns / 4; return y < 1 ? "" : ` (about ${Math.round(y)} year${Math.round(y) === 1 ? "" : "s"})`; };
const COUNTER_NOTES = (() => {
  const out = {};
  for (const m of CAMPAIGN.matchAll(/^\s*declare_(?:persistent_)?counter\s+(\S+)[ \t]*;+[ \t]*([^\r\n]+)/gim)) out[m[1]] = m[2].trim();
  return out;
})();
/** Counters named in a condition, rendered as themselves with the mod's note. */
function counterCond(text) {
  return clauses([text]).map((c) => {
    const m = /^(not\s+)?I_CompareCounter\s+(\S+)\s*(>=|>|<=|<|==|=|!=)\s*(-?\d+)$/i.exec(c.text.trim());
    if (!m) return renderClause(c.text, { locals: new Map() });
    const note = COUNTER_NOTES[m[2]];
    return `\`${m[2]}\` ${m[3] === "==" ? "=" : m[3]} ${m[4]}${note ? ` (“${note}”)` : ""}`;
  }).filter(Boolean);
}
/** A counter only ever raised inside loops over factions that do not exist never rises. */
function deadCounter(c) {
  const sites = (COUNTER_SITES.get(c) || []).filter((s) => s.op === "inc_counter" || (s.op === "set_counter" && (s.n || s.from)));
  return sites.length > 0 && sites.every((s) => s.op === "inc_counter" && s.fors.some((f) => f.faction && !isFaction(f.faction)));
}
function complexCounterText(c, depth = 0) {
  const sites = COUNTER_SITES.get(c) || [];
  const lines = [];
  const nested = new Set();
  for (const s of sites) {
    if (s.op === "set_counter" && s.n === 0 && !s.from) continue; // resets
    const d = s.monitor ? describeMonitor(s.monitor) : null;
    const when = d ? eventPhrase(d) : "When the script starts";
    const monConds = s.monitor && s.monitor.event !== "SettlementTurnEnd" ? s.monitor.cond.flatMap((x) => counterCond(x)).filter((x) => !d || !d.who || !/^the faction is /.test(x)) : [];
    const ifConds = s.ifs.flatMap((cond) => cond.flatMap((x) => counterCond(x)));
    const seenC = new Set();
    const all = [...monConds, ...ifConds].filter((x) => /% roll/.test(x) || (!seenC.has(x) && seenC.add(x))).filter((x) => !/^the faction is /.test(x) || !d || !d.who);
    const f = s.fors[s.fors.length - 1];
    let loop = "";
    if (f) {
      if (f.faction && !isFaction(f.faction)) { NO_SUCH_FACTION.add(f.faction); loop = ` for each ${f.what} of \`${f.faction}\` — **no faction is called \`${f.faction}\`, so this loop counts nothing**`; }
      else loop = f.faction ? ` for each ${f.what} ${heldBy(f.faction)}` : ` for each ${f.what} on the map`;
    }
    const what = s.op === "inc_counter" ? `goes up by ${s.n}${loop}` : s.from ? `is set to \`${s.from}\`` : `is set to ${s.n}`;
    lines.push(`${when}${all.length ? `, if ${joinAnd(all)}` : ""}: ${what}`);
    if (s.from) nested.add(s.from);
    // A counter tested here that has no note of its own and is a plain tally: explain it too.
    for (const cond of [...(s.monitor ? s.monitor.cond : []), ...s.ifs.flat()]) {
      for (const m of String(cond).matchAll(/I_CompareCounter\s+(\S+)/g)) {
        const k = m[1];
        if (k === c || COUNTER_NOTES[k]) continue;
        const ks = COUNTER_SITES.get(k) || [];
        if (ks.length && ks.every((x) => x.op === "inc_counter" ? x.fors.length > 0 : x.n === 0)) nested.add(k);
      }
    }
  }
  if (depth === 1) {
    const incs = sites.filter((x) => x.op === "inc_counter");
    const loops = [...new Set(incs.map((x) => (x.fors[x.fors.length - 1] || {}).faction || ""))];
    if (incs.length > 1 && loops.length === 1 && incs.every((x) => x.fors.length && x.ifs.length)) {
      const f = loops[0];
      const items = incs.map((x) => renderCond(x.ifs[x.ifs.length - 1], { locals: new Map() })).filter(Boolean).map((t) => t.replace(/^it has (an? )?/, ""));
      const over = f && !isFaction(f) ? `every settlement of \`${f}\` — **no faction is called \`${f}\`, so this counts nothing**` : f ? `every settlement ${heldBy(f)}` : "every settlement on the map";
      if (!isFaction(f)) NO_SUCH_FACTION.add(f);
      return [`Recounted over ${over}: 1 for each of these buildings standing in one — ${orList(items)}`];
    }
  }
  const out = [...new Set(lines)];
  if (depth === 0) for (const k of nested) {
    const sub = complexCounterText(k, 1);
    if (sub.length) out.push(`\`${k}\`${deadCounter(k) ? " — **never rises, so any test that needs it above 0 fails**" : ""}:\n${sub.map((l) => `  - ${l}`).join("\n")}`);
  }
  return out;
}
/**
 * The short version of a campaign-script counter, for the top of the page: one bullet per
 * gate, in the order the script tests them. Only for a counter the script SETS to the value
 * the trigger wants (Gracchi); a counter that counts up turn by turn keeps just the detail.
 * A tally tested inside it ("gracchi_farms >= 5") is spelled out as what has to be built,
 * and each random roll stays its own bullet — two 35% rolls are two chances, not one.
 */
function tallyPhrase(k, op, v) {
  const ks = (COUNTER_SITES.get(k) || []).filter((x) => x.op === "inc_counter");
  if (!ks.length || !ks.every((x) => x.fors.length && x.ifs.length)) return null;
  const f = (ks[0].fors[ks[0].fors.length - 1] || {}).faction || "";
  const items = ks.map((x) => renderCond(x.ifs[x.ifs.length - 1], { locals: new Map() })).filter(Boolean).map((t) => t.replace(/^it has (an? )?/, ""));
  const { word, n } = atLeast(op, parseInt(v, 10));
  // Conditions between the loop and the building test narrow WHERE ("HasResource aor_camillan").
  const lp = ks[0].fors[ks[0].fors.length - 1];
  const narrow = [...new Set(ks[0].ifs.slice(lp.ifDepth || 0, -1).map((cnd) => renderCond(cnd, { locals: new Map() })).filter(Boolean))].map((x) => x.replace(/^it /, ""));
  const where = !f ? (narrow.length ? `in settlements that ${joinAnd(narrow).replace(/^lies /, "lie ")}` : "anywhere on the map") : isFaction(f) ? `in settlements ${heldBy(f)}` : `in settlements of \`${f}\` — **no faction is called \`${f}\`, so this is never met**`;
  return `${word} ${num(n)} of these buildings stand ${where}: ${orList(items)}`;
}
/** The gates of one set/inc site as bullets; nested set-counters become indented sub-lists. */
function siteBullets(c, site, depth) {
  const d = site.monitor ? describeMonitor(site.monitor) : null;
  const raw = [...(site.monitor ? site.monitor.cond : []), ...site.ifs.flat()].flatMap((line) => clauses([line]));
  const bullets = [];
  let rolls = 0;
  for (const q of raw) {
    const t = q.text.trim();
    let m;
    if ((m = /^I_CompareCounter\s+(\S+)\s*(>=|>|<=|<|==|=|!=)\s*(-?\d+)$/i.exec(t))) {
      if (m[1] === c) continue; // the site's own guard ("has not happened yet" / "not yet counted")
      const tp = tallyPhrase(m[1], m[2], m[3]);
      if (tp) { bullets.push(tp); continue; }
      const { word, n } = atLeast(m[2], parseInt(m[3], 10));
      const sub = depth < 2 ? summarizeCounter(m[1], word, n, depth + 1) : null;
      const note = COUNTER_NOTES[m[1]];
      bullets.push(sub
        ? `\`${m[1]}\` has been set${note ? ` (“${note}”)` : ""} — ${sub.replace(/\n\n/g, "\n").replace(/\n- /g, "\n  - ")}`
        : counterCond(t).join(""));
      continue;
    }
    if ((m = /^RandomPercent\s*<\s*(\d+)$/i.exec(t))) { bullets.push(rolls++ ? `then a further ${m[1]}% chance` : `a ${m[1]}% chance each time it is checked`); continue; }
    const r = renderClause(t, { locals: new Map() });
    if (r && !(d && d.who && /^the faction is /.test(r))) bullets.push(r);
  }
  return { d, bullets };
}
function whenOf(d) {
  return d ? eventPhrase(d).replace(/^At /, "at ").replace(/^After /, "after ").replace(/^When /, "when ").replace(/^On /, "on ") : "when the script starts";
}
function summarizeCounter(c, word, n, depth = 0) {
  const all = COUNTER_SITES.get(c) || [];
  // Copied from a tally at the end of a faction's turn (Carthage's Italian and Sicilian cities).
  const copies = all.filter((x) => x.op === "set_counter" && x.from);
  if (copies.length === 1 && all.every((x) => x === copies[0] || (x.op === "set_counter" && x.n === 0))) {
    const src = (COUNTER_SITES.get(copies[0].from) || []).filter((x) => x.op === "inc_counter");
    const d = copies[0].monitor ? describeMonitor(copies[0].monitor) : null;
    if (src.length === 1 && src[0].monitor && src[0].monitor.event === "SettlementTurnEnd" && d && d.who) {
      const cond = describeMonitor(src[0].monitor).quals.map((q) => renderClause(q.text, { locals: new Map() })).filter(Boolean).map((x) => x.replace(/^it /, ""));
      return `${word} ${plural(n, "settlement")}${cond.length ? ` that ${joinAnd(cond).replace(/^lies /, n === 1 ? "lies " : "lie ")}` : ""} ${n === 1 ? "is" : "are"} held by ${d.who} (counted at the end of its turn)`;
    }
  }
  // Counted up once per turn while its conditions hold (Late Republican: two turns after the revolt).
  const incs = all.filter((x) => x.op === "inc_counter");
  // Several turn monitors (one per player case, Named Legions): the mod's own note says what
  // is being counted, and the per-case conditions stay in the step-by-step detail.
  if (incs.length > 1 && COUNTER_NOTES[c] && incs.every((x) => x.n === 1 && x.monitor && /^(NewTurnStart|FactionTurnStart)$/.test(x.monitor.event)) && word === "at least") {
    return `the campaign script has counted ${plural(n, "turn")} on \`${c}\` (“${COUNTER_NOTES[c]}”)`;
  }
  if (incs.length === 1 && incs[0].n === 1 && incs[0].monitor && /^(NewTurnStart|FactionTurnStart)$/.test(incs[0].monitor.event)
      && all.every((x) => x.op === "inc_counter" || x.n === 0) && word === "at least") {
    const { d, bullets } = siteBullets(c, incs[0], depth);
    if (bullets.length) return `for ${plural(n, "turn")}, counted ${whenOf(d)}, all of these hold:\n\n${bullets.map((x) => `- ${x}`).join("\n")}`;
  }
  const sites = all.filter((x) => x.op === "set_counter" && x.n != null && x.n !== 0 && !x.from
    && (word === "at least" ? x.n >= n : word === "exactly" ? x.n === n : true));
  if (!sites.length || sites.length > 3) return null;
  const blocks = [];
  for (const site of sites) {
    const { d, bullets } = siteBullets(c, site, depth);
    if (bullets.length) blocks.push({ when: whenOf(d), bullets });
  }
  if (!blocks.length) return null;
  return blocks.map((b) => `checked ${b.when}, all of these hold:\n\n${b.bullets.map((x) => `- ${x}`).join("\n")}`).join("\n\n");
}
function eventPhrase(d) {
  switch (d.event) {
    case "NewTurnStart": return "At the start of each turn";
    case "FactionTurnStart": return `At the start of ${d.who || "a faction"}'s turn`;
    case "FactionTurnEnd": return `At the end of ${d.who || "a faction"}'s turn`;
    case "PostBattle": return `After a battle fought by ${d.who || "a faction"}`;
    case "SettlementTurnEnd": return `At the end of the turn, for each settlement${d.quals.length ? ` that ${joinAnd(d.quals.map((q) => (renderClause(q.text, { locals: new Map() }) || q.text).replace(/^it /, "")))}` : ""}`;
    case "GeneralCaptureSettlement": return `When ${d.who || "a faction"} captures a settlement`;
    default: return `On \`${d.event}\``;
  }
}

// ── build every reform ──────────────────────────────────────────────────────
fs.mkdirSync(path.join(OUT, "reforms"), { recursive: true });

// Units each reform opens and closes, from the recruit lines.
const OPENS = new Map(), CLOSES = new Map();
for (const r of RECRUIT) {
  for (const m of r.expr.matchAll(/(\bnot\s+)?major_event\s+"([A-Za-z0-9_]+)"/g)) {
    const ev = m[2];
    if (!REFORM_BY_NAME[ev]) continue;
    const map = m[1] ? CLOSES : OPENS;
    if (!map.has(ev)) map.set(ev, new Map());
    const u = map.get(ev);
    if (!u.has(r.unit)) u.set(r.unit, { factions: new Set(), player: false, ai: false });
    const e = u.get(r.unit);
    const f = /factions\s*\{([^}]*)\}/.exec(r.expr);
    if (f) for (const x of f[1].split(",").map((s) => s.trim()).filter(Boolean)) e.factions.add(x);
    if (/\bnot\s+is_player\b/.test(r.expr)) e.ai = true; else if (/\bis_player\b/.test(r.expr)) e.player = true; else { e.ai = true; e.player = true; }
  }
}

// Which reforms each trigger script waits on, so pages can show the chain both ways.
const NEEDS = new Map(), LEADS = new Map();
const TREES = new Map();
for (const r of REFORMS) {
  const whole = r.trigger ? rd(...r.trigger.split("/")) : null;
  // A trigger file is one script. Sparta's holds two, back to back; the first is what is
  // translated, and the second is reported as unresolved rather than merged in.
  let file = whole, extra = null;
  if (whole) {
    const m = /^([\s\S]*?\bend_script\b)([\s\S]*\bscript\b[\s\S]*)$/i.exec(whole);
    if (m && /^\s*script\s*$/im.test(m[2])) { file = m[1]; extra = m[2]; }
  }
  const tree = file != null ? parseScript(file) : null;
  TREES.set(r.name, { file, tree, extra });
  const txt = file || "";
  const counters = [...txt.matchAll(/I_CompareCounter\s+(\S+)/g)].map((m) => m[1]);
  const direct = [...txt.matchAll(/MajorEventActive\s+"?([A-Za-z0-9_]+)"?/g)].map((m) => m[1]);
  // A counter the campaign script only sets once another reform has happened (Gracchi -> Polybian).
  // Two levels: Late Republican waits on italic_cw1_gate, which only rises once
  // italic_revolt_done is set, which needs the Gracchan Reforms.
  const seen = new Set();
  const scan = (c, depth) => {
    if (seen.has(c) || depth > 2) return;
    seen.add(c);
    for (const s of COUNTER_SITES.get(c) || []) {
      const text = [...(s.monitor ? s.monitor.cond : []), ...s.ifs.flat()].join(" ");
      for (const m of text.matchAll(/MajorEventActive\s+"?([A-Za-z0-9_]+)"?/g)) direct.push(m[1]);
      for (const m of text.matchAll(/I_CompareCounter\s+(\S+)/g)) scan(m[1], depth + 1);
    }
  };
  for (const c of counters) scan(c, 1);
  const deps = [...new Set(direct)].filter((d) => d !== r.name && REFORM_BY_NAME[d]);
  NEEDS.set(r.name, deps);
  for (const d of deps) { if (!LEADS.has(d)) LEADS.set(d, []); LEADS.get(d).push(r.name); }
}

const INDEX = { reforms: {}, units: {} };
const OFF = new Set();   // reforms that can never fire as the mod ships (Marian)
const addUnitRef = (type, reform, kind) => {
  const s = unitSlug(type);
  if (!INDEX.units[s]) INDEX.units[s] = [];
  if (!INDEX.units[s].some((x) => x.reform === reform && x.kind === kind)) INDEX.units[s].push({ reform, title: titleOf(REFORM_BY_NAME[reform]), kind, ...(OFF.has(reform) ? { off: true } : {}) });
};

const stats = { pages: 0, routes: 0, noRoute: [], never: [], complex: 0 };
const cleanBody = (s) => String(s || "").replace(/\\n/g, "\n").replace(/\u0013/g, "").replace(/Make sure to check the recruitment scroll[^\n]*/gi, "").trim();

function unitTable(map, reformName, kind) {
  const rows = [];
  const bySlug = new Map();
  for (const [type, e] of map) {
    addUnitRef(type, reformName, kind);
    const s = unitSlug(type);
    if (!bySlug.has(s)) bySlug.set(s, { type, factions: new Set(), player: false, ai: false });
    const b = bySlug.get(s);
    for (const f of e.factions) b.factions.add(f);
    b.player = b.player || e.player; b.ai = b.ai || e.ai;
  }
  for (const b of [...bySlug.values()].sort((a, c) => unitName(a.type).localeCompare(unitName(c.type)))) {
    const f = [...b.factions];
    const who = f.includes("all") ? "any faction in its recruitment area" : [...new Set(f.map((x) => factionLink(x)))].join(", ");
    rows.push(`| ${unitLink(b.type)} | ${who || "—"} |${b.player && !b.ai ? " player only" : !b.player && b.ai ? " AI only" : ""} |`);
  }
  return `| Unit | Who can raise it | |\n|---|---|---|\n${rows.join("\n")}`;
}

for (const r of REFORMS) {
  const { file, tree, extra } = TREES.get(r.name);
  const title = titleOf(r);
  const body = cleanBody(textOf(r.body));
  const affects = r.affects.includes("all") ? "every faction" : joinAnd(r.affects.map((f) => factionLink(f)));

  // Requirements
  let req = [];
  if (file == null) req.push("_The trigger script this reform names is not in the mod folder, so what fires it is **not determined**._");
  else {
    const complexCounters = new Map();
    // Every script in the trigger file counts (Sparta's file holds two; the mod team confirms
    // the second is the one that fires). A route that can never be met - an old placeholder
    // testing a resource nothing places - is left off, unless no route can ever be met.
    const main = renderRoutes(tree, r, complexCounters);
    const more = extra ? renderRoutes(parseScript(extra), r, complexCounters) : { routes: [], texts: [] };
    const allRoutes = [...main.routes, ...more.routes], allTexts = [...main.texts, ...more.texts];
    const dead = allTexts.map((t) => /can never happen/.test(t));
    const never = allRoutes.length > 0 && dead.every(Boolean);
    const keep = allRoutes.map((_, i) => never || !dead[i]);
    const routes = allRoutes.filter((_, i) => keep[i]);
    const texts = allTexts.filter((_, i) => keep[i]);
    stats.routes += routes.length;
    if (dead.some(Boolean) && !never) stats.deadRoutes = (stats.deadRoutes || 0) + dead.filter(Boolean).length;
    const complexNotes = [...complexCounters.entries()].map(([c, v]) => { stats.complex++; return { c, ...v, lines: complexCounterText(c) }; });
    if (!routes.length) { stats.noRoute.push(r.name); req.push("_Nothing in its trigger script ever returns true, so this reform never fires on its own._"); }
    else {
      if (never) stats.never.push(r.name);
      for (let i = 0; i < texts.length; i++) texts[i] = texts[i].replace(/the conditions below are met(?:(?:,| and) the conditions below are met)+/g, "the conditions below are met");
      const pastEnd = never && texts.every((t) => /after the campaign ends/.test(t));
      if (pastEnd) {
        // The mod keeps the event declared but parks its trigger past the end of the campaign
        // (Marian: turn 4,002) - that is how a reform is switched off.
        OFF.add(r.name);
        const m = /turn ([\d,]+) has been reached — which is after the campaign ends in ([^,]+),/.exec(texts[0]);
        req.push(`**Switched off in this version of the mod.** Its trigger waits for ${m ? `turn ${m[1]}, long after the campaign ends in ${m[2]}` : "a turn after the campaign ends"}, so it never fires.`);
      } else {
        req.push(...playerAiSections(routes, texts));
        if (never) { OFF.add(r.name); req.push("**In practice this reform cannot happen in a campaign as the mod ships it.**"); }
      }
    }
    for (const cn of complexNotes) {
      const gloss = COUNTER_NOTES[cn.c] ? ` (“${COUNTER_NOTES[cn.c]}”)` : "";
      const g = glossFor(cn.c);
      const summary = g ? g.how.replace(/^./, (x) => x.toLowerCase()).replace(/\.$/, "") : summarizeCounter(cn.c, cn.word, cn.n);
      if (summary) req.push(summary.charAt(0).toUpperCase() + summary.slice(1) + (/\n- /.test(summary) ? "" : "."));
      const detail = `**\`${cn.c}\`**${gloss} is kept by the campaign script${summary ? "" : ` and must be ${cn.word} ${num(cn.n)}`}. It changes:\n\n${cn.lines.map((l) => `- ${l}`).join("\n") || "- _where it is set is **not determined**_"}`;
      req.push(summary ? `<details>\n<summary>The script, step by step</summary>\n\n${detail}\n\n</details>` : detail);
    }
    if (!OFF.has(r.name)) req.push("The game checks this at the end of every round.");
  }

  const needs = NEEDS.get(r.name) || [];
  const leads = LEADS.get(r.name) || [];
  const opens = OPENS.get(r.name) || new Map();
  const closes = CLOSES.get(r.name) || new Map();

  const lines = [];
  lines.push(`# ${title}`, "");
  const pic = reformImage(r);
  // A banner, not the floated lede picture: at 732px wide a float squeezes the text into a column.
  if (pic) lines.push('<div class="reform-banner">', "", `![${cell(title)}](${pic})`, "", "</div>", "");
  lines.push(`**Who gets it:** ${affects}${r.global ? " — once it fires it applies to all of them at once" : ""}`, "");
  if (body) lines.push(body.split("\n").map((l) => `> ${l}`).join("\n"), "");
  lines.push("## How to get it", "", ...req.map((x) => x + "\n"));
  if (needs.length) lines.push(`Comes after: ${needs.map((n) => reformLink(n)).join(", ")}.`, "");
  if (leads.length) lines.push(`Opens the way to: ${leads.map((n) => reformLink(n)).join(", ")}.`, "");
  lines.push("## What it unlocks", "");
  if (!opens.size && !closes.size && !r.switches.length) {
    lines.push("**Message only.** It unlocks, retires and converts no units.", "");
    if (leads.length) lines.push(`Its only effect is that ${joinAnd(leads.map((n) => reformLink(n)))} ${leads.length === 1 ? "waits" : "wait"} for it.`, "");
  }
  if (opens.size) lines.push(`**${plural(opens.size, "unit")} can be recruited once it fires:**`, "", unitTable(opens, r.name, "unlocks"), "");
  if (r.switches.length) {
    for (const [from, to] of r.switches) { addUnitRef(to, r.name, "upgrades"); addUnitRef(from, r.name, "upgraded"); }
    lines.push("**Units already in your armies are converted:**", "", "| Before | After |", "|---|---|", ...r.switches.map(([a, b]) => `| ${unitTypeLink(a)} | ${unitTypeLink(b)} |`), "");
  }
  if (closes.size) lines.push(`**${plural(closes.size, "unit")} can no longer be recruited:**`, "", unitTable(closes, r.name, "retires"), "");
  fs.writeFileSync(path.join(OUT, "reforms", `${r.name}.md`), lines.join("\n").replace(/\n{3,}/g, "\n\n"), "utf8");
  stats.pages++;
  INDEX.reforms[r.name] = { page: `${r.name}.md`, title, factions: r.affects, ...(OFF.has(r.name) ? { off: true } : {}) };
}

// ── index page ──────────────────────────────────────────────────────────────
{
  const byFaction = new Map();
  for (const r of REFORMS) {
    const key = r.affects.includes("all") ? "all" : r.affects[0];
    if (!byFaction.has(key)) byFaction.set(key, []);
    byFaction.get(key).push(r);
  }
  const groups = [...byFaction.entries()].sort((a, b) => (a[0] === "all" ? -1 : b[0] === "all" ? 1 : factionName(a[0]).localeCompare(factionName(b[0]))));
  const rows = [];
  for (const [k, list] of groups) {
    for (const r of list) {
      const o = (OPENS.get(r.name) || new Map()).size, c = (CLOSES.get(r.name) || new Map()).size;
      const who = r.affects.includes("all") ? "Every faction" : r.affects.map((f) => factionLink(f, "")).join(", ");
      rows.push(`| [${cell(titleOf(r))}](reforms/${r.name}.md)${OFF.has(r.name) ? " _(switched off)_" : ""} | ${who} | ${o || "—"} | ${c || "—"} | ${r.switches.length || "—"} |`);
    }
  }
  const md = `# Reforms

Reforms are one-off changes to a faction's army. Each fires once, when its requirements are met, and from then on
new units can be recruited, older ones are retired and some units already in the field are converted.

**${REFORMS.length}** reforms. Open one to see what it takes and what it unlocks; every unit page links back to the
reforms that open or close it.

| Reform | Who gets it | Units unlocked | Units retired | Units converted |
|---|---|---:|---:|---:|
${rows.join("\n")}
`;
  fs.writeFileSync(path.join(OUT, "reforms.md"), md, "utf8");
}
fs.writeFileSync(path.join(OUT, "reforms", "index.json"), JSON.stringify(INDEX, null, 1), "utf8");

// ── report ──────────────────────────────────────────────────────────────────
say(`reforms: ${REFORMS.length} of ${EVENTS.length} major events (left out: ${EVENTS.filter((e) => !REFORM_BY_NAME[e.name]).map((e) => e.name).join(", ")})`);
say(`  pages ${stats.pages} · requirement routes ${stats.routes} · counters spelled out from the campaign script ${stats.complex}`);
say(`  units referenced ${Object.keys(INDEX.units).length} · reforms that open units ${OPENS.size} · close units ${CLOSES.size}`);
if (stats.never.length) say(`  CANNOT FIRE before the campaign ends: ${stats.never.join(", ")}`);
say(`  pictures: ${IMAGE_STATS.written} reforms illustrated · ${IMAGE_STATS.stock} of them with a stock picture${IMAGE_STATS.missing.length ? ` · NO FILE IN THE MOD (stock picture shown): ${IMAGE_STATS.missing.join(", ")}` : ""}`);
for (const g of GLOSS_STALE) say(`  COUNTER GLOSS STALE for ${g.c}: its monitors changed (fingerprint now ${g.now}) - re-check the wording in COUNTER_GLOSS, then update sig`);
if (stats.deadRoutes) say(`  routes left off because they can never be met: ${stats.deadRoutes} (placeholder conditions)`);
if (NO_SUCH_FACTION.size) say(`  scripts loop over factions that do not exist: ${[...NO_SUCH_FACTION].join(", ")}`);
if (NEVER_RESOURCES.size) say(`  tested resources that no region carries and no script places: ${[...NEVER_RESOURCES].join(", ")}`);
if (stats.noRoute.length) say(`  NO ROUTE returns true: ${stats.noRoute.join(", ")}`);
const missingUnits = Object.keys(INDEX.units).filter((s) => !fs.existsSync(path.join(OUT, "units", `${s}.md`)));
if (missingUnits.length) say(`  unit pages not (yet) written: ${missingUnits.length} — ${missingUnits.slice(0, 8).join(", ")}`);
if (UNTRANSLATED.size) {
  say(`  UNTRANSLATED constructs (printed as written): ${UNTRANSLATED.size}`);
  for (const [k, n] of [...UNTRANSLATED.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) say(`    ${n}x ${k}`);
} else say("  every construct translated");
say("next: gen-ris-unit-pages.js (reads reforms/index.json)");
