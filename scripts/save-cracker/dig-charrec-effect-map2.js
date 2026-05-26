// dig-charrec-effect-map2.js
// Refined effect->slot mapping. Tests BOTH interpretations of trait Effect
// accumulation (absolute-per-level vs additive-cumulative) and prints, for the
// core RTW attribute effects, the single best-matching byte slot with rate.
// Also dumps a candidate slot->effect table for the +126..+298 zone.
const fs = require("fs");
const path = require("path");
const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav";
const modPath = "C:/RIS/RIS";
const names = fs.readFileSync(path.join(modPath, "data/descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitsTxt = fs.readFileSync(path.join(modPath, "data/export_descr_character_traits.txt"), "utf8");

const traitNames = [];
const traitDef = new Map();
{
  const lines = traitsTxt.split(/\r?\n/);
  let curTrait = null, curLevel = null;
  for (let raw of lines) {
    const line = raw.trim();
    let m;
    if ((m = line.match(/^Trait\s+([A-Za-z0-9_]+)/))) {
      curTrait = m[1]; traitNames.push(curTrait); traitDef.set(curTrait, []); curLevel = null;
    } else if (curTrait && (m = line.match(/^Level\s+([A-Za-z0-9_]+)/))) {
      curLevel = { threshold: null, effects: [] }; traitDef.get(curTrait).push(curLevel);
    } else if (curLevel && (m = line.match(/^Threshold\s+(\d+)/))) {
      curLevel.threshold = parseInt(m[1], 10);
    } else if (curLevel && (m = line.match(/^Effect\s+([A-Za-z0-9_]+)\s+(-?\d+)/))) {
      curLevel.effects.push({ name: m[1], val: parseInt(m[2], 10) });
    }
  }
}

const { findCharacterRecords } = require("../../src/characterParser.js");
const buf = fs.readFileSync(SAVE);
const v1 = findCharacterRecords(buf, names, traitNames, null);

// active level index for points
function activeLevelIdx(def, points) {
  let idx = 0;
  for (let i = 0; i < def.length; i++) {
    const th = def[i].threshold == null ? (i===0?0:1) : def[i].threshold;
    if (points >= th) idx = i; else break;
  }
  return idx;
}
// ABSOLUTE: just the active level's effects
function effAbsolute(name, points) {
  const def = traitDef.get(name); if (!def||!def.length) return [];
  return def[activeLevelIdx(def, points)].effects;
}

const CORE = ["Attack","Defence","Command","CavalryCommand","InfantryCommand","ElephantCommand",
  "Influence","Management","Loyalty","Subterfuge","PersonalSecurity","TaxCollection","Trading",
  "Farming","Mining","Law","Construction","Squalor","Health","Fertility","LocalPopularity",
  "PopularStanding","SenateStanding","Electability","TroopMorale","Looting","Bribery",
  "BribeResistance","Negotiation","LineOfSight","MovementPoints","HitPoints","BodyguardValour",
  "SiegeAttack","SiegeDefence","SiegeEngineering","NightBattle","Ambush","BattleSurgery",
  "TrainingUnits","TrainingAgents","PublicSecurity","SlaveTrading","FootInTheDoor"];

// expected per char (absolute)
const charExp = v1.map(c => {
  const exp = new Map();
  for (const t of (c.traits||[])) for (const e of effAbsolute(t.name, t.points)) exp.set(e.name,(exp.get(e.name)||0)+e.val);
  return { c, exp };
});

const SLOTS = []; for (let p = 94; p <= 298; p += 4) SLOTS.push(p);
function rateFor(eff, p) {
  let mNZ=0,tNZ=0,mAll=0,tAll=0;
  for (const {c,exp} of charExp) {
    const lb = c.lastName===null;
    const physOff = lb ? c.offset+p : c.offset+p+4;
    if (physOff+4>buf.length) continue;
    const val = buf.readInt32LE(physOff);
    const e = exp.get(eff)||0;
    tAll++; if (val===e) mAll++;
    if (e!==0){tNZ++; if(val===e)mNZ++;}
  }
  return {mNZ,tNZ,mAll,tAll,rateNZ:tNZ?mNZ/tNZ:0,rateAll:tAll?mAll/tAll:0};
}

console.log(`SAVE=${path.basename(SAVE)} v1=${v1.length}`);
console.log("\n=== Core effect -> best slot ===");
const slotToEff = new Map();
for (const eff of CORE) {
  let best=null;
  for (const p of SLOTS) { const r=rateFor(eff,p); if(r.tNZ<3) continue; if(!best||r.rateNZ>best.rateNZ||(r.rateNZ===best.rateNZ&&r.tNZ>best.tNZ)) best={p,...r}; }
  if (!best) { console.log(`  ${eff.padEnd(20)} <no data>`); continue; }
  const flag = best.rateNZ>=0.9?"***":best.rateNZ>=0.7?" **":best.rateNZ>=0.5?"  *":"";
  console.log(`  ${eff.padEnd(20)} -> slot +${String(best.p).padEnd(4)} rateNZ=${(best.rateNZ*100).toFixed(0)}% (${best.mNZ}/${best.tNZ}) rateAll=${(best.rateAll*100).toFixed(0)}% ${flag}`);
  if (best.rateNZ>=0.6) {
    if (!slotToEff.has(best.p)) slotToEff.set(best.p,[]);
    slotToEff.get(best.p).push(`${eff}(${(best.rateNZ*100).toFixed(0)}%)`);
  }
}
console.log("\n=== slot -> effect(s) (rateNZ>=60%) ===");
for (const p of SLOTS) if (slotToEff.has(p)) console.log(`  +${p}: ${slotToEff.get(p).join(", ")}`);
