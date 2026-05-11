// Look for resource-type IDs inside Rome's settlement record
// Rome (region Roma) has: grain(4), pottery(2), dyes(40), fruits(43), glass(10), salt(25), slaves(9)
// And amounts: 1, 2, 2, 2, 1, 2, 1

const fs = require('fs');
const buf = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav');

// Resource index list from descr_sm_resources.txt
const RES_NAMES = ['gold','silver','pottery','horses','grain','timber','iron','olive_oil','wine','slaves','slave_trade','glass','marble','textiles','purple_dye','incense','silk','wild_animals','livestock','tin','copper','lead','amber','elephants','camels','salt','fish','dates','hemp','honey','flax','spices','cotton','stone','papyrus','villages','sheep','sulphur','gemstones','perfumes','dyes','coal','pitch','fruits'];
const idToName = {};
RES_NAMES.forEach((n,i) => idToName[i] = n);
const nameToId = {};
RES_NAMES.forEach((n,i) => nameToId[n] = i);

const ROME_TAX = 0xf8567f; // tax byte
console.log('Rome tax level byte:', buf[ROME_TAX]);
console.log('Rome X:', buf.readUInt32LE(ROME_TAX + 341), 'Y:', buf.readUInt32LE(ROME_TAX + 345));

// Rome resources from public/resources_large.json
const romaRes = {
  grain: 1,
  pottery: 2,
  dyes: 2,
  fruits: 2,
  glass: 1,
  salt: 2,
  slaves: 1,
};
const romaIds = Object.keys(romaRes).map(n => nameToId[n]);
console.log('Roma resource ids (in 792-list):', romaIds);
console.log('Roma resource names:', Object.keys(romaRes));

// Walk Rome's settlement record (tax-21 .. tax+3727) and look for these IDs as u32, u16, u8
const RECORD_START = ROME_TAX - 21;
const RECORD_END = ROME_TAX + 3728;
console.log('Searching record range', RECORD_START.toString(16), '..', RECORD_END.toString(16));

// Scan for each resource ID byte
for (const id of romaIds) {
  const positions = [];
  for (let i = RECORD_START; i < RECORD_END - 4; i++) {
    if (buf[i] === id && buf[i+1] === 0 && buf[i+2] === 0 && buf[i+3] === 0) {
      positions.push(i - ROME_TAX);
    }
  }
  console.log('id', id.toString().padStart(3), idToName[id].padEnd(10), 'u32 hits relative to tax_byte:', positions.length, 'positions:', positions.slice(0, 20));
}

// Also try u16 (resource id might fit in u16)
console.log('\nu16 scan:');
for (const id of romaIds) {
  const positions = [];
  for (let i = RECORD_START; i < RECORD_END - 2; i++) {
    if (buf[i] === id && buf[i+1] === 0) {
      positions.push(i - ROME_TAX);
    }
  }
  // Don't dump all u16 (0..43 is too common) — just count
  console.log('id', id.toString().padStart(3), idToName[id].padEnd(10), 'u16 hits:', positions.length);
}

// Look for byte sequences that ENCODE the resource set
// E.g., 7 contiguous bytes of [4, 2, 40, 43, 10, 25, 9] in some order
// Try u8 sequence (any order)
const idSetByte = new Set(romaIds);
let bestRun = 0, bestPos = -1;
for (let i = RECORD_START; i < RECORD_END - 10; i++) {
  let runLen = 0;
  const seen = new Set();
  for (let k = 0; k < 30; k++) {
    const b = buf[i+k];
    if (idSetByte.has(b) && !seen.has(b)) {
      seen.add(b);
      runLen++;
    } else if (b === 0 || b === 0xff) {
      // padding allowed within run
    } else {
      break;
    }
  }
  if (runLen >= bestRun) {
    bestRun = runLen;
    bestPos = i;
    if (runLen >= 5) console.log('byte-seq run len', runLen, 'at +', (i - ROME_TAX), 'bytes:', buf.slice(i, i+30).toString('hex'));
  }
}
console.log('best u8 run match:', bestRun, 'at +', bestPos - ROME_TAX);
