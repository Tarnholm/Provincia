// AI Movement Lab report export (2026-07-25) — turn an analysis run into files
// the RIS team can actually work from outside the app.
//
//   toMarkdown(result)  → a review document: headline numbers, the mod-file
//                         leads grouped by file (that IS the to-do list), the
//                         worst findings per problem type, faction rollup.
//   toFindingsCsv(result) → every finding, one row per line, for spreadsheets.
//   toLeadsCsv(result)    → every mod-file lead, one row per line.
//
// PURE (no fs / Electron) so it unit-tests directly and can run in a worker.
// Nothing here invents data: every column comes from the analysis result, and
// missing values are written as empty cells rather than guesses.

"use strict";

function csvCell(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvRows(header, rows) {
  return [header.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n") + "\n";
}

function toFindingsCsv(result) {
  const f = (result && result.findings) || [];
  return csvRows(
    ["kind", "name", "faction", "fromTurn", "toTurn", "turns", "severity", "region", "x", "y", "detail", "verdict", "blockedBy", "impossible", "orphaned", "micMax", "factionMenAtSave", "factionSettlements"],
    f.map((x) => [
      x.kind, x.name, x.faction, x.fromTurn, x.toTurn, x.turns, x.severity, x.region, x.x, x.y,
      x.detail, x.verdict, x.blockedBy, x.impossible ? "yes" : "", x.orphaned ? "yes" : "",
      x.micMax, x.factionMenAtSave, x.factionSettlements,
    ])
  );
}

function toLeadsCsv(result) {
  const l = (result && result.modLeads) || [];
  return csvRows(
    ["severity", "faction", "file", "key", "issue", "suggestion", "evidence"],
    l.map((x) => [x.severity, x.faction, x.file, x.key, x.issue, x.suggestion, x.evidence])
  );
}

// Faction rollup: who is actually in trouble, worst first.
function factionRollup(result) {
  const out = {};
  for (const f of (result.findings || [])) {
    const k = String(f.faction || "?").toLowerCase();
    if (k === "?") continue;
    const e = out[k] = out[k] || { faction: k, total: 0, impossible: 0, neverArrived: 0, orphaned: 0, kinds: {} };
    e.total++;
    e.kinds[f.kind] = (e.kinds[f.kind] || 0) + 1;
    if (f.impossible) e.impossible++;
    if (/NEVER arrived/.test(f.verdict || "")) e.neverArrived++;
    if (f.orphaned) e.orphaned++;
  }
  return Object.values(out).sort((a, b) => b.total - a.total);
}

function toMarkdown(result, opts = {}) {
  if (!result) return "";
  const when = opts.generatedAt || "";
  const L = [];
  const nf = (n) => (n == null ? "—" : Number(n).toLocaleString());

  L.push("# AI Movement Lab report");
  L.push("");
  if (result.logKind === "campaign_ai") {
    L.push(`**AI decision log** · ${result.totalTurns} turn blocks` +
      (result.firstYear != null ? ` (${result.firstYear} → ${result.lastYear})` : "") +
      ` · ${nf(result.lines)} lines`);
  } else if (result.logKind === "scripting") {
    // These are the engine's own errors in the mod's data files: each names a
    // file and a line, so unlike the behavioural logs there is nothing to
    // interpret and no save to cross-reference.
    L.push(`**Scripting log** · ${nf(result.lines)} lines · ${nf((result.findings || []).length)} engine error(s) in the mod's data files`);
  } else {
    L.push(`**Movement log** · ${result.totalTurns} turns · ${nf(result.moveLines)} moves · ${nf(result.armies)} armies`);
  }
  if (result.logPath) L.push(`Log: \`${result.logPath}\``);
  if (when) L.push(`Generated: ${when}`);
  L.push("");

  if (result.usable === false) {
    L.push("> **Nothing to analyse in this log.** " + (result.emptyReason || ""));
    L.push("");
    return L.join("\n");
  }

  L.push(`**${nf((result.findings || []).length)} findings** across ${Object.keys(result.findingCounts || {}).length} problem types.`);
  L.push("");
  if (result.save) {
    L.push(`Cross-referenced with a **turn ${result.save.turn}** save:`);
    L.push("");
    L.push(`- **${nf(result.save.confirmedNeverArrived)}** move orders confirmed never to have arrived`);
    L.push(`- **${nf(result.save.impossibleCampaigns)}** campaigns the faction could never have afforded`);
    L.push(`- **${nf(result.save.orphanedArmies)}** armies orphaned while still alive`);
    L.push(`- World at that turn: ${nf(result.save.navalWorld)} ships, ${nf(result.save.sieges)} sieges, ${nf(result.save.factionsWithUnits)} factions still fielding troops`);
    L.push("");
  }

  // ── problem-type table ──
  const counts = Object.entries(result.findingCounts || {}).sort((a, b) => b[1] - a[1]);
  if (counts.length) {
    L.push("## Problems by type");
    L.push("");
    L.push("| Problem | Count |");
    L.push("|---|---:|");
    for (const [k, n] of counts) L.push(`| ${k.replace(/_/g, " ")} | ${nf(n)} |`);
    L.push("");
  }

  // ── the to-do list: leads grouped by the file you'd edit ──
  const leads = result.modLeads || [];
  if (leads.length) {
    L.push("## Mod-file leads — what to change");
    L.push("");
    L.push(`${nf(leads.length)} leads. Each names the file and key to edit, with the evidence behind it.`);
    L.push("");
    const byFile = {};
    for (const l of leads) (byFile[l.file] = byFile[l.file] || []).push(l);
    for (const [file, list] of Object.entries(byFile).sort((a, b) => b[1].length - a[1].length)) {
      L.push(`### \`${file}\` — ${list.length} lead(s)`);
      L.push("");
      const show = list.slice(0, opts.leadsPerFile || 15);
      for (const l of show) {
        L.push(`- **${l.faction}** — ${l.issue}`);
        L.push(`  - key: \`${l.key}\``);
        L.push(`  - fix: ${l.suggestion}`);
        L.push(`  - evidence: ${l.evidence}`);
      }
      if (list.length > show.length) L.push(`- …and ${list.length - show.length} more (see the CSV export for the full list)`);
      L.push("");
    }
  }

  // ── faction rollup ──
  const roll = factionRollup(result);
  if (roll.length) {
    L.push("## Worst-affected factions");
    L.push("");
    L.push("| Faction | Findings | Unaffordable | Never arrived | Orphaned |");
    L.push("|---|---:|---:|---:|---:|");
    for (const r of roll.slice(0, opts.factionRows || 25)) {
      L.push(`| ${r.faction} | ${nf(r.total)} | ${nf(r.impossible)} | ${nf(r.neverArrived)} | ${nf(r.orphaned)} |`);
    }
    if (roll.length > (opts.factionRows || 25)) L.push("");
    if (roll.length > (opts.factionRows || 25)) L.push(`_…and ${roll.length - (opts.factionRows || 25)} more factions._`);
    L.push("");
  }

  // ── worst individual findings per type ──
  const byKind = {};
  for (const f of (result.findings || [])) (byKind[f.kind] = byKind[f.kind] || []).push(f);
  const kindKeys = Object.keys(byKind).sort((a, b) => byKind[b].length - byKind[a].length);
  if (kindKeys.length) {
    L.push("## Worst cases");
    L.push("");
    for (const k of kindKeys) {
      const list = byKind[k].slice().sort((a, b) => (b.severity - a.severity) || (b.turns - a.turns)).slice(0, opts.casesPerKind || 5);
      L.push(`### ${k.replace(/_/g, " ")} (${nf(byKind[k].length)})`);
      L.push("");
      for (const f of list) {
        const where = f.region ? ` — ${f.region}` : "";
        const turns = (f.fromTurn != null && f.toTurn != null) ? ` (t${f.fromTurn}–${f.toTurn})` : "";
        L.push(`- **${f.name}** [${f.faction}]${where}${turns}: ${f.detail}`);
        if (f.verdict) L.push(`  - ${f.verdict}`);
      }
      L.push("");
    }
  }

  return L.join("\n");
}

module.exports = { toMarkdown, toFindingsCsv, toLeadsCsv, factionRollup };
