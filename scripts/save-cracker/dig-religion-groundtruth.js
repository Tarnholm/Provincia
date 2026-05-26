// dig-religion-groundtruth.js
// Build the ground-truth tables we need to crack per-settlement religion:
//   1. The ordered belief/religion list from descr_beliefs.txt (declaration order)
//   2. region -> settlement display name (descr_regions.txt)
//   3. settlement -> dominant/official religion (descr_strat.txt "religion" lines, if any)
//
// Pure read/report. No save touched here.

const fs = require("fs");

const RIS = "C:\\RIS\\RIS\\data";
const BELIEFS = RIS + "\\descr_beliefs.txt";
const REGIONS = RIS + "\\world\\maps\\base\\descr_regions.txt";
const STRAT = RIS + "\\world\\maps\\campaign\\imperial_campaign\\descr_strat.txt";

// ── 1. belief order ──
function parseBeliefs(p) {
  const txt = fs.readFileSync(p, "latin1");
  // each religion is `\t"name":` followed shortly by `"trait": "BeingXxx"`.
  // Use the trait line order (most reliable, one per religion).
  const order = [];
  const re = /"trait":\s*"Being([A-Za-z_]+)"/g;
  // But trait name != key name. We want the KEY name (lowercase token).
  // Match the key declaration: a line that is exactly  "<token>": followed by {
  const lines = txt.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*"([a-z][a-z_0-9]*)":\s*$/);
    if (!m) continue;
    // confirm next non-blank line opens a brace
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === "") j++;
    if (lines[j] && lines[j].trim().startsWith("{")) {
      order.push(m[1]);
    }
  }
  return order;
}

// ── 2. region -> settlement (and region internal name) ──
// descr_regions.txt format (RR): each region block:
//   Region_Internal_Name
//   	Settlement_Internal_Name
//   	faction_owner
//   	rebel_type
//   	{ hidden_resources }
//   	triumph_value
//   	color r g b
//   ... (the settlement internal name is line 2; display name comes from string table)
function parseRegions(p) {
  const txt = fs.readFileSync(p, "latin1");
  const lines = txt.split(/\r?\n/).map((l) => l.replace(/;.*$/, ""));
  const regions = [];
  let i = 0;
  // skip leading comments/blank
  while (i < lines.length) {
    const line = lines[i];
    // A region block begins with a non-indented non-empty token
    if (line && !/^\s/.test(line) && line.trim().length > 0) {
      const regionName = line.trim();
      // next indented line = settlement name
      const settlement = (lines[i + 1] || "").trim();
      const owner = (lines[i + 2] || "").trim();
      if (settlement && /^[a-z]/i.test(settlement) && !regionName.includes("{")) {
        regions.push({ regionName, settlement, owner });
      }
    }
    i++;
  }
  return regions;
}

// ── 3. descr_strat: per-settlement religion / culture if present ──
// In RR descr_strat the settlement block looks like:
//   settlement
//   {
//     level <x>
//     region <Region_Name>
//     ...
//     religion <name>      <-- official religion of the settlement (if defined)
//   }
function parseStratReligions(p) {
  const txt = fs.readFileSync(p, "latin1");
  const lines = txt.split(/\r?\n/).map((l) => l.replace(/;.*$/, ""));
  const out = [];
  let curRegion = null;
  let pendingReligion = null;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const rm = t.match(/^region\s+(\S+)/i);
    if (rm) { curRegion = rm[1]; }
    const relm = t.match(/^religion\s+(\S+)/i);
    if (relm) { pendingReligion = relm[1]; }
    // when we hit the close of a settlement, flush
    if (t === "}" && curRegion) {
      if (pendingReligion) out.push({ region: curRegion, religion: pendingReligion });
      curRegion = null; pendingReligion = null;
    }
  }
  return out;
}

const beliefs = parseBeliefs(BELIEFS);
console.log("=== BELIEF/RELIGION DECLARATION ORDER (" + beliefs.length + ") ===");
beliefs.forEach((b, i) => console.log(String(i).padStart(2) + "  " + b));

const regions = parseRegions(REGIONS);
console.log("\n=== REGIONS (" + regions.length + ") first 20 ===");
regions.slice(0, 20).forEach((r, i) => console.log(i + "  region=" + r.regionName + "  settlement=" + r.settlement + "  owner=" + r.owner));

const stratRel = parseStratReligions(STRAT);
console.log("\n=== descr_strat religion lines found: " + stratRel.length + " ===");
stratRel.slice(0, 30).forEach((r) => console.log("  region=" + r.region + " religion=" + r.religion));

// Also: does descr_strat even mention "religion"? grep count.
const stratTxt = fs.readFileSync(STRAT, "latin1");
console.log("\nraw 'religion' occurrences in descr_strat:", (stratTxt.match(/religion/gi) || []).length);
console.log("raw 'belief' occurrences in descr_strat:", (stratTxt.match(/belief/gi) || []).length);
console.log("raw 'pip_religion' set list maybe in descr_strat:", (stratTxt.match(/pip_religion/gi) || []).length);

module.exports = { beliefs, regions, stratRel, parseBeliefs, parseRegions };
