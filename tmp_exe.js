const fs=require("fs");
const EXE="C:/Program Files (x86)/Steam/steamapps/common/Total War ROME REMASTERED/Total War ROME REMASTERED.exe";
const buf=fs.readFileSync(EXE);
console.log("exe size:",(buf.length/1e6).toFixed(1),"MB");
// candidate value sets to locate (percent table, fraction table, distance table)
const sets={
  "pct%f32":[0,4,8,11.5,15,20,24.5,28,34,41.5,51,60,68.5],
  "pctFrac_f32":[0,0.04,0.08,0.115,0.15,0.20,0.245,0.28,0.34,0.415,0.51,0.60,0.685],
  "dist_f32":[15,20,25,30,35,40,45,50,60,70,80,90,100],
};
function searchSeq(vals,dbl,minRun){
  const sz=dbl?8:4;
  // search for at least minRun consecutive matching values anywhere (stride sz), tolerant
  for(let off=0;off+sz*minRun<=buf.length;off++){
    // try to match vals starting at some index within the set
    for(let start=0;start+minRun<=vals.length;start++){
      let ok=true;
      for(let k=0;k<minRun;k++){const v=dbl?buf.readDoubleLE(off+k*sz):buf.readFloatLE(off+k*sz);if(Math.abs(v-vals[start+k])>1e-4){ok=false;break;}}
      if(ok)return {off,start};
    }
  }
  return null;
}
for(const [name,vals] of Object.entries(sets)){
  for(const dbl of [false,true]){
    const r=searchSeq(vals,dbl,5); // 5 consecutive distinctive values
    if(r)console.log(name+(dbl?"(f64)":"(f32)")+": FOUND at 0x"+r.off.toString(16)+" starting value index "+r.start+" (val "+vals[r.start]+")");
  }
}
console.log("done");
