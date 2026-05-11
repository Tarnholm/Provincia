// Look for resource bitmask or count fields in the settlement record.
// Sparta has just slaves, livestock, fish.
// Rome has grain, pottery, dyes, fruits, glass, salt, slaves.
// Look for bytes that correlate with resource COUNT or resource SET.

const fs = require('fs');
const buf = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav');
const res = JSON.parse(fs.readFileSync('C:/dev/Provincia/public/resources_large.json'));

const MAP_H = 700;

// Build region → resource list (with IDs)
const RES_NAMES = ['gold','silver','pottery','horses','grain','timber','iron','olive_oil','wine','slaves','slave_trade','glass','marble','textiles','purple_dye','incense','silk','wild_animals','livestock','tin','copper','lead','amber','elephants','camels','salt','fish','dates','hemp','honey','flax','spices','cotton','stone','papyrus','villages','sheep','sulphur','gemstones','perfumes','dyes','coal','pitch','fruits'];
const idToName = {}; RES_NAMES.forEach((n,i) => idToName[i] = n);
const nameToId = {}; RES_NAMES.forEach((n,i) => nameToId[n] = i);

// Find each settlement's tax_byte by name
// Use the (X,Y) + name marker pattern: tax_byte+341/+345 = X,Y; tax_byte+2269 = 0x01 marker + name
// Scan for "01 LEN_LO 00" markers followed by UTF-16LE name strings
function findSettlements() {
  const settlements = [];
  // Look for valid name markers: 01 LEN 00 (small u16) followed by UTF-16LE bytes that are printable ASCII
  for (let i = 0; i < buf.length - 50; i++) {
    if (buf[i] !== 0x01) continue;
    const ln = buf.readUInt16LE(i + 1);
    if (ln < 3 || ln > 40) continue;
    // peek at the chars - all must be ASCII letters/digits/space/underscore/hyphen
    let isName = true;
    for (let k = 0; k < ln && isName; k++) {
      const c = buf[i + 3 + 2*k];
      const hi = buf[i + 3 + 2*k + 1];
      if (hi !== 0) { isName = false; break; }
      if (!((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x20 || c === 0x5f || c === 0x2d || c === 0x27 || (c >= 0x30 && c <= 0x39))) {
        isName = false; break;
      }
    }
    if (!isName) continue;
    // First char must be uppercase
    if (!(buf[i + 3] >= 0x41 && buf[i + 3] <= 0x5a)) continue;
    const name = buf.slice(i+3, i+3+2*ln).toString('utf16le');
    // tax_byte = i - 2269
    const tax = i - 2269;
    if (tax < 0) continue;
    // sanity check: tax_byte ∈ [0..4]
    if (buf[tax] > 4) continue;
    // Read X, Y at +341/+345
    const x = buf.readUInt32LE(tax + 341);
    const y = buf.readUInt32LE(tax + 345);
    if (x < 1 || x > 1020 || y < 1 || y > 700) continue;
    settlements.push({ tax, name, x, y });
  }
  return settlements;
}

const settlements = findSettlements();
console.log('settlements found via name-marker scan:', settlements.length);

// Build region → list of resource types
// First we need to map save settlement name → region key in resources_large.json
// Use descr_regions.txt mapping (region → city/settlement name)
const regionToCity = require('./region-to-city.json');
const cityToRegion = {};
for (const [r, c] of Object.entries(regionToCity)) cityToRegion[c] = r;

// For each settlement, look up its resources
const settlementsWithRes = [];
for (const s of settlements) {
  const region = cityToRegion[s.name];
  if (!region) continue;
  const resources = res[region];
  if (!resources || resources.length === 0) continue;
  settlementsWithRes.push({ ...s, region, resources, resCount: resources.length, resTypes: resources.map(r => r.type) });
}
console.log('settlements with known resources:', settlementsWithRes.length);

// Print a few to validate
console.log('sample:');
for (const s of settlementsWithRes.slice(0, 5)) {
  console.log(' ', s.name, 'tax @ 0x' + s.tax.toString(16), 'X,Y:', s.x, s.y, 'region:', s.region, 'resCount:', s.resCount, 'types:', s.resTypes.join(','));
}

// Now: at every relative offset T in [0..3000], correlate buf[tax+T] with s.resCount
// This is the simplest possible test for "this byte = resource count"
console.log('\nLooking for u8 correlated with resource count...');
const N = settlementsWithRes.length;
let bestT = -1, bestR2 = 0;
for (let T = 0; T < 3500; T++) {
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (const s of settlementsWithRes) {
    const x = buf[s.tax + T];
    const y = s.resCount;
    sumX += x; sumY += y; sumXY += x * y; sumX2 += x*x; sumY2 += y*y;
  }
  const num = N * sumXY - sumX * sumY;
  const denX = N * sumX2 - sumX * sumX;
  const denY = N * sumY2 - sumY * sumY;
  if (denX === 0 || denY === 0) continue;
  const r = num / Math.sqrt(denX * denY);
  if (Math.abs(r) > Math.abs(bestR2)) {
    bestT = T;
    bestR2 = r;
    if (Math.abs(r) > 0.5) console.log('T=' + T + ' r=' + r.toFixed(3));
  }
}
console.log('best correlation: T=' + bestT + ' r=' + bestR2.toFixed(3));
