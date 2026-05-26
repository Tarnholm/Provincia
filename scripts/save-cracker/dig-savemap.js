// Whole-save offset MAP: locate every major region/structure in one pass so the
// 34MB RIS save has a top-level layout reference (complements the per-region
// cracking agents). Reports offsets of header, faction records, diplomacy
// matrix, diplo zones, settlement markers, region records, event log, tail.
const fs = require("fs");
const cx = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const bp = (() => { try { return require("C:/dev/Provincia/src/buildingParser.js"); } catch { return null; } })();

const DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const SAVE = DIR + "save_macedon t0.sav";
const SM = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";

function loadOrder(p){const t=fs.readFileSync(p,"utf8");const o=[];let c=null;for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);if(m){c=m[1];continue;}if(c){const cm=l.match(/^\s*"culture":\s*"([a-z_]+)"/);if(cm){o.push(c);c=null;}}}return o;}

const buf = fs.readFileSync(SAVE);
const order = loadOrder(SM);
const N = order.length;
const hex = (n) => "0x" + n.toString(16);
const mb = (n) => (n / 1048576).toFixed(2) + "MB";
const rows = [];
function row(name, off, note="") { rows.push({ name, off, note }); }

console.log(`save_macedon t0.sav  size=${buf.length} (${mb(buf.length)})  N=${N} factions\n`);

// Header
const hdr = cx.parseHeader(buf);
row("header.magic", 0, `campaign="${hdr ? hdr.campaignName : "?"}" v${hdr ? hdr.saveVersion : "?"}`);
row("header.nameEnd", hdr ? hdr.nameEnd : 0, "");
// Section-type registry
row("section-type registry", 0x3310, "RTTI, 106 types");

// First diplomacy zone (0x39240005)
let firstZone = -1; { const m = Buffer.from([0x05,0x00,0x24,0x39]); firstZone = buf.indexOf(m, 0x4000); }
row("first diplo zone (0x39240005)", firstZone, "agreement handles");

// Diplomacy matrix
const mtx = cx.parseDiplomacyMatrix(buf, order);
if (mtx && mtx._meta) {
  const m = mtx._meta;
  const end = m.base + N * N * m.stride;
  row("DIPLOMACY MATRIX base", m.base, `stride=${m.stride} N=${N} -> ends ~${hex(end)} (${mb(N*N*m.stride)})`);
}

// First class-100 faction record
const recs = cx.parseFactionTreasuries(buf);
if (recs && recs.length) {
  row("first class-100 faction record", recs[0].offset, `${recs.length} records, last @${hex(recs[recs.length-1].offset)}`);
}

// Region records
try {
  const regs = cx.findRegionRecords(buf);
  if (regs && regs.length) row("region records", regs[0].offset, `${regs.length} records, last @${hex(regs[regs.length-1].offset)}`);
} catch {}

// Settlement markers
try {
  if (bp && bp.findAllSettlementMarkers) {
    const s = bp.findAllSettlementMarkers(buf);
    if (s && s.length) row("settlement markers", s[0].offset, `${s.length} settlements, last @${hex(s[s.length-1].offset)}`);
  }
} catch {}

// Event log (f2feffff) — first VALID utf16 event
{
  const FR = Buffer.from([0xf2,0xfe,0xff,0xff]); let p = 0, first = -1, count = 0;
  while ((p = buf.indexOf(FR, p)) !== -1) { count++; if (first < 0) first = p; p += 4; }
  row("event log (f2feffff) frames", first, `${count} frames total`);
}

// Player faction record hint (first captain_card_ before first class-100 record)
{
  const t = Buffer.from("captain_card_", "ascii");
  const firstMajor = recs && recs.length ? recs[0].offset : buf.length;
  let p = buf.indexOf(t, 0x1000);
  if (p >= 0 && p < firstMajor) row("player record (first captain banner)", p, "before NPC records");
}

rows.sort((a, b) => (a.off || 0) - (b.off || 0));
for (const r of rows) console.log(`  ${hex(r.off).padEnd(12)} ${r.name.padEnd(34)} ${r.note}`);
