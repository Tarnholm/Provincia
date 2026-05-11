#!/usr/bin/env node
// Try to find battle-counter fields in character records.
// Use Macedon Turn 97 vs Turn 98 End — that's a turn boundary where many battles happen.
// Method: look at the existing character parser, match characters by uuid+name across saves,
// find counter-like fields that increment by 1 in some chars and stay 0 in others.

const fs = require('fs');
const path = require('path');

// Try to use the existing character parser
const cpPath = path.join(__dirname, '..', '..', 'src', 'characterParser.js');
let characterParser = null;
try {
  characterParser = require(cpPath);
} catch (e) {
  console.error('Cannot load characterParser:', e.message);
}

const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';
const A = fs.readFileSync(path.join(dir, 'save_Autosave   Macedon   Turn 97.sav'));
const B = fs.readFileSync(path.join(dir, 'save_Autosave   Macedon   Turn 98 End.sav'));

console.log(`A=${A.length}, B=${B.length}, Δ=${B.length - A.length}`);

// If parser loaded, use it
if (!characterParser) {
  console.log('No parser available; do manual scanning');
} else {
  // Check function signatures
  console.log('characterParser exports:', Object.keys(characterParser));
}
