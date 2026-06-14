// taxCalib.js — PER-CAMPAIGN TAX CALIBRATION (H lock), 2026-06-12.
//
// THE LAW (rtw-sav-parser/resource-tax-fit.md + fit2.md): live per-town taxes =
// model × H, H ∈ {0.85..1.15 in 0.05 steps} — a campaign-start roll seeded by the
// EXACT file set. H is frozen for the whole campaign (restarts on identical files
// reproduce it), reshuffles on ANY mod-file edit, is NOT file-derivable and NOT
// stored in saves — so the only way to H-exact budgets is pasting the live tax
// scroll values once per campaign. With H known the wired tax law is denarius-
// grade: max |residual| ≤ 6 over the 19-town julii validation corpus.
//
// This module is pure (no fs/electron): parses pasted scroll readings, matches
// them to budget settlements, computes snapped H per town. Persistence lives in
// the renderer (localStorage per modDir+faction); application lives in
// incomeModel.computeTurn1Budget(opts.taxHByCity).
export const BRACKET_MULT = { low: 0.8, normal: 1.0, high: 1.2, very_high: 1.5 };

// flexible bracket tokens: "vh"/"very high"/"v.high" etc.
const BRACKET_TOKEN = {
  vh: "very_high", vhigh: "very_high", veryhigh: "very_high", very_high: "very_high",
  v: "very_high", // "v high" splits to ["v","high"] — joined first, see parse
  h: "high", hi: "high", high: "high",
  n: "normal", norm: "normal", normal: "normal",
  l: "low", lo: "low", low: "low",
};

const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

// Calibration honors the pasted value EXACTLY (taxes reproduce to the denarius) —
// the live/model ratio is stored raw, no 0.05 snap. The ratio is stored against the
// budget's OWN bracket, so applying H reproduces the pasted game value even when the
// app's bracket ≠ the game's (e.g. app set Rome "normal"=854, game VH=1318 → H 1.54,
// 854×1.54=1318 exact). Band [0.35, 2.6] spans a one-step bracket gap (×1.5/×0.8 =
// 1.875) plus fortune; ratios beyond it signal a wrong-town match or a population
// paste (e.g. 9000/854 ≈ 10) and are rejected.
export function snapH(raw) {
  if (!Number.isFinite(raw) || raw <= 0) return null;
  if (raw < 0.35 || raw > 2.6) return null;
  return raw;
}

// parse pasted readings → [{ name, live, bracket|null, line }]; junk → skipped[].
// FORGIVING (2026-06-14): one-per-line OR comma-separated ("Rome 1318, Iguvium
// 203, …"), tolerates filler ("Rome 1318 in game"), strips the app's table emoji
// (★ 👤 🟢 ⚠), reads a bracket token anywhere. Detects an app-TABLE row (pop-first:
// a 4-digit number before a bracket keyword) → flags tableRowSeen so the UI can tell
// the user to paste GAME values, not the app's own table.
export function parseTaxReadings(text) {
  const readings = [], skipped = []; let tableRowSeen = false; let last = null;
  for (const raw of String(text || "").split(/[\r\n,]+/)) {
    const seg = raw.replace(/[★👤🟢⚠✓✕]/gu, "").trim();
    if (!seg || /^[#;\/]/.test(seg)) continue;
    const toks = seg.split(/[\s;:|=]+/).filter(Boolean);
    const nums = [];
    for (let i = 0; i < toks.length; i++) if (/^[+-]?\d{1,6}$/.test(toks[i])) nums.push({ i, v: parseInt(toks[i], 10) });
    if (!nums.length) {
      // a lone bracket segment (e.g. the ", low" of "Camerinum 189, low") binds to
      // the previous reading; anything else with no number is junk.
      const b = BRACKET_TOKEN[norm(seg)];
      if (b && last && last.bracket == null) last.bracket = b;
      else skipped.push(seg);
      continue;
    }
    // first inline bracket token position (for the app-table guard)
    let brIdx = -1;
    for (let i = 0; i < toks.length; i++) if (BRACKET_TOKEN[norm(toks[i])] != null) { brIdx = i; break; }
    if (brIdx >= 0 && nums[0].v >= 1000 && nums[0].i < brIdx && nums.length >= 3) { tableRowSeen = true; skipped.push(seg); continue; }
    // name = leading tokens before the first number/bracket; tax = first number after
    let nameEnd = 0;
    while (nameEnd < toks.length && !/^[+-]?\d{1,6}$/.test(toks[nameEnd]) && BRACKET_TOKEN[norm(toks[nameEnd])] == null) nameEnd++;
    if (nameEnd === 0) { skipped.push(seg); continue; }
    const name = toks.slice(0, nameEnd).join(" ");
    const after = nums.find(n => n.i >= nameEnd);
    if (!after || !Number.isFinite(after.v) || after.v < 0) { skipped.push(seg); continue; }
    // bracket = the joined tokens AFTER the tax number ("very high" → very_high),
    // matched against BRACKET_TOKEN; non-bracket filler ("in game") is ignored.
    const bracket = BRACKET_TOKEN[norm(toks.slice(after.i + 1).join(""))] || null;
    last = { name, live: after.v, bracket, line: seg };
    readings.push(last);
  }
  return { readings, skipped, tableRowSeen };
}

// match a pasted name against budget settlements (settlement/region, fuzzy)
export function matchSettlement(name, settlements) {
  const n = norm(name);
  if (!n) return null;
  let best = null;
  for (const s of settlements) {
    const cands = [norm(s.settlement), norm(s.region)];
    for (const c of cands) {
      if (!c) continue;
      if (c === n) return s;                          // exact wins immediately
      if (c.startsWith(n) || n.startsWith(c) || c.includes(n)) {
        if (!best || norm(best.settlement).length > c.length) best = s;
      }
    }
  }
  return best;
}

// model taxes for a settlement at a bracket, from the budget's pre-H decomposition
export function modelTaxAt(s, bracket) {
  if (!s || !s.taxParts) return null;
  const mult = BRACKET_MULT[bracket] || 1;
  return Math.max(0, mult * s.taxParts.w + s.taxParts.flat);
}

// the full pipeline: pasted text + budget settlements → calibration map
// returns { byCity: { settlementName: { h, live, bracket, model } }, unmatched, skipped }
export function computeTaxCalibration(text, settlements) {
  const { readings, skipped } = parseTaxReadings(text);
  const byCity = {}; const unmatched = [];
  for (const r of readings) {
    const s = matchSettlement(r.name, settlements || []);
    if (!s) { unmatched.push(r.line); continue; }
    const bracket = r.bracket || s.bracket || "normal"; // no bracket pasted → the budget's set bracket
    const model = modelTaxAt(s, bracket);
    if (model == null || model <= 0) { unmatched.push(r.line); continue; }
    const h = snapH(r.live / model);
    if (h == null) { unmatched.push(r.line); continue; }
    byCity[s.settlement] = { h, live: r.live, bracket, model: Math.round(model) };
  }
  return { byCity, unmatched, skipped };
}

