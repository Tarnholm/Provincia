// corrCalib.js — per-campaign corruption calibration. Corruption's distance-to-
// capital is the engine's road/pathfinding metric, not file-recoverable to the
// denarius (the save's distance field is 5%-quantized). But corruption is
// DETERMINISTIC per files, so — exactly like tax calibration — the user pastes the
// live per-town corruption once and we reproduce it EXACTLY.
//
// Paste format: one town per line, "Name 392" or "Metapontum 392" (the in-game
// settlement scroll's corruption / "Other" expenditure; sign ignored, 392 == −392).
// Reuses matchSettlement from taxCalib for fuzzy name matching.
"use strict";

import { matchSettlement } from "./taxCalib.js";

// parse pasted lines → [{ name, corr, line }]; junk → skipped[]
export function parseCorrReadings(text) {
  const readings = [], skipped = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[#;\/]/.test(line)) continue;
    const toks = line.split(/[\s,;:|=]+/).filter(Boolean);
    let numIdx = -1;
    for (let i = 0; i < toks.length; i++) {
      if (/^[+-]?\d{1,6}$/.test(toks[i])) { numIdx = i; break; }
    }
    if (numIdx < 1) { skipped.push(line); continue; } // need a name before the number
    const name = toks.slice(0, numIdx).join(" ");
    const corr = Math.abs(parseInt(toks[numIdx], 10)); // sign-agnostic ("−392" or "392")
    if (!Number.isFinite(corr)) { skipped.push(line); continue; }
    readings.push({ name, corr, line });
  }
  return { readings, skipped };
}

// pasted text + budget settlements → { byCity: { settlementName: { corr } }, unmatched, skipped }
export function computeCorrCalibration(text, settlements) {
  const { readings, skipped } = parseCorrReadings(text);
  const byCity = {}; const unmatched = [];
  for (const r of readings) {
    const s = matchSettlement(r.name, settlements || []);
    if (!s) { unmatched.push(r.line); continue; }
    byCity[s.settlement] = { corr: r.corr };
  }
  return { byCity, unmatched, skipped };
}
