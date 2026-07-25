// Script-error → mod-file lead engine (2026-07-25).
//
// scripting_log.txt gives us a file, a line and a complaint. That is already
// actionable, but for two whole classes of error we can go further and resolve
// the fix from the mod files themselves — which turns "the engine is unhappy at
// descr_senate.txt:139" into "Aedile_tenure names an office that RIS deleted;
// the offices that DO exist are PlebeianAedile and CuruleAedile".
//
// The rule this module obeys, same as aiModFileAudit.js: a suggestion is only
// emitted when it can be PROVEN from the files on disk. Where the cause can't
// be resolved (the descr_formations_ai parse failure — the engine's column
// number doesn't land on the offending token and no vocabulary check reproduces
// it), the lead states the measurable impact and stops, rather than guessing.
"use strict";

// ── descr_senate.txt ────────────────────────────────────────────────────────
// Office definitions are bare capitalised words at column 1, followed by
// Title/Rank/... and closed with `End`. Restrictions reference other offices as
// `<OfficeName>_tenure`. RIS split vanilla's single `Aedile` into
// `PlebeianAedile` + `CuruleAedile` and dropped `PontifexMaximus`, but the
// `Aedile_tenure` restrictions stayed behind, so they can never be satisfied.
const SENATE_NON_OFFICE = new Set([
  "Restrictions", "End", "End_restrictions", "Senate_benefits", "End_senate_benefits",
  "Title", "Description", "Rank", "Quantity", "Duration", "Sittings",
  "Appease", "Assassinate", "Subjugate", "Bribe", "Senate", "End_senate",
]);

function parseSenateOffices(text) {
  const offices = new Set();
  const tenureRefs = []; // { name, line }
  if (!text) return { offices, tenureRefs };
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t || t.startsWith(";")) continue;
    // an office declaration is unindented and a single bare word
    if (/^[A-Za-z][A-Za-z]*$/.test(raw) && !SENATE_NON_OFFICE.has(t)) offices.add(t);
    const m = /^([A-Za-z][A-Za-z]*)_tenure\b/.exec(t);
    if (m) tenureRefs.push({ name: m[1], line: i + 1 });
  }
  return { offices, tenureRefs };
}

// Which real office names is a dead reference most likely meant to be? Prefer
// containment (Aedile → PlebeianAedile, CuruleAedile) over anything fuzzier,
// because containment is the shape a rename actually produces.
function officeCandidates(missing, offices) {
  const hits = [...offices].filter((o) => o !== missing && o.toLowerCase().includes(missing.toLowerCase()));
  return hits.sort();
}

// ── export_descr_character_traits.txt ───────────────────────────────────────
// `Condition HasOffice <Office>` is the OTHER place office names are referenced,
// and it's where the engine's runtime "no office named X" errors actually come
// from — the senate file only produces the static parse error. Resolving these
// against the offices descr_senate.txt really defines finds dead references even
// for offices no character has hit yet, which the log alone can't do.
//
// Commented-out lines are skipped: RIS keeps large ;;;-disabled blocks, and a
// reference inside one is not a bug.
function parseHasOfficeRefs(text) {
  const refs = []; // { office, line }
  if (!text) return refs;
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.startsWith(";")) continue;
    const m = /^Condition\s+HasOffice\s+(\w+)/.exec(t);
    if (m) refs.push({ office: m[1], line: i + 1 });
  }
  return refs;
}

// ── descr_formations_ai.txt ─────────────────────────────────────────────────
// We can't resolve the parse error, but we CAN measure the blast radius: how
// many formations are declared after the line the engine gave up on.
function countFormationsAfter(text, line) {
  if (!text) return null;
  const lines = String(text).split(/\r?\n/);
  let before = 0, after = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^begin_formation\b/.test(lines[i])) (i + 1 < line ? before++ : after++);
  }
  return { before, after, total: before + after, fileLines: lines.length };
}

// "Formation X does not cover all unit types" — the fix is a low-priority
// catch-all block (`unit_type any`), which is exactly what the formations the
// engine did NOT complain about all have. Verified on the RIS file: 20 of 32
// formations carry one, 11 don't, and every group the engine warned about is in
// the second set. That correlation is the evidence for the suggestion, so it is
// measured from the file rather than asserted.
//
// NOTE the engine reports these warnings against a formation *group* name, and
// the line number it gives lands inside a sibling formation in the same group —
// so the group name is the reliable identifier here, not the line.
function catchAllCoverage(text) {
  if (!text) return null;
  const lines = String(text).split(/\r?\n/);
  const withCatchAll = [], without = [];
  let cur = null, count = 0;
  const close = () => {
    if (cur) (count > 0 ? withCatchAll : without).push(cur);
    cur = null; count = 0;
  };
  for (const l of lines) {
    if (/^begin_formation\s+(\S+)/.test(l)) { close(); cur = /^begin_formation\s+(\S+)/.exec(l)[1]; continue; }
    if (/^end_formation\b/.test(l)) { close(); continue; }
    if (cur && /unit_type\s+any\b/.test(l)) count++;
  }
  close();
  return { withCatchAll, without, total: withCatchAll.length + without.length };
}

/**
 * Turn script_error / script_runtime_error findings into mod-file leads.
 *
 * @param {object} a
 * @param {Array}  a.findings  findings from createScriptLogAnalyzer().finish()
 * @param {object} a.files     { senate, formationsAi } raw text (may be null)
 * @returns {{leads: Array}}
 */
/**
 * Locate a failing console command in the campaign script and report it with lines.
 *
 * `failures` is the analyser's `failedConsoleCommands`. Its counts are FAILURES, not
 * rates — the game console echoes a command only when it fails, so this log has no
 * denominator and nothing here may imply a percentage.
 *
 * Returns [] when the script text is absent: a lead that cannot name a line is not
 * worth emitting, and guessing the location would be worse than staying quiet.
 */
function auditFailedConsoleCommands({ failures, campaignScript } = {}) {
  const leads = [];
  const list = Array.isArray(failures) ? failures : [];
  if (!list.length || !campaignScript) return leads;

  const lines = String(campaignScript).split(/\r?\n/);

  // Group by command NAME: five different set_building_health calls in one block is
  // one problem to fix, not five leads to read.
  const byName = new Map();
  for (const f of list) {
    const name = String(f.command || "").split(/\s+/)[0];
    if (!name) continue;
    const e = byName.get(name) || { name, total: 0, calls: [], messages: new Map() };
    e.total += f.count || 0;
    e.calls.push(f);
    for (const m of f.messages || []) e.messages.set(m.message, (e.messages.get(m.message) || 0) + m.n);
    byName.set(name, e);
  }

  for (const e of [...byName.values()].sort((a, b) => b.total - a.total)) {
    // Find where the script issues it. console_command is how a campaign script
    // reaches the console; a bare occurrence also counts.
    const at = [];
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const t = raw.trim();
      if (t.startsWith(";")) continue;             // commented out — not running
      if (t.indexOf(e.name) < 0) continue;
      if (!/^(?:console_command\s+)?/.test(t)) continue;
      at.push(i + 1);
    }
    if (!at.length) continue;                       // cannot name a line → say nothing

    const span = at.length > 1 ? `lines ${at[0]}-${at[at.length - 1]}` : `line ${at[0]}`;
    const msgs = [...e.messages.entries()].sort((a, b) => b[1] - a[1]);
    const each = e.calls
      .slice(0, 6)
      .map((c) => `${c.command} (${c.count}x)`)
      .join(" · ");

    // Only claim "never succeeds" when every call in the group failed the SAME number
    // of times. Equal counts across calls that are not mutually exclusive is what
    // rules out the "one of the set succeeds" reading; unequal counts do not, so the
    // wording softens rather than overclaiming.
    const counts = e.calls.map((c) => c.count);
    const allEqual = counts.length > 1 && counts.every((c) => c === counts[0]);

    leads.push({
      severity: "warn",
      faction: "all (campaign script)",
      file: "RIS_Campaign_Script.txt",
      key: e.name,
      issue: allEqual
        ? `EVERY ${e.name} CALL IN THIS BLOCK FAILS — ${at.length} calls at ${span}, each failing exactly ${counts[0]} times (${e.total} total). Equal counts across calls that are not mutually exclusive means none of them is succeeding, so the whole block is dead.`
        : `${e.name} FAILS REPEATEDLY — ${e.total} failures across ${at.length} call site(s) at ${span}.`,
      suggestion: `Guard each call with the condition this same script already uses a few lines later, e.g. "if SettlementBuildingExists = <chain>" ... "end_if". That removes the console errors; if the intent was to repair a building the settlement should have, the real question is why it does not have it.`,
      evidence: `${each}${e.calls.length > 6 ? " · …" : ""} · engine said: ${msgs.map(([m, n]) => `"${m}" ${n}x`).join(", ")} · NOTE these are failure COUNTS, not rates: the console echoes only failures, so this log carries no denominator.`,
    });
  }
  return leads;
}

function auditScriptErrors({ findings, files } = {}) {
  const leads = [];
  const list = Array.isArray(findings) ? findings : [];
  const senate = parseSenateOffices(files && files.senate);
  const hasOffice = parseHasOfficeRefs(files && files.traits);
  const coverage = catchAllCoverage(files && files.formationsAi);
  const seenOffice = new Set();

  // A dead office name usually shows up in TWO files, so emit one lead per
  // (file, office) pair — each names the lines its own file must change.
  const pushOfficeLead = (missing, evidence, severity) => {
    if (!senate.offices.size) return; // can't prove anything without the file
    if (senate.offices.has(missing)) return; // it does exist — not this bug
    const cands = officeCandidates(missing, senate.offices);
    const existing = `offices that DO exist: ${[...senate.offices].sort().join(", ")}`;
    const fix = (suffix) => (cands.length
      ? `rename to ${cands.map((c) => c + suffix).join(" or ")} — ${cands.length > 1 ? "those are" : "that is"} what the office is actually called now`
      : `define an office named "${missing}" in descr_senate.txt, or remove the reference`);

    // (a) descr_senate.txt — `<Office>_tenure` restrictions
    const tenureLines = senate.tenureRefs.filter((r) => r.name === missing).map((r) => r.line);
    if (tenureLines.length && !seenOffice.has("senate:" + missing)) {
      seenOffice.add("senate:" + missing);
      leads.push({
        severity, faction: "roman senate", file: "descr_senate.txt", key: `${missing}_tenure`,
        issue: `DEAD OFFICE REFERENCE — no office named "${missing}" is defined in this file, so the "${missing}_tenure" restriction can never be satisfied and every office gated behind it is unobtainable`,
        suggestion: fix("_tenure"),
        evidence: `${existing} · restriction used at line ${tenureLines.join(", ")}` + (evidence ? ` · ${evidence}` : ""),
      });
    }

    // (b) export_descr_character_traits.txt — `Condition HasOffice <Office>`
    const hoLines = hasOffice.filter((r) => r.office === missing).map((r) => r.line);
    if (hoLines.length && !seenOffice.has("traits:" + missing)) {
      seenOffice.add("traits:" + missing);
      const shown = hoLines.slice(0, 6).join(", ") + (hoLines.length > 6 ? ` +${hoLines.length - 6} more` : "");
      leads.push({
        severity, faction: "roman senate", file: "export_descr_character_traits.txt", key: `Condition HasOffice ${missing}`,
        issue: `DEAD OFFICE REFERENCE — "${missing}" is not an office in descr_senate.txt, so this condition never evaluates true and the trait behind it is never awarded`,
        suggestion: fix(""),
        evidence: `${existing} · condition used at line ${shown}` + (evidence ? ` · ${evidence}` : ""),
      });
    }

    // (c) neither file names it — still report, since the engine hit it
    if (!tenureLines.length && !hoLines.length && !seenOffice.has("other:" + missing)) {
      seenOffice.add("other:" + missing);
      leads.push({
        severity, faction: "roman senate", file: "descr_senate.txt", key: missing,
        issue: `DEAD OFFICE REFERENCE — the engine looked for an office named "${missing}" and descr_senate.txt does not define one`,
        suggestion: fix(""),
        evidence: `${existing} · no reference to it found in descr_senate.txt or export_descr_character_traits.txt, so the caller is elsewhere` + (evidence ? ` · ${evidence}` : ""),
      });
    }
  };

  for (const f of list) {
    if (f.kind === "script_runtime_error" && f.name === "HasOffice") {
      const m = /no office named (\w+)/.exec(f.detail || "");
      if (m) pushOfficeLead(m[1], `engine reported this ${f.turns}× at runtime`, 3);
      continue;
    }
    if (f.kind !== "script_error") continue;

    if (f.file === "descr_senate.txt") {
      const m = /'(\w+)_tenure' does not contain a valid office name/.exec(f.detail || "");
      if (m) pushOfficeLead(m[1], `descr_senate.txt:${f.line}`, 3);
      continue;
    }

    if (f.file === "descr_formations_ai.txt" && f.severity === 3) {
      // one lead per failing line, not one per message (the engine emits three)
      const key = `formations:${f.line}`;
      if (seenOffice.has(key)) continue;
      seenOffice.add(key);
      const c = countFormationsAfter(files && files.formationsAi, f.line);
      leads.push({
        severity: 3,
        faction: "all (battle AI)",
        file: "descr_formations_ai.txt",
        key: `line ${f.line}`,
        issue: `PARSE FAILURE — the engine stopped reading this file at line ${f.line} ("${f.message || f.detail}")`,
        suggestion:
          `fix the block that ends at line ${f.line} so the file parses. ` +
          `Compare it field-by-field against a block the engine accepted earlier in the same file — the engine's column number points at where it gave up recovering, not at the offending token.`,
        evidence: c
          ? `${c.after} of ${c.total} formation(s) in this ${c.fileLines.toLocaleString()}-line file are declared AFTER line ${f.line}, and the engine reported no diagnostics past it — worth confirming in-game whether those formations load at all`
          : `could not read descr_formations_ai.txt to measure the impact`,
      });
      continue;
    }

    if (f.file === "descr_formations_ai.txt") {
      const m = /Formation (\S+) does not cover all unit types/.exec(f.detail || "");
      if (m) {
        const cov = coverage; // measured once, below
        const lacks = cov && cov.without.some((n) => n.startsWith(m[1]));
        leads.push({
          severity: 2,
          faction: "all (battle AI)",
          file: "descr_formations_ai.txt",
          key: m[1],
          issue: `INCOMPLETE COVERAGE — formation group "${m[1]}" has no block that accepts every unit type, so units outside its preference list get no assigned position`,
          suggestion: `add a low-priority catch-all block (\`unit_type any\` with priority ~0.1) to "${m[1]}", the way the formations the engine did not complain about do`,
          evidence: cov
            ? `${cov.withCatchAll.length} of ${cov.total} formations in this file carry a \`unit_type any\` catch-all and ${cov.without.length} do not` +
              (lacks ? ` — "${m[1]}" is in the second group` : ``) +
              ` · the engine still loads the formation, but falls back to defaults for the uncovered units` +
              ` · it reports this against a formation GROUP, so its line number (${f.line}) lands inside a sibling formation rather than on the culprit`
            : `descr_formations_ai.txt:${f.line} · the engine still loads the formation, but falls back to defaults for the uncovered units`,
        });
      }
      continue;
    }

    if (f.file === "descr_strat.txt" && /invalid tile/.test(f.detail || "")) {
      const m = /invalid tile\((\d+), (\d+)\) for (\S+) \(([^)]+)\)/.exec(f.detail);
      if (m) {
        leads.push({
          severity: 3,
          faction: m[4],
          file: "descr_strat.txt",
          key: `line ${f.line} — ${m[3]}`,
          issue: `INVALID STARTING TILE (${m[1]}, ${m[2]}) — the engine rejected this character's placement, so ${m[3]} does not start on the map where the file says`,
          suggestion: `move ${m[3]} to a valid land tile inside ${m[4]}'s territory; the tile as written is impassable, off-map, or owned by someone else`,
          evidence: `descr_strat.txt:${f.line}:${f.column}`,
        });
      }
      continue;
    }

    // Anything we don't have a cross-check for still becomes a lead — the file
    // and line ARE the actionable part.
    leads.push({
      severity: f.severity || 2,
      faction: "—",
      file: f.file || "(unknown file)",
      key: `line ${f.line}`,
      issue: f.message || f.detail,
      suggestion: `open ${f.file}:${f.line} and fix what the engine reported`,
      evidence: f.detail,
    });
  }

  // ── STATIC SWEEP ──────────────────────────────────────────────────────────
  // The engine only logs "no office named X" once a character actually reaches
  // that trigger, so the log under-reports. Resolving every office reference in
  // the mod against the offices descr_senate.txt defines catches the rest —
  // including references no save has exercised yet. Runs after the log-driven
  // leads so those keep their richer runtime evidence (the dedupe set makes the
  // second pass a no-op for anything already reported).
  for (const r of senate.tenureRefs) pushOfficeLead(r.name, null, 3);
  for (const r of hasOffice) pushOfficeLead(r.office, null, 3);

  leads.sort((p, q) => q.severity - p.severity || p.file.localeCompare(q.file) || String(p.key).localeCompare(String(q.key)));
  return { leads };
}

module.exports = { auditScriptErrors, auditFailedConsoleCommands, parseSenateOffices, officeCandidates, countFormationsAfter, catchAllCoverage, parseHasOfficeRefs };
