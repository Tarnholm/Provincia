// dig-occupy6.js
// Per brief, known settlement fields:
//   -21 = 0xcb signature
//   +62 = size
//   +341/+345 = X/Y coords
//   +683 = per-turn income
//   +775 = pop u32
//   +819 = growth multiplier
//   +2239 = happiness f32
//
// Read these for all 4 Uria states. Also dump u32s near Uria-1590 and Uria-1877.

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function read(name) { return fs.readFileSync(path.join(SAVE_DIR, name)); }

const saves = [
  ["save_9.1",  read("save_9.1.sav"),  0x1264861, "pre-capture"],
  ["save_10.1", read("save_10.1.sav"), 0x1264861, "enslave"],
  ["save_11.1", read("save_11.1.sav"), 0x12693c6, "(captured-Brundisium scene)"],
  ["save_12.1", read("save_12.1.sav"), 0x1264861, "exterminate"],
];

// Fields per brief
const FIELDS = {
  "-21=0xcb_sig":     [-21, "u8"],
  "+62=size":         [62, "u32"],
  "+341=X":           [341, "u32"],
  "+345=Y":           [345, "u32"],
  "+683=income":      [683, "u32"],
  "+775=pop":         [775, "u32"],
  "+819=growth_mul":  [819, "f32"],
  "+2239=happiness":  [2239, "f32"],
  // candidates
  "-34=u16":          [-34, "u16"],
  "-32=u32_at_-32":   [-32, "u32"],
  "-28=u32_at_-28":   [-28, "u32"],
  "-21=u32_at_-21":   [-21, "u32"],
  "-1590=u32":        [-1590, "u32"],
  "-1586=u32":        [-1586, "u32"],
  "-1582=u32":        [-1582, "u32"],
  "-1877=u8":         [-1877, "u8"],
};

function readField(buf, off, ty) {
  if (ty === "u8") return buf.readUInt8(off);
  if (ty === "u16") return buf.readUInt16LE(off);
  if (ty === "u32") return buf.readUInt32LE(off);
  if (ty === "s32") return buf.readInt32LE(off);
  if (ty === "f32") return buf.readFloatLE(off);
}

console.log("Field summary (all 4 Uria states):");
console.log(`${"FIELD".padEnd(20)} | ${"save_9.1".padEnd(15)} | ${"save_10.1".padEnd(15)} | ${"save_11.1".padEnd(15)} | ${"save_12.1".padEnd(15)}`);
console.log("-".repeat(90));
for (const [label, [off, ty]] of Object.entries(FIELDS)) {
  const row = [label.padEnd(20)];
  for (const [name, buf, m] of saves) {
    const v = readField(buf, m + off, ty);
    let s = ty === "f32" ? v.toFixed(3) : v.toString();
    if (ty.startsWith("u")) s += ` (0x${v.toString(16)})`;
    row.push(s.padEnd(15));
  }
  console.log(row.join(" | "));
}
