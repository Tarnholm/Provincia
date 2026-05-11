// dig-gap1.js — Self-pointer scan of the 9.7MB body-root gap
// Gap: 0x633bb3 .. 0xf88637 in save_1.2.sav (RIS imperial campaign)
// Goal: find {u32 offset==pos, u32 size} section headers.

const fs = require('fs');
const path = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(path);

const START = 0x633bb3;
const END   = 0xf88637;
console.log(`File size: ${buf.length}  Gap size: ${END - START} (${((END-START)/1024/1024).toFixed(2)} MB)`);
console.log(`Scanning ${START.toString(16)}..${END.toString(16)} for self-pointers (u32@p == p)`);

const selfPtrs = [];
// align to 1, allow any byte offset, since nested sections aren't always 4-aligned
for (let p = START; p < END - 8; p++) {
  const v = buf.readUInt32LE(p);
  if (v === p) {
    const size = buf.readUInt32LE(p + 4);
    // sanity: size must keep us inside the gap (or just past), and >= 8
    if (size >= 8 && size < 0x2000000) {
      selfPtrs.push({ pos: p, size, end: p + size });
    }
  }
}
console.log(`Found ${selfPtrs.length} candidate self-pointers in gap.`);

// dump first 50 + last 10
function fmt(s) {
  return `0x${s.pos.toString(16).padStart(8,'0')}  size=${s.size.toString().padStart(10)} (0x${s.size.toString(16)})  end=0x${s.end.toString(16).padStart(8,'0')}`;
}
console.log('\n=== first 60 self-pointers ===');
selfPtrs.slice(0, 60).forEach(s => console.log(fmt(s)));
console.log('\n=== last 20 self-pointers ===');
selfPtrs.slice(-20).forEach(s => console.log(fmt(s)));

// Find TOP-LEVEL ones (those whose pos is not contained inside any other section that started earlier and didn't end yet)
// Simpler: sort by pos, group by nesting depth using stack.
selfPtrs.sort((a,b) => a.pos - b.pos);

const stack = [];
const depths = [];
for (const s of selfPtrs) {
  while (stack.length && stack[stack.length-1].end <= s.pos) stack.pop();
  // a section is well-nested if its end <= parent's end
  if (stack.length === 0 || s.end <= stack[stack.length-1].end) {
    depths.push({ ...s, depth: stack.length });
    stack.push(s);
  } else {
    // overlaps parent — likely a false positive
    depths.push({ ...s, depth: -1 });
  }
}

// Count by depth
const byDepth = {};
for (const d of depths) byDepth[d.depth] = (byDepth[d.depth] || 0) + 1;
console.log(`\nDepth histogram (well-nested only):`);
Object.keys(byDepth).sort((a,b)=>+a-+b).forEach(k => console.log(`  depth ${k}: ${byDepth[k]}`));

// List depth=0 (top-level direct children of the gap)
const top = depths.filter(d => d.depth === 0);
console.log(`\n=== ${top.length} top-level self-pointer sections in the gap ===`);
top.forEach(s => {
  const ctx = buf.slice(s.pos+8, s.pos+8+16).toString('hex');
  console.log(`${fmt(s)}  payload[0:16]=${ctx}`);
});

// Save all to JSON
fs.writeFileSync(__dirname + '/gap-selfptrs.json', JSON.stringify(depths, null, 2));
console.log(`\nWrote ${depths.length} self-pointers to gap-selfptrs.json`);
