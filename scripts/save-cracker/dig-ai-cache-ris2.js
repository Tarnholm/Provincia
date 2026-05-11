// dig-ai-cache-ris2.js — session 19. Better methodology:
// 1) Examine Alexander AI cache at 0x1024 in detail to get the *exact* shape.
// 2) Then search rome10/romet1 using that signature, including within-turn-stable
//    constraint by comparing rome10 (T?) vs romet1 (T1).

const fs = require('fs');
const ROME_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const ALEX_DIR = 'C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z/';

const rome10 = fs.readFileSync(ROME_DIR + 'save_rome10.sav');
const romet1 = fs.readFileSync(ROME_DIR + 'save_Autosave   Republic of Rome   Turn 1.sav');
const alexT13E = fs.readFileSync(ALEX_DIR + '0357_save_Autosave   Macedon   Turn 13 End.sav');
const alexT13S = fs.readFileSync(ALEX_DIR + '0351_save_Autosave   Macedon   Turn 13 Start.sav');
const alexT14E = fs.readFileSync(ALEX_DIR + '0369_save_Autosave   Macedon   Turn 14 End.sav');

// (1) Look at first 30 records of Alexander AI cache verbatim
console.log('Alexander T13E first 30 records at 0x1024:');
for(let i=0;i<30;i++){
  const off = 0x1024 + i*12;
  const a = alexT13E.readUInt32LE(off);
  const b = alexT13E.readUInt32LE(off+4);
  const c = alexT13E.readUInt32LE(off+8);
  console.log('  ['+i+']@0x'+off.toString(16)+' hash=0x'+a.toString(16).padStart(8,'0')+' key=0x'+b.toString(16).padStart(8,'0')+' turn='+c);
}

// Find end of Alexander cache
let end = 0x1024;
for(let off=0x1024;off<alexT13E.length-12;off+=12){
  const c = alexT13E.readUInt32LE(off+8);
  if(c === 0 || c >= 300) { end = off; break; }
}
console.log('Alexander T13E cache end @0x'+end.toString(16)+', records='+((end-0x1024)/12));
console.log('Bytes at end:', Array.from(alexT13E.slice(end, end+32)).map(b=>b.toString(16).padStart(2,'0')).join(' '));

// Look at what's at offset 0 to find header structure
console.log('\nFirst bytes of rome10:');
console.log('  0..32:', Array.from(rome10.slice(0,32)).map(b=>b.toString(16).padStart(2,'0')).join(' '));
console.log('  '+rome10.slice(0,32).toString('latin1'));
console.log('First bytes of alexT13E:');
console.log('  0..32:', Array.from(alexT13E.slice(0,32)).map(b=>b.toString(16).padStart(2,'0')).join(' '));
console.log('  '+alexT13E.slice(0,32).toString('latin1'));

// (2) For RIS imperial: search anywhere in 0x1000..0x20000 for a region where:
//   - first u32 looks like hash (large, non-zero)
//   - third u32 is a small turn number
//   - the structure has many consecutive valid records
function parseAICacheFrom(buf, start){
  const recs = [];
  let off = start;
  while(off < buf.length-12){
    const a = buf.readUInt32LE(off);
    const b = buf.readUInt32LE(off+4);
    const c = buf.readUInt32LE(off+8);
    if(a === 0 && b === 0 && c === 0) break;
    if(c === 0 || c > 300) break;
    recs.push({a, b, c, off});
    off += 12;
  }
  return recs;
}

// Compute "AI-cache likeness score" — records with monotonic turn, hashes look hashy
function aiScore(recs){
  if(recs.length < 30) return 0;
  let score = recs.length;
  // Verify monotonic turn
  let lastT = 0;
  let monoBreaks = 0;
  let hashyCount = 0;
  let smallLowByteB = 0;
  for(const r of recs){
    if(r.c < lastT) monoBreaks++;
    lastT = r.c;
    if(r.a > 0x100000 || (r.a > 0x100 && (r.a & 0xff) !== r.a)) hashyCount++;
    if((r.b & 0xff) <= 0x20) smallLowByteB++;
  }
  if(monoBreaks > 10) score = Math.floor(score * 0.5);
  score *= hashyCount/recs.length;
  score *= smallLowByteB/recs.length;
  return score;
}

console.log('\nScanning rome10 for AI cache candidates (start 0x1000..0x20000)...');
let cands = [];
for(let s=0x1000; s<0x20000; s+=4){
  const recs = parseAICacheFrom(rome10, s);
  const sc = aiScore(recs);
  if(sc > 50) cands.push({start: s, len: recs.length, score: sc, sample: recs[0]});
}
cands.sort((a,b)=>b.score-a.score);
console.log('Top 30 candidates in rome10:');
for(const c of cands.slice(0, 30)){
  console.log('  0x'+c.start.toString(16).padStart(6,'0')+': '+c.len+' rec, score='+c.score.toFixed(1)+' first.hash=0x'+c.sample.a.toString(16).padStart(8,'0')+' first.turn='+c.sample.c);
}

console.log('\nScanning romet1 for AI cache candidates (start 0x1000..0x20000)...');
cands = [];
for(let s=0x1000; s<0x20000; s+=4){
  const recs = parseAICacheFrom(romet1, s);
  const sc = aiScore(recs);
  if(sc > 50) cands.push({start: s, len: recs.length, score: sc, sample: recs[0]});
}
cands.sort((a,b)=>b.score-a.score);
console.log('Top 30 candidates in romet1:');
for(const c of cands.slice(0, 30)){
  console.log('  0x'+c.start.toString(16).padStart(6,'0')+': '+c.len+' rec, score='+c.score.toFixed(1)+' first.hash=0x'+c.sample.a.toString(16).padStart(8,'0')+' first.turn='+c.sample.c);
}
