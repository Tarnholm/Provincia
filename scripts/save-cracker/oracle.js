// Build the known-token index from descr_strat.txt + descr_regions.txt + descr_sm_factions.txt.
// Then scan the .sav for every occurrence of every token in every plausible encoding.
//
// Output shape: {
//   tokens: { [token]: { kind, hits: [{offset, encoding}] } },
//   ints:   [{value, source, hitsU32: [offset...], hitsU16: [offset...]}],
//   summary: {...counts...}
// }
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(new URL(".", import.meta.url).pathname, "../..");

function readMaybe(p) {
  try { return fs.readFileSync(p, "utf-8"); } catch { return null; }
}

// Parse descr_regions.txt — rebel-default field-3 + region/city names + tag tokens
function parseDescrRegions(text) {
  if (!text) return { regions: [], cities: [], factions: new Set(), cultures: new Set(), tags: new Set() };
  const lines = text.split(/\r?\n/);
  const out = { regions: [], cities: [], factions: new Set(), cultures: new Set(), tags: new Set() };
  let i = 0;
  while (i < lines.length) {
    // skip blank/comment lines
    while (i < lines.length && (!lines[i].trim() || lines[i].trim().startsWith(";"))) i++;
    if (i + 4 >= lines.length) break;
    const region = lines[i++].trim();
    const city = lines[i++].trim();
    const fac = lines[i++].trim();
    const cul = lines[i++].trim();
    const _rgb = lines[i++].trim();
    const tags = (lines[i++] || "").trim();
    // skip remaining region fields (farm, pop, ethnicities, etc.)
    while (i < lines.length && lines[i].trim() && !/^[A-Z]/.test(lines[i])) i++;
    if (region) out.regions.push(region);
    if (city) out.cities.push(city);
    if (fac) out.factions.add(fac);
    if (cul) out.cultures.add(cul);
    for (const t of tags.split(/,\s*/)) if (t.trim()) out.tags.add(t.trim());
  }
  return out;
}

// Pull strings + a few key integers out of descr_strat.txt
export function parseDescrStrat(text) {
  if (!text) return { factions: [], settlements: [], characters: [], traits: new Set(), ancillaries: new Set(), units: new Set(), buildings: new Set(), denarii: [], armyXY: [] };
  const out = { factions: [], settlements: [], characters: [], traits: new Set(), ancillaries: new Set(), units: new Set(), buildings: new Set(), denarii: [], armyXY: [] };
  const lines = text.split(/\r?\n/);
  let currentFaction = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith(";")) continue;
    const fm = line.match(/^faction\s+(\w+)/);
    if (fm) { currentFaction = fm[1]; out.factions.push(currentFaction); continue; }
    const dm = line.match(/^denari\s+(\d+)/);
    if (dm) { out.denarii.push({ faction: currentFaction, value: parseInt(dm[1], 10) }); continue; }
    const rm = line.match(/^region\s+(\S+)/);
    if (rm) { out.settlements.push(rm[1]); continue; }
    const cm = line.match(/^character[,\s]\s*([^,]+),/);
    if (cm) {
      const name = cm[1].trim();
      out.characters.push(name);
      // also try splitting underscore in surnames
      if (name.includes("_")) out.characters.push(name.replace(/_/g, " "));
      continue;
    }
    if (/^traits\s+/.test(line)) {
      for (const t of line.replace(/^traits\s+/, "").split(/,\s*/)) {
        const tm = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+\d+/);
        if (tm) out.traits.add(tm[1]);
      }
      continue;
    }
    if (/^ancillaries\s+/.test(line)) {
      for (const a of line.replace(/^ancillaries\s+/, "").split(/,\s*/)) {
        if (a.trim() && /^[a-z_][a-z0-9_]*$/i.test(a.trim())) out.ancillaries.add(a.trim());
      }
      continue;
    }
    const um = line.match(/^unit\s+([\w\s]+?)\s+exp\s+/);
    if (um) { out.units.add(um[1].trim()); continue; }
    const bm = line.match(/^type\s+(\S+)\s+(\S+)/);
    if (bm) { out.buildings.add(bm[1]); out.buildings.add(bm[2]); continue; }
    // capture x/y from character lines
    const xy = line.match(/x\s+(-?\d+)\s*,\s*y\s+(-?\d+)/);
    if (xy) out.armyXY.push({ x: parseInt(xy[1], 10), y: parseInt(xy[2], 10) });
  }
  return out;
}

// Parse descr_sm_factions.txt — faction RGB / culture / homelands hints
function parseSmFactions(text) {
  if (!text) return { ids: new Set(), cultures: new Set() };
  const out = { ids: new Set(), cultures: new Set() };
  for (const raw of text.split(/\r?\n/)) {
    const m1 = raw.match(/^\s*faction\s+(\w+)/);
    if (m1) out.ids.add(m1[1]);
    const m2 = raw.match(/^\s*culture\s+(\w+)/);
    if (m2) out.cultures.add(m2[1]);
  }
  return out;
}

// Encode a string in every plausible save encoding so we can search the buffer
function encodingsFor(token) {
  const out = [];
  // utf-8 cstring (null-terminated)
  out.push({ encoding: "cstring",   bytes: Buffer.concat([Buffer.from(token, "utf-8"), Buffer.from([0])]) });
  // utf-8 raw
  out.push({ encoding: "utf8raw",   bytes: Buffer.from(token, "utf-8") });
  // utf-16le raw
  const u16 = Buffer.alloc(token.length * 2);
  for (let i = 0; i < token.length; i++) u16.writeUInt16LE(token.charCodeAt(i), i * 2);
  out.push({ encoding: "utf16le",   bytes: u16 });
  // length-prefixed utf-8 (u16le len)
  const lp8 = Buffer.alloc(2 + token.length);
  lp8.writeUInt16LE(token.length, 0);
  Buffer.from(token, "utf-8").copy(lp8, 2);
  out.push({ encoding: "pstr8",     bytes: lp8 });
  // length-prefixed utf-16le
  const lp16 = Buffer.alloc(2 + token.length * 2);
  lp16.writeUInt16LE(token.length, 0);
  u16.copy(lp16, 2);
  out.push({ encoding: "pstr16le",  bytes: lp16 });
  return out;
}

// indexOf-all of needle in haystack
function findAll(haystack, needle, max = 64) {
  const hits = [];
  let from = 0;
  while (hits.length < max) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) break;
    hits.push(i);
    from = i + 1;
  }
  return hits;
}

// Scan u32le and u16le for an integer value
function findInts(buf, value, max = 64) {
  const u32 = [];
  const u16 = [];
  if (value >= 0 && value < 2 ** 32) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(value, 0);
    let from = 0;
    while (u32.length < max) {
      const i = buf.indexOf(b, from);
      if (i < 0) break;
      u32.push(i);
      from = i + 1;
    }
  }
  if (value >= 0 && value < 2 ** 16) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(value, 0);
    let from = 0;
    while (u16.length < max) {
      const i = buf.indexOf(b, from);
      if (i < 0) break;
      u16.push(i);
      from = i + 1;
    }
  }
  return { u32, u16 };
}

// Read campaign name from the save's pstr16le at offset 0x3a — confirmed
// header field across both classic and imperial saves. Returns "imperial_campaign",
// "ris_classic", etc.
function readCampaignName(saveBuf) {
  if (!saveBuf || saveBuf.length < 0x40) return null;
  const len = saveBuf.readUInt16LE(0x3a);
  if (len < 1 || len > 64) return null;
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(saveBuf.readUInt16LE(0x3c + i * 2));
  return s;
}

export function loadModTexts(modDir, saveBuf) {
  modDir = modDir || REPO_ROOT;
  const campaign = saveBuf ? readCampaignName(saveBuf) : null;
  // Map campaign name → descr_strat directory. Falls back across known mod
  // variants so the oracle still works if the layout differs.
  const candidates = [];
  if (campaign === "imperial_campaign") {
    candidates.push("C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt");
  } else if (campaign === "ris_classic") {
    candidates.push("C:/RIS/_submods/RIS_Classic/data/world/maps/campaign/ris_classic/descr_strat.txt");
  }
  // Default fallback order: imperial first (more common), then classic submod, then bundled
  candidates.push("C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt");
  candidates.push("C:/RIS/_submods/RIS_Classic/data/world/maps/campaign/ris_classic/descr_strat.txt");
  candidates.push(path.join(modDir, "scripts/others/descr_strat.txt"));

  let stratText = null, stratPath = null;
  for (const p of candidates) {
    const t = readMaybe(p);
    if (t) { stratText = t; stratPath = p; break; }
  }

  const regionCandidates = [];
  if (campaign === "imperial_campaign") {
    regionCandidates.push("C:/RIS/RIS/data/world/maps/base/descr_regions.txt");
    regionCandidates.push("C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_regions.txt");
  } else if (campaign === "ris_classic") {
    regionCandidates.push("C:/RIS/_submods/RIS_Classic/data/world/maps/campaign/ris_classic/descr_regions.txt");
    regionCandidates.push("C:/RIS/_submods/RIS_Classic/data/world/maps/base/descr_regions.txt");
  }
  regionCandidates.push("C:/RIS/RIS/data/world/maps/base/descr_regions.txt");
  regionCandidates.push("C:/RIS/_submods/RIS_Classic/data/world/maps/campaign/ris_classic/descr_regions.txt");
  regionCandidates.push(path.join(modDir, "scripts/others/descr_regions.txt"));

  let regionsText = null;
  for (const p of regionCandidates) {
    const t = readMaybe(p);
    if (t) { regionsText = t; break; }
  }

  const smFactionsText = readMaybe(path.join(modDir, "public/descr_sm_factions.txt"))
    || readMaybe("C:/RIS/RIS/data/descr_sm_factions.txt")
    || readMaybe("C:/RIS/_submods/RIS_Classic/data/descr_sm_factions.txt");

  return { stratText, regionsText, smFactionsText, campaign, stratPath };
}

export function buildOracle({ saveBuf, modDir }) {
  const { stratText, regionsText, smFactionsText, campaign, stratPath } = loadModTexts(modDir, saveBuf);
  if (campaign) console.log(`[oracle] campaign from save header: ${campaign}`);
  if (stratPath) console.log(`[oracle] descr_strat: ${stratPath}`);

  const dr = parseDescrRegions(regionsText);
  const ds = parseDescrStrat(stratText);
  const sm = parseSmFactions(smFactionsText);

  // Collect tokens by kind
  const tokenSets = [
    { kind: "region",     values: dr.regions },
    { kind: "city",       values: dr.cities },
    { kind: "faction",    values: [...new Set([...dr.factions, ...ds.factions, ...sm.ids])] },
    { kind: "culture",    values: [...sm.cultures, ...dr.cultures] },
    { kind: "tag",        values: [...dr.tags] },
    { kind: "character",  values: ds.characters },
    { kind: "trait",      values: [...ds.traits] },
    { kind: "ancillary",  values: [...ds.ancillaries] },
    { kind: "unit",       values: [...ds.units] },
    { kind: "building",   values: [...ds.buildings] },
  ];

  const tokens = {};
  for (const { kind, values } of tokenSets) {
    for (const v of values) {
      if (!v || v.length < 3) continue; // 1-2 char tokens have too many false positives
      if (tokens[v]) { tokens[v].kinds.add(kind); continue; }
      tokens[v] = { token: v, kinds: new Set([kind]), hits: [] };
      const encs = encodingsFor(v);
      for (const { encoding, bytes } of encs) {
        const offsets = findAll(saveBuf, bytes, 64);
        for (const o of offsets) tokens[v].hits.push({ offset: o, encoding, len: bytes.length });
      }
    }
  }

  // Integer probes
  const intProbes = [
    { value: 1,    source: "turn (turn1-end means turn 1)" },
    { value: 199,  source: "region count (RIS imperial)" },
    { value: 0xa70a, source: "magic word at offset 0 (0x070a)" },
  ];
  for (const d of ds.denarii) intProbes.push({ value: d.value, source: `denari ${d.faction}` });
  for (const xy of ds.armyXY) {
    intProbes.push({ value: xy.x, source: `army x=${xy.x}` });
    intProbes.push({ value: xy.y, source: `army y=${xy.y}` });
  }

  const ints = [];
  for (const p of intProbes) {
    const { u32, u16 } = findInts(saveBuf, p.value, 64);
    ints.push({ ...p, hitsU32: u32, hitsU16: u16 });
  }

  // Materialize sets-as-arrays for JSON friendliness
  const tokensOut = {};
  for (const [k, v] of Object.entries(tokens)) {
    tokensOut[k] = { token: v.token, kinds: [...v.kinds], hits: v.hits };
  }

  return {
    tokens: tokensOut,
    ints,
    parsed: { dr, ds, sm },
    sources: {
      regions: dr.regions.length,
      cities: dr.cities.length,
      factions: [...new Set([...dr.factions, ...ds.factions, ...sm.ids])].length,
      characters: ds.characters.length,
      traits: ds.traits.size,
      ancillaries: ds.ancillaries.size,
      units: ds.units.size,
      buildings: ds.buildings.size,
      tags: dr.tags.size,
      denarii: ds.denarii.length,
    },
  };
}
