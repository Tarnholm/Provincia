// @vitest-environment node
//
// Whether the save's family roster may be counted.
//
// It looks authoritative — on the reference save, 2,846 records, every one named, 99%
// with a plausible age, no duplicate uuids — and it is nonetheless a partial view. Only
// 15% of its own father references and 11% of its spouse references resolve inside it.
// The shortfall is not uniform: the missing members are mostly male, so the survivors
// read 19% male and yield 48 "alive adult males" map-wide against 848 settlements that
// demonstrably have a governor.
//
// The gender DECODE is fine, and that was established before any of this was believed.
// These tests keep the two apart, because conflating them would send a future reader to
// rewrite a bit-flag that is already correct.
import { describe, it, expect } from "vitest";
import { familyIntegrity } from "./familyIntegrity.js";

// A complete little tree: father + mother married, one child.
const COMPLETE = [
  { uuid: 1, gender: "male", firstName: "Pater", spouseUuid: 2, childUuids: [3] },
  { uuid: 2, gender: "female", firstName: "Mater", spouseUuid: 1, childUuids: [3] },
  { uuid: 3, gender: "male", firstName: "Filius", fatherUuid: 1 },
];

describe("familyIntegrity", () => {
  it("passes a roster whose own references resolve", () => {
    const r = familyIntegrity({ family: COMPLETE });
    expect(r.fatherResolution).toBe(1);
    expect(r.spouseResolution).toBe(1);
    expect(r.usableAsRoster).toBe(true);
    expect(r.note).toMatch(/may be counted/);
  });

  it("rejects a roster that references members it does not contain", () => {
    // The reference save's shape: most fathers and spouses point outside the array.
    const partial = [
      { uuid: 10, gender: "female", firstName: "A", fatherUuid: 900, spouseUuid: 901 },
      { uuid: 11, gender: "female", firstName: "B", fatherUuid: 902, spouseUuid: 903 },
      { uuid: 12, gender: "female", firstName: "C", fatherUuid: 904, spouseUuid: 905 },
      { uuid: 13, gender: "male", firstName: "D", fatherUuid: 12 },
    ];
    const r = familyIntegrity({ family: partial });
    expect(r.usableAsRoster).toBe(false);
    expect(r.missingFathers).toBe(3);
    expect(r.note).toMatch(/INCOMPLETE ROSTER/);
    // The note must warn about the SKEW, not just the shortfall: a uniform undercount
    // would still give correct ratios, and this one does not.
    expect(r.note).toMatch(/not uniform/);
    expect(r.note).toMatch(/Do not use this as a roster/);
  });

  it("locates the missing members in the other character list", () => {
    // 62% of the reference save's absent fathers are in characters.v1, which is what
    // shows the two lists are partial views of one roster rather than one being broken.
    const partial = [{ uuid: 10, gender: "female", firstName: "A", fatherUuid: 900 }];
    const r = familyIntegrity({ family: partial, v1: [{ primaryUuid: 900 }] });
    expect(r.missingFathers).toBe(1);
    expect(r.missingFoundInV1).toBe(1);
    expect(r.note).toMatch(/characters\.v1/);
  });

  it("reports the gender-decode checks separately from coverage", () => {
    // These two are what proved the bit-flag correct: fatherhood and marriage come from
    // different fields than the gender bit, so they could have disagreed and did not.
    // Kept apart so "the data is wrong" never gets read as "the decode is wrong".
    const r = familyIntegrity({ family: COMPLETE });
    expect(r.genderDecodeChecks.fathersMaleShare).toBe(1);
    expect(r.genderDecodeChecks.spousesOppositeShare).toBe(1);
  });

  it("catches a genuinely inverted gender bit", () => {
    // If the bit were wrong, fathers would read female. The check must fail here, or it
    // is not testing anything — a guard that cannot fire is worse than none.
    const inverted = [
      { uuid: 1, gender: "female", firstName: "Pater", spouseUuid: 2, childUuids: [3] },
      { uuid: 2, gender: "female", firstName: "Mater", spouseUuid: 1 },
      { uuid: 3, gender: "male", firstName: "Filius", fatherUuid: 1 },
    ];
    const r = familyIntegrity({ family: inverted });
    expect(r.genderDecodeChecks.fathersMaleShare).toBe(0);      // father reads female
    expect(r.genderDecodeChecks.spousesOppositeShare).toBe(0);  // same-sex "marriage"
  });

  it("says nothing without records", () => {
    expect(familyIntegrity({ family: [] })).toBeNull();
    expect(familyIntegrity({})).toBeNull();
  });
});
