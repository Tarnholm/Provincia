// One-off audit: for every (faction, unit) pair in EDU, check whether the
// icon resolver can find a file. Mirrors main.js's resolve-unit-card logic
// with an "RIS only" search root (no vanilla fallback) so we see the worst
// case — anything missing here renders blank in the panel until the vanilla
// fallback fires (which only fills a subset of common units).
const fs = require("fs");
const path = require("path");

const MOD = "C:/RIS/RIS/data";
const ROOTS = [MOD];

function fileExists(p) { try { fs.statSync(p); return true; } catch { return false; } }

const eduText = fs.readFileSync(path.join(MOD, "export_descr_unit.txt"), "utf8");
const units = {};
let cur = null;
for (const raw of eduText.split(/\r?\n/)) {
  const line = raw.replace(/;.*/, "").trim();
  if (!line) continue;
  let m;
  if ((m = line.match(/^type\s+(.+)$/))) { cur = m[1].trim(); units[cur] = { dictionary: null, ownership: null }; continue; }
  if (!cur) continue;
  if ((m = line.match(/^dictionary\s+(.+)$/))) units[cur].dictionary = m[1].trim();
  if ((m = line.match(/^ownership\s+(.+)$/))) units[cur].ownership = m[1].split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
}

const scrub = (s) => String(s).toLowerCase().replace(/['"`]/g, "").replace(/\s+/g, "_");

function resolveCard(faction, unitName, dictionary) {
  const f = String(faction).toLowerCase().replace(/\s+/g, "_");
  const variants = [];
  const push = v => { if (v && !variants.includes(v)) variants.push(v); };
  if (dictionary) push(scrub(dictionary));
  push(scrub(unitName));
  for (const v of [...variants]) {
    if (/s$/.test(v)) push(v.slice(0, -1));
    if (v.startsWith("aor_")) push(v.slice(4));
    if (v.startsWith("merc_")) push(v.slice(5));
  }
  // Strict: requested faction + mercs.
  for (const fac of [f, "mercs"]) {
    for (const root of ROOTS) {
      for (const uv of variants) {
        if (fileExists(path.join(root, "ui", "units", fac, "#" + uv + ".tga"))) return "ok";
        if (fileExists(path.join(root, "ui", "unit_info", fac, uv + "_info.tga"))) return "ok";
      }
    }
  }
  // Brute-force fallback: scan every faction subdir.
  for (const root of ROOTS) {
    for (const subdir of ["units", "unit_info"]) {
      const base = path.join(root, "ui", subdir);
      let entries;
      try { entries = fs.readdirSync(base); } catch { continue; }
      for (const facDir of entries) {
        const facPath = path.join(base, facDir);
        try { if (!fs.statSync(facPath).isDirectory()) continue; } catch { continue; }
        for (const uv of variants) {
          if (fileExists(path.join(facPath, "#" + uv + ".tga"))) return "ok";
          if (fileExists(path.join(facPath, uv + "_info.tga"))) return "ok";
        }
      }
    }
  }
  return null;
}

const missing = [];
let tested = 0;
const repFactions = ["romans_julii", "greeks", "carthage", "seleucid", "ptolemaic", "arverni", "aedui", "parni", "armenia", "macedon", "antigonid", "spartans"];
for (const [t, info] of Object.entries(units)) {
  const owners = info.ownership || [];
  for (const fac of owners) {
    if (fac === "slave" || fac === "mercs" || fac === "all") continue;
    tested++;
    if (!resolveCard(fac, t, info.dictionary)) missing.push({ faction: fac, unit: t, dict: info.dictionary });
  }
  if (owners.includes("all")) {
    for (const fac of repFactions) {
      tested++;
      if (!resolveCard(fac, t, info.dictionary)) missing.push({ faction: fac, unit: t, dict: info.dictionary });
    }
  }
}

console.log("tested faction×unit combos:", tested);
console.log("missing icons:", missing.length);
console.log("missing rate:", ((missing.length / tested) * 100).toFixed(1) + "%");

const byFac = {};
for (const m of missing) byFac[m.faction] = (byFac[m.faction] || 0) + 1;
console.log("\nTop factions by missing icon count:");
for (const [f, n] of Object.entries(byFac).sort((a, b) => b[1] - a[1]).slice(0, 25)) {
  console.log("  ", f.padEnd(20), n);
}

console.log("\nFirst 30 missing samples:");
for (const m of missing.slice(0, 30)) {
  console.log("  ", m.faction.padEnd(18), "/", m.unit.padEnd(35), "  dict=" + m.dict);
}
