// Background session 4 — exhaustive byte-by-byte map of CHARACTER RECORD.
const fs = require("fs");
const path = require("path");
const cp = require("../../src/characterParser.js");

const MOD = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods/RIS beta/data";
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8")
  .split(/\r?\n/).map(s => s.trim());
const traitNames = [];
{
  const lines = fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/);
  for (const line of lines) {
    const tm = line.match(/^Trait\s+(\S+)/);
    if (tm) traitNames.push(tm[1]);
  }
}
console.error(`# loaded ${nameLookup.length} names, ${traitNames.length} traits`);

function loadBuf(name) { return fs.readFileSync(path.join(SAVES, name)); }

function dumpHex(buf, off, len) {
  const lines = [];
  for (let i = 0; i < len; i += 16) {
    const slice = buf.subarray(off + i, off + i + 16);
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2,"0")).join(" ");
    const ascii = Array.from(slice).map(b => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".")).join("");
    lines.push(`+${i.toString(16).padStart(4,"0")}  ${hex.padEnd(48)}  ${ascii}`);
  }
  return lines.join("\n");
}

function findChar(buf, fnAndLn) {
  const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);
  return recs.find(r => fnAndLn(r));
}

function step1() {
  // Find Marcus Livius_Drusus by name match (record at 0x01506718 in rome5 per dossier)
  for (const fname of ["save_rome5..sav", "save_rome6.sav", "save_rome7.sav", "save_rome8.sav", "save_rome9.sav", "save_rome10.sav"]) {
    const buf = loadBuf(fname);
    const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);
    const m = recs.find(r => r.firstName === "Marcus" && r.lastName === "Livius_Drusus");
    const all_marcus = recs.filter(r => r.firstName === "Marcus");
    console.log(`${fname}: total=${recs.length} all_Marcus=${all_marcus.length} Livius_Drusus=${m ? "@0x"+m.offset.toString(16) : "MISSING"}`);
    if (m) console.log(`  age=${m.age} traits=${m.traits.length} role=${m.role} pUuid=0x${m.primaryUuid.toString(16)} sUuid=0x${m.secondaryUuid.toString(16)}`);
  }
}

function step2() {
  // The dossier says rec at 0x01506718, uuid 06 4c a4 cd. Let's just dump that offset directly
  // and parse it manually.
  const buf = loadBuf("save_rome5..sav");
  const o = 0x01506718;
  console.log(`raw bytes at 0x${o.toString(16)}:`);
  console.log(dumpHex(buf, o - 64, 64));
  console.log("--- record starts here ---");
  console.log(dumpHex(buf, o, 380));

  // Read field by field
  const first = buf.readUInt32LE(o);
  const last = buf.readUInt32LE(o + 5);
  console.log(`\nfirstName idx=${first} -> ${nameLookup[first]}`);
  console.log(`lastName idx=${last} -> ${nameLookup[last]}`);
  console.log(`gender=${buf[o+4]} age=${242 - buf[o+26]}`);
  console.log(`primaryUuid (-47) = 0x${buf.readUInt32LE(o-47).toString(16).padStart(8,"0")}`);
  console.log(`secondaryUuid (-43) = 0x${buf.readUInt32LE(o-43).toString(16).padStart(8,"0")}`);
  console.log(`fatherUuid (+46) = 0x${buf.readUInt32LE(o+46).toString(16).padStart(8,"0")}`);
  console.log(`role (+42) = ${buf[o+42]}`);
  console.log(`traitCount (+302) = ${buf.readUInt16LE(o+302)}`);
}

function step3(charName = "Aulus_Gabinius", primary = 0x9dfc590c) {
  // Diff Aulus Gabinius across all rome saves; he's mentioned in the brief
  // primaryUuid 0c59fc9d, secondaryUuid cb79a1ae per the brief.
  const sortedSaves = ["save_rome1.sav","save_rome2.sav","save_rome3.sav","save_rome4.sav","save_rome5..sav","save_rome6.sav","save_rome7.sav","save_rome8.sav","save_rome9.sav","save_rome10.sav"];
  const records = {};
  for (const f of sortedSaves) {
    const buf = loadBuf(f);
    const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);
    const m = recs.find(r => r.firstName === "Aulus" && r.lastName === "Gabinius");
    records[f] = m ? { buf, m } : null;
    console.log(`${f}: Aulus Gabinius @ ${m ? "0x" + m.offset.toString(16) : "MISSING"}  age=${m?.age} traits=${m?.traits.length} pUuid=0x${m?.primaryUuid.toString(16)}`);
  }
  return records;
}

function step4() {
  // Diff Aulus Gabinius's interior between two saves
  const a = loadBuf("save_rome5..sav");
  const b = loadBuf("save_rome6.sav");
  const recsA = cp.findCharacterRecords(a, nameLookup, traitNames, null);
  const recsB = cp.findCharacterRecords(b, nameLookup, traitNames, null);
  // pick same character (Aulus Gabinius)
  const ma = recsA.find(r => r.firstName === "Aulus" && r.lastName === "Gabinius");
  const mb = recsB.find(r => r.firstName === "Aulus" && r.lastName === "Gabinius");
  console.log(`Aulus rome5 @ 0x${ma.offset.toString(16)}, rome6 @ 0x${mb.offset.toString(16)}`);
  console.log(`age rome5=${ma.age} rome6=${mb.age}, traits rome5=${ma.traits.length} rome6=${mb.traits.length}`);
  console.log(`pUuid 0x${ma.primaryUuid.toString(16)}`);
  // Establish record extent. Use 600 bytes to span trait area + portraits.
  console.log("\n# byte-by-byte diff [-48 .. +600]");
  for (let d = -48; d < 600; d++) {
    if (ma.offset + d >= a.length || mb.offset + d >= b.length) break;
    const va = a[ma.offset + d];
    const vb = b[mb.offset + d];
    if (va !== vb) {
      console.log(`  rel ${(d>=0?"+":"")}${d.toString().padStart(4)}  rome5=0x${va.toString(16).padStart(2,"0")} (${va})  rome6=0x${vb.toString(16).padStart(2,"0")} (${vb})`);
    }
  }
}

function step5() {
  // Examine trait/ancillary block disassembly for Aulus Gabinius
  const buf = loadBuf("save_rome5..sav");
  const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);
  const m = recs.find(r => r.firstName === "Aulus" && r.lastName === "Gabinius");
  if (!m) { console.log("missing"); return; }
  const o = m.offset;
  const tc = buf.readUInt16LE(o + 302);
  console.log(`Aulus Gabinius @ 0x${o.toString(16)} traitCount=${tc} (parser sees ${m.traits.length} traits)`);
  console.log("\n# trait block disassembly (LE id u32, level u16, _u16) starting +308");
  for (let k = 0; k < tc; k++) {
    const tid = buf.readUInt32LE(o + 308 + k * 8);
    const lvl = buf.readUInt16LE(o + 308 + k * 8 + 4);
    const flag = buf.readUInt16LE(o + 308 + k * 8 + 6);
    const tnm = traitNames[tid] || `#${tid}`;
    console.log(`  [${k}] off=+${308 + k*8}  id=${tid} (${tnm})  lvl=${lvl}  _=${flag}`);
  }
  // Also look at the +132..+302 zone
  console.log("\n# preceding zone +12..+302 (look for ancillaries and stats)");
  console.log(dumpHex(buf, o + 12, 290));
}

const step = process.argv[2] || "1";
if (step === "1") step1();
else if (step === "2") step2();
else if (step === "3") step3();
else if (step === "4") step4();
else if (step === "5") step5();
else console.log("usage: node dig-charmap.js [1-5]");
