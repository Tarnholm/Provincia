import { describe, test, expect } from "vitest";

// Regression for the 0.9.774 live-commander-faction fix (main.js
// parseCharactersAndUnits faction-tag pass). The player faction's own
// character block is written near the TOP of the save — BEFORE the first
// `captain_card_<faction>.tga` marker appears. Verified on RIS Republic-of-
// Rome T1: Quintus (leader) / Marcus / Servius at offset ~22,619,662 vs the
// first marker (itself romans_julii) at 22,627,784. The preceding-marker
// lookup returns null for them, so they came out faction=null → no culture →
// portrait fell back to the bodyguard unit icon.
//
// These mirror the two binary-search helpers in main.js. They are pure, so we
// pin their semantics here; the end-to-end assertion (real save → faction +
// culture for Quintus/Marcus/Servius) lives in
// scripts/probe-live-commander-faction.js (needs a local .sav + RIS mod).

function factionAtOffset(markers, off) {
  let lo = 0, hi = markers.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (markers[mid].pos <= off) lo = mid + 1; else hi = mid;
  }
  return lo > 0 ? markers[lo - 1].faction : null;
}
function factionAtOrAfterOffset(markers, off) {
  let lo = 0, hi = markers.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (markers[mid].pos < off) lo = mid + 1; else hi = mid;
  }
  return lo < markers.length ? markers[lo].faction : null;
}

// Order-preserving tag resolver matching main.js: preceding marker first,
// then nearest following marker as a fallback (only when preceding misses).
function resolveFaction(markers, off) {
  return factionAtOffset(markers, off) ?? factionAtOrAfterOffset(markers, off);
}

describe("commander faction tagging — captain_card marker resolution", () => {
  // Real RIS Rome T1 layout: first three markers are all romans_julii; the
  // player faction's char records sit just before the first one.
  const markers = [
    { pos: 22627784, faction: "romans_julii" },
    { pos: 22634184, faction: "romans_julii" },
    { pos: 22641238, faction: "romans_julii" },
    { pos: 23000000, faction: "romans_scipii" },
    { pos: 24000000, faction: "carthage" },
  ];

  test("char AFTER a marker → that marker's faction (unchanged behavior)", () => {
    expect(resolveFaction(markers, 22634500)).toBe("romans_julii");
    expect(resolveFaction(markers, 23500000)).toBe("romans_scipii");
    expect(resolveFaction(markers, 99999999)).toBe("carthage");
  });

  test("player char BEFORE the first marker → nearest FOLLOWING marker (the fix)", () => {
    // Quintus / Marcus / Servius offsets (~22,619,662) precede marker[0].
    expect(factionAtOffset(markers, 22619662)).toBeNull(); // old path missed
    expect(resolveFaction(markers, 22619662)).toBe("romans_julii"); // fixed
    expect(resolveFaction(markers, 22620316)).toBe("romans_julii");
    expect(resolveFaction(markers, 22620922)).toBe("romans_julii");
  });

  test("exactly on a marker boundary attributes to that marker", () => {
    expect(resolveFaction(markers, 22627784)).toBe("romans_julii");
  });

  test("no markers at all → null (no fabricated faction)", () => {
    expect(resolveFaction([], 123)).toBeNull();
  });
});
