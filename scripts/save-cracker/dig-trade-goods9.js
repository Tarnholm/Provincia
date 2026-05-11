// Examine bytes at T=1093 - this is u32 but the values look packed-into-bytes.
// Let me see all 4 bytes of T=1093..+1096 and T=1161..+1164.

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

// Look at all 1304 settlements' bytes at T=1090..1100, T=1158..1168
// to look for u8 patterns within u32 boundaries
console.log('Settlements ordered by totalAmt — show bytes at +1090..+1100');
console.log('name'.padEnd(25), 'resC tAmt | bytes @+1090..+1100');
ss.sort((a,b) => b.totalAmt - a.totalAmt);
for (const s of ss.slice(0, 20)) {
  const bytes = buf.slice(s.tax + 1090, s.tax + 1100).toString('hex');
  console.log(s.name.padEnd(25), s.resCount.toString().padStart(3), s.totalAmt.toString().padStart(3), '|', bytes);
}
console.log('--- bottom 10:');
for (const s of ss.slice(-10)) {
  const bytes = buf.slice(s.tax + 1090, s.tax + 1100).toString('hex');
  console.log(s.name.padEnd(25), s.resCount.toString().padStart(3), s.totalAmt.toString().padStart(3), '|', bytes);
}

console.log('\nBytes at +1158..+1168:');
ss.sort((a,b) => b.totalAmt - a.totalAmt);
for (const s of ss.slice(0, 20)) {
  const bytes = buf.slice(s.tax + 1158, s.tax + 1168).toString('hex');
  console.log(s.name.padEnd(25), s.resCount.toString().padStart(3), s.totalAmt.toString().padStart(3), '|', bytes);
}

// Now, what about u8 at T=1095? With r=0.5, it's probably bytes 1095 = high-byte of u32.
// Let's check if u8 at specific T has direct relationship with totalAmt
console.log('\nBest u8 correlations with totalAmt:');
function pearson(xs, ys) {
  const n = xs.length;
  let sx=0,sy=0,sxy=0,sx2=0,sy2=0;
  for (let i = 0; i < n; i++) { sx+=xs[i]; sy+=ys[i]; sxy+=xs[i]*ys[i]; sx2+=xs[i]*xs[i]; sy2+=ys[i]*ys[i]; }
  const num = n*sxy - sx*sy;
  const dx = n*sx2 - sx*sx, dy = n*sy2 - sy*sy;
  if (dx <= 0 || dy <= 0) return 0;
  return num / Math.sqrt(dx*dy);
}
const totalAmts = ss.map(s => s.totalAmt);
const u8 = [];
for (let T = 0; T < 3500; T++) {
  const xs = ss.map(s => buf[s.tax + T]);
  const r = pearson(xs, totalAmts);
  u8.push({ T, r });
}
u8.sort((a,b) => Math.abs(b.r) - Math.abs(a.r));
for (const c of u8.slice(0, 20)) console.log(' T=' + c.T + ' r=' + c.r.toFixed(3));

// Look for "list of resource ids" in payload - perhaps a sequence of u32 IDs in the 792-range
// at some offset within the record
// Get Rome's resource IDs from the 792-name index
const RES_792 = require('fs').readFileSync('C:/RIS/RIS/data/descr_sm_resources.txt', 'utf8');
const re = /^\s*"(\w+)":\s*\{/gm;
const names792 = [];
let m;
while ((m = re.exec(RES_792))) names792.push(m[1]);
const id792 = {};
names792.forEach((n,i) => id792[n] = i);
console.log('\n792-list ID for Rome resources:');
const Rome = ss.find(s => s.name === 'Rome');
for (const r of Rome.resources) {
  console.log(' ', r.type, '→', id792[r.type]);
}
