// Trade goods per settlement - first probe
// Strategy: find a settlement with a known unique set of resources from public/resources_large.json
// then look for a byte pattern matching that resource set inside its settlement record

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const RES_JSON = 'C:/dev/Provincia/public/resources_large.json';

const buf = fs.readFileSync(SAVE);
const resources = JSON.parse(fs.readFileSync(RES_JSON, 'utf8'));

console.log('save size:', buf.length);
console.log('settlements w/ resources:', Object.keys(resources).length);

// Each settlement starts with `cb 00 00 00` tag at -21 from tax byte (per dossier).
// Tax_byte+341..344 = X u32, +345..348 = Y u32.
// Let's find Rome's settlement record (X=285, Y=404 per session 3).
// Settlements are wrapped in `01 XX YY` marker for UTF-16LE name at +2269 from tax.

// Step 1: find all settlement records by `cb 00 00 00` signature
const sigCount = (() => {
  let c = 0;
  const sig = Buffer.from([0xcb, 0x00, 0x00, 0x00]);
  let p = 0;
  while ((p = buf.indexOf(sig, p)) !== -1) {
    // need to land on u32 alignment - filter
    c++;
    p++;
  }
  return c;
})();
console.log('cb 00 00 00 hits anywhere:', sigCount);

// Step 2: find Rome's settlement by walking from a known position.
// Per session 3: Rome's tax_byte at 0xf8567f in rome10 (= 0xf85af1 in rome7..rome9).
// Verify the cb tag is at tax_byte - 21
const ROME_TAX = 0xf8567f;
console.log('byte at Rome tax - 21:', buf.slice(ROME_TAX - 21, ROME_TAX - 17).toString('hex'));
console.log('tax level at Rome:', buf[ROME_TAX]);

// Read Rome's X, Y at +341, +345
console.log('Rome X:', buf.readUInt32LE(ROME_TAX + 341), 'Y:', buf.readUInt32LE(ROME_TAX + 345));
console.log('Rome pop +775:', buf.readUInt32LE(ROME_TAX + 775));

// Step 3: Read Rome's settlement name to find which entry in resources_large.json
// Settlement name marker at +2269: 01 LEN_LO LEN_HI UTF-16LE
const nameMarker = ROME_TAX + 2269;
console.log('marker byte at +2269:', buf[nameMarker]);
const nameLen = buf.readUInt16LE(nameMarker + 1);
const name = buf.slice(nameMarker + 3, nameMarker + 3 + nameLen * 2).toString('utf16le');
console.log('settlement name:', JSON.stringify(name), 'len:', nameLen);

// Step 4: Look up Rome's resources
console.log('Rome resources from public/resources_large.json:');
if (resources[name]) {
  for (const r of resources[name]) {
    console.log(' ', r.type, '@', r.x, r.y);
  }
} else {
  console.log(' (no entry — maybe name mismatch)');
}
