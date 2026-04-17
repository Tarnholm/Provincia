/**
 * Usage: node scripts/convertRegions.js path/to/descr_regions.txt path/to/regions.json
 *
 * It parses the descr_regions.txt blocks and writes a regions.json object keyed by "r,g,b".
 */
const fs = require("fs");
const path = require("path");

function parseFile(text) {
  const lines = text.split(/\r?\n/);
  const regions = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    // Skip comments/blank lines
    if (!line || line.startsWith(";")) {
      i++;
      continue;
    }

    // Expect a block of 9 lines after the region name:
    // 0: region
    // 1: city
    // 2: faction
    // 3: culture
    // 4: RGB "r g b"
    // 5: tags (comma-separated)
    // 6: farm_level
    // 7: pop_level
    // 8: ethnicities
    const region = line;
    if (i + 8 >= lines.length) break;

    const city = lines[i + 1].trim();
    const faction = lines[i + 2].trim();
    const culture = lines[i + 3].trim();
    const rgbParts = lines[i + 4].trim().split(/\s+/);
    if (rgbParts.length !== 3) {
      console.warn("Skipping malformed RGB at line", i + 5, region);
      i++;
      continue;
    }
    const rgbKey = rgbParts.join(",");

    const tags = lines[i + 5].trim();
    const farm_level = lines[i + 6].trim();
    const pop_level = lines[i + 7].trim();
    const ethnicities = lines[i + 8].trim();

    regions[rgbKey] = {
      region,
      city,
      faction,
      culture,
      tags,
      farm_level,
      pop_level,
      ethnicities,
    };

    i += 9;
  }
  return regions;
}

function main() {
  const [, , srcPath, outPath] = process.argv;
  if (!srcPath || !outPath) {
    console.error("Usage: node scripts/convertRegions.js <descr_regions.txt> <regions.json>");
    process.exit(1);
  }
  const txt = fs.readFileSync(srcPath, "utf8");
  const data = parseFile(txt);
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf8");
  console.log(`Wrote ${Object.keys(data).length} regions to ${path.resolve(outPath)}`);
}

main();