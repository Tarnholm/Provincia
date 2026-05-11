// Save cracker CLI.
//   node scripts/save-cracker/index.js <save.sav> [--vs <other.sav>] [--out <dir>]
//
// What it does:
//   1. Loads the save buffer
//   2. Decodes the header (already known fields)
//   3. Builds the oracle: every known token from descr_strat / descr_regions /
//      descr_sm_factions, scanned in 5 encodings against the buffer
//   4. (optional) Diffs against another save and annotates runs
//   5. Writes a self-contained HTML report + a JSON dump for downstream tools
//
// Outputs land in scripts/save-cracker/out/<basename>.{html,json}
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { loadSave } from "./loader.js";
import { buildOracle } from "./oracle.js";
import { decodeHeader } from "./header.js";
import { diffByteRuns, summarizeDiff, diffSmart, summarizeSmartDiff } from "./diff.js";
import { renderReport } from "./report.js";
import { correlate, defaultProbes } from "./locator.js";
import { findSelfPointers, buildSectionTree, summarizeTree, findHeaderStringsTable } from "./sections.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

function parseArgs(argv) {
  const args = { positional: [], vs: null, out: path.join(__dirname, "out"), batch: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--vs") args.vs = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--batch") args.batch = argv[++i];
    else args.positional.push(a);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.batch) {
    const { batch } = await import("./batch.js");
    await batch({ dir: args.batch, outDir: args.out });
    return;
  }
  if (args.positional.length === 0) {
    console.error("usage: node index.js <save.sav> [--vs <other.sav>] [--out <dir>]");
    console.error("       node index.js --batch <dir-of-save_*.sav>");
    process.exit(2);
  }
  const savePath = path.resolve(args.positional[0]);
  const otherPath = args.vs ? path.resolve(args.vs) : null;
  fs.mkdirSync(args.out, { recursive: true });

  console.log(`[load] ${savePath}`);
  const save = loadSave(savePath);
  console.log(`       size: ${save.size.toLocaleString()} bytes`);

  console.log("[header] decoding first ~256 bytes…");
  const header = decodeHeader(save.buf);
  for (const h of header.items) {
    console.log(`  0x${h.off.toString(16).padStart(4, "0")} (${String(h.len).padStart(3)}B) ${h.name.padEnd(28)} → ${h.interp || ""}`);
  }

  console.log("[sections] scanning for self-pointing sections (taw invariant: u32@X==X)…");
  const selfPtrs = findSelfPointers(save.buf);
  console.log(`  ${selfPtrs.length} candidate sections`);
  const tree = buildSectionTree(selfPtrs);
  const treeSummary = summarizeTree(tree, 0, 50);
  for (const n of treeSummary.slice(0, 25)) {
    console.log(`    ${"  ".repeat(n.depth)}@0x${n.offset.toString(16).padStart(6,"0")} size=${n.size.toLocaleString().padStart(12)} children=${n.childCount}`);
  }

  console.log("[hst] scanning for header strings table (NAME + u32-version pairs)…");
  const hstRuns = findHeaderStringsTable(save.buf, { minRun: 4 });
  console.log(`  top ${Math.min(3, hstRuns.length)} runs:`);
  for (const r of hstRuns.slice(0, 3)) {
    console.log(`    @0x${r.start.toString(16)} (${r.entries.length} entries):`);
    for (const e of r.entries.slice(0, 12)) console.log(`      ${e.name.padEnd(30)} v=${e.version}`);
    if (r.entries.length > 12) console.log(`      ... (${r.entries.length - 12} more)`);
  }

  console.log("[oracle] indexing known tokens…");
  const oracle = buildOracle({ saveBuf: save.buf, modDir: REPO_ROOT });
  const totalTokens = Object.keys(oracle.tokens).length;
  const totalHits = Object.values(oracle.tokens).reduce((s, t) => s + t.hits.length, 0);
  console.log(`  ${totalTokens} unique tokens scanned, ${totalHits} hits across all encodings`);
  console.log(`  source counts:`, oracle.sources);

  // Top 10 most-hit tokens
  const top = Object.values(oracle.tokens).sort((a, b) => b.hits.length - a.hits.length).slice(0, 10);
  console.log("  most-hit tokens:");
  for (const t of top) {
    const encs = [...new Set(t.hits.map(h => h.encoding))].join(",");
    console.log(`    ${t.token.padEnd(30)} ${String(t.hits.length).padStart(4)}× [${encs}] kinds=${t.kinds.join(",")}`);
  }

  // Strongest integer probes
  const intsRanked = oracle.ints.filter(p => p.hitsU32.length || p.hitsU16.length).slice(0, 10);
  console.log("  integer probes:");
  for (const p of intsRanked) {
    console.log(`    ${String(p.value).padStart(8)}  u32×${p.hitsU32.length}  u16×${p.hitsU16.length}  ← ${p.source}`);
  }

  let diffRuns = null, diffSummary = null, smartDiff = null, smartDiffSummary = null;
  let other = null;
  if (otherPath) {
    console.log(`[diff] vs ${otherPath}`);
    other = loadSave(otherPath);
    diffRuns = diffByteRuns(save.buf, other.buf);
    diffSummary = summarizeDiff(diffRuns, save.buf, other.buf);
    console.log(`  byte-level: ${diffSummary.runCount} runs, ${diffSummary.totalChanged.toLocaleString()} bytes changed (${diffSummary.pctChanged}), size delta ${diffSummary.sizeDelta}`);
    console.log("  computing shift-aware diff (this is slower)…");
    smartDiff = diffSmart(save.buf, other.buf);
    smartDiffSummary = summarizeSmartDiff(smartDiff, save.buf, other.buf);
    console.log(`  shift-aware: ${smartDiffSummary.runCount} change-runs, ${smartDiffSummary.anchorCount} anchors, ${smartDiffSummary.changedBytesA.toLocaleString()} bytes (${smartDiffSummary.pctChangedA}) actually changed`);
  }

  // Field locator: where do faction treasuries sit relative to faction names?
  console.log("[locator] correlating known integers near known strings…");
  const probes = defaultProbes(oracle.parsed.ds);
  const corr = correlate({ oracle, probes, buf: save.buf, window: 2048 });
  const strongest = corr.filter(c => c.cluster && c.cluster.totalPairs <= 30 && c.cluster.totalPairs > 0)
    .sort((a, b) => a.cluster.totalPairs - b.cluster.totalPairs).slice(0, 12);
  console.log(`  ${corr.length} probes; ${strongest.length} look high-signal (≤30 hits):`);
  for (const s of strongest) {
    const c = s.cluster;
    console.log(`    ${s.label.padEnd(30)} value=${String(s.value).padStart(7)}  pairs=${c.totalPairs}  topΔ=${c.topDelta} (${c.topCount}×)`);
  }

  const base = path.basename(savePath, path.extname(savePath));
  const htmlPath = path.join(args.out, `${base}.html`);
  const jsonPath = path.join(args.out, `${base}.json`);

  console.log(`[report] writing ${htmlPath}`);
  renderReport({ savePath, save, oracle, header, diffRuns, diffSummary, otherPath }, htmlPath);

  console.log(`[json]   writing ${jsonPath}`);
  // Strip the buffer from save before serializing
  const jsonOut = {
    save: { path: savePath, size: save.size },
    header,
    oracle: { sources: oracle.sources, ints: oracle.ints,
      tokensCount: totalTokens, totalHits,
      tokensTop: top.map(t => ({ token: t.token, kinds: t.kinds, hits: t.hits.slice(0, 8), totalHits: t.hits.length })),
    },
    diff: diffSummary,
    diffRuns: diffRuns ? diffRuns.slice(0, 500) : null,
    smartDiff: smartDiffSummary,
    smartDiffRuns: smartDiff ? smartDiff.runs.slice(0, 500) : null,
    smartDiffAnchors: smartDiff ? smartDiff.anchors.slice(0, 200) : null,
    fieldCorrelations: corr.filter(c => c.cluster).map(c => ({ label: c.label, value: c.value, cluster: c.cluster, pairs: c.pairs.slice(0, 12) })),
    sections: { count: selfPtrs.length, top: treeSummary },
    headerStrings: hstRuns.slice(0, 3).map(r => ({ start: r.start, count: r.entries.length, entries: r.entries.map(e => ({ offset: e.offset, name: e.name, version: e.version })) })),
  };
  fs.writeFileSync(jsonPath, JSON.stringify(jsonOut, null, 2));

  console.log("[done]");
}

main().catch(e => { console.error(e); process.exit(1); });
