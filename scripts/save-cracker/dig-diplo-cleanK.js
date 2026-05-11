// Session 32 step K: Understand the +1/-1 byte insert/delete pattern at 0xf846e0+.
// We saw delta=+1 events (B has extra byte) AND delta=-1 events (A has extra byte) alternating.
// Net should give the -10 file delta.

const fs = require('fs');
const path = require('path');

const events = JSON.parse(fs.readFileSync('C:/dev/Provincia/scripts/save-cracker/diplo-clean-events.json', 'utf8'));

// Region beyond 0xf80000. Categorize by net byte delta.
const regionEvents = events.filter(e => e.ai >= 0xf80000);
console.log(`Region events: ${regionEvents.length}`);
let netDelta = 0;
let plus1 = 0, minus1 = 0, other = 0;
for (const e of regionEvents) {
  if (e.type === 'replace') {
    const d = e.bLen - e.aLen;
    netDelta += d;
    if (d === 1) plus1++;
    else if (d === -1) minus1++;
    else if (d !== 0) other++;
  }
}
console.log(`Net delta in region: ${netDelta}`);
console.log(`+1 events (B has extra): ${plus1}, -1 events (A has extra): ${minus1}, other-size: ${other}`);

// Most are net 0? Let me filter only events with non-zero size delta.
const insOrDel = regionEvents.filter(e => e.type === 'replace' && e.bLen !== e.aLen);
console.log(`Net-changed events: ${insOrDel.length}`);
console.log(`Sample first 30:`);
for (const e of insOrDel.slice(0, 30)) {
  console.log(`  A=0x${e.ai.toString(16)} B=0x${e.bi.toString(16)} aLen=${e.aLen} bLen=${e.bLen} d=${e.bLen-e.aLen} aHex=${e.aHex} bHex=${e.bHex}`);
}

// Group: how many +1 and -1 are there, and do they form pairs?
console.log(`\nLooking at pairing: A=ins, then nearby B=del...`);
let i = 0;
let pairs = 0;
while (i < insOrDel.length - 1) {
  const e = insOrDel[i];
  const e2 = insOrDel[i + 1];
  if (e.bLen - e.aLen === 1 && e2.bLen - e2.aLen === -1) {
    pairs++;
  }
  i++;
}
console.log(`+1/-1 pairs (consecutive): ${pairs}`);

// Read the surrounding context for several insertions.
const a = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.1.sav');
const b = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_2.1.sav');

function dump(buf, start, len, label) {
  const lines = [];
  for (let i = 0; i < len; i += 16) {
    const off = start + i;
    const slice = buf.slice(off, Math.min(off + 16, start + len));
    const hexs = Array.from(slice).map(x => x.toString(16).padStart(2, '0')).join(' ');
    const asciis = Array.from(slice).map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('');
    lines.push(`  ${off.toString(16).padStart(8, '0')}: ${hexs.padEnd(48)} ${asciis}`);
  }
  console.log(`${label}\n${lines.join('\n')}`);
}

// First +1 insertion (B side): 0xf846e0, before string "core_building".
console.log(`\n=== B context around 0xf846e0 (+1 insertion of 0x03) ===`);
dump(b, 0xf846a0, 0x100, 'B');
console.log(`\n=== A context around 0xf846e0 ===`);
dump(a, 0xf846a0, 0x100, 'A');

// First -1 deletion (A side has extra byte): 0xf847ce (in A) -- A has byte 0xff that B doesn't.
console.log(`\n=== A context around 0xf847ce ===`);
dump(a, 0xf84780, 0x80, 'A');
console.log(`=== B equivalent (B shifted left 1) ===`);
dump(b, 0xf84780, 0x80, 'B');
