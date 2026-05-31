// scripts/campaign-timeline.js — campaign ARC across a SEQUENCE of saves.
//
// Ingests several saves from ONE campaign (the consecutive autosaves / crash
// saves), cracks each with crackSave(), SORTS them by the cracked turn number
// (NOT by filename), and prints the campaign's evolution per turn for the
// player faction: treasury, gross income (Σ settlement income), territory
// (region count), military (units / soldiers), # at war / # allied, family
// size. Between consecutive turns it prints a compact "what changed" delta —
// settlements gained/lost, treasury swing, wars declared/ended, family births
// /deaths — reusing the same comparison logic shape as scripts/diff-saves.js.
//
// This is the multi-save companion to:
//   - campaign-report.js (one save, all factions)
//   - diff-saves.js      (two saves, full semantic diff)
//
// Honors the project no-fabrication rule: any metric the cracker cannot supply
// is shown as "—", never a placeholder number.
//
// Usage:
//   node scripts/campaign-timeline.js <dir>                  (auto-discover *.sav, recursive)
//   node scripts/campaign-timeline.js <a.sav> <b.sav> ...    (explicit list)
//   node scripts/campaign-timeline.js <dir> --mod <modDataDir>
//   node scripts/campaign-timeline.js <dir> --json
//   node scripts/campaign-timeline.js <dir> --faction <name> (override player faction to track)
//   node scripts/campaign-timeline.js <dir> --all-campaigns   (don't filter to the dominant campaign)
//
// --mod defaults to C:\RIS\RIS\data.

"use strict";
const fs = require("fs");
const path = require("path");
const { crackSave } = require("../src/saveCracker.js");

// ── arg parsing ────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = {
    inputs: [],
    mod: "C:\\RIS\\RIS\\data",
    json: false,
    faction: null,
    allCampaigns: false,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--mod") a.mod = argv[++i];
    else if (argv[i] === "--json") a.json = true;
    else if (argv[i] === "--faction") a.faction = argv[++i];
    else if (argv[i] === "--all-campaigns") a.allCampaigns = true;
    else a.inputs.push(argv[i]);
  }
  return a;
}

// Recursively collect *.sav files under a directory; pass-through for files.
function collectSaves(input) {
  let st;
  try { st = fs.statSync(input); } catch { return []; }
  if (st.isFile()) return input.toLowerCase().endsWith(".sav") ? [input] : [];
  const out = [];
  for (const ent of fs.readdirSync(input, { withFileTypes: true })) {
    const full = path.join(input, ent.name);
    if (ent.isDirectory()) out.push(...collectSaves(full));
    else if (ent.isFile() && ent.name.toLowerCase().endsWith(".sav")) out.push(full);
  }
  return out;
}

// ── per-save metric extraction (single source of truth for a row) ───────────
// Pulls only player-faction figures from a cracked save; everything that may be
// unavailable is left null so the formatter can render "—".
function extractRow(cracked, filePath, factionOverride) {
  const player = factionOverride || cracked.playerFaction || null;
  const pf = player ? (cracked.factions && cracked.factions[player]) : null;

  // Gross income = Σ income of settlements this faction owns (ground-truth
  // source per campaign-report.js — record +4 is NOT net income).
  let income = null;
  if (player) {
    const own = cracked.ownerByCity || {};
    const sf = cracked.settlementFields || {};
    let acc = null;
    for (const [city, fac] of Object.entries(own)) {
      if (fac !== player) continue;
      const f = sf[city];
      if (f && f.income != null) acc = (acc || 0) + f.income;
    }
    income = acc; // null if no settlement income was decoded
  }

  // Military rollup from units owned by the player faction.
  let units = null, soldiers = null;
  if (player) {
    let u = 0, s = 0, seen = false;
    for (const unit of (cracked.units || [])) {
      if (unit.faction !== player) continue;
      seen = true; u++; s += unit.soldiers || 0;
    }
    if (seen) { units = u; soldiers = s; }
  }

  // Region count: prefer the ownerByCity tally (the correct source).
  let regions = null;
  if (player) {
    let n = 0, seen = false;
    for (const fac of Object.values(cracked.ownerByCity || {})) {
      if (fac === player) { n++; seen = true; }
    }
    if (seen) regions = n;
    else if (pf && pf.regionCount != null) regions = pf.regionCount;
  }

  // Diplomacy counts from the cracked attitude matrix.
  const dip = (player && cracked.diplomacy && cracked.diplomacy[player]) || null;
  const wars = dip && Array.isArray(dip.war) ? dip.war.length : null;
  const allies = dip && Array.isArray(dip.allied) ? dip.allied.length : null;

  // Family roster size (generals + women + dead, attributed to the faction).
  let family = null;
  if (player && cracked.characters && cracked.characters.familyByFaction) {
    const fam = cracked.characters.familyByFaction[player];
    if (Array.isArray(fam)) family = fam.length;
  }

  return {
    file: path.basename(filePath),
    path: filePath,
    player,
    turn: cracked.turn != null ? cracked.turn : null,
    year: cracked.currentYear != null ? cracked.currentYear : null,
    seasonIndex: cracked.seasonIndex != null ? cracked.seasonIndex : null,
    treasury: pf && pf.treasury != null ? pf.treasury : null,
    income,
    regions,
    units,
    soldiers,
    wars,
    allies,
    family,
    // retained for delta computation (not printed directly):
    _ownerByCity: cracked.ownerByCity || {},
    _diplomacy: (player && cracked.diplomacy && cracked.diplomacy[player]) || null,
    // Scope the family roster to the TRACKED faction (familyByFaction) so the
    // birth/death delta reflects this dynasty — not the whole world's ~1580
    // characters (which crackSave().characters.family contains).
    _family: (player && cracked.characters && cracked.characters.familyByFaction
      && cracked.characters.familyByFaction[player]) || [],
  };
}

// ── delta between two consecutive player-faction rows ───────────────────────
// Mirrors the comparison shape of diff-saves.js but scoped to the tracked
// faction and the metrics the timeline cares about.
function computeDelta(prev, cur) {
  const d = { settlementsGained: [], settlementsLost: [], treasurySwing: null, newWar: [], endWar: [], newAlly: [], endAlly: [], births: 0, deaths: 0 };

  // Settlements gained/lost by the tracked faction (ownerByCity).
  const player = cur.player;
  const ownA = prev._ownerByCity, ownB = cur._ownerByCity;
  const allCities = new Set([...Object.keys(ownA), ...Object.keys(ownB)]);
  for (const c of allCities) {
    const a = ownA[c], b = ownB[c];
    if (b === player && a !== player) d.settlementsGained.push({ city: c, from: a || "?" });
    else if (a === player && b !== player) d.settlementsLost.push({ city: c, to: b || "?" });
  }

  // Treasury swing.
  if (prev.treasury != null && cur.treasury != null) d.treasurySwing = cur.treasury - prev.treasury;

  // Diplomacy: wars/alliances declared or ended (from the tracked faction's row).
  const da = prev._diplomacy, db = cur._diplomacy;
  if (da && db) {
    const sub = (x, y) => (x || []).filter((v) => !(y || []).includes(v));
    d.newWar = sub(db.war, da.war);
    d.endWar = sub(da.war, db.war);
    d.newAlly = sub(db.allied, da.allied);
    d.endAlly = sub(da.allied, db.allied);
  }

  // Family births / deaths by uuid (same approach as diff-saves.js, scoped to
  // the tracked faction's roster). Character uuids are only stable WITHIN one
  // continuous save chain; saves from different playthroughs at the same turn
  // share no uuids. If the two rosters have zero overlap we treat the family
  // delta as undefined (chain break) rather than reporting the whole roster as
  // "born" — honoring the no-fabrication rule.
  const famA = new Map((prev._family || []).map((m) => [m.uuid >>> 0, m]));
  const famB = new Map((cur._family || []).map((m) => [m.uuid >>> 0, m]));
  let overlap = 0;
  for (const uuid of famB.keys()) if (famA.has(uuid)) overlap++;
  d.familyChainBroken = famA.size > 0 && famB.size > 0 && overlap === 0;
  if (!d.familyChainBroken) {
    for (const [uuid, mb] of famB) {
      const ma = famA.get(uuid);
      if (!ma) { d.births++; continue; }
      if (ma.alive && !mb.alive) d.deaths++;
    }
  }

  return d;
}

// ── campaign grouping + sort ────────────────────────────────────────────────
// Group rows by detected campaign (player faction). Pick the dominant group
// (most saves) unless --all-campaigns. Within a group, sort by cracked turn
// number ascending; ties broken by Start-before-End hint then filename.
function phaseRank(file) {
  // End-of-turn snapshots reflect the state AFTER the turn; order Start < (bare) < End.
  if (/\bStart\b/i.test(file)) return 0;
  if (/\bEnd\b/i.test(file)) return 2;
  return 1;
}

function sortByTurn(rows) {
  return rows.slice().sort((a, b) => {
    const ta = a.turn == null ? Infinity : a.turn;
    const tb = b.turn == null ? Infinity : b.turn;
    if (ta !== tb) return ta - tb;
    const pa = phaseRank(a.file), pb = phaseRank(b.file);
    if (pa !== pb) return pa - pb;
    return a.file.localeCompare(b.file);
  });
}

function groupByCampaign(rows) {
  const groups = {};
  for (const r of rows) {
    const key = r.player || "(unknown)";
    (groups[key] ||= []).push(r);
  }
  return groups;
}

// ── formatting ──────────────────────────────────────────────────────────────
function pad(s, n) { s = String(s); return s.length >= n ? s : s + " ".repeat(n - s.length); }
function padl(s, n) { s = String(s); return s.length >= n ? s : " ".repeat(n - s.length) + s; }
function num(v) { return v == null ? "—" : String(v); }
function signed(v) { return v == null ? "—" : (v >= 0 ? "+" + v : String(v)); }
function dateLabel(r) {
  if (r.year == null) return "—";
  const yr = `${Math.abs(r.year)} ${r.year < 0 ? "BC" : "AD"}`;
  return r.seasonIndex == null ? yr : `${yr} s${r.seasonIndex}`;
}

function reportCampaign(player, rows, args) {
  console.log(`\n=== Campaign timeline: ${player} (${rows.length} saves) ===`);
  console.log(`mod ${args.mod}`);

  const H = `  ${pad("turn", 5)} ${pad("date", 12)} ${padl("treasury", 9)} ${padl("income", 8)} ${padl("rgn", 4)} ${padl("units", 5)} ${padl("soldiers", 8)} ${padl("war", 4)} ${padl("ally", 4)} ${padl("fam", 4)}  save`;
  console.log("\n" + H);
  console.log("  " + "-".repeat(H.length - 2));

  let prev = null;
  for (const r of rows) {
    console.log(
      `  ${pad(num(r.turn), 5)} ${pad(dateLabel(r), 12)} ${padl(num(r.treasury), 9)} ${padl(num(r.income), 8)} ` +
      `${padl(num(r.regions), 4)} ${padl(num(r.units), 5)} ${padl(num(r.soldiers), 8)} ${padl(num(r.wars), 4)} ${padl(num(r.allies), 4)} ${padl(num(r.family), 4)}  ${r.file}`
    );
    if (prev) {
      const d = computeDelta(prev, r);
      const parts = [];
      if (d.settlementsGained.length) parts.push(`+${d.settlementsGained.length} settlement(s): ${d.settlementsGained.map((s) => s.city).join(",")}`);
      if (d.settlementsLost.length) parts.push(`-${d.settlementsLost.length} settlement(s): ${d.settlementsLost.map((s) => s.city).join(",")}`);
      if (d.treasurySwing != null && d.treasurySwing !== 0) parts.push(`treasury ${signed(d.treasurySwing)}`);
      if (d.newWar.length) parts.push(`+war ${d.newWar.join("/")}`);
      if (d.endWar.length) parts.push(`-war ${d.endWar.join("/")}`);
      if (d.newAlly.length) parts.push(`+ally ${d.newAlly.join("/")}`);
      if (d.endAlly.length) parts.push(`-ally ${d.endAlly.join("/")}`);
      if (d.familyChainBroken) parts.push("family Δ — (different save chain; uuids don't align)");
      else {
        if (d.births) parts.push(`${d.births} born/come-of-age`);
        if (d.deaths) parts.push(`${d.deaths} died`);
      }
      if (parts.length) console.log(`        Δ ${parts.join("  ·  ")}`);
    }
    prev = r;
  }
  console.log("\n  legend: income = Σ owned-settlement income (gross); rgn = region count;");
  console.log("          war/ally = diplomacy counts; fam = family roster size; Δ = change vs previous turn;");
  console.log("          \"—\" = metric unavailable in that save (never a placeholder).\n");
}

// ── main ─────────────────────────────────────────────────────────────────────
function buildTimeline(inputs, mod, factionOverride, allCampaigns) {
  // Discover + crack.
  const files = [];
  for (const inp of inputs) files.push(...collectSaves(inp));
  // de-dup
  const seen = new Set();
  const uniqFiles = files.filter((f) => { const k = path.resolve(f); if (seen.has(k)) return false; seen.add(k); return true; });

  const rows = [];
  const errors = [];
  for (const f of uniqFiles) {
    try {
      const cracked = crackSave(fs.readFileSync(f), mod);
      rows.push(extractRow(cracked, f, factionOverride));
    } catch (e) {
      errors.push({ file: path.basename(f), error: e.message });
    }
  }

  const groups = groupByCampaign(rows);
  let campaigns;
  if (allCampaigns || factionOverride) {
    campaigns = Object.entries(groups).map(([player, rs]) => ({ player, rows: sortByTurn(rs) }));
    campaigns.sort((a, b) => b.rows.length - a.rows.length);
  } else {
    // Dominant campaign = the player faction with the most saves.
    const entries = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
    const [player, rs] = entries[0];
    campaigns = [{ player, rows: sortByTurn(rs) }];
  }
  return { campaigns, errors, scanned: uniqFiles.length };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.inputs.length) {
    console.error("usage: node scripts/campaign-timeline.js <dir|save...> [--mod <dir>] [--json] [--faction <name>] [--all-campaigns]");
    process.exit(1);
  }

  const { campaigns, errors, scanned } = buildTimeline(args.inputs, args.mod, args.faction, args.allCampaigns);

  if (args.json) {
    const strip = (r) => { const { _ownerByCity, _diplomacy, _family, path: p, ...keep } = r; return { ...keep, path: p }; };
    console.log(JSON.stringify({
      scanned, errors,
      campaigns: campaigns.map((c) => ({
        player: c.player,
        saves: c.rows.length,
        turns: c.rows.map(strip),
        deltas: c.rows.slice(1).map((r, i) => ({ fromTurn: c.rows[i].turn, toTurn: r.turn, ...computeDelta(c.rows[i], r) })),
      })),
    }, null, 2));
    return;
  }

  console.log(`scanned ${scanned} save file(s); ${campaigns.length} campaign(s) tracked` + (errors.length ? `; ${errors.length} crack error(s)` : ""));
  for (const e of errors) console.log(`  ! ${e.file}: ${e.error}`);
  for (const c of campaigns) reportCampaign(c.player, c.rows, args);
}

module.exports = { sortByTurn, computeDelta, extractRow, phaseRank, groupByCampaign, buildTimeline };

// Run only as a CLI, not when required by tests.
if (require.main === module) main();
