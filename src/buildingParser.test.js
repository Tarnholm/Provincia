import { describe, test, expect } from "vitest";
import { findAllSettlementMarkers } from "./buildingParser.js";

// Build a settlement marker: [flag][nchars][00][UTF-16 name][u32 term].
function marker(name, flag, term) {
  const b = Buffer.alloc(3 + name.length * 2 + 4);
  b[0] = flag;
  b[1] = name.length;
  b[2] = 0;
  for (let i = 0; i < name.length; i++) b[3 + i * 2] = name.charCodeAt(i);
  b.writeUInt32LE(term >>> 0, 3 + name.length * 2);
  return b;
}

describe("findAllSettlementMarkers — terminator variants (2026-05-31)", () => {
  test("recovers markers whose terminator u32 is a small non-zero count", () => {
    // Pad between markers so adjacent ones don't share/overlap bytes.
    const pad = Buffer.alloc(40);
    const buf = Buffer.concat([
      pad,
      marker("Arretium", 0x01, 0), // variant A (term=0) — always parsed
      pad,
      marker("Roma", 0x01, 2),     // term=2 — DROPPED by the old `00 00` check
      pad,
      marker("Athens", 0x01, 3),   // term=3
      pad,
      marker("Syracuse", 0x00, 4), // term=4, flag=0
      pad,
    ]);
    const names = new Set(findAllSettlementMarkers(buf).map((m) => m.name));
    expect(names.has("Arretium")).toBe(true);
    expect(names.has("Roma")).toBe(true);
    expect(names.has("Athens")).toBe(true);
    expect(names.has("Syracuse")).toBe(true);
  });

  test("rejects markers whose terminator u32 exceeds the small-count cap", () => {
    const pad = Buffer.alloc(40);
    // term=5000 is not a plausible settlement-count terminator — must be ignored
    // so unrelated byte sequences that look name-like aren't admitted as noise.
    const buf = Buffer.concat([pad, marker("Bogusville", 0x01, 5000), pad]);
    const names = findAllSettlementMarkers(buf).map((m) => m.name);
    expect(names).not.toContain("Bogusville");
  });
});
