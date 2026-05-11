// dig-ai-policy-retry2.js — session 18: alternate-AI-cache check. The 12 u32s at
// 0xfc0..0xfef and the u32 at 0xff8/0xffc all follow the AI-cache pattern (same within
// turn, different across turns). 0xfc0 reads as f32=[3.06, -0.0, +1.8e25, -8.5M] in
// "default" turns but flips to f32=[1.88, -0.33, -1.1e33, +1.4e31] on specific saves
// — this is mode-flagged data (NOT a clean per-turn AI weight vector).

const fs = require('fs');
const dir = 'C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z/';
const FILES = {
  t11s: '0161_save_Autosave   Macedon   Turn 11 Start.sav',
  t11e: '0169_save_Autosave   Macedon   Turn 11 End.sav',
  t12s: '0177_save_Autosave   Macedon   Turn 12 Start.sav',
  t13s: '0351_save_Autosave   Macedon   Turn 13 Start.sav',
  t13e: '0357_save_Autosave   Macedon   Turn 13 End.sav',
  t14e: '0369_save_Autosave   Macedon   Turn 14 End.sav',
  t15s: '0375_save_Autosave   Macedon   Turn 15 Start.sav',
  t15e: '0381_save_Autosave   Macedon   Turn 15 End.sav',
};
const bufs = {};
for(const [k,f] of Object.entries(FILES)) bufs[k] = fs.readFileSync(dir+f);

console.log('0xfc0..0xfd0 (4×f32) across turns:');
console.log('Turn   f0       f1       f2          f3');
for(const [t, b] of Object.entries(bufs)){
  const vals = [];
  for(let i=0;i<4;i++) vals.push(b.readFloatLE(0xfc0+i*4));
  console.log(t.padEnd(6)+' '+vals.map(v=>{
    if(Math.abs(v)>1e10 || Math.abs(v)<1e-5) return v.toExponential(2).padStart(10);
    return v.toFixed(3).padStart(10);
  }).join(' '));
}

console.log('\nu32 at 0xff8 / 0xffc / 0xf80 / 0xf88 / 0x502 (likely AI counters):');
for(const [t, b] of Object.entries(bufs)){
  console.log(t.padEnd(6)+' 0xff8=0x'+b.readUInt32LE(0xff8).toString(16).padStart(8,'0')+
    '  0xffc='+b.readUInt32LE(0xffc).toString().padStart(5)+
    '  0xf80='+b.readUInt32LE(0xf80).toString().padStart(4)+
    '  0xf88='+b.readUInt32LE(0xf88).toString().padStart(4)+
    '  0x502='+b.readUInt32LE(0x500).toString(16).padStart(6,'0'));
}

// Identify all bytes with the within-turn-stable + cross-turn-changing pattern
console.log('\nAll AI-cache-pattern bytes across THREE saves (T13S, T13E, T14E):');
const t13s = bufs.t13s, t13e = bufs.t13e, t14e = bufs.t14e;
const ai = [];
for(let off=0;off<0x3bad;off++){
  if(t13s[off]===t13e[off] && t13e[off]!==t14e[off]) ai.push(off);
}
console.log('Total AI-pattern bytes in header [0..0x3bad]:', ai.length);

// Cluster them
let clusters = [];
let curr = [ai[0]];
for(let i=1;i<ai.length;i++){
  if(ai[i] - ai[i-1] <= 4) curr.push(ai[i]);
  else { clusters.push(curr); curr = [ai[i]]; }
}
clusters.push(curr);
console.log('Clusters (showing cluster ≥ 4 bytes):');
for(const c of clusters){
  if(c.length>=4){
    console.log('  0x'+c[0].toString(16).padStart(4,'0')+'..0x'+c[c.length-1].toString(16).padStart(4,'0')+' ('+c.length+' bytes)');
  }
}
console.log('Singleton AI-pattern offsets:', clusters.filter(c=>c.length<4).length);

// Also count monotonic-pattern (differ both intra and cross — likely RNG counter)
let mono = 0;
for(let off=0;off<0x3bad;off++){
  if(t13s[off]!==t13e[off] && t13e[off]!==t14e[off]) mono++;
}
console.log('Monotonic-pattern bytes (intra AND cross-turn change):', mono);
