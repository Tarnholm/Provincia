// map.rwm creator re-sync (src/rwmCreators.js), a port of RIS's rwm_creators.py.
// Verified against the Python tool on RIS 2026-10-10: 0 changes on a synced map,
// and a byte-identical patch (1,220 ids) after a faction is cloned after parni.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { planRwmCreators, parseRegions } = require("./rwmCreators.js");
const { safeWriteModFiles } = require("./safeModWrite.js");

const NL = String.fromCharCode(10);
const SM = ['\t"romans":', "\t{", "\t},", '\t"gauls":', "\t{", "\t},", '\t"slave":', "\t{", "\t},"].join(NL);
const REGIONS = [
  "Latium", "Roma", "romans", "rebels_x", "10 20 30", "hidden_a", "5", "",
  "Gallia ; a comment", "Lutetia", "gauls", "rebels_y", "40 50 60", "hidden_b", "5",
].join(NL);

// a region-name record, then the creator field 20 bytes before the region colour (B,G,R)
function record(name, creator, rgb) {
  const nm = Buffer.from(name, "latin1");
  const head = Buffer.alloc(2); head.writeUInt16LE(nm.length + 1);
  const field = Buffer.alloc(20); field.writeUInt32LE(creator, 0);
  return Buffer.concat([head, nm, Buffer.from([0]), Buffer.alloc(8), field, Buffer.from([rgb[2], rgb[1], rgb[0]]), Buffer.alloc(9)]);
}
const raw = (...rgbs) => Buffer.from(rgbs.flatMap(([r, g, b]) => [b, g, r]));
const SEA = [0, 0, 200];
const rwm = (latium, gallia, sea) => Buffer.concat([Buffer.alloc(16), record("Latium", latium, [10, 20, 30]), record("Gallia", gallia, [40, 50, 60]), record("the sea", sea, SEA)]);
const map = raw([10, 20, 30], [40, 50, 60], SEA, [0, 0, 0], [255, 255, 255], [10, 20, 30]);

describe("planRwmCreators", () => {
  it("reads descr_regions' 7-line records, comments stripped", () => {
    expect(parseRegions(REGIONS)).toEqual([
      { region: "Latium", creator: "romans", rgb: [10, 20, 30] },
      { region: "Gallia", creator: "gauls", rgb: [40, 50, 60] },
    ]);
  });

  it("changes nothing on a map that matches the faction list", () => {
    const r = planRwmCreators({ rwm: rwm(0, 1, 3), smFactions: SM, descrRegions: REGIONS, regionsRaw: map });
    expect(r).toMatchObject({ ok: true, factions: 3, land: 2, seas: 1, changes: [], buffer: null });
  });

  it("follows a faction inserted mid-list: later indexes shift and the sea's no-faction count grows", () => {
    const sm = SM.replace('\t"gauls":', ['\t"etruscans":', "\t{", "\t},", '\t"gauls":'].join(NL));
    const before = rwm(0, 1, 3);
    const r = planRwmCreators({ rwm: before, smFactions: sm, descrRegions: REGIONS, regionsRaw: map });
    expect(r.ok).toBe(true);
    expect(r.changes.map((c) => [c.region, c.from, c.to])).toEqual([["Gallia", 1, 2], ["sea (0, 0, 200)", 3, 4]]);
    expect(before.readUInt32LE(r.changes[0].offset)).toBe(1); // the input is not modified
    expect(r.buffer.readUInt32LE(r.changes[0].offset)).toBe(2);
    expect(r.buffer.length).toBe(before.length);
    const diff = [...r.buffer].filter((b, i) => b !== before[i]).length;
    expect(diff).toBe(2); // one byte per changed id here; nothing else moves
  });

  it("refuses to patch anything when a creator is not a faction", () => {
    const r = planRwmCreators({ rwm: rwm(0, 1, 3), smFactions: SM.replace('"gauls"', '"galli"'), descrRegions: REGIONS, regionsRaw: map });
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/Gallia: creator 'gauls'/);
    expect(r.buffer).toBe(null);
  });

  it("a colour seen twice is settled by the region-name record before it", () => {
    const twice = Buffer.concat([rwm(0, 1, 3), record("Latium", 7, [40, 50, 60])]);
    const r = planRwmCreators({ rwm: twice, smFactions: SM, descrRegions: REGIONS, regionsRaw: map });
    expect(r.ok).toBe(true);
    expect(r.changes).toEqual([]); // the Gallia field is the one after "Gallia", not the stray after "Latium"
  });

  it("the batch writer takes the patched map as raw bytes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rwm-"));
    const p = path.join(dir, "map.rwm");
    fs.writeFileSync(p, rwm(0, 1, 3));
    const sm = SM.replace('\t"gauls":', ['\t"etruscans":', "\t{", "\t},", '\t"gauls":'].join(NL));
    const r = planRwmCreators({ rwm: fs.readFileSync(p), smFactions: sm, descrRegions: REGIONS, regionsRaw: map });
    safeWriteModFiles([{ livePath: p, data: r.buffer, encoding: undefined }], { backup: false });
    expect(fs.readFileSync(p).equals(r.buffer)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
