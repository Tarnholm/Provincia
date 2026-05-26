// dig-trade-spain-diff.js
// Diff pre-trade vs post-trade Spain saves to surface trade-route / trade-income
// fields that appear when a trade agreement with Carthage is formed.
"use strict";
const fs = require("fs");
const dir = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";
const pre = fs.readFileSync(dir + "save_17-05-2026   Spain   Turn 1.sav");
const post = fs.readFileSync(dir + "save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav");

console.log("pre size", pre.length, "post size", post.length, "delta", post.length - pre.length);

// Byte-level diff is meaningless across a turn (everything moves). Instead:
// 1) Find LONGEST common prefix and suffix to bound where structural insertions
//    happened.
let pfx = 0;
const minLen = Math.min(pre.length, post.length);
while (pfx < minLen && pre[pfx] === post[pfx]) pfx++;
let sfx = 0;
while (sfx < minLen - pfx && pre[pre.length - 1 - sfx] === post[post.length - 1 - sfx]) sfx++;
console.log("common prefix", pfx, "(0x" + pfx.toString(16) + ")");
console.log("common suffix", sfx);
console.log("pre middle window", pre.length - pfx - sfx, "post middle window", post.length - pfx - sfx);

// Show a hex window around the prefix divergence point
function hexWin(buf, start, len, label) {
  console.log(`\n--- ${label} @0x${start.toString(16)} ---`);
  let out = "";
  for (let i = start; i < start + len && i < buf.length; i += 16) {
    const slab = buf.slice(i, i + 16);
    const h = [...slab].map(b => b.toString(16).padStart(2, "0")).join(" ");
    const a = [...slab].map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : ".").join("");
    out += i.toString(16).padStart(6, "0") + "  " + h.padEnd(48) + "  " + a + "\n";
  }
  console.log(out);
}
hexWin(pre, Math.max(0, pfx - 32), 96, "PRE at divergence");
hexWin(post, Math.max(0, pfx - 32), 96, "POST at divergence");
