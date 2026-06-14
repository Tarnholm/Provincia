import { describe, test, expect } from "vitest";
import { parseCorrReadings, computeCorrCalibration } from "./corrCalib.js";

describe("corrCalib — parse + match", () => {
  test("parses 'Name value' lines, sign-agnostic", () => {
    const { readings, skipped } = parseCorrReadings("Metapontum 364\nThurii -334\nCroton 271");
    expect(readings).toHaveLength(3);
    expect(readings[0]).toMatchObject({ name: "Metapontum", corr: 364 });
    expect(readings[1].corr).toBe(334); // "-334" → 334 (sign ignored)
    expect(skipped).toHaveLength(0);
  });

  test("multi-word names and tabs", () => {
    const { readings } = parseCorrReadings("Epizephyrian Locri\t219\nSena Gallica 54");
    expect(readings[0]).toMatchObject({ name: "Epizephyrian Locri", corr: 219 });
    expect(readings[1]).toMatchObject({ name: "Sena Gallica", corr: 54 });
  });

  test("skips junk / comment / nameless lines", () => {
    const { readings, skipped } = parseCorrReadings("# header\n364\nMetapontum 364");
    expect(readings).toHaveLength(1);
    expect(skipped).toContain("364"); // number with no name before it
  });

  test("computeCorrCalibration matches settlements and keys by exact name", () => {
    const settlements = [{ settlement: "Metapontum" }, { settlement: "Thurii" }, { settlement: "Rome" }];
    const res = computeCorrCalibration("Metapontum 364\nThurii 334\nNowhere 99", settlements);
    expect(res.byCity.Metapontum).toEqual({ corr: 364 });
    expect(res.byCity.Thurii).toEqual({ corr: 334 });
    expect(res.unmatched).toEqual(["Nowhere 99"]);
  });
});
