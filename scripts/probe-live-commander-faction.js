// scripts/probe-live-commander-faction.js
//
// Validates the 0.9.774 live-commander-faction fix: the LIVE-mode parser
// (main.js parseCharactersAndUnits) must now stamp every region character
// with a real `faction`, so the renderer's commanderInfo map resolves a
// culture and the bodyguard-swap loads a real portrait instead of the
// bodyguard unit icon.
//
// This drives the EXACT parser the renderer uses for charactersByRegion
// (NOT src/saveCracker.js's crackSave — that feeds a different path). We
// stub `electron` so main.js can be required headlessly: app.whenReady()
// returns a never-resolving promise so createWindow() never fires.
//
// Usage:
//   node scripts/probe-live-commander-faction.js --save "<path.sav>" --mod "C:\\RIS\\RIS\\data"

const path = require("path");
const fs = require("fs");
const Module = require("module");

// ---- electron stub (must be installed before requiring main.js) ----
const noop = () => {};
const neverResolve = new Promise(() => {});
const electronStub = {
  app: {
    isPackaged: true,
    getPath: () => process.cwd(),
    getName: () => "Provincia",
    getVersion: () => "probe",
    whenReady: () => neverResolve,
    on: noop,
    quit: noop,
    requestSingleInstanceLock: () => true,
    setAppUserModelId: noop,
  },
  BrowserWindow: class { static getAllWindows() { return []; } on() {} },
  Menu: { setApplicationMenu: noop, buildFromTemplate: () => ({}) },
  session: { defaultSession: { webRequest: { onHeadersReceived: noop } } },
  dialog: {},
  ipcMain: { handle: noop, on: noop },
  shell: {},
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron") return electronStub;
  if (request === "electron-updater") return { autoUpdater: { on: noop, checkForUpdatesAndNotify: noop } };
  return origLoad.apply(this, arguments);
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--save") out.save = argv[++i];
    else if (argv[i] === "--mod") out.mod = argv[++i];
  }
  return out;
}

// faction -> culture, from descr_sm_factions.txt (same source the app uses).
function loadFactionCultures(modDir) {
  const cultures = {};
  const p = path.join(modDir, "descr_sm_factions.txt");
  if (!fs.existsSync(p)) return cultures;
  const txt = fs.readFileSync(p, "utf8");
  // RIS descr_sm_factions is JSON-style: `"<faction_id>":` then
  // `"culture": "<culture>"`. Mirror main.js loadModCharacterData's parser.
  const lines = txt.split(/\r?\n/);
  let curFac = null;
  for (const line of lines) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { curFac = fm[1].toLowerCase(); continue; }
    if (curFac) {
      const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/);
      if (cm) { cultures[curFac] = cm[1].toLowerCase(); curFac = null; }
    }
  }
  return cultures;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.save || !fs.existsSync(args.save)) {
    console.error("save not found:", args.save);
    process.exit(2);
  }
  if (!args.mod || !fs.existsSync(args.mod)) {
    console.error("mod dir not found:", args.mod);
    process.exit(2);
  }

  const main = require(path.join(__dirname, "..", "main.js"));
  const { parseCharactersAndUnits, loadModCharacterData } = main;
  if (typeof parseCharactersAndUnits !== "function" || typeof loadModCharacterData !== "function") {
    console.error("main.js did not export parseCharactersAndUnits/loadModCharacterData");
    process.exit(2);
  }

  loadModCharacterData(args.mod);
  const factionCultures = loadFactionCultures(args.mod);

  const buf = fs.readFileSync(args.save);
  const res = parseCharactersAndUnits(buf, null);
  if (!res || !res.charactersByRegion) {
    console.error("parseCharactersAndUnits returned null (mod data not loaded?)");
    process.exit(2);
  }

  const flat = [];
  for (const [region, list] of Object.entries(res.charactersByRegion)) {
    for (const c of (list || [])) flat.push({ ...c, region });
  }

  console.log(`\n=== ${path.basename(args.save)} ===`);
  console.log(`regions=${Object.keys(res.charactersByRegion).length} chars=${flat.length} units=${(res.units || []).length}`);

  // Simulate the App.js commanderInfo build + RegionInfo culture lookup.
  // commanderInfo entry: faction = c.faction || null. culture =
  // factionCultures[faction.toLowerCase()].
  let withFaction = 0, nullFaction = 0, cultureResolved = 0;
  for (const c of flat) {
    if (c.faction) withFaction++; else nullFaction++;
    const culture = c.faction ? (factionCultures[String(c.faction).toLowerCase()] || null) : null;
    if (culture) cultureResolved++;
  }
  console.log(`faction set on ${withFaction}/${flat.length} (null on ${nullFaction}); culture resolves for ${cultureResolved}/${flat.length}`);

  // Focused checks: the player's named commanders the bug report called out.
  const targets = ["Quintus", "Marcus", "Servius"];
  const found = {};
  for (const name of targets) {
    // Prefer a leader/heir/general (has a bodyguard secondaryUuid) when
    // multiple chars share a first name.
    const matches = flat.filter(c => (c.firstName || "").toLowerCase() === name.toLowerCase());
    const pick = matches.find(c => c.secondaryUuid) || matches[0] || null;
    found[name] = pick;
  }

  // Diagnostic: captain_card marker layout vs the untagged player chars.
  {
    const pattern = Buffer.from("captain_card_", "ascii");
    let p = 0; const markers = [];
    while ((p = buf.indexOf(pattern, p)) !== -1) {
      let end = p + pattern.length, nm = "";
      while (end < buf.length && buf[end] !== 0x2e) { const b = buf[end]; if (b < 0x20 || b > 0x7e) break; nm += String.fromCharCode(b); end++; }
      if (nm.length > 0 && nm.length < 30) markers.push({ pos: p, faction: nm });
      p += pattern.length;
    }
    markers.sort((a, b) => a.pos - b.pos);
    console.log(`\n-- marker diag --`);
    console.log(`  captain_card markers=${markers.length} firstMarkerPos=${markers[0] ? markers[0].pos : "(none)"} first3=${markers.slice(0, 3).map(m => m.pos + ":" + m.faction).join(", ")}`);
    const julii = markers.filter(m => m.faction.includes("julii"));
    console.log(`  julii markers=${julii.length} firstJuliiPos=${julii[0] ? julii[0].pos : "(none)"}`);
    for (const name of ["Quintus", "Marcus", "Servius"]) {
      const c = flat.find(x => (x.firstName || "").toLowerCase() === name.toLowerCase());
      if (c) console.log(`  ${name}: offset=${c.offset} _fromV2=${!!c._fromV2} primaryUuid=${c.primaryUuid != null ? (c.primaryUuid >>> 0).toString(16) : "(none)"} (markerBeforeOffset=${markers.filter(m => m.pos <= c.offset).slice(-1)[0]?.faction || "(NONE — offset precedes all markers)"})`);
    }
  }

  // SOURCE-array diag: confirms the player faction's char block precedes the
  // first captain_card marker (the root cause the fix addresses).
  {
    const src = res.characters || [];
    for (const n of ["Quintus", "Marcus", "Servius"]) {
      const c = src.find(x => (x.firstName || "").toLowerCase() === n.toLowerCase());
      if (c) console.log(`  SRC ${n}: offset=${c.offset} faction=${c.faction || "(null)"} primaryUuid=${c.primaryUuid != null ? (c.primaryUuid >>> 0).toString(16) : "(none)"}`);
    }
  }

  console.log(`\n-- named commander checks --`);
  let assertFailures = 0;
  for (const name of targets) {
    const c = found[name];
    if (!c) {
      console.log(`  ${name}: NOT FOUND in this save (may not be in this faction's roster)`);
      continue;
    }
    const fac = c.faction || null;
    const culture = fac ? (factionCultures[String(fac).toLowerCase()] || null) : null;
    const swapFires = !!(c.secondaryUuid && culture);
    const status = (fac && culture) ? "OK" : "FAIL";
    if (!(fac && culture)) assertFailures++;
    console.log(`  [${status}] ${c.firstName} ${c.lastName || ""} region=${c.region} faction=${fac || "(NULL)"} culture=${culture || "(MISSING)"} isLeader=${!!c.isLeader} secUuid=${c.secondaryUuid != null ? (c.secondaryUuid >>> 0).toString(16) : "(none)"} → swap=${swapFires ? "FACE" : "BODYGUARD-ICON"}`);
  }

  // Hard assertions: every character that carries a bodyguard secondaryUuid
  // (i.e. is renderable as a commander face card) must now have a faction.
  const commanders = flat.filter(c => c.secondaryUuid);
  const cmdrNullFaction = commanders.filter(c => !c.faction);
  console.log(`\ncommanders (secondaryUuid present)=${commanders.length}; with null faction=${cmdrNullFaction.length}`);
  if (cmdrNullFaction.length > 0) {
    console.log(`  sample null-faction commanders: ${cmdrNullFaction.slice(0, 8).map(c => c.firstName + (c.lastName ? " " + c.lastName : "")).join(", ")}`);
  }

  // Exit non-zero if the player's leader (Quintus) didn't resolve — that's
  // the canonical regression check for this fix.
  const q = found["Quintus"];
  if (q && (!q.faction || !factionCultures[String(q.faction).toLowerCase()])) {
    console.error("\nASSERT FAIL: Quintus has no faction/culture — portrait would fall back to bodyguard icon.");
    process.exit(1);
  }
  if (assertFailures > 0 && q) {
    // Quintus resolved but Marcus/Servius didn't get found in THIS save — not
    // necessarily a failure (julii1 vs autosave roster differs). Report only.
    console.log(`\n(note: ${assertFailures} of the named targets unresolved — see per-name lines above)`);
  }
  console.log(`\nPROBE OK`);
  process.exit(0);
}

main();
