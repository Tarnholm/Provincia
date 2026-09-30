#!/usr/bin/env node
// Build the wiki once per campaign variant (asked for 2026-09-30): Four Romans, RIS Light and
// RIS Classic. Each is the full generator run (gen-ris-wiki-all.js) with lib/risOverlay.js
// loaded, so every generator reads the submod's files where it has them and the base mod's
// otherwise, written to its own folder. build-ris-wiki-site.js then publishes, per variant,
// only the pages that differ from the main campaign's.
//
//   node scripts/gen-ris-wiki-variants.js [--only 4r,light,classic]
const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const VARIANTS = require("./lib/risVariants.js").VARIANTS;
const only = (() => { const i = process.argv.indexOf("--only"); return i >= 0 ? process.argv[i + 1].split(",") : null; })();

const failed = [];
for (const v of VARIANTS.filter((x) => !only || only.includes(x.id))) {
  if (!fs.existsSync(v.data)) { console.log(`${v.id}: ${v.data} not found, skipped`); continue; }
  fs.mkdirSync(v.out, { recursive: true });
  // The hand-made art (logo, rule) is not generated; the variant pages use the main site's.
  console.log(`\n== ${v.name} (${v.id}) -> ${v.out}`);
  const env = {
    ...process.env,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --require "${path.join(__dirname, "lib", "risOverlay.js").replace(/\\/g, "/")}"`.trim(),
    RIS_BASE_DATA: "C:/RIS/RIS/data",
    RIS_OVERLAY_DATA: v.data,
    RIS_CAMPAIGN: v.campaign || "",
    RIS_VARIANT: v.id,
    RIS_WIKI_OUT: v.out,
  };
  if (!v.campaign) delete env.RIS_CAMPAIGN;
  // The generators read each other's output from the run before (culture and trade-good
  // indexes, unit cards, tag names): a new folder has none, so its first run is only a primer
  // and the second is the real one. The main wiki always has a previous run to lean on.
  const passes = fs.existsSync(path.join(v.out, "README.md")) ? 1 : 2;
  for (let pass = 1; pass <= passes; pass++) {
    if (passes > 1) console.log(`-- pass ${pass} of ${passes}`);
    try {
      execFileSync(process.execPath, [path.join(__dirname, "gen-ris-wiki-all.js")], { env, stdio: "inherit" });
    } catch (e) {
      if (pass === passes) failed.push(v.id);
    }
  }
}
if (failed.length) { console.log(`\nFAILED: ${failed.join(", ")}`); process.exitCode = 1; }
