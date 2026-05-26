// dig-cmpcounts.js — compare chain-token counts across 3 saves.
"use strict";
const fs = require("fs");
const saves = [
  ["item_limit_bug", "C:/Users/vtarn/Downloads/save_item limit bug.sav"],
  ["t960",          "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav"],
  ["t1018",         "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 1018 Start.sav"],
];

for (const [tag, path] of saves) {
  const buf = fs.readFileSync(path);
  const tokens = ["port_buildings", "river_port", "hinterland_roads", "watchtower", "WATCHTOWER", "PORT_MANAGER", "ROAD_MANAGER"];
  const out = { tag, size: (buf.length/1024/1024).toFixed(1)+"MB" };
  for (const t of tokens) {
    const tok = Buffer.from(t);
    let p = 0, count = 0;
    while ((p = buf.indexOf(tok, p)) >= 0) { count++; p += 1; }
    out[t] = count;
  }
  console.log(out);
}
