// Safety test for the add-general WRITE path (EOL + UTF-16 BOM + minting),
// against TEMP COPIES of the real files. Does NOT touch the real mod files.
const fs = require("fs");
const os = require("os");
const path = require("path");
const G = require("C:/dev/Provincia/src/descrStratGeneral.js");

const SRC = {
  ds: "C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt",
  names: "C:/RIS/RIS/data/text/names.txt",
  lookup: "C:/RIS/RIS/data/descr_names_lookup.txt",
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "addgen-"));
const dsP = path.join(tmp, "descr_strat.txt"), nmP = path.join(tmp, "names.txt"), lkP = path.join(tmp, "lookup.txt");
fs.copyFileSync(SRC.ds, dsP); fs.copyFileSync(SRC.names, nmP); fs.copyFileSync(SRC.lookup, lkP);

// original BOM bytes of names.txt
const origHead = fs.readFileSync(nmP).slice(0, 2);
console.log(`names.txt original first2 bytes: ${[...origHead].map(b=>b.toString(16)).join(" ")} (BOM=ff fe expected)`);

// ---- replicate the IPC apply write logic ----
const dsRaw = fs.readFileSync(dsP, "utf8");
const eol = dsRaw.includes("\r\n") ? "\r\n" : "\n";
const names = G.parseNamesTxt(fs.readFileSync(nmP, "utf16le"));
const parsed = G.parseDescrStrat(dsRaw);
const sel = {
  factionName: "carthage", x: 100, y: 100,
  general: { firstDisplay: "Hannibal", age: 28 },
  familyName: "Barca", // may not exist -> mints; that's fine for the test
  wife: { firstDisplay: G.buildPools(parsed.factions.find(f=>f.name==="carthage"), names).femaleFirst[0], age: 24 },
  children: [{ firstDisplay: "Mago", gender: "son", age: 6 }],
};
let res;
try { res = G.composeAddGeneral(parsed, names, sel); }
catch (e) { console.log("compose error (likely name not in carthage pool):", e.message);
  // retry with names guaranteed in the faction pool
  const cp = G.buildPools(parsed.factions.find(f=>f.name==="carthage"), names);
  sel.general.firstDisplay = cp.maleFirst[0]; sel.familyName = cp.families[0].display; sel.children[0].firstDisplay = cp.maleFirst[1] || cp.maleFirst[0];
  res = G.composeAddGeneral(parsed, names, sel);
}
fs.writeFileSync(dsP, res.lines.join(eol), "utf8");
if (res.namesAppend.length) {
  let nt = fs.readFileSync(nmP, "utf16le");
  if (!/\r?\n$/.test(nt)) nt += "\r\n";
  nt += res.namesAppend.map((n) => `{${n.token}}${n.display}`).join("\r\n") + "\r\n";
  fs.writeFileSync(nmP, nt, "utf16le");
}
if (res.lookupAppend.length) {
  let lk = fs.readFileSync(lkP, "utf8");
  if (!/\n$/.test(lk)) lk += "\n";
  lk += res.lookupAppend.join("\n") + "\n";
  fs.writeFileSync(lkP, lk, "utf8");
}

// ---- verify ----
const newHead = fs.readFileSync(nmP).slice(0, 2);
console.log(`names.txt after-write first2 bytes: ${[...newHead].map(b=>b.toString(16)).join(" ")} ${newHead.equals(origHead) ? "✓ BOM preserved" : "✗ BOM CHANGED"}`);
const names2 = G.parseNamesTxt(fs.readFileSync(nmP, "utf16le"));
console.log(`names.txt tokens ${names.tokenToDisplay.size} -> ${names2.tokenToDisplay.size} (+${names2.tokenToDisplay.size - names.tokenToDisplay.size}); minted present: ${res.namesAppend.every(n=>names2.tokenToDisplay.get(n.token)===n.display) ? "✓" : "✗"}`);
const lookup2 = G.parseLookup(fs.readFileSync(lkP, "utf8"));
console.log(`lookup minted present: ${res.lookupAppend.every(t=>lookup2.has(t)) ? "✓" : "✗"}`);
const reparsed = G.parseDescrStrat(fs.readFileSync(dsP, "utf8"));
const rf = reparsed.factions.find(f=>f.name==="carthage");
const of = parsed.factions.find(f=>f.name==="carthage");
console.log(`carthage chars ${of.characters.length} -> ${rf.characters.length} (+${rf.characters.length - of.characters.length}); dups after: ${JSON.stringify(G.findDuplicateNames(rf))}`);
console.log(`general: ${res.summary.general}; relativeLine: ${res.summary.relativeLine}`);
fs.rmSync(tmp, { recursive: true, force: true });
console.log("temp cleaned up. REAL mod files untouched.");
