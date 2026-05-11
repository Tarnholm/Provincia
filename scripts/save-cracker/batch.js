// Batch differential analysis. Pairs every `save_<N>turnstart.sav` with its
// matching `save_<N>turnchange.sav` in a directory, runs the bounded-shift
// diff on each pair, and aggregates: for each byte offset, how many pairs
// changed it.
//
// The killer table this produces:
//   offsets_changed_in_exactly_1_pair  = the action-specific signal for THAT pair
//   offsets_changed_in_every_pair       = engine noise (FoW, AI memory, RNG state)
//   offsets_changed_in_some-pairs       = subsystems that overlap across actions
//
// We then label each "signal" offset with the closest known oracle hit so
// the action's affected fields surface immediately.
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { loadSave } from "./loader.js";
import { buildOracle } from "./oracle.js";
import { diffSmart, summarizeSmartDiff } from "./diff.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

function findPairs(dir) {
  // New scheme (per user 2026-05-05): one baseline `save_1turnstart.sav`,
  // diffed against each variant `save_<N>.sav` (or `save_1turnchange.sav` as
  // a special-case variant N=1). Each variant = baseline + one action,
  // making every diff a true single-variable isolation.
  const files = fs.readdirSync(dir);
  const baselinePath = path.join(dir, "save_1turnstart.sav");
  if (!fs.existsSync(baselinePath)) return [];
  const variants = [];
  // Special-case the first variant carrying the legacy name
  const legacyChange = path.join(dir, "save_1turnchange.sav");
  if (fs.existsSync(legacyChange)) variants.push({ n: 1, file: legacyChange });
  for (const f of files) {
    const m = f.match(/^save_(\d+)\.sav$/i);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (n < 2) continue; // 1 is reserved for legacy / baseline
    variants.push({ n, file: path.join(dir, f) });
  }
  variants.sort((a, b) => a.n - b.n);
  return variants.map(v => ({ n: v.n, before: baselinePath, after: v.file }));
}

function loadManifest(dir) {
  const p = path.join(dir, "manifest.json");
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return {}; }
}

export async function batch({ dir, outDir }) {
  outDir = outDir || path.join(__dirname, "out");
  fs.mkdirSync(outDir, { recursive: true });

  const pairs = findPairs(dir);
  const manifest = loadManifest(dir);
  console.log(`[batch] ${pairs.length} pair(s) found in ${dir}`);
  if (pairs.length === 0) {
    console.error("  No `save_<N>turnstart.sav` / `save_<N>turnchange.sav` pairs found.");
    return;
  }

  // Build oracle once on the first save (mod data is the same across pairs)
  const firstBuf = fs.readFileSync(pairs[0].before);
  console.log(`[batch] building oracle from first save (${firstBuf.length.toLocaleString()} bytes)…`);
  const oracle = buildOracle({ saveBuf: firstBuf, modDir: REPO_ROOT });
  console.log(`        ${Object.keys(oracle.tokens).length} unique tokens; sources:`, oracle.sources);

  // Pre-flatten oracle hits (cstring/utf8raw only — those are the body strings) into a
  // sorted offset → label array so we can binary-search "nearest-known" quickly.
  const annOffsets = [];
  const annLabels = [];
  for (const t of Object.values(oracle.tokens)) {
    for (const h of t.hits) {
      if (h.encoding !== "cstring" && h.encoding !== "utf8raw") continue;
      annOffsets.push(h.offset);
      annLabels.push(`${t.token} [${t.kinds.join(",")}]`);
    }
  }
  // Sort by offset
  const sortIdx = annOffsets.map((_, i) => i).sort((a, b) => annOffsets[a] - annOffsets[b]);
  const sortedOff = sortIdx.map(i => annOffsets[i]);
  const sortedLab = sortIdx.map(i => annLabels[i]);
  function nearest(off) {
    let lo = 0, hi = sortedOff.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sortedOff[mid] <= off) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (best < 0) return null;
    return { offset: sortedOff[best], label: sortedLab[best], delta: off - sortedOff[best] };
  }

  // Run the diff for each pair, capturing the bitmap of changed bytes (in A's
  // coord space). We also record summary stats and per-pair top changes.
  const perPairResults = [];
  // Use a single Uint32Array to count "how many pairs changed this offset"
  // — sized to the largest A buffer we encounter.
  let maxLen = 0;
  for (const p of pairs) maxLen = Math.max(maxLen, fs.statSync(p.before).size);
  const changeCount = new Uint32Array(maxLen);

  for (const pair of pairs) {
    const a = loadSave(pair.before);
    const b = loadSave(pair.after);
    console.log(`[pair ${pair.n}] ${path.basename(pair.before)} → ${path.basename(pair.after)} (${a.size.toLocaleString()} → ${b.size.toLocaleString()} bytes, Δ=${(b.size-a.size).toLocaleString()})`);
    const sm = diffSmart(a.buf, b.buf);
    const summary = summarizeSmartDiff(sm, a.buf, b.buf);
    console.log(`  ${summary.runCount} change-runs, ${summary.changedBytesA.toLocaleString()} bytes (${summary.pctChangedA}) actually changed`);

    // Mark every byte covered by a "change run" (in A coord)
    const localMask = new Uint8Array(a.size);
    for (const r of sm.runs) {
      const len = Math.max(r.aEnd - r.aStart, r.bEnd - r.bStart);
      for (let o = r.aStart; o < Math.min(r.aStart + len, a.size); o++) localMask[o] = 1;
    }
    for (let o = 0; o < a.size; o++) if (localMask[o]) changeCount[o]++;

    // Annotate top 20 runs with nearest oracle hit
    const annotatedRuns = sm.runs
      .map(r => ({ ...r, lenA: r.aEnd - r.aStart, lenB: r.bEnd - r.bStart, near: nearest(r.aStart) }))
      .sort((a, b) => Math.max(b.lenA, b.lenB) - Math.max(a.lenA, a.lenB))
      .slice(0, 20);

    perPairResults.push({
      n: pair.n,
      before: pair.before,
      after: pair.after,
      action: manifest[pair.n] || manifest[String(pair.n)] || "(no manifest entry)",
      summary,
      topRuns: annotatedRuns,
    });
  }

  // Aggregate — bucket each byte offset by the number of pairs that changed it.
  const bucketCounts = new Array(pairs.length + 1).fill(0);
  // Track a small sample of "signal" offsets per bucket
  const bucketSamples = Array.from({ length: pairs.length + 1 }, () => []);
  for (let o = 0; o < changeCount.length; o++) {
    const c = changeCount[o];
    bucketCounts[c]++;
    if (bucketSamples[c].length < 100) bucketSamples[c].push(o);
  }
  console.log(`\n[aggregate] offsets bucketed by # of pairs changed:`);
  for (let i = 0; i <= pairs.length; i++) {
    if (bucketCounts[i] === 0) continue;
    const meaning = i === 0 ? "(constant — engine scaffolding)"
                  : i === pairs.length ? "(every pair — engine noise: FoW/AI/RNG)"
                  : i === 1 ? "(SIGNAL — action-specific to one pair)"
                            : "(spans some pairs)";
    console.log(`  ${i.toString().padStart(2)}× : ${bucketCounts[i].toLocaleString().padStart(10)} bytes  ${meaning}`);
  }

  // For the "exactly 1× changed" bucket, group offsets by which pair lit them up
  console.log(`\n[signal] offsets that changed in exactly ONE pair (per-pair):`);
  const perPairSignal = pairs.map((_p, idx) => ({ pairIdx: idx, offsets: [] }));
  // Walk again, but this time we need the per-pair masks. Re-run masks without
  // re-running diff — store them. Simpler: re-run diff (cached small) to get masks.
  // (Or: cache localMask above. Refactor.)
  // For now, recompute via re-diffing into a per-pair mask:
  const perPairMasks = [];
  for (const pair of pairs) {
    const a = loadSave(pair.before);
    const b = loadSave(pair.after);
    const sm = diffSmart(a.buf, b.buf);
    const localMask = new Uint8Array(a.size);
    for (const r of sm.runs) {
      const len = Math.max(r.aEnd - r.aStart, r.bEnd - r.bStart);
      for (let o = r.aStart; o < Math.min(r.aStart + len, a.size); o++) localMask[o] = 1;
    }
    perPairMasks.push(localMask);
  }
  for (let o = 0; o < changeCount.length; o++) {
    if (changeCount[o] !== 1) continue;
    for (let i = 0; i < perPairMasks.length; i++) {
      if (o < perPairMasks[i].length && perPairMasks[i][o]) {
        if (perPairSignal[i].offsets.length < 10000) perPairSignal[i].offsets.push(o);
        break;
      }
    }
  }
  for (const s of perPairSignal) {
    const pair = pairs[s.pairIdx];
    const total = s.offsets.length;
    console.log(`  pair ${pair.n} (${pair.action ? "" : "(no action label)"}): ${total.toLocaleString()} signal bytes`);
    // Cluster into runs
    const runs = [];
    let runStart = -1, runEnd = -1;
    for (const o of s.offsets) {
      if (runStart < 0) { runStart = o; runEnd = o + 1; continue; }
      if (o === runEnd) { runEnd++; continue; }
      runs.push({ start: runStart, end: runEnd });
      runStart = o; runEnd = o + 1;
    }
    if (runStart >= 0) runs.push({ start: runStart, end: runEnd });
    runs.sort((a, b) => (b.end - b.start) - (a.end - a.start));
    for (const r of runs.slice(0, 8)) {
      const near = nearest(r.start);
      console.log(`    @0x${r.start.toString(16).padStart(8,"0")}  ${(r.end-r.start).toString().padStart(5)}B  near: ${near ? `${near.label} (+${near.delta}B)` : "—"}`);
    }
  }

  // Write JSON output
  const outPath = path.join(outDir, "batch.json");
  fs.writeFileSync(outPath, JSON.stringify({
    pairs: perPairResults,
    bucketCounts,
    perPairSignal: perPairSignal.map((s, i) => {
      const runs = [];
      let runStart = -1, runEnd = -1;
      for (const o of s.offsets) {
        if (runStart < 0) { runStart = o; runEnd = o + 1; continue; }
        if (o === runEnd) { runEnd++; continue; }
        runs.push({ start: runStart, end: runEnd });
        runStart = o; runEnd = o + 1;
      }
      if (runStart >= 0) runs.push({ start: runStart, end: runEnd });
      runs.sort((a, b) => (b.end - b.start) - (a.end - a.start));
      return {
        pair: pairs[i].n,
        action: pairs[i].action,
        signalRuns: runs.slice(0, 200).map(r => {
          const near = nearest(r.start);
          return { start: r.start, len: r.end - r.start, near };
        }),
      };
    }),
  }, null, 2));
  console.log(`\n[batch] JSON written to ${outPath}`);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1].endsWith("batch.js")) {
  const dir = process.argv[2];
  if (!dir) { console.error("usage: node batch.js <dir-with-save_NturnSTART/CHANGE.sav>"); process.exit(2); }
  batch({ dir }).catch(e => { console.error(e); process.exit(1); });
}
