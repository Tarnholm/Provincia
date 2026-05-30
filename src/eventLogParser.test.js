import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseEventLog, diffTurn, EVENT_CLASS } from "./eventLogParser.js";

const SAVE = path.join("bundled-mod", "saves", "sample.sav");

describe("parseEventLog", () => {
  test("parses end-of-turn event records from the bundled save", () => {
    if (!fs.existsSync(SAVE)) return; // skip if asset absent
    const ev = parseEventLog(fs.readFileSync(SAVE));
    expect(ev.length).toBeGreaterThan(10);
    // every record has a known event type and a subject string
    for (const e of ev) {
      expect(typeof e.subject).toBe("string");
      expect(e.subject.length).toBeGreaterThan(0);
      expect(typeof e.factionId).toBe("number");
    }
    // the bundled save's events are all recognized classes (no class_NN)
    const known = ev.filter((e) => Object.values(EVENT_CLASS).includes(e.type)).length;
    expect(known).toBe(ev.length);
  });

  test("diffTurn returns only events new in the after-set", () => {
    if (!fs.existsSync(SAVE)) return;
    const all = parseEventLog(fs.readFileSync(SAVE));
    const before = all.slice(0, Math.floor(all.length / 2));
    const fresh = diffTurn(before, all);
    expect(fresh.length).toBe(all.length - before.length);
  });
});
