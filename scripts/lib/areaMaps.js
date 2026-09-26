/**
 * Maps of a SET of regions (a unit's area of recruitment, a mercenary pool, a recruitment
 * zone), drawn by lib/regionMaps.py in the region-page style: the regions shaded and outlined
 * in red, their settlements named, the rest of the map for context.
 *
 *   const areas = areaMaps(OUT, "area-maps");
 *   md += areas.add(["Achaia", ...], "Where X can be recruited", "../");   // markdown image
 *   ...
 *   areas.render();                                                         // at the end
 *
 * One picture per distinct region set, named by its hash, so units that share an area share
 * the file. The regions come from the list gen-ris-region-pages.js saves on every run (it
 * runs first in wiki:gen), so these maps name, colour and place everything as the region maps
 * do. Each caller gets its OWN folder: render() deletes files it did not ask for, and two
 * callers sharing one folder would delete each other's maps.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const SPEC = path.join(os.tmpdir(), "ris-region-maps.json");

function areaMaps(OUT, dirName) {
  const outDir = path.join(OUT, dirName);
  const areas = new Map();   // file -> sorted region list
  const known = new Set(fs.existsSync(path.join(OUT, "regions"))
    ? fs.readdirSync(path.join(OUT, "regions")).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)) : []);

  function add(regions, alt, rel = "../") {
    const list = [...new Set(regions)].filter((r) => known.has(r)).sort();
    if (!list.length) return "";
    const file = "area-" + crypto.createHash("sha1").update(list.join(",")).digest("hex").slice(0, 12);
    areas.set(file, list);
    return `![${String(alt).replace(/[[\]]/g, "")}](${rel}${dirName}/${file}.webp)`;
  }

  function render() {
    if (!areas.size) return 0;
    if (!fs.existsSync(SPEC)) {
      console.error(`${dirName}: ${SPEC} is missing - run gen-ris-region-pages.js first`);
      process.exitCode = 2;
      return 0;
    }
    const spec = JSON.parse(fs.readFileSync(SPEC, "utf8"));
    spec.areas = [...areas].map(([file, regions]) => ({ file, regions }));
    spec.areas_out = outDir;
    spec.areas_only = true;
    const sig = crypto.createHash("sha1").update(JSON.stringify(spec))
      .update(fs.readFileSync(path.join(__dirname, "regionMaps.py"))).digest("hex");
    const sigFile = path.join(outDir, ".sig");
    const have = fs.existsSync(sigFile) && fs.readFileSync(sigFile, "utf8") === sig
      && spec.areas.every((a) => fs.existsSync(path.join(outDir, `${a.file}.webp`)));
    if (have) { console.log(`  ${dirName}: unchanged, ${spec.areas.length} kept`); return spec.areas.length; }
    fs.mkdirSync(outDir, { recursive: true });
    const tmp = path.join(os.tmpdir(), `ris-${dirName}.json`);
    fs.writeFileSync(tmp, JSON.stringify(spec));
    execFileSync("python", [path.join(__dirname, "regionMaps.py"), tmp], { stdio: "inherit" });
    const want = new Set(spec.areas.map((a) => `${a.file}.webp`));
    for (const f of fs.readdirSync(outDir)) if (f.endsWith(".webp") && !want.has(f)) fs.unlinkSync(path.join(outDir, f));
    fs.writeFileSync(sigFile, sig);
    return spec.areas.length;
  }

  return { add, render };
}

module.exports = { areaMaps };
