// Better trade-goods probe:
// 1) Look at u32 fields correlated with resource COUNT
// 2) Look for byte sequences inside settlement record that hold ids of placed resources

const fs = require('fs');
const buf = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav');
const res = JSON.parse(fs.readFileSync('C:/dev/Provincia/public/resources_large.json'));

const RES_NAMES = ['gold','silver','pottery','horses','grain','timber','iron','olive_oil','wine','slaves','slave_trade','glass','marble','textiles','purple_dye','incense','silk','wild_animals','livestock','tin','copper','lead','amber','elephants','camels','salt','fish','dates','hemp','honey','flax','spices','cotton','stone','papyrus','villages','sheep','sulphur','gemstones','perfumes','dyes','coal','pitch','fruits'];
const nameToId = {}; RES_NAMES.forEach((n,i) => nameToId[n] = i);

const regionToCity = require('./region-to-city.json');
const cityToRegion = {};
for (const [r, c] of Object.entries(regionToCity)) cityToRegion[c] = r;

// Reuse findSettlements
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

const settlementsWithRes = [];
for (const s of settlements) {
  const region = cityToRegion[s.name];
  if (!region) continue;
  const r = res[region];
  if (!r || r.length === 0) continue;
  // Set of resource IDs (those that fit in our 44-name list)
  const ids = new Set();
  const typeAmounts = {};
  for (const e of r) {
    if (nameToId.hasOwnProperty(e.type)) ids.add(nameToId[e.type]);
    typeAmounts[e.type] = (typeAmounts[e.type] || 0) + e.amount;
  }
  settlementsWithRes.push({ ...s, region, resources: r, resCount: r.length, ids: [...ids], typeAmounts });
}

console.log('settlements:', settlementsWithRes.length);

// Approach 1: u32 correlation with resCount
function pearson(xs, ys) {
  const n = xs.length;
  let sx=0,sy=0,sxy=0,sx2=0,sy2=0;
  for (let i = 0; i < n; i++) { sx+=xs[i]; sy+=ys[i]; sxy+=xs[i]*ys[i]; sx2+=xs[i]*xs[i]; sy2+=ys[i]*ys[i]; }
  const num = n*sxy - sx*sy;
  const dx = n*sx2 - sx*sx, dy = n*sy2 - sy*sy;
  if (dx <= 0 || dy <= 0) return 0;
  return num / Math.sqrt(dx*dy);
}

const resCounts = settlementsWithRes.map(s => s.resCount);
console.log('resCount distribution: min=' + Math.min(...resCounts) + ' max=' + Math.max(...resCounts) + ' mean=' + (resCounts.reduce((a,b)=>a+b,0)/resCounts.length).toFixed(2));

// Sum amount across all resources
const totalAmounts = settlementsWithRes.map(s => Object.values(s.typeAmounts).reduce((a,b)=>a+b,0));
console.log('total amount range:', Math.min(...totalAmounts), '..', Math.max(...totalAmounts));

console.log('\nu32 correlations with resCount (top 10):');
const u32Corrs = [];
for (let T = 0; T < 3500; T++) {
  const xs = settlementsWithRes.map(s => {
    if (s.tax + T + 4 > buf.length) return 0;
    return buf.readUInt32LE(s.tax + T);
  });
  // Filter saturated values (likely runtime pointers)
  const valid = xs.filter(v => v < 1e8).length;
  if (valid < settlementsWithRes.length * 0.5) continue;
  const r = pearson(xs, resCounts);
  u32Corrs.push({ T, r });
}
u32Corrs.sort((a,b) => Math.abs(b.r) - Math.abs(a.r));
for (const c of u32Corrs.slice(0, 20)) {
  console.log(' T=' + c.T + ' r=' + c.r.toFixed(3));
}

console.log('\nu32 correlations with TOTAL amount (top 20):');
const u32Corrs2 = [];
for (let T = 0; T < 3500; T++) {
  const xs = settlementsWithRes.map(s => {
    if (s.tax + T + 4 > buf.length) return 0;
    return buf.readUInt32LE(s.tax + T);
  });
  const valid = xs.filter(v => v < 1e8).length;
  if (valid < settlementsWithRes.length * 0.5) continue;
  const r = pearson(xs, totalAmounts);
  u32Corrs2.push({ T, r });
}
u32Corrs2.sort((a,b) => Math.abs(b.r) - Math.abs(a.r));
for (const c of u32Corrs2.slice(0, 20)) {
  console.log(' T=' + c.T + ' r=' + c.r.toFixed(3));
}
