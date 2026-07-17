// ── Icon warm-pass scheduler (2026-07-17) ──────────────────────────────────
// The ONE chunk runner behind every icon warm-up pass (building icons, unit
// cards, live-save top-up, commander portraits) plus the tuning knobs that
// were previously scattered across App.js. Consolidated so the pacing rules
// live in one place instead of comments spread over four effects.
//
// HARD-WON INVARIANTS — read before touching (each one was a shipped
// regression at some point):
//
// 1. NEVER bump iconCacheVersion per chunk. A bump is a full App re-render;
//    a train of them was the 1.5–5s post-reveal main-thread stall storm in
//    v0.9.1277's logs (fixed in 0.9.1278), and per-icon bumps were the
//    v0.9.1270 freeze family. This runner therefore has NO built-in version
//    bump — callers bump exactly once at their boundaries: uncoalesced at the
//    splash reveal, coalesced (150ms) at background-pass completion, or not
//    at all (portraits rely on hover-driven re-render).
//
// 2. Splash-gating passes are SUPERSEDED, not cancelled, on effect re-runs.
//    Their effects depend on inputs that churn during load (coloredOffscreen
//    recolorizes several times); a normal cancel-on-cleanup killed the
//    in-flight warm-up on each churn and the warmKey guard then refused to
//    restart it — it wedged after ~1 chunk (2026-07-15). Pattern: keep the
//    run handle on a ref, cancel the PRIOR run only when a genuinely new run
//    starts. Post-reveal passes (live top-up, portraits) may use normal
//    cancel-on-cleanup.
//
// 3. gapMs = 0 engages a depth-2 pipeline: chunk i+1's IPC fetch starts
//    BEFORE chunk i is awaited, so the decode worker pool never sits idle
//    between chunks (chunks are disjoint; the bulk prefetchers dedupe
//    in-flight work). gapMs > 0 is strictly serial with a pause after every
//    chunk — for post-reveal passes that must not crowd out interaction.
//
// 4. Splash passes warm ONLY what is visible at reveal (on-map armies,
//    settlement icons); supersets warm post-reveal in the background. Holding
//    the splash for a superset was the 105s launch of v0.9.1277.

export const WARM_TUNING = {
  // Bulk chunk size for the building-icon and unit-card passes — one IPC
  // round-trip per chunk, sized for the widened decode pool (2026-07-16).
  BULK_CHUNK: 128,
  // Live-save top-up pass: smaller chunks + a gap — the UI is live.
  LIVE_CHUNK: 96,
  LIVE_GAP_MS: 50,
  // Portrait prewarm: each item is an IPC + a SYNCHRONOUS DDS decode on the
  // renderer main thread, so strictly one at a time with a minimal yield
  // (was 15ms; 5ms since 0.9.1280 — zero pop-in ASAP).
  PORTRAIT_GAP_MS: 5,
  // Recruit-superset size guard. Effectively uncapped since 0.9.1283 — the
  // per-file blob dedupe made 100k-pair supersets cheap. Kept as a runaway
  // backstop; if a log ever reports this cap hit, raise it rather than let
  // cards silently stay cold (the 0.9.1281 AOR lesson).
  RECRUIT_WARM_CAP: 100000,
  // Unit warm-up: how long to wait for army/region data before releasing the
  // splash anyway — prevents a splash deadlock when EDU/army data never
  // lands (web build, broken mod).
  UNIT_DATA_GRACE_MS: 8000,
};

// Run `list` through `fetchChunk` in chunks. Returns the number of items
// completed (equals list.length unless cancelled). See invariants 1 and 3
// above for the bump policy and the two pacing modes.
export async function runWarmChunks(list, { chunkSize, gapMs, fetchChunk, isCancelled = () => false, label = "" }) {
  const chunks = [];
  for (let i = 0; i < list.length; i += chunkSize) chunks.push(list.slice(i, i + chunkSize));
  let done = 0;
  let inFlight = chunks.length ? fetchChunk(chunks[0]) : null;
  for (let i = 0; i < chunks.length && !isCancelled(); i++) {
    // Depth-2 pipeline (gapMs=0): start chunk i+1's fetch BEFORE awaiting
    // chunk i. Serial mode (gapMs>0): next chunk starts only after the gap.
    const next = (!gapMs && i + 1 < chunks.length) ? fetchChunk(chunks[i + 1]) : null;
    await inFlight;
    done += chunks[i].length;
    if (gapMs) {
      await new Promise((r) => setTimeout(r, gapMs));
      inFlight = (i + 1 < chunks.length) ? fetchChunk(chunks[i + 1]) : null;
    } else {
      await new Promise((r) => setTimeout(r, 0)); // yield the event loop between awaits
      inFlight = next;
    }
  }
  return done;
}
