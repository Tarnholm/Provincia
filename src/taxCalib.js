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

// snap a raw live/model ratio to the engine's 0.05 H grid, clamped to [0.85, 1.15]
export function snapH(raw) {
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const h = Math.round(raw * 20) / 20;
  return Math.min(1.15, Math.max(0.85, h));
}

// parse pasted lines → [{ name, live, bracket|null, line }]; junk lines → skipped[]
export function parseTaxReadings(text) {
  const readings = [], skipped = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[#;\/]/.test(line)) continue;
    // tokens: split on whitespace / tabs / commas / colons / pipes / equals
    const toks = line.split(/[\s,;:|=]+/).filter(Boolean);
    let numIdx = -1;
    for (let i = 0; i < toks.length; i++) {
      if (/^[+-]?\d{1,6}$/.test(toks[i])) { numIdx = i; break; }
    }
    if (numIdx < 1) { skipped.push(line); continue; } // need a name before the number
    const name = toks.slice(0, numIdx).join(" ");
    const live = parseInt(toks[numIdx], 10);
    // bracket from the remaining tokens (joined, so "very high" works)
    const rest = norm(toks.slice(numIdx + 1).join(""));
    let bracket = null;
    if (rest) {
      bracket = BRACKET_TOKEN[rest] || null;
      if (!bracket) { skipped.push(line); continue; } // trailing junk we can't read
    }
    if (!Number.isFinite(live) || live < 0) { skipped.push(line); continue; }
    readings.push({ name, live, bracket, line });
  }
  return { readings, skipped };
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

