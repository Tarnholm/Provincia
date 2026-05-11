// T=1093 has r=0.5 with total resource amount. Inspect this field.
const fs = require('fs');
const buf = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav');
const res = JSON.parse(fs.readFileSync('C:/dev/Provincia/public/resources_large.json'));

const regionToCity = require('./region-to-city.json');
const cityToRegion = {};
for (const [r, c] of Object.entries(regionToCity)) cityToRegion[c] = r;

function findSettlements() {
  const settlements = [];
  for (let i = 0; i < buf.length - 50; i++) {
    if (buf[i] !== 0x01) continue;
    const ln = buf.readUInt16LE(i + 1);
    if (ln < 3 || ln > 40) continue;
    let isName = true;
    for (let k = 0; k < ln && isName; k++) {
      const c = buf[i + 3 + 2*k];
      const hi = buf[i + 3 + 2*k + 1];
      if (hi !== 0) { isName = false; break; }
      if (!((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x20 || c === 0x5f || c === 0x2d || c === 0x27 || (c >= 0x30 && c <= 0x39))) { isName = false; break; }
    }
    if (!isName) continue;
    if (!(buf[i + 3] >= 0x41 && buf[i + 3] <= 0x5a)) continue;
    const name = buf.slice(i+3, i+3+2*ln).toString('utf16le');
    const tax = i - 2269;
    if (tax < 0) continue;
    if (buf[tax] > 4) continue;
    const x = buf.readUInt32LE(tax + 341);
    const y = buf.readUInt32LE(tax + 345);
    if (x < 1 || x > 1020 || y < 1 || y > 700) continue;
    settlements.push({ tax, name, x, y });
  }
  return settlements;
}

const settlements = findSettlements();
const ss = [];
for (const s of settlements) {
  const region = cityToRegion[s.name];
  if (!region) continue;
  const r = res[region];
  if (!r || r.length === 0) continue;
  const totalAmt = r.reduce((a,b)=>a+b.amount, 0);
  ss.push({ ...s, region, resources: r, resCount: r.length, totalAmt });
}

// At T=1093, dump u32 values and resource info
ss.sort((a,b) => b.totalAmt - a.totalAmt);
console.log('top 20 settlements by total resource amount:');
console.log('name'.padEnd(20), 'resCount', 'totalAmt', 'u32@1093', 'u32@1161');
for (const s of ss.slice(0, 20)) {
  const v1 = buf.readUInt32LE(s.tax + 1093);
  const v2 = buf.readUInt32LE(s.tax + 1161);
  console.log(s.name.padEnd(20), s.resCount.toString().padStart(3), s.totalAmt.toString().padStart(3), v1.toString().padStart(10), v2.toString().padStart(10));
}
console.log('\nbottom 20:');
for (const s of ss.slice(-20)) {
  const v1 = buf.readUInt32LE(s.tax + 1093);
  const v2 = buf.readUInt32LE(s.tax + 1161);
  console.log(s.name.padEnd(20), s.resCount.toString().padStart(3), s.totalAmt.toString().padStart(3), v1.toString().padStart(10), v2.toString().padStart(10));
}

// Try per-byte resource-set bitmask
// Each known resource type has an id (0..43 in our list)
// If saved as a bitset, each settlement should have a fixed-size byte array where bit `id` is set iff resource present
// The smallest fits in 6 bytes (44 bits)
// Look for a region where the *bitmask matches* perfectly

const RES_NAMES = ['gold','silver','pottery','horses','grain','timber','iron','olive_oil','wine','slaves','slave_trade','glass','marble','textiles','purple_dye','incense','silk','wild_animals','livestock','tin','copper','lead','amber','elephants','camels','salt','fish','dates','hemp','honey','flax','spices','cotton','stone','papyrus','villages','sheep','sulphur','gemstones','perfumes','dyes','coal','pitch','fruits'];
const nameToId = {}; RES_NAMES.forEach((n,i) => nameToId[n] = i);

// Build per-settlement bitmask (44 bits = 6 bytes)
for (const s of ss) {
  const mask = Buffer.alloc(8, 0); // u64
  for (const r of s.resources) {
    if (nameToId[r.type] !== undefined) {
      const bit = nameToId[r.type];
      mask[Math.floor(bit/8)] |= (1 << (bit & 7));
    }
  }
  s.mask = mask;
}

// Search for the bitmask of Rome inside Rome's settlement record range
console.log('\nRome bitmask:', ss.find(s => s.name === 'Rome').mask.toString('hex'));
console.log('Sparta-ish: looking for a settlement with mask=hex...');
const Rome = ss.find(s => s.name === 'Rome');
// Search Rome's record [tax-21..tax+3728] for Rome's mask
const RECORD_START = Rome.tax - 21;
const RECORD_END = Rome.tax + 3728;
let foundMask = false;
const mask6 = Rome.mask.slice(0, 6);
for (let i = RECORD_START; i < RECORD_END - 6; i++) {
  // Compare 6 bytes
  let match = true;
  for (let k = 0; k < 6; k++) {
    if (buf[i+k] !== mask6[k]) { match = false; break; }
  }
  if (match) {
    console.log('mask hit at +', (i - Rome.tax), 'in Rome record');
    foundMask = true;
  }
}
if (!foundMask) console.log('Rome mask not found in Rome record (likely bitmask not contiguous OR not bit-packed)');

// Try the high bits of bitmask too
const mask8 = Rome.mask;
for (let i = RECORD_START; i < RECORD_END - 8; i++) {
  let match = true;
  for (let k = 0; k < 8; k++) {
    if (buf[i+k] !== mask8[k]) { match = false; break; }
  }
  if (match) {
    console.log('mask8 hit at +', (i - Rome.tax), 'in Rome record');
  }
}
