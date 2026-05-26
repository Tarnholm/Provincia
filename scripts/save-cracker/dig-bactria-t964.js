// Inspect Bactria T964 alongside Dummies T900 / T1134 for engine pool limits.
// Dumps section registry counts side-by-side, flags suspicious round numbers,
// and notes growth between turns.
const fs = require("fs");
const path = require("path");
const { parseCharacterExtras } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const SAVES = [
  { label: "Dummies T900",   path: "C:\\Users\\vtarn\\Downloads\\save_Autosave   Dummies   Turn 900 End.sav" },
  { label: "Bactria T964",   path: "C:\\Users\\vtarn\\Downloads\\save_Autosave   Bactria   Turn 964.sav" },
  { label: "Dummies T1134",  path: "C:\\Users\\vtarn\\Downloads\\save_Autosave   Dummies   Turn 1134.sav" },
];

function readRegistry(buf) {
  let p = 0x100;
  while (p < 0x10000) {
    const count = buf.readUInt32LE(p);
    if (count > 0 && count < 100000) {
      const nameStart = p + 4;
      if (buf[nameStart] >= 0x41 && buf[nameStart] <= 0x5a) {
        const end = buf.indexOf(0x00, nameStart);
        if (end !== -1 && end > nameStart && end < nameStart + 60) {
          const name = buf.slice(nameStart, end).toString("latin1");
          if (/^[A-Z][A-Z_0-9]*$/.test(name)) break;
        }
      }
    }
    p++;
  }
  const registryStart = p;
  const types = [];
  while (true) {
    const count = buf.readUInt32LE(p);
    const nameStart = p + 4;
    const end = buf.indexOf(0x00, nameStart);
    if (end === -1 || end > nameStart + 60) break;
    const name = buf.slice(nameStart, end).toString("latin1");
    if (!/^[A-Z][A-Z_0-9]*$/.test(name)) break;
    types.push({ id: types.length, offset: p, name, count });
    p = end + 1;
  }
  return { types, registryStart, registryEnd: p };
}

function countOccurrences(buf, needleStr) {
  const needle = Buffer.from(needleStr, "ascii");
  let n = 0, p = 0;
  while ((p = buf.indexOf(needle, p)) !== -1) { n++; p += 1; }
  return n;
}

// Suspicious round numbers (engine pool sizes / power-of-two caps and common limits)
const SUSPICIOUS = new Set([
  256, 500, 511, 512, 700, 750, 1000, 1023, 1024, 1500, 2000, 2047, 2048,
  3000, 4000, 4095, 4096, 5000, 6000, 7000, 8000, 8191, 8192,
  10000, 12000, 16000, 16383, 16384, 20000, 32767, 32768, 65535, 65536,
]);
function suspiciousTag(n) {
  if (SUSPICIOUS.has(n)) return " <<CAP?>>";
  // within 1 of a power-of-two or round multiple
  for (const c of SUSPICIOUS) {
    if (n === c - 1 || n === c + 1) return ` ~${c}?`;
  }
  return "";
}

const results = [];
for (const { label, path: sp } of SAVES) {
  const buf = fs.readFileSync(sp);
  const fn = path.basename(sp);
  const { types, registryStart, registryEnd } = readRegistry(buf);
  let charsParsed = -1, charsErr = null;
  try { charsParsed = parseCharacterExtras(buf).length; }
  catch (e) { charsErr = e.message; }
  const captainCards = countOccurrences(buf, "captain_card_");
  const tail = buf.slice(buf.length - 0x100);
  const tailZero = tail.every(b => b === 0);
  results.push({
    label, fn, size: buf.length, types, registryStart, registryEnd,
    charsParsed, charsErr, captainCards, tailZero,
  });
}

// ── File sizes ─────────────────────────────────────────────────────────────
console.log("\n=== FILE SIZES ===");
for (const r of results) {
  console.log(`  ${r.label.padEnd(16)} ${(r.size/1024/1024).toFixed(2).padStart(7)} MB  (${r.size.toLocaleString()} bytes)  registry@0x${r.registryStart.toString(16)} types=${r.types.length}`);
}

// ── Side-by-side section counts ────────────────────────────────────────────
// Union of all section names across the 3 saves
const allNames = new Set();
for (const r of results) for (const t of r.types) allNames.add(t.name);
const names = Array.from(allNames).sort();

const cols = results.map(r => Object.fromEntries(r.types.map(t => [t.name, t.count])));

console.log("\n=== SECTION COUNTS (side-by-side) ===");
console.log(`  ${"section".padEnd(32)} ${"T900".padStart(8)} ${"T964".padStart(8)} ${"T1134".padStart(8)}   growth/caps`);
console.log("  " + "-".repeat(80));

const rows = [];
for (const name of names) {
  const v0 = cols[0][name];
  const v1 = cols[1][name];
  const v2 = cols[2][name];
  rows.push({ name, v0, v1, v2 });
}

// Print all, but flag interesting ones
for (const r of rows) {
  const s0 = r.v0 === undefined ? "-" : String(r.v0);
  const s1 = r.v1 === undefined ? "-" : String(r.v1);
  const s2 = r.v2 === undefined ? "-" : String(r.v2);
  const tags = [];
  // plateau (T964 == T1134 and both > 0)
  if (r.v1 !== undefined && r.v2 !== undefined && r.v1 === r.v2 && r.v1 > 0) {
    tags.push("plateau(T964=T1134)");
  }
  if (r.v0 !== undefined && r.v1 !== undefined && r.v0 === r.v1 && r.v0 > 0) {
    tags.push("plateau(T900=T964)");
  }
  // suspicious round
  const allVals = [r.v0, r.v1, r.v2].filter(v => v !== undefined);
  for (const v of allVals) {
    const tag = suspiciousTag(v);
    if (tag) { tags.push(`${v}${tag}`); break; }
  }
  // growth T900 → T964 → T1134
  if (r.v0 !== undefined && r.v1 !== undefined) {
    const d = r.v1 - r.v0;
    if (Math.abs(d) >= 10) tags.push(`T900→T964 ${d > 0 ? "+" : ""}${d}`);
  }
  if (r.v1 !== undefined && r.v2 !== undefined) {
    const d = r.v2 - r.v1;
    if (Math.abs(d) >= 10) tags.push(`T964→T1134 ${d > 0 ? "+" : ""}${d}`);
  }
  console.log(`  ${r.name.padEnd(32)} ${s0.padStart(8)} ${s1.padStart(8)} ${s2.padStart(8)}   ${tags.join("; ")}`);
}

// ── Largest-count and largest-growth highlights ────────────────────────────
console.log("\n=== TOP-20 LARGEST COUNTS (max across all 3 saves) ===");
const enriched = rows.map(r => ({
  name: r.name,
  max: Math.max(r.v0 ?? 0, r.v1 ?? 0, r.v2 ?? 0),
  v0: r.v0, v1: r.v1, v2: r.v2,
}));
enriched.sort((a, b) => b.max - a.max);
for (const r of enriched.slice(0, 20)) {
  console.log(`  ${r.name.padEnd(32)} max=${String(r.max).padStart(7)}  [${r.v0 ?? "-"}, ${r.v1 ?? "-"}, ${r.v2 ?? "-"}]${suspiciousTag(r.max)}`);
}

console.log("\n=== TOP-15 GROWTH T900→T1134 ===");
const growth = rows
  .filter(r => r.v0 !== undefined && r.v2 !== undefined)
  .map(r => ({ name: r.name, d: r.v2 - r.v0, v0: r.v0, v1: r.v1, v2: r.v2 }));
growth.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
for (const g of growth.slice(0, 15)) {
  console.log(`  ${g.name.padEnd(32)} ${g.v0} → ${g.v1 ?? "-"} → ${g.v2}   Δ=${g.d > 0 ? "+" : ""}${g.d}`);
}

// ── Parser-vs-registry sanity check ────────────────────────────────────────
console.log("\n=== parseCharacterExtras vs registry CHARACTER count ===");
for (const r of results) {
  const charType = r.types.find(t => t.name === "CHARACTER" || t.name === "CHARACTER_RECORD" || t.name === "CHARACTER_DB");
  const regCharLine = r.types.filter(t => /^CHARACTER/.test(t.name)).map(t => `${t.name}=${t.count}`).join(", ");
  if (r.charsErr) {
    console.log(`  ${r.label.padEnd(16)} parseCharacterExtras THREW: ${r.charsErr}  (registry: ${regCharLine})`);
  } else {
    const ref = charType ? charType.count : 0;
    const diff = ref ? r.charsParsed - ref : null;
    console.log(`  ${r.label.padEnd(16)} parsed=${String(r.charsParsed).padStart(5)}  registry: ${regCharLine}  ${ref ? `diff=${diff > 0 ? "+" : ""}${diff}` : ""}  ${r.charsParsed < (ref || 0) ? "<<UNDERCOUNT — parser might be capping>>" : ""}`);
  }
  console.log(`     captain_card_ occurrences: ${r.captainCards}   tail-zero: ${r.tailZero}`);
}

// ── Sections present in some saves but missing in others ───────────────────
console.log("\n=== SECTIONS MISSING FROM ANY SAVE ===");
for (const name of names) {
  const missing = results
    .map((r, i) => cols[i][name] === undefined ? r.label : null)
    .filter(Boolean);
  if (missing.length && missing.length < results.length) {
    const present = results
      .map((r, i) => cols[i][name] !== undefined ? `${r.label}=${cols[i][name]}` : null)
      .filter(Boolean);
    console.log(`  ${name.padEnd(32)} missing in: ${missing.join(", ")}    present: ${present.join(", ")}`);
  }
}

// ── DEEP PROBE: registry counts are constants. Real live counts live in
//    section body headers. Scan for known marker patterns.
console.log("\n=== DEEP PROBE: STRING-BASED PROXIES ===");
function probe(buf, ascii, alignBytes = null) {
  const needle = Buffer.from(ascii, "ascii");
  let n = 0, p = 0;
  while ((p = buf.indexOf(needle, p)) !== -1) { n++; p += 1; }
  return n;
}
const PROBES = [
  "captain_card_",         // captain portraits
  "young_card_",           // family-tree young-character portraits
  "general_card_",
  "diplomat_card_",
  "spy_card_",
  "assassin_card_",
  "admiral_card_",
  "merchant_card_",
  "princess_card_",
  "named_character",
  "character_record",
  "ancillary ",            // ancillary token in body
  " general",              // role tokens
  " captain",
  " diplomat",
  " spy",
  " assassin",
  " admiral",
  " merchant",
  " princess",
  " general\x00",          // pstr16 terminated
  " captain\x00",
];
console.log(`  ${"probe".padEnd(24)} ${"T900".padStart(8)} ${"T964".padStart(8)} ${"T1134".padStart(8)}   notes`);
console.log("  " + "-".repeat(72));
for (const ascii of PROBES) {
  const vals = results.map(r => probe(r.bufRef || fs.readFileSync(SAVES[results.indexOf(r)].path), ascii));
  // Avoid re-reading: cache via global
  const label = ascii.replace(/\x00/g, "\\0");
  const tags = [];
  if (vals[1] === vals[2] && vals[1] > 0) tags.push("plateau(T964=T1134)");
  for (const v of vals) {
    const t = suspiciousTag(v);
    if (t) { tags.push(`${v}${t}`); break; }
  }
  console.log(`  ${label.padEnd(24)} ${String(vals[0]).padStart(8)} ${String(vals[1]).padStart(8)} ${String(vals[2]).padStart(8)}   ${tags.join("; ")}`);
}

// ── Scan body for repeated 4-byte count headers that look like array counts
// near common big sections. Just spot-check by looking at the largest section
// type registries' offsets near them — too involved here, so we use FAMILY
// markers instead.
console.log("\n=== FAMILY TREE / ROSTER MARKER COUNTS ===");
const FAMILY_MARKERS = [
  "spouse",
  "father",
  "mother",
  "son",
  "daughter",
  "adopted",
  "father_in_law",
];
for (const m of FAMILY_MARKERS) {
  const vals = results.map((r, i) => {
    const buf = fs.readFileSync(SAVES[i].path);
    return probe(buf, m);
  });
  const tags = [];
  if (vals[1] === vals[2] && vals[1] > 0) tags.push("plateau(T964=T1134)");
  for (const v of vals) {
    const t = suspiciousTag(v);
    if (t) { tags.push(`${v}${t}`); break; }
  }
  console.log(`  ${m.padEnd(20)} T900=${String(vals[0]).padStart(6)}  T964=${String(vals[1]).padStart(6)}  T1134=${String(vals[2]).padStart(6)}   ${tags.join("; ")}`);
}

// ── Per-save bookmarked summary ─────────────────────────────────────────────
console.log("\n=== INTERPRETATION ===");
console.log("  NOTE: registry counts at 0x33xx are the SECTION TYPE TABLE constants");
console.log("        (106 type definitions identical across every save). They are NOT");
console.log("        live record counts. Live counts live inside each section body.");
console.log("        So plateau/equality between T900/T964/T1134 in section-count");
console.log("        rows above is structural, not engine-cap evidence.");
console.log("        Real signals: parseCharacterExtras counts, card_ path occurrences,");
console.log("        family-tree markers, file-size deltas.");

// ── Per-faction breakdown via culture+role pairs ────────────────────────────
console.log("\n=== CULTURE/ROLE BREAKDOWN (parseCharacterExtras roles) ===");
// Probe each (culture, role) pair to find which faction/role bucket is largest
const ROLES = ["general", "captain", "diplomat", "spy", "assassin", "admiral", "merchant", "princess"];
const culturesByLabel = {};
for (let i = 0; i < SAVES.length; i++) {
  const label = results[i].label;
  const buf = fs.readFileSync(SAVES[i].path);
  const cultures = new Set();
  for (const role of ROLES) {
    const tail = Buffer.from(" " + role + "\0", "ascii");
    let p = 0;
    while (true) {
      const idx = buf.indexOf(tail, p);
      if (idx === -1) break;
      p = idx + 1;
      let start = idx;
      while (start > 0) {
        const b = buf[start - 1];
        if ((b >= 0x61 && b <= 0x7a) || (b >= 0x30 && b <= 0x39) || b === 0x5f) start -= 1;
        else break;
      }
      if (start === idx) continue;
      const token = buf.slice(start, idx).toString("ascii");
      if (token.length >= 3 && token[0] >= "a" && token[0] <= "z") cultures.add(token);
    }
  }
  culturesByLabel[label] = Array.from(cultures);
  console.log(`  ${label.padEnd(16)} cultures discovered: ${culturesByLabel[label].length}  [${culturesByLabel[label].slice(0, 20).join(", ")}${culturesByLabel[label].length > 20 ? ", ..." : ""}]`);
}

// Per-role total across all cultures
console.log("\n=== ROLE TOTALS (sum across all cultures, pstr16 `<culture> <role>\\0`) ===");
console.log(`  ${"role".padEnd(12)} ${"T900".padStart(8)} ${"T964".padStart(8)} ${"T1134".padStart(8)}`);
for (const role of ROLES) {
  const vals = [0, 0, 0];
  for (let i = 0; i < SAVES.length; i++) {
    const buf = fs.readFileSync(SAVES[i].path);
    for (const culture of culturesByLabel[results[i].label]) {
      const target = Buffer.from(culture + " " + role + "\0", "ascii");
      let p = 0, n = 0;
      while (true) {
        const idx = buf.indexOf(target, p);
        if (idx === -1) break;
        // Validate via own_uuid like parseCharacterExtras does
        const roleLen = target.length;
        if (idx + roleLen + 5 + 4 > buf.length) { p = idx + 1; continue; }
        const ownUuid = buf.readUInt32LE(idx + roleLen + 1);
        if (ownUuid !== 0 && ownUuid !== 0xffffffff) n++;
        p = idx + 1;
      }
      vals[i] += n;
    }
  }
  console.log(`  ${role.padEnd(12)} ${String(vals[0]).padStart(8)} ${String(vals[1]).padStart(8)} ${String(vals[2]).padStart(8)}`);
}

// ── Captains have no `<culture> captain` pstr16 (see memo project_captain_vs_general).
// They sit under armies with a `captain_card_NNN.tga` portrait path. Count those.
console.log("\n=== CARD PATH COUNTS (raw substring) ===");
const CARD_PROBES = ["_card_"];
for (const ascii of CARD_PROBES) {
  const vals = results.map((r, i) => probe(fs.readFileSync(SAVES[i].path), ascii));
  console.log(`  ${ascii.padEnd(16)} T900=${vals[0]}  T964=${vals[1]}  T1134=${vals[2]}`);
}
// Show 5 raw contexts of _card_ to understand its encoding
console.log("\n=== SAMPLE _card_ contexts (first 5 in Bactria T964) ===");
{
  const buf = fs.readFileSync(SAVES[1].path);
  const needle = Buffer.from("_card_", "ascii");
  let p = 0, n = 0;
  while (n < 5 && (p = buf.indexOf(needle, p)) !== -1) {
    const start = Math.max(0, p - 40);
    const end = Math.min(buf.length, p + 60);
    const ctx = buf.slice(start, end).toString("latin1").replace(/[^\x20-\x7e]/g, ".");
    console.log(`  @0x${p.toString(16)} ${JSON.stringify(ctx)}`);
    p += 1; n += 1;
  }
}

// Distinct card prefixes - paths are likely ASCII or UTF-16; try both
console.log("\n=== captain_card_<faction>.tga FACTION TOTALS ===");
for (let i = 0; i < SAVES.length; i++) {
  const buf = fs.readFileSync(SAVES[i].path);
  const re = /captain_card_([a-z_]+)\.tga/g;
  const counts = new Map();
  let m;
  const text = buf.toString("latin1");
  while ((m = re.exec(text)) !== null) {
    counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  }
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  console.log(`  ${results[i].label.padEnd(16)} total=${total}`);
  for (const [k, v] of entries) console.log(`     ${k.padEnd(20)} ${v}`);
}

console.log("\n=== DISTINCT card_*.tga path prefixes ===");
for (let i = 0; i < SAVES.length; i++) {
  const buf = fs.readFileSync(SAVES[i].path);
  // Convert UTF-16LE to ASCII by stripping odd-indexed zero bytes
  const ascii8 = buf.toString("latin1");
  // Also build a "loose" ASCII view of UTF-16: every other byte
  let utf16Loose = "";
  for (let j = 0; j < buf.length; j += 2) {
    const c = buf[j];
    const h = buf[j + 1];
    if (h === 0 && c >= 0x20 && c <= 0x7e) utf16Loose += String.fromCharCode(c);
    else utf16Loose += "\x00";
  }
  for (const [name, text] of [["ascii8", ascii8], ["utf16", utf16Loose]]) {
    const re = /([a-zA-Z]+)_card_\d+\.tga/g;
    const counts = new Map();
    let m;
    while ((m = re.exec(text)) !== null) {
      counts.set(m[1], (counts.get(m[1]) || 0) + 1);
    }
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, [, v]) => s + v, 0);
    if (total > 0) {
      console.log(`  ${results[i].label.padEnd(16)} (${name}) total=${total}  by-prefix: ${entries.map(([k, v]) => `${k}=${v}`).join(", ")}`);
    }
  }
}
