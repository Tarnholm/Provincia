"use strict";
const fs = require("fs");
const path = require("path");
const { parseSettlementFields } = require("../src/settlementFieldsParser.js");
const { findAllSettlementMarkers } = require("../src/buildingParser.js");
const D = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
function load(fn){const b=fs.readFileSync(path.join(D,fn));return parseSettlementFields(b,findAllSettlementMarkers(b));}
const c1=load("save_Carthage1.sav"), c2=load("save_carthage2.sav"), c3=load("save_carthage3.sav");
for(const city of ["Carthage","Tingi","Hadrumetum","Lilybaeum"]){
  console.log(city.padEnd(12),
    "s7:", c1[city].order.startTransientBonus, c2[city]?.order.startTransientBonus, c3[city]?.order.startTransientBonus,
    "| s10:", c1[city].order.capitalBonus, c2[city]?.order.capitalBonus, c3[city]?.order.capitalBonus);
}
