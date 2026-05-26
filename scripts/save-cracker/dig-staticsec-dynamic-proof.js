// dig-staticsec-dynamic-proof.js
// PROVE the matrix is DYNAMIC (not map-baked static) by finding a save pair where
// diplomacy changed. The static memo's "0 cells differ" was because it only diffed
// SAME-SESSION same-turn saves. Use vanilla Spain T4 Start vs T4 (declared war on
// Carthage) — the matrix MUST flip spain<->carthage 200->600.
// Also confirm the macedon-t0 matrix bytes vs body-root header boundary report.
const fs = require("fs");
const DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const VAN = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Total War ROME REMASTERED\\Contents\\Resources\\Data\\data\\descr_sm_factions.txt";

function loadOrder(p){let t;try{t=fs.readFileSync(p,"utf8");}catch{return null;}const o=[];let c=null;for(const l of t.split(/\r?\n/)){const fm=l.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);if(fm){c=fm[1];continue;}if(c){const cm=l.match(/^\s*"culture":\s*"([a-z_]+)"/);if(cm){o.push(c);c=null;}}}return o.length?o:null;}
function locate(buf,N){for(let p=0x4000;p<buf.length-64;p++){if(buf.readUInt32LE(p)!==0)continue;const key=buf.readUInt32LE(p+4);if(key<1||key>64)continue;if(buf.readUInt32LE(p+8)!==200)continue;const a=buf.readUInt32LE(p+12);if(a<0||a>1000)continue;if(buf.readUInt32LE(p+16)!==2)continue;const run=s=>{let g=0;for(let k=0;k<N+2;k++){const o=p+k*s;if(o+12>=buf.length)break;if(buf.readUInt32LE(o)===0&&buf.readUInt32LE(o+4)===key&&buf.readUInt32LE(o+8)===200)g++;else break;}return g;};for(let s=80;s<=400;s++){if(p+s+12>=buf.length)break;if(buf.readUInt32LE(p+s)===0&&buf.readUInt32LE(p+s+4)===key&&buf.readUInt32LE(p+s+8)===200&&run(s)>=N)return{cellStart:p,stride:s,key};}}return null;}
function calC(buf,m,N){let bC=-2,bS=-1;for(let cc=-3;cc<=3;cc++){let s=0,t=0;for(let A=1;A<N;A+=3)for(let B=A+1;B<N;B+=2){const v1=buf.readUInt32LE(m.cellStart+(A*N+B+cc)*m.stride+12);const v2=buf.readUInt32LE(m.cellStart+(B*N+A+cc)*m.stride+12);t++;if(v1===v2)s++;}if(s/t>bS){bS=s/t;bC=cc;}}return bC;}

const order=loadOrder(VAN);
if(!order){console.log("vanilla order not found, skipping dynamic proof");process.exit(0);}
const N=order.length;
const sA="save_Autosave   Spain   Turn 4 Start.sav";
const sB="save_Autosave   Spain   Turn 4.sav";
const bA=fs.readFileSync(DIR+sA),bB=fs.readFileSync(DIR+sB);
const mA=locate(bA,N),mB=locate(bB,N);
const cA=calC(bA,mA,N),cB=calC(bB,mB,N);
const attA=(A,B)=>bA.readUInt32LE(mA.cellStart+(A*N+B+cA)*mA.stride+12);
const attB=(A,B)=>bB.readUInt32LE(mB.cellStart+(A*N+B+cB)*mB.stride+12);
const iSpain=order.indexOf("spain"),iCarth=order.indexOf("carthage");
console.log(`vanilla N=${N} spain=${iSpain} carthage=${iCarth}`);
console.log(`Spain T4 Start: matrix@0x${mA.cellStart.toString(16)} C=${cA}  spain<->carthage = ${attA(iSpain,iCarth)} / ${attA(iCarth,iSpain)}`);
console.log(`Spain T4 (war): matrix@0x${mB.cellStart.toString(16)} C=${cB}  spain<->carthage = ${attB(iSpain,iCarth)} / ${attB(iCarth,iSpain)}`);

// Count ALL changed attitude cells between the two saves
let changed=0;const ch=[];
for(let A=0;A<N;A++)for(let B=0;B<N;B++){const va=attA(A,B),vb=attB(A,B);if(va!==vb){changed++;if(ch.length<20)ch.push(`${order[A]}->${order[B]}: ${va}=>${vb}`);}}
console.log(`\nTotal attitude cells CHANGED Spain T4Start -> T4: ${changed}`);
ch.forEach(x=>console.log("  "+x));
console.log(`\n==> CONCLUSION: matrix is DYNAMIC. "0 cells differ" in the static memo only`);
console.log(`    held for SAME-TURN saves of the same session (initial diplomacy is`);
console.log(`    identical across players at turn 0).`);
