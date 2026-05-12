// Summarize the events JSON to extract structural inserts (>=4 bytes).

const fs = require('fs');
const events = JSON.parse(fs.readFileSync('C:/dev/Provincia/scripts/save-cracker/out-diplomat-events.json'));

const big = events.filter(e => (e.type === 'INS_A' || e.type === 'INS_B') && e.len >= 4);
const skips = events.filter(e => e.type === 'SKIP').length;
console.log(`Total events: ${events.length}, ≥4B inserts/deletes: ${big.length}, SKIPs: ${skips}`);

// Group by region
console.log('\nStructural events ≥4 bytes:');
for (const e of big) {
  const tag = e.type === 'INS_B' ? '+' : '-';
  console.log(`  ${e.type} A=0x${e.ai.toString(16).padStart(8,'0')} B=0x${e.bi.toString(16).padStart(8,'0')} ${tag}${e.len}`);
  if (e.content) console.log(`    hex:  ${e.content.slice(0, 240)}`);
  if (e.ascii) console.log(`    asc:  "${e.ascii.slice(0, 120)}"`);
}

// Total 1-byte inserts (likely AI cache churn)
const oneB = events.filter(e => (e.type === 'INS_A' || e.type === 'INS_B') && e.len === 1);
console.log(`\n1-byte inserts/deletes: ${oneB.length}`);
console.log(`  INS_B count: ${oneB.filter(e => e.type === 'INS_B').length}`);
console.log(`  INS_A count: ${oneB.filter(e => e.type === 'INS_A').length}`);

// 1-byte hex distribution
const insB = oneB.filter(e => e.type === 'INS_B');
const insBhex = {};
for (const e of insB) { insBhex[e.content] = (insBhex[e.content]||0) + 1; }
console.log(`1-byte INS_B hex values: ${JSON.stringify(insBhex)}`);
const insA = oneB.filter(e => e.type === 'INS_A');
const insAhex = {};
for (const e of insA) { insAhex[e.content] = (insAhex[e.content]||0) + 1; }
console.log(`1-byte INS_A hex values: ${JSON.stringify(insAhex)}`);

// Region distribution
const insBoffs = insB.map(e => e.bi);
insBoffs.sort((a,b)=>a-b);
const insAoffs = insA.map(e => e.bi);
insAoffs.sort((a,b)=>a-b);
console.log(`\nINS_B B-offset distribution (first 10): ${insBoffs.slice(0,10).map(x=>'0x'+x.toString(16)).join(' ')}`);
console.log(`INS_B B-offset distribution (last 10):  ${insBoffs.slice(-10).map(x=>'0x'+x.toString(16)).join(' ')}`);
