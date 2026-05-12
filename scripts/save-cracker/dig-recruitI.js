// Clean side-by-side hex dump of the queue body for all 3 save variants
// at offsets 0..max in 4-byte u32-aligned columns.

const fs = require('fs');
const path = require('path');

const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVE_DIR, 'save_1.2.sav'));
const B = fs.readFileSync(path.join(SAVE_DIR, 'save_2.2.sav'));
const C = fs.readFileSync(path.join(SAVE_DIR, 'save_3.2.sav'));

function body(buf) {
  const ds = buf.indexOf(Buffer.from('default_set\0'), 0xf84600, 'latin1');
  const hr = buf.indexOf(Buffer.from('hinterland_region\0'), 0xf84600, 'latin1');
  return buf.slice(ds + 12, hr - 10);
}

const a = body(A), b = body(B), c = body(C);
console.log(`Body sizes: A=${a.length} B=${b.length} C=${c.length}`);

const maxLen = Math.max(a.length, b.length, c.length);
function u32(buf, i) {
  if (i + 4 > buf.length) return null;
  return buf.readUInt32LE(i);
}
function fmt(v) { return v === null ? '          ' : v.toString().padStart(10); }
function hex8(buf, i) {
  if (i >= buf.length) return '        ';
  return buf[i].toString(16).padStart(2, '0');
}

console.log('\nu32 view (rel offset, save_1, save_2, save_3):');
for (let i = 0; i < maxLen; i += 4) {
  const v1 = u32(a, i), v2 = u32(b, i), v3 = u32(c, i);
  // Mark differences
  const set = new Set([v1, v2, v3]);
  const m = set.size > 1 ? ' ***' : '';
  console.log(`  +${i.toString().padStart(3)}  ${fmt(v1)}  ${fmt(v2)}  ${fmt(v3)}${m}`);
}

// Also show queue block as u32-aligned
// for save_2 the queue is +53..+105 — NOT u32-aligned to body start
// Let me check if it's u32-aligned to header end. Header is 53 bytes (NOT mult of 4).
// Better assumption: queue might start at body+52 or body+56 (4-aligned).
//
// Looking at the dump:
// body+52 in save_1 = 00, save_2 = 2d, save_3 = ba — different across all 3
// body+56 in save_1 = beyond length, save_2 = 00, save_3 = 6d ('m')
//
// Actually I think the queue block isn't separately 4-aligned; it's just appended.
// In save_2.2, byte +49..+52 = 8c 4d 32 2d (queue UUID), and that's the same UUID at +4..+7 (header).
// So in save_2.2, the header IS 52 bytes long (not 53), and the queue UUID is repeated at body+49.
//
// Let me retry alignment with body separated as header (52B) + queue (rest).
console.log('\nRe-trying with 52-byte header + queue (4-byte aligned):');
for (let i = 0; i < maxLen; i += 4) {
  const v1 = u32(a, i), v2 = u32(b, i), v3 = u32(c, i);
  const set = new Set([v1, v2, v3]);
  const m = set.size > 1 ? ' ***' : '';
  // tag this region
  const tag = i < 52 ? '  HDR' : ' QUEUE';
  console.log(`  +${i.toString().padStart(3)}${tag}  ${fmt(v1)}  ${fmt(v2)}  ${fmt(v3)}${m}`);
}
