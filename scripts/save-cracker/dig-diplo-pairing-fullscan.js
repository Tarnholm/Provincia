// dig-diplo-pairing-fullscan.js
//
// FULL-FILE test: there are ~220 DIPLO_MARKER blocks (one per faction record,
// across all 239 factions). Collect EVERY relationUuid across ALL blocks and
// test whether any uuid appears in 2 blocks (= reciprocal pair). This is the
// definitive uniqueness test at full coverage.

const fs = require('fs');
const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav';
const buf = fs.readFileSync(SAVE);
const DIPLO_MARKER = 0x39240005;

// Find every diplo block; for each, the OWNING faction record begins some
// bytes earlier. We identify the owner record by walking back to the nearest
// self-pointer pair (+24/+40 == offset). For pairing we only need a stable
// block id, so we use the marker offset itself as the owner key.
const blocks = [];
for (let p = 0; p < buf.length - 8; p++) {
  if (buf.readUInt32LE(p) !== DIPLO_MARKER) continue;
  const count = buf.readUInt32LE(p + 4);
  if (count > 400) continue;
  // sanity: validate the entries look like {uuid, class<8, attitude<8, tag=0x10101}
  let ok = true;
  const rels = [];
  for (let k = 0; k < count; k++) {
    const o = p + 8 + k * 16;
    if (o + 16 > buf.length) { ok = false; break; }
    const cls = buf.readUInt32LE(o + 4);
    const att = buf.readUInt32LE(o + 8);
    const tag = buf.readUInt32LE(o + 12);
    if (cls > 10 || att > 10 || tag !== 0x10101) { ok = false; break; }
    rels.push({ uuid: buf.readUInt32LE(o), class_: cls, attitude: att });
  }
  if (!ok || rels.length !== count) continue;
  blocks.push({ at: p, count, rels });
  p += 8 + count * 16 - 1;
}
console.log('valid diplo blocks (tag-checked):', blocks.length);
let total = 0; for (const b of blocks) total += b.count;
console.log('total relations across all blocks:', total);

// uuid -> [blockIdx...]
const uuidBlocks = new Map();
for (let i = 0; i < blocks.length; i++) {
  for (const r of blocks[i].rels) {
    if (!uuidBlocks.has(r.uuid)) uuidBlocks.set(r.uuid, []);
    uuidBlocks.get(r.uuid).push({ blk: i, class_: r.class_ });
  }
}
console.log('distinct uuids:', uuidBlocks.size);

const hist = new Map();
for (const [u, list] of uuidBlocks) hist.set(list.length, (hist.get(list.length)||0)+1);
console.log('\n=== uuid multiplicity histogram (across ALL', blocks.length, 'blocks) ===');
for (const [n,c] of [...hist.entries()].sort((a,b)=>a[0]-b[0])) console.log(`  appears in ${n} block(s): ${c} uuids`);

// If any uuid appears in 2 blocks, show class agreement (reciprocal test)
const pairs = [...uuidBlocks.entries()].filter(([u,l]) => l.length === 2);
if (pairs.length) {
  let agree=0, disagree=0;
  for (const [u,l] of pairs) { if (l[0].class_===l[1].class_) agree++; else disagree++; }
  console.log(`\nshare==2 uuids: ${pairs.length}  classAgree=${agree} classDisagree=${disagree}`);
  console.log('samples:', pairs.slice(0,10).map(([u,l])=>`${u}:blk${l[0].blk}/blk${l[1].blk}`).join('  '));
} else {
  console.log('\nNo uuid appears in 2 blocks -> NO reciprocal storage.');
}

// uuid range / density
const us = [...uuidBlocks.keys()].sort((a,b)=>a-b);
console.log('\nuuid range:', us[0], '..', us[us.length-1], ' distinct:', us.length);
let consec=0; for (let i=1;i<us.length;i++) if (us[i]===us[i-1]+1) consec++;
console.log('consecutive fraction:', (consec/us.length*100).toFixed(1)+'%');
console.log('fill density:', (us.length/(us[us.length-1]-us[0])*100).toFixed(1)+'% of the integer range');
