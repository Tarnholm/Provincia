// dig-tilegap-registry.js — read section registry, list all types+counts, find which section the block is in
const fs = require('fs');
const DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';

function readRegistry(buf){
  let p = 0x500;
  while (p < 0x20000) {
    const count = buf.readUInt32LE(p);
    if (count > 0 && count < 100000) {
      const nameStart = p + 4;
      if (buf[nameStart] >= 0x41 && buf[nameStart] <= 0x5a) {
        const end = buf.indexOf(0x00, nameStart);
        if (end !== -1 && /^[A-Z][A-Z_0-9]*$/.test(buf.slice(nameStart, end).toString('latin1'))) break;
      }
    }
    p++;
  }
  const start=p;
  const types = [];
  while (true) {
    const count = buf.readUInt32LE(p);
    const nameStart = p + 4;
    const end = buf.indexOf(0x00, nameStart);
    if (end<0 || end > nameStart + 60) break;
    const name = buf.slice(nameStart, end).toString('latin1');
    if (!/^[A-Z][A-Z_0-9]*$/.test(name)) break;
    types.push({ id: types.length, name, count });
    p = end + 1;
  }
  return {types, start, end:p};
}

function go(s){
  const buf = fs.readFileSync(DIR+s);
  const {types,start,end} = readRegistry(buf);
  console.log(`\n=== ${s} : registry @0x${start.toString(16)}..0x${end.toString(16)}, ${types.length} types ===`);
  // print interesting ones
  for(const t of types){
    if(/MAP|TILE|TERRAIN|GROUND|WORLD|REGION|MOVEMENT|PATH|GRID/.test(t.name) || t.count===57120 || t.count===440 || t.count>1000)
      console.log(`  ID${t.id}: ${t.name} = ${t.count}`);
  }
}
go('save_t0.sav');
go('save_17-05-2026   Spain   Turn 1.sav');
