// dig-staticsec-extra-fields.js
// Decode the meaning of +20 (counter) and +24 (aggression):
//  - Are they GEOMETRIC (depend only on row/col A,B in the matrix), or DATA?
//  - +20: values 6 / 54 / 55. Hypothesis: 6=normal, 54/55=diagonal/self or boundary.
//  - +24: values 200/600/0/-10. Hypothesis: a SECONDARY attitude or AI aggression copy.
//  - Cross-turn delta (T0 macedon vs antigonid T1, seleucid T0) to test static vs dynamic.
const fs = require("fs");
const DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const ORDER = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";

function loadOrder(p){const t=fs.readFileSync(p,"utf8");const o=[];let c=null;for(const l of t.split(/\r?\n/)){const fm=l.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);if(fm){c=fm[1];continue;}if(c){const cm=l.match(/^\s*"culture":\s*"([a-z_]+)"/);if(cm){o.push(c);c=null;}}}return o;}
function locate(buf,N){for(let p=0x4000;p<buf.length-64;p++){if(buf.readUInt32LE(p)!==0)continue;const key=buf.readUInt32LE(p+4);if(key<1||key>64)continue;if(buf.readUInt32LE(p+8)!==200)continue;const a=buf.readUInt32LE(p+12);if(a<0||a>1000)continue;if(buf.readUInt32LE(p+16)!==2)continue;const run=s=>{let g=0;for(let k=0;k<N+2;k++){const o=p+k*s;if(o+12>=buf.length)break;if(buf.readUInt32LE(o)===0&&buf.readUInt32LE(o+4)===key&&buf.readUInt32LE(o+8)===200)g++;else break;}return g;};for(let s=80;s<=400;s++){if(p+s+12>=buf.length)break;if(buf.readUInt32LE(p+s)===0&&buf.readUInt32LE(p+s+4)===key&&buf.readUInt32LE(p+s+8)===200&&run(s)>=N)return{cellStart:p,stride:s,key};}}return null;}
const order=loadOrder(ORDER);const N=order.length;

const buf=fs.readFileSync(DIR+"save_macedon t0.sav");
const m=locate(buf,N);const C=-1;
const cell=(A,B)=>m.cellStart+(A*N+B+C)*m.stride;
const att=(A,B)=>buf.readUInt32LE(cell(A,B)+12);
const counter=(A,B)=>buf.readUInt32LE(cell(A,B)+20);
const aggrU=(A,B)=>buf.readUInt32LE(cell(A,B)+24);
const aggrS=(A,B)=>buf.readInt32LE(cell(A,B)+24);

// --- Is +20 (counter) the DIAGONAL/self marker? ---
console.log(`=== +20 counter: diagonal vs off-diagonal ===`);
let diag6=0,diag54=0,diag55=0,diagOther=0, off6=0,off54=0,off55=0,offOther=0;
for(let A=0;A<N;A++)for(let B=0;B<N;B++){const v=counter(A,B);if(A===B){if(v===6)diag6++;else if(v===54)diag54++;else if(v===55)diag55++;else diagOther++;}else{if(v===6)off6++;else if(v===54)off54++;else if(v===55)off55++;else offOther++;}}
console.log(`DIAGONAL (A==B, ${N} cells):     6=${diag6} 54=${diag54} 55=${diag55} other=${diagOther}`);
console.log(`OFF-DIAG (A!=B, ${N*N-N} cells):  6=${off6} 54=${off54} 55=${off55} other=${offOther}`);

// Where do the 432 counter=54 cells live? row/col histogram
console.log(`\n=== +20 counter==54 cell locations (row A, col B) ===`);
const rowH=new Map(),colH=new Map();let c54=0;
for(let A=0;A<N;A++)for(let B=0;B<N;B++){if(counter(A,B)===54){c54++;rowH.set(A,(rowH.get(A)||0)+1);colH.set(B,(colH.get(B)||0)+1);}}
console.log(`total counter==54: ${c54}`);
console.log(`top rows: ${[...rowH.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([r,c])=>`A=${r}(${order[r]})×${c}`).join(" ")}`);
console.log(`top cols: ${[...colH.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([r,c])=>`B=${r}(${order[r]})×${c}`).join(" ")}`);
// Are the 54-cells exactly the cells where one party is a "rebels"/"slave"/"dummies" non-playable faction?
const c54pairs=[];for(let A=0;A<N;A++)for(let B=0;B<N;B++)if(counter(A,B)===54&&c54pairs.length<10)c54pairs.push(`${order[A]}->${order[B]}(att=${att(A,B)},aggr=${aggrS(A,B)})`);
console.log(`sample 54-pairs: ${c54pairs.join("  ")}`);

// --- +24 aggression: relationship to attitude ---
console.log(`\n=== +24 aggression (signed) distribution ===`);
const aggH=new Map();for(let A=0;A<N;A++)for(let B=0;B<N;B++){const v=aggrS(A,B);aggH.set(v,(aggH.get(v)||0)+1);}
[...aggH.entries()].sort((a,b)=>b[1]-a[1]).forEach(([v,c])=>console.log(`  aggr=${v} ×${c}`));
// Is aggression == attitude often? or independent?
let aggEqAtt=0,aggNeAtt=0;for(let A=0;A<N;A++)for(let B=0;B<N;B++){if(aggrU(A,B)===att(A,B))aggEqAtt++;else aggNeAtt++;}
console.log(`aggression == attitude: ${aggEqAtt} cells; differ: ${aggNeAtt}`);
// Is aggression SYMMETRIC like attitude?
let aggSym=0,aggTot=0;for(let A=0;A<N;A++)for(let B=A+1;B<N;B++){aggTot++;if(aggrU(A,B)===aggrU(B,A))aggSym++;}
console.log(`aggression symmetry: ${aggSym}/${aggTot} (${(100*aggSym/aggTot).toFixed(2)}%)`);

// --- CROSS-TURN / CROSS-SAVE delta to test static vs dynamic ---
console.log(`\n=== CROSS-SAVE delta on +12/+20/+24 (does data change with game state?) ===`);
function loadM(name){const b=fs.readFileSync(DIR+name);const mm=locate(b,N);return{b,mm};}
const others=[
  ["seleucid t0","save_Seleucids t0.sav"],
  ["antigonid T1","save_Autosave   Antigonid Kingdom   Turn 1.sav"],
];
for(const [lab,name] of others){
  let bb,mmm;try{({b:bb,mm:mmm}=loadM(name));}catch(e){console.log(`  ${lab}: SKIP (${e.message})`);continue;}
  // calibrate C for the other save by symmetry on attitude
  let bestC=-1,bestS=-1;for(let cc=-3;cc<=3;cc++){let s=0,t=0;for(let A=1;A<N;A+=7)for(let B=A+1;B<N;B+=5){const v1=bb.readUInt32LE(mmm.cellStart+(A*N+B+cc)*mmm.stride+12);const v2=bb.readUInt32LE(mmm.cellStart+(B*N+A+cc)*mmm.stride+12);t++;if(v1===v2)s++;}if(s/t>bestS){bestS=s/t;bestC=cc;}}
  const a2=(A,B,off)=>bb.readUInt32LE(mmm.cellStart+(A*N+B+bestC)*mmm.stride+off);
  let dAtt=0,dCnt=0,dAgg=0;for(let A=0;A<N;A++)for(let B=0;B<N;B++){if(a2(A,B,12)!==att(A,B))dAtt++;if(a2(A,B,20)!==counter(A,B))dCnt++;if(a2(A,B,24)!==aggrU(A,B))dAgg++;}
  console.log(`  ${lab} (C=${bestC}, sym=${(bestS*100).toFixed(0)}%): vs macedon-t0 differing cells -> attitude=${dAtt} counter=${dCnt} aggression=${dAgg}`);
}
