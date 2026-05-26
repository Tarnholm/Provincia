// dig-tilegap-spain-map.js — is the Spain save a different (small) map? Check MAP_REGIONS / region count
const fs = require('fs');
const DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';

// Count distinct settlement-name markers (UTF-16LE) as proxy for map size, plus look for tile dims
function settlementCount(buf){
  // crude: count occurrences of "_set" preceded by name? Instead count 'default_set' ASCII
  let c=0,p=buf.indexOf(Buffer.from('default_set','ascii'));
  while(p!==-1){ c++; p=buf.indexOf(Buffer.from('default_set','ascii'),p+1); }
  return c;
}
for(const f of ['save_17-05-2026   Spain   Turn 1.sav','save_t0.sav','save_macedon t0.sav']){
  const buf=fs.readFileSync(DIR+f);
  console.log(`${f}: size=${buf.length}  default_set(settlements)=${settlementCount(buf)}`);
}

// Spain GROUND_TILE = 440 = 22x20 or 20x22. RIS = 57120.
// If Spain were the SAME map at the SAME resolution, count would match. It's 130x smaller.
// => Spain uses a different (much smaller) map OR different GROUND_TILE resolution.
console.log('\nRIS GROUND_TILE=57120 (=240x238), Spain=440 (=22x20). Ratio 130x.');
console.log('If same map: impossible at same res. Spain map must be small OR streaming-based.');
