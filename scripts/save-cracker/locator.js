// Field locator — given a token (e.g. "carthage") and a related integer (e.g.
// 12500 = its starting denarii), find every co-occurrence: pairs where the
// integer's u32 (or u16) offset lies within ±N bytes of the token's string
// offset. The minimal-shift pair tells us the field's position within the
// per-token record. Repeat across all tokens of the same kind and the
// shifts cluster — that cluster IS the record stride.
//
// Inputs:
//   oracle: { tokens: { [token]: { hits: [{offset, encoding}] } }, ints: [...] }
//   probes: [{ token, value, label }] — what to correlate
//   buf: the save buffer (only used to verify u32/u16 reads when needed)
//
// Output: [{ token, value, label, pairs: [{strOff, intOff, intWidth, delta}], cluster: { mean, stddev, count } }]
import { findIntsInBuf } from "./scan-helpers.js";

export function correlate({ oracle, probes, buf, window = 1024 }) {
  // Build a quick u32 + u16 finder with a cache
  const cache = new Map();
  function findInts(value) {
    if (cache.has(value)) return cache.get(value);
    const r = findIntsInBuf(buf, value);
    cache.set(value, r);
    return r;
  }

  const results = [];
  for (const probe of probes) {
    const tokenEntry = oracle.tokens[probe.token];
    if (!tokenEntry) continue;
    const strHits = tokenEntry.hits.filter(h => h.encoding === "cstring" || h.encoding === "utf8raw");
    if (!strHits.length) continue;
    const ints = findInts(probe.value);
    const pairs = [];
    for (const sh of strHits) {
      const sOff = sh.offset;
      // Search nearby u32 hits
      for (const iOff of ints.u32) {
        if (iOff >= sOff - window && iOff <= sOff + window) {
          pairs.push({ strOff: sOff, intOff: iOff, intWidth: 4, delta: iOff - sOff });
        }
      }
      // Search nearby u16 hits — only when value fits and as a tie-breaker
      for (const iOff of ints.u16) {
        if (iOff >= sOff - window && iOff <= sOff + window) {
          pairs.push({ strOff: sOff, intOff: iOff, intWidth: 2, delta: iOff - sOff });
        }
      }
    }
    if (pairs.length === 0) { results.push({ ...probe, pairs: [], cluster: null }); continue; }

    // Histogram of deltas — the most-common delta is the structural one
    const histo = new Map();
    for (const p of pairs) histo.set(p.delta, (histo.get(p.delta) || 0) + 1);
    const histoSorted = [...histo.entries()].sort((a, b) => b[1] - a[1]);
    const [topDelta, topCount] = histoSorted[0];
    results.push({
      ...probe,
      pairs: pairs.slice(0, 50),
      cluster: { topDelta, topCount, totalPairs: pairs.length, histogramTop: histoSorted.slice(0, 5) },
    });
  }
  return results;
}

// Convenience: build probes for every (faction, denarii) and (army, x), (army, y)
// from a parsed descr_strat structure. The save scanner already carries this
// info — we reshape it for correlate().
export function defaultProbes(stratParsed) {
  const probes = [];
  for (const d of (stratParsed.denarii || [])) {
    if (d.faction && d.value > 0) probes.push({ token: d.faction, value: d.value, label: `denari:${d.faction}` });
  }
  // Army x/y probes are noisy without a name — skip for now
  return probes;
}
