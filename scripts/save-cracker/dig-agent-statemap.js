// dig-agent-statemap.js  (v2)
// =====================
// Locate agent records by UUID *without* requiring the 0x7fff marker (it gets
// cleared on move), then full-diff each agent across move + infiltrate saves.
//
// Record layout hypothesis (136/0x88-byte intrusive linked-list node):
//   +0   u32 ownUuid
//   +4   u32 self_ptr (== off+4)         (record body start pointer)
//   +8   u32 x (tile)
//   +12  u32 y (tile)
//   +16  u16 0x7fff  "fresh / not-yet-moved this turn" marker (cleared on move)
//   +18  u8  movedFlag?  (1 / 0)
//   +20  f32 ?  (0.0 / 1.0)
//   +33  u32 0xffffffff sentinel
//   +58  f32 movement points (current)
//   +112 u8  per-turn action/MP-reset flag (ff -> 01/02/03 churn)
//   +124 u32 ptr  (off+? neighbor)
//   +128 u32 ptr  (off+? neighbor)
//   +136 u32 next agent uuid (linked list)
//
// Research-only.

const fs = require("fs");
const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";
function load(n) { return fs.readFileSync(SAVE_DIR + n); }

const SAVES = {
  base: "save_17-05-2026   Spain   Turn 1.sav",
  spy:  "save_17-05-2026   Spain   Turn 1 move spy.sav",
  dip:  "save_17-05-2026   Spain   Turn 1move diplomat and army.sav",
  t3end: "save_Autosave   Spain   Turn 3 End.sav",
  t3inf: "save_Autosave   Spain   Turn 3 inflitrated city with spy..sav",
};

// Locate the record by uuid: u32 at +0 == uuid AND u32 at +4 == off+4 (self ptr).
// This signature is robust to marker clearing.
function findAgentRecord(buf, uuid) {
  const t = Buffer.alloc(4); t.writeUInt32LE(uuid);
  let p = 0;
  while ((p = buf.indexOf(t, p)) !== -1) {
    if (p + 8 <= buf.length && buf.readUInt32LE(p + 4) === p + 4) return p;
    p += 1;
  }
  return -1;
}

function f32(buf, o) { return o + 4 <= buf.length ? buf.readFloatLE(o) : NaN; }

function dumpRecord(label, buf, off, len = 144) {
  console.log(`  [${label}] off=0x${off.toString(16)} uuid=${buf.readUInt32LE(off)} coord=(${buf.readUInt32LE(off+8)},${buf.readUInt32LE(off+12)}) mk@16=0x${buf.readUInt16LE(off+16).toString(16)} mp@58=${f32(buf,off+58).toFixed(2)}`);
  const rows = [];
  for (let i = 0; i < len; i += 16) {
    const hexa = [], asc = [];
    for (let j = 0; j < 16 && off + i + j < buf.length; j++) {
      const b = buf[off + i + j];
      hexa.push(b.toString(16).padStart(2, "0"));
      asc.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
    }
    rows.push(`    +${(i).toString().padStart(3)}: ${hexa.join(" ").padEnd(48)} | ${asc.join("")}`);
  }
  console.log(rows.join("\n"));
}

function diffRecords(bufA, offA, bufB, offB, len = 160) {
  const diffs = [];
  for (let i = 0; i < len; i++) {
    const a = offA + i < bufA.length ? bufA[offA + i] : -1;
    const b = offB + i < bufB.length ? bufB[offB + i] : -1;
    if (a !== b) diffs.push({ rel: i, a, b });
  }
  return diffs;
}

const KNOWN = {
  spy:  2482542527,
  dipA: 3005591593,
  dipB: 82994962,
};

const base = load(SAVES.base);
const spyBuf = load(SAVES.spy);
const dipBuf = load(SAVES.dip);

console.log("############ AGENT RECORDS: base vs move saves ############\n");

for (const [name, uuid] of Object.entries(KNOWN)) {
  console.log(`\n================ ${name} uuid=${uuid} (0x${uuid.toString(16)}) ================`);
  const offBase = findAgentRecord(base, uuid);
  if (offBase < 0) { console.log("  base: NOT FOUND"); continue; }
  dumpRecord("base", base, offBase);

  for (const [sk, sbuf] of [["spySave", spyBuf], ["dipSave", dipBuf]]) {
    const o2 = findAgentRecord(sbuf, uuid);
    if (o2 < 0) { console.log(`  ${sk}: NOT FOUND`); continue; }
    const d = diffRecords(base, offBase, sbuf, o2);
    const note = o2 !== offBase ? ` (RELOCATED to 0x${o2.toString(16)})` : "";
    console.log(`  >>> ${sk}${note}: coord=(${sbuf.readUInt32LE(o2+8)},${sbuf.readUInt32LE(o2+12)}) mp@58=${f32(sbuf,o2+58).toFixed(2)} mk@16=0x${sbuf.readUInt16LE(o2+16).toString(16)} | ${d.length} byte diff`);
    for (const x of d) {
      const aS = x.a < 0 ? ".." : x.a.toString(16).padStart(2, "0");
      const bS = x.b < 0 ? ".." : x.b.toString(16).padStart(2, "0");
      console.log(`        +${x.rel}: ${aS} -> ${bS}`);
    }
  }
}

// ── INFILTRATION pair ──
console.log("\n\n############ INFILTRATION: Turn3 End vs Turn3 infiltrated ############\n");
const t3e = load(SAVES.t3end);
const t3i = load(SAVES.t3inf);

// We don't know the spy's T3 uuid; it should be the same uuid 2482542527.
for (const [name, uuid] of Object.entries(KNOWN)) {
  const oe = findAgentRecord(t3e, uuid);
  const oi = findAgentRecord(t3i, uuid);
  if (oe < 0 && oi < 0) continue;
  console.log(`\n================ ${name} uuid=${uuid} ================`);
  if (oe >= 0) dumpRecord("t3end", t3e, oe);
  if (oi >= 0) dumpRecord("t3inf", t3i, oi);
  if (oe >= 0 && oi >= 0) {
    const d = diffRecords(t3e, oe, t3i, oi);
    console.log(`  >>> ${d.length} byte diff:`);
    for (const x of d) {
      const aS = x.a < 0 ? ".." : x.a.toString(16).padStart(2, "0");
      const bS = x.b < 0 ? ".." : x.b.toString(16).padStart(2, "0");
      console.log(`        +${x.rel}: ${aS} -> ${bS}`);
    }
  }
}
