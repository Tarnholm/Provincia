// dig-tilegap-geometry.js — prove the +28==54 cells are pure index-geometry (perimeter), not map data
const fs = require('fs');
const DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const MAGIC = Buffer.from([0x05,0,0,0, 0,0,0,0, 0,0,0,0, 0x0a,0,0,0, 0xc8,0,0,0]);

function analyze(s, stride, W){
  const buf = fs.readFileSync(DIR+s);
  const first = buf.indexOf(MAGIC);
  let N=0,p=first;
  while(p+20<=buf.length && buf.readUInt32LE(p)===5 && buf.readUInt32LE(p+12)===10 && buf.readUInt32LE(p+16)===200){N++;p+=stride;}
  const H=N/W;
  console.log(`\n=== ${s} : N=${N}, grid ${W}x${H} ===`);
  // For each varying field, classify cells as perimeter / anti-diagonal / interior
  let onPerim54=0, off54=0, total54=0;
  let onDiag600=0, offDiag600=0, total600=0;
  for(let i=0;i<N;i++){
    const gy=(i/W)|0, gx=i%W;
    const v28=buf.readUInt32LE(first+i*stride+28);
    const v20=buf.readUInt32LE(first+i*stride+20);
    const isPerim = (gx===0||gx===W-1||gy===0||gy===H-1);
    const isDiag = (gx+gy===W-1) || (gx===gy) || (gx+gy===H-1);
    if(v28===54){ total54++; if(isPerim) onPerim54++; else off54++; }
    if(v20===600){ total600++; if(isDiag) onDiag600++; else offDiag600++; }
  }
  console.log(`  +28==54 cells: ${total54}, on rectangle perimeter: ${onPerim54} (${(100*onPerim54/total54).toFixed(1)}%), off: ${off54}`);
  console.log(`  +20==600 cells: ${total600}, on a main/anti diagonal: ${onDiag600} (${(100*onDiag600/total600).toFixed(1)}%), off: ${offDiag600}`);
  // expected perimeter count
  console.log(`  expected perimeter cell count for ${W}x${H} = ${2*W+2*H-4}`);
}
analyze('save_17-05-2026   Spain   Turn 1.sav', 115, 22);
analyze('save_t0.sav', 267, 240);
analyze('save_t0.sav', 267, 238);
