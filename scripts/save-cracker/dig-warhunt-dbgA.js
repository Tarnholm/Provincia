"use strict";
const fs = require("fs");
const D = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const pre = fs.readFileSync(D + "save_Autosave   Spain   Turn 4 Start.sav");
const war = fs.readFileSync(D + "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav");
const T = Buffer.from([0x43,0x02,0,0, 0,0,0,0, 0xff,0xff,0xff,0xff, 0x0e,0,0,0]);
console.log("pre trailer >=0x11960:", pre.indexOf(T, 0x11960).toString(16));
console.log("war trailer >=0x11960:", war.indexOf(T, 0x11960).toString(16));
console.log("pre@0x11925:", Array.from(pre.slice(0x11925, 0x1193d)).map(b => b.toString(16).padStart(2,"0")).join(" "));
console.log("war@0x11925:", Array.from(war.slice(0x11925, 0x1193d)).map(b => b.toString(16).padStart(2,"0")).join(" "));
// What is the trailer just after record A in each?
const tp = pre.indexOf(T, 0x11930), tw = war.indexOf(T, 0x11930);
console.log("nextTrailer pre:", tp.toString(16), "war:", tw.toString(16));
