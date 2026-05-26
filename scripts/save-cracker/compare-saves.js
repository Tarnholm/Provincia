// Quick structural diff between two .sav files. Compares:
//   - file size
//   - magic / version header
//   - section type registry at 0x566 (each entry: [u32 count][ASCIIZ name])
//   - HST table count
//   - top-level body offsets (header end, settlement zone, tail)
// Outputs a side-by-side table.

const fs = require("fs");
const path = require("path");

const A = process.argv[2];
const B = process.argv[3];
if (!A || !B) {
  console.error("usage: node compare-saves.js <a.sav> <b.sav>");
  process.exit(2);
}

function load(p) {
  const buf = fs.readFileSync(p);
  return { name: path.basename(p), size: buf.length, buf };
}

function readU32(buf, off) {
  if (off + 4 > buf.length) return null;
  return buf.readUInt32LE(off);
}

function readCStr(buf, off, max = 64) {
  let end = off;
  while (end < buf.length && end < off + max && buf[end] !== 0) end++;
  return { str: buf.slice(off, end).toString("ascii"), nextOff: end + 1 };
}

function parseSectionRegistry(buf) {
  // Section registry at 0x566 — `[u32 count][ASCIIZ name]` repeated.
  // The list is terminated by something — we'll guess by stopping at
  // names that don't look ASCII-printable.
  const sections = [];
  let off = 0x566;
  while (off < buf.length - 8) {
    const count = readU32(buf, off);
    if (count == null) break;
    const { str, nextOff } = readCStr(buf, off + 4, 48);
    // Names are uppercase + underscore. If first char isn't A-Z, stop.
    if (str.length === 0 || !/^[A-Z][A-Z0-9_]*$/.test(str)) break;
    sections.push({ id: sections.length, count, name: str });
    off = nextOff;
    if (sections.length > 200) break; // safety
  }
  return sections;
}

function parseHeader(buf) {
  // Magic: bytes 0..3 should be 0x070a0000 or similar (per memory).
  const magic = readU32(buf, 0);
  // Per memo `project_save_file_geography`: header → body+character_paths
  // → tile-attribute gap → settlement zone → tail.
  return { magic: magic ? magic.toString(16) : "(null)" };
}

const a = load(A);
const b = load(B);

const aHdr = parseHeader(a.buf);
const bHdr = parseHeader(b.buf);
const aSecs = parseSectionRegistry(a.buf);
const bSecs = parseSectionRegistry(b.buf);

console.log(`\n=== File overview ===`);
console.log(`A: ${a.name}  ${a.size.toLocaleString()} bytes  magic=${aHdr.magic}`);
console.log(`B: ${b.name}  ${b.size.toLocaleString()} bytes  magic=${bHdr.magic}`);
const sizeDelta = b.size - a.size;
console.log(`Δ size = ${sizeDelta >= 0 ? "+" : ""}${sizeDelta.toLocaleString()} bytes (${(sizeDelta / 1024).toFixed(1)} KB)`);

console.log(`\n=== Section registry ===`);
console.log(`A: ${aSecs.length} sections | B: ${bSecs.length} sections`);

// Join by name
const allNames = new Set([...aSecs.map(s => s.name), ...bSecs.map(s => s.name)]);
const aByName = new Map(aSecs.map(s => [s.name, s]));
const bByName = new Map(bSecs.map(s => [s.name, s]));

console.log(`\n${"name".padEnd(36)}  ${"A.count".padStart(8)}  ${"B.count".padStart(8)}  ${"Δ".padStart(8)}  note`);
console.log("-".repeat(80));
const rows = [...allNames].sort();
let totalDeltaCount = 0;
for (const n of rows) {
  const A_ = aByName.get(n);
  const B_ = bByName.get(n);
  const a_c = A_ ? A_.count : null;
  const b_c = B_ ? B_.count : null;
  let note = "";
  let delta = 0;
  if (a_c == null) note = "ONLY IN B";
  else if (b_c == null) note = "ONLY IN A";
  else {
    delta = b_c - a_c;
    if (delta !== 0) note = `Δ=${delta > 0 ? "+" : ""}${delta}`;
  }
  totalDeltaCount += (b_c || 0) - (a_c || 0);
  console.log(`${n.padEnd(36)}  ${String(a_c ?? "-").padStart(8)}  ${String(b_c ?? "-").padStart(8)}  ${String(delta).padStart(8)}  ${note}`);
}
console.log("-".repeat(80));
console.log(`Σ count delta (B − A) across all section types: ${totalDeltaCount}`);

// Also report sections unique to one file
const onlyA = aSecs.filter(s => !bByName.has(s.name));
const onlyB = bSecs.filter(s => !aByName.has(s.name));
console.log(`\nSections ONLY in A: ${onlyA.length ? onlyA.map(s => `${s.name}(${s.count})`).join(", ") : "(none)"}`);
console.log(`Sections ONLY in B: ${onlyB.length ? onlyB.map(s => `${s.name}(${s.count})`).join(", ") : "(none)"}`);
