// Run v2 parser on a save, list female records with name + faction, and
// compare the JULII set against descr_strat ground truth.
"use strict";
const fs = require("fs");
const path = require("path");
const v2 = require("../src/characterParserV2.js");

const MOD = "C:/RIS/RIS/data";
const STRAT = MOD + "/world/maps/campaign/imperial_campaign/descr_strat.txt";

function loadLookup(){
  // descr_names_lookup.txt: one name token per line (index = line)
  const p = MOD + "/descr_names_lookup.txt";
  const raw = fs.readFileSync(p, "utf8").split(/\r?\n/);
  // some lookups have a count header; keep array index alignment as the parser expects
  return raw;
}
function loadTraits(){
  const p = MOD + "/export_descr_character_traits.txt";
  const txt = fs.readFileSync(p, "utf8");
  const names=[];
  // build index→name? The parser uses traitNames[id] for validity; emulate via Trait order
  const re=/^Trait\s+(\w+)/gm; let m; const list=[];
  while((m=re.exec(txt))) list.push(m[1]);
  return list; // index roughly; good enough for validity gating
}

// ground-truth Julii family women from descr_strat
function julliFamilyTruth(){
  const txt = fs.readFileSync(STRAT, "utf8").split(/\r?\n/);
  let inJulii=false, out=[];
  for(let i=0;i<txt.length;i++){
    const ln=txt[i].trim();
    if(/^faction\s+julii/.test(ln)) inJulii=true;
    else if(/^faction\s+\w/.test(ln) && inJulii) break;
    if(inJulii){
      // character lines: "character\tNAME, ... " and "character_record\tNAME, ..."
      const m=ln.match(/^character(_record)?\s+([A-Za-z]+)\b.*?\b(male|female)\b/);
      if(m) out.push({name:m[2], gender:m[3], kind:m[1]?"record":"char", line:ln.slice(0,80)});
    }
  }
  return out;
}

function main(){
  const savePath = process.argv[2];
  const buf = fs.readFileSync(savePath);
  const lookup = loadLookup();
  const traits = loadTraits();
  console.log(`lookup=${lookup.length} traitNames=${traits.length}`);
  const recs = v2.findScriptedCharacters(buf, lookup, traits);
  console.log(`v2 total records: ${recs.length}`);
  const byGender={male:0,female:0};
  for(const r of recs) byGender[r.gender]=(byGender[r.gender]||0)+1;
  console.log(`gender tally:`, byGender);

  const julii = recs.filter(r=>r.faction==="julii");
  console.log(`\n=== JULII v2 records: ${julii.length} ===`);
  for(const r of julii) console.log(`  ${r.gender.padEnd(6)} ${(r.firstName+(r.lastName?" "+r.lastName:"")).padEnd(28)} b${r.birthYear} traits=${r.traitCount} fac=${r.faction}`);

  console.log(`\n=== descr_strat JULII ground truth ===`);
  const truth = julliFamilyTruth();
  for(const t of truth) console.log(`  ${t.gender.padEnd(6)} ${t.name.padEnd(20)} [${t.kind}]`);
}
main();
