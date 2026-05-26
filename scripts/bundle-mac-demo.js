// Assemble bundled-mod/ — the RIS subset + a sample save that the "Mac"
// dev-pill button loads when there's no game install on the machine.
//
// Sources: the modder's working copy at C:\RIS\RIS and one save from
// %USERPROFILE%\Downloads (their saves folder is empty on this box, so we
// fall back to the test-saves they keep in Downloads).
//
// Output: bundled-mod/{data/...,saves/sample.sav}  (gitignored; rebuild via
// `npm run bundle-mac-demo`). electron-builder copies it to
// resources/bundled-mod via the extraResources entry in package.json.
//
// On non-Windows boxes (e.g. CI building Mac) the RIS source path won't
// exist; the script then silently skips and the Mac button just won't have
// data to load. That's preferable to failing the build.

const fs = require("fs");
const path = require("path");

const RIS_DATA = "C:\\RIS\\RIS\\data";
const DOWNLOADS = path.join(process.env.USERPROFILE || "", "Downloads");
const OUT = path.join(__dirname, "..", "bundled-mod");
const OUT_DATA = path.join(OUT, "data");
const OUT_SAVES = path.join(OUT, "saves");

// Files Provincia actually reads from a mod (subset; UI .tga icons are
// skipped to keep the bundle ~60MB instead of hundreds).
const MOD_FILES = [
  "export_descr_buildings.txt",
  "descr_sm_factions.txt",
  "export_descr_character_traits.txt",
  "export_descr_ancillaries.txt",
  "descr_names_lookup.txt",
  "text/export_buildings.txt",
  "text/imperial_campaign_regions_and_settlement_names.txt",
  "world/maps/base/descr_regions.txt",
  "world/maps/base/map_regions.tga",
  "world/maps/campaign/imperial_campaign/descr_strat.txt",
  "world/maps/campaign/imperial_campaign/descr_win_conditions.txt",
];

// Pick the smallest .sav in Downloads (the user has a few RIS test saves
// stashed there). Smallest = lightest installer bump.
function pickSampleSave() {
  if (!fs.existsSync(DOWNLOADS)) return null;
  const saves = fs.readdirSync(DOWNLOADS)
    .filter(f => /\.sav$/i.test(f))
    .map(f => ({ name: f, full: path.join(DOWNLOADS, f), size: fs.statSync(path.join(DOWNLOADS, f)).size }))
    .sort((a, b) => a.size - b.size);
  return saves[0] || null;
}

function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function main() {
  if (!fs.existsSync(RIS_DATA)) {
    console.log(`[bundle-mac-demo] ${RIS_DATA} not found — skipping (probably CI).`);
    return;
  }
  // Wipe any stale bundle so removed files don't linger across runs.
  if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT_DATA, { recursive: true });
  fs.mkdirSync(OUT_SAVES, { recursive: true });

  let total = 0;
  for (const rel of MOD_FILES) {
    const src = path.join(RIS_DATA, rel.replace(/\//g, path.sep));
    if (!fs.existsSync(src)) { console.warn(`[bundle-mac-demo] missing: ${rel}`); continue; }
    const dest = path.join(OUT_DATA, rel.replace(/\//g, path.sep));
    copy(src, dest);
    const sz = fs.statSync(dest).size; total += sz;
    console.log(`  ${(sz / 1024).toFixed(0).padStart(7)} KB  ${rel}`);
  }
  const sav = pickSampleSave();
  if (sav) {
    const dest = path.join(OUT_SAVES, "sample.sav");
    copy(sav.full, dest);
    total += sav.size;
    console.log(`  ${(sav.size / 1024).toFixed(0).padStart(7)} KB  saves/sample.sav  (from: ${sav.name})`);
  } else {
    console.warn("[bundle-mac-demo] no .sav found in Downloads — Mac button will load mod only.");
  }
  console.log(`[bundle-mac-demo] wrote ${OUT}  (${(total / (1024 * 1024)).toFixed(1)} MB)`);
}

main();
