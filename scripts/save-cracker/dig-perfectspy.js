// Session 38 — perfect_spy console cheat
// Compares save_9.2.sav (pre) vs save_10.2.sav (post `§ perfect_spy`).
// Both files are 34,690,934 bytes (identical size to FoW pair).
//
// Result: ONLY 2 bytes differ — both inside the known per-save tick counter
// at 0x43f8 (u32 LE). No flag, no Lua byte, no per-faction storage.
//
// Conclusion: perfect_spy is a transient Lua/script side-effect that is NOT
// persisted to the .sav file. Reloading a save taken under perfect_spy will
// likely revert to normal vision (untested, but the byte evidence is unambiguous).
//
// Contrast with toggle_fow (session 37): that one flipped a real flag byte
// at 0x44e2 (u8) PLUS the counter PLUS a Lua-state byte at 0x02110de5.
// perfect_spy flips none of those.

const fs = require('fs');
const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const a = fs.readFileSync(dir + 'save_9.2.sav');
const b = fs.readFileSync(dir + 'save_10.2.sav');

const diffs = [];
for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs.push(i);
console.log('sizes:', a.length, b.length);
console.log('total diff bytes:', diffs.length);
for (const o of diffs) console.log('  0x' + o.toString(16), 'a=' + a[o].toString(16), 'b=' + b[o].toString(16));
console.log('counter @ 0x43f8 (u32 LE):', a.readUInt32LE(0x43f8), '->', b.readUInt32LE(0x43f8),
  '(delta', b.readUInt32LE(0x43f8) - a.readUInt32LE(0x43f8) + ')');
console.log('toggle_fow flag @ 0x44e2:', a[0x44e2], '->', b[0x44e2], '(unchanged: both off)');
