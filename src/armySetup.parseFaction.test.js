// parseFaction feeds recruitPool — two silent failures lived at this seam:
//   • the region was matched with \w+, cutting RIS's 133 hyphenated regions at
//     the hyphen (the hidden-resource lookup then missed);
//   • buildings were pushed as the LEVEL alone, while recruitPool gates every
//     recruit line on the settlement owning the building CLASS — so every
//     settlement's pool was empty (measured on RIS: Roma 0 units → 8).
// Synthetic mod, padded deeper than findRelatedModDirs' 5-level walk.
import { describe, it, expect, afterAll } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const as = require("./armySetup.js");
const recruitPool = require("./recruitPool.js");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "armysetup-pf-"));
const data = path.join(root, "a", "b", "c", "d", "e", "mod", "data");
const camp = path.join(data, "world", "maps", "campaign", "imperial_campaign");
const base = path.join(data, "world", "maps", "base");
fs.mkdirSync(camp, { recursive: true });
fs.mkdirSync(base, { recursive: true });
fs.writeFileSync(path.join(camp, "descr_strat.txt"), [
  "faction\tcarthage, balanced smith",
  "denari\t5000",
  "settlement",
  "{",
  "\tlevel large_town",
  "\tregion Qart-Khadasht",
  "\tpopulation 4000",
  "\tbuilding",
  "\t{",
  "\t\ttype barracks militia_barracks",
  "\t}",
  "\tbuilding",
  "\t{",
  "\t\ttype granary granary+1",
  "\t}",
  "}",
  "faction\tslave, balanced smith",
  "",
].join("\r\n"), "latin1");
fs.writeFileSync(path.join(data, "export_descr_buildings.txt"), [
  "building barracks",
  "{",
  "    levels militia_barracks",
  "    {",
  "        militia_barracks requires factions { carthage, }",
  "        {",
  "            capability",
  "            {",
  "                recruit \"test spearmen\"  0  requires factions { carthage, }",
  "                recruit \"test aor unit\"  0  requires factions { carthage, } and hidden_resource aor_test",
  "            }",
  "        }",
  "    }",
  "}",
  "building stables",
  "{",
  "    levels stables",
  "    {",
  "        stables requires factions { carthage, }",
  "        {",
  "            capability",
  "            {",
  "                recruit \"test cavalry\"  0  requires factions { carthage, }",
  "            }",
  "        }",
  "    }",
  "}",
  "",
].join("\r\n"), "latin1");
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("armySetup.parseFaction", () => {
  const f = as.parseFaction(data, "carthage");

  it("reads a hyphenated region whole", () => {
    expect(f.settlements.map((s) => s.region)).toEqual(["Qart-Khadasht"]);
  });

  it("keeps each building's CLASS with its level (levels like granary+1 intact)", () => {
    expect(f.settlements[0].buildings).toEqual(["barracks militia_barracks", "granary granary+1"]);
  });

  it("so the recruit pool sees the owned classes: barracks units in, stables units out", () => {
    const s = f.settlements[0];
    const cache = { regions: { "Qart-Khadasht": new Set(["aor_test"]) }, unitStats: {} };
    const pool = recruitPool.poolForSettlement(data, "carthage", s.buildings, s.region, cache).map((u) => u.unit).sort();
    expect(pool).toEqual(["test aor unit", "test spearmen"]);
    // the truncated name the old \w+ produced finds no hidden resources
    const cut = recruitPool.poolForSettlement(data, "carthage", s.buildings, "Qart", cache).map((u) => u.unit);
    expect(cut).toEqual(["test spearmen"]);
  });
});
