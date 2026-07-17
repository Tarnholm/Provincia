// Locks down the warm-scheduler's pacing semantics — the depth-2 pipeline and
// serial-with-gap modes are launch-perf-critical (see the invariants in
// iconWarmScheduler.js). If these fail after a change, the change altered
// warm-up behavior, not just its packaging.
import { describe, it, expect } from "vitest";
import { runWarmChunks, WARM_TUNING } from "./iconWarmScheduler.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("runWarmChunks", () => {
  it("gapMs=0 pipelines depth-2: chunk i+1's fetch starts before chunk i resolves", async () => {
    const events = [];
    const resolvers = [];
    const fetchChunk = (c) => {
      events.push(`start:${c[0]}`);
      return new Promise((res) => resolvers.push(() => { events.push(`end:${c[0]}`); res(); }));
    };
    const p = runWarmChunks([1, 2, 3], { chunkSize: 1, gapMs: 0, fetchChunk });
    await tick();
    // chunk 0 started at call time; chunk 1's fetch must have started while
    // chunk 0 is still unresolved (the depth-2 pipeline).
    expect(events).toEqual(["start:1", "start:2"]);
    resolvers[0](); await tick(); await tick();
    expect(events).toContain("start:3");
    resolvers[1](); resolvers[2]();
    await tick(); await tick();
    expect(await p).toBe(3);
  });

  it("gapMs>0 is strictly serial: next fetch starts only after the prior chunk + gap", async () => {
    const events = [];
    const fetchChunk = async (c) => { events.push(`start:${c[0]}`); await tick(); events.push(`end:${c[0]}`); };
    const done = await runWarmChunks([1, 2], { chunkSize: 1, gapMs: 1, fetchChunk });
    expect(done).toBe(2);
    expect(events).toEqual(["start:1", "end:1", "start:2", "end:2"]);
  });

  it("stops at the next chunk boundary when cancelled", async () => {
    let cancelled = false;
    let calls = 0;
    // Cancel DURING chunk 1's await. Cancellation is checked at each loop
    // top, so chunks 0–1 count, chunk 2's fetch pre-starts (it is queued
    // right after the gap, before the next check — same semantics as the
    // original runners), and chunks 3–4 never start.
    const fetchChunk = async () => { calls += 1; await tick(); if (calls === 2) cancelled = true; };
    const done = await runWarmChunks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { chunkSize: 2, gapMs: 5, fetchChunk, isCancelled: () => cancelled });
    expect(done).toBe(4);   // chunks 0 and 1 counted; the cancel then stopped the loop
    expect(calls).toBe(3);  // chunk 2 had pre-started; chunks 3-4 never did
  });

  it("chunks the list by chunkSize and returns the completed count", async () => {
    const sizes = [];
    const done = await runWarmChunks([1, 2, 3, 4, 5], { chunkSize: 2, gapMs: 0, fetchChunk: async (c) => { sizes.push(c.length); } });
    expect(done).toBe(5);
    expect(sizes).toEqual([2, 2, 1]);
  });

  it("exposes the tuning knobs the passes rely on", () => {
    expect(WARM_TUNING.BULK_CHUNK).toBe(128);
    expect(WARM_TUNING.LIVE_CHUNK).toBe(96);
    expect(WARM_TUNING.LIVE_GAP_MS).toBe(50);
    expect(WARM_TUNING.PORTRAIT_GAP_MS).toBe(5);
    expect(WARM_TUNING.RECRUIT_WARM_CAP).toBe(100000);
    expect(WARM_TUNING.UNIT_DATA_GRACE_MS).toBe(8000);
  });
});
