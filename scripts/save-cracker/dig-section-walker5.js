// dig-section-walker5.js — explore the 9.8MB "gap" between body root and section B,
// AND walk inside the 15.7MB settlement-zone child.

const fs = require("fs");
const path = require("path");

const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);

function isSection(p, maxEnd) {
  if (p + 8 > maxEnd) return false;
  if (buf.readUInt32LE(p) !== p) return false;
  const sz = buf.readUInt32LE(p + 4);
  if (sz < 16 || p + sz > maxEnd) return false;
  return true;
}

function walkSequential(start, end, max = 100000) {
  const found = [];
  for (let p = start; p + 8 <= end; p += 4) {
    if (!isSection(p, end)) continue;
    found.push({ off: p, size: buf.readUInt32LE(p + 4) });
  }
  found.sort((a, b) => a.off - b.off || b.size - a.size);
  const accepted = [];
  let lastEnd = start;
  for (const s of found) {
    if (s.off < lastEnd) continue;
    accepted.push(s);
    lastEnd = s.off + s.size;
    if (accepted.length >= max) break;
  }
  return accepted;
}

function classify(s) {
  const p = s.off + 8;
  const lookahead = Math.min(s.size - 8, 4096);
  const slice = buf.slice(p, p + lookahead);
  if (slice.indexOf(Buffer.from("data/ui/", "ascii")) >= 0) return "char_record";
  if (slice.indexOf(Buffer.from("default_set", "ascii")) >= 0) return "settlement_record";
  if (slice.indexOf(Buffer.from("core_building", "ascii")) >= 0) return "settlement_record";
  if (s.size >= 64 && buf.readUInt32LE(p) === 100 && buf.readUInt32LE(p + 4) === 1) return "faction_record";
  if (s.size >= 32 && buf[p+1] === 0 && buf[p+3] === 0 && buf[p+0] >= 0x41 && buf[p+0] <= 0x7e) return "utf16_named";
  let nzero = 0;
  for (let i = 0; i < Math.min(lookahead, 256); i++) if (slice[i] === 0) nzero++;
  if (nzero > 200) return "mostly_zero";
  if (s.size < 100) return "small";
  // Match unit-record: starts with [u16 nameLen][asciz name] like "roman general"
  const nameLen = buf.readUInt16LE(p);
  if (nameLen > 4 && nameLen < 40) {
    const possibleName = buf.slice(p + 2, p + 2 + nameLen).toString('ascii');
    if (/^[a-z][a-z _]+$/.test(possibleName)) return `unit_record:${possibleName.slice(0,15)}`;
  }
  return "unknown";
}

function classifyAll(kids, label) {
  if (!kids.length) { console.log(`${label}: no children`); return; }
  const cls = {};
  for (const k of kids) {
    const c = classify(k);
    cls[c] = (cls[c] || 0) + 1;
  }
  console.log(`\n${label} (${kids.length} kids) classification:`);
  for (const [c, n] of Object.entries(cls).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)} × ${c}`);
}

// Walk the GAP between body root end (0x633bb3) and Section B start (0xf88637).
const GAP_START = 0x633bb3;
const GAP_END = 0xf88637;
console.log(`Gap: 0x${GAP_START.toString(16)}..0x${GAP_END.toString(16)} = ${GAP_END - GAP_START} bytes`);

const gapKids = walkSequential(GAP_START, GAP_END);
console.log(`Gap top-level kids: ${gapKids.length}`);
classifyAll(gapKids, "Gap");

// Show top 30 sections in gap
const sortedGap = [...gapKids].sort((a, b) => b.size - a.size);
console.log(`\nTop 30 by size in gap:`);
for (const k of sortedGap.slice(0, 30)) {
  console.log(`  0x${k.off.toString(16)} size=${k.size} → ${classify(k)}`);
}

// Walk inside the 15.7MB section B child
const sBchild = { off: 0xf8a90f, size: 15663104 };  // from prior run; need to re-find
// Re-find: the child of Section B
const SB = { off: 0xf88637, size: 16287291 };
const sbKids = walkSequential(SB.off + 8, SB.off + SB.size, 1);
if (sbKids.length) {
  const sBKid = sbKids[0];
  console.log(`\nSection B's single giant child: 0x${sBKid.off.toString(16)} size=${sBKid.size}`);
  const inner = walkSequential(sBKid.off + 8, sBKid.off + sBKid.size, 200000);
  console.log(`  Inner direct children: ${inner.length}`);
  classifyAll(inner, "Section B inner");
}
