// scripts/probe-leader-portrait.js
//
// Reproduces the renderer's leader-portrait resolution data path WITHOUT the UI:
//   1. crackSave() → characters/charactersByRegion/units (same as snapshot)
//   2. Build commanderInfo the way App.js does (secondaryUuid → meta)
//   3. For the player faction's LEADER, check whether their bodyguard unit's
//      commanderUuid is present in commanderInfo (the swap), and whether the
//      faction → culture lookup resolves. If either fails → the renderer falls
//      back to the bodyguard unit icon (the reported bug).
//   4. Also probes findFactionMarkers WITH and WITHOUT the new /_rebel$/ guard
//      to quantify whether the guard shifted the leader's faction attribution.
//
// Usage: node scripts/probe-leader-portrait.js <save.sav> [--mod <dir>]

"use strict";
const fs = require("fs");
const path = require("path");
const { crackSave } = require("../src/saveCracker.js");

function parseArgs(argv) {
  const a = { save: null, mod: "C:\\RIS\\RIS\\data" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--mod") a.mod = argv[++i];
    else if (!a.save) a.save = argv[i];
  }
  return a;
}

// Replicate characterParserV2.findFactionMarkers, parameterised on the guard.
function findFactionMarkers(buf, dropRebel) {
  const markers = [];
  const pattern = Buffer.from("captain_card_", "ascii");
  let p = 0;
  while ((p = buf.indexOf(pattern, p)) !== -1) {
    let end = p + pattern.length;
    let factionName = "";
    while (end < buf.length) {
      const b = buf[end];
      if (b === 0x2e) break;
      if (b < 0x20 || b > 0x7e) break;
      factionName += String.fromCharCode(b);
      end++;
    }
    if (factionName.length > 0 && factionName.length < 30) {
      if (!(dropRebel && /_rebel$/.test(factionName))) {
        markers.push({ pos: p, faction: factionName });
      }
    }
    p += pattern.length;
  }
  return markers;
}

function lastFactionBefore(markers, offset) {
  let last = null;
  for (const m of markers) {
    if (m.pos < offset) last = m.faction;
    else break;
  }
  return last;
}

function loadFactionCultures(modDir) {
  // EXACT replica of main.js ipcMain.handle("faction-cultures").
  const map = {};
  try {
    const text = fs.readFileSync(path.join(modDir, "descr_sm_factions.txt"), "utf8");
    let curFaction = null;
    for (const line of text.split(/\r?\n/)) {
      const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
      if (fm) { curFaction = fm[1]; continue; }
      if (curFaction) {
        const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/);
        if (cm) {
          if (!(curFaction in map)) map[curFaction] = cm[1];
          curFaction = null;
        }
      }
    }
  } catch (e) { console.warn("culture load failed:", e.message); }
  return map;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.save || !fs.existsSync(args.save)) {
    console.error("save not found:", args.save);
    process.exit(1);
  }
  const buf = fs.readFileSync(args.save);
  const r = crackSave(buf, args.mod);
  const player = r.playerFaction;
  console.log(`\n=== ${path.basename(args.save)} ===`);
  console.log(`turn ${r.turn}  player=${player}`);

  // crackSave returns r.characters.v1 (trait-anchored generals incl. leader).
  const v1 = (r.characters && Array.isArray(r.characters.v1)) ? r.characters.v1 : [];
  console.log(`\nv1 chars=${v1.length}`);
  // Dump shape of first leader-ish record.
  const sampleKeys = v1[0] ? Object.keys(v1[0]) : [];
  console.log(`v1 record keys: ${sampleKeys.join(", ")}`);

  const flatByRegion = v1;

  // Build commanderInfo the way App.js does: secondaryUuid → meta.
  const commanderInfo = new Map();
  for (const c of flatByRegion) {
    if (!c.secondaryUuid) continue;
    commanderInfo.set(c.secondaryUuid, {
      firstName: c.firstName || null,
      lastName: c.lastName || null,
      faction: c.faction || null,
      age: typeof c.age === "number" ? c.age : null,
      isLeader: c.isLeader,
    });
  }

  // Build unit commanderUuid → unit map.
  const units = r.units || [];
  const unitsByCmd = new Map();
  for (const u of units) {
    if (u.commanderUuid) {
      if (!unitsByCmd.has(u.commanderUuid)) unitsByCmd.set(u.commanderUuid, []);
      unitsByCmd.get(u.commanderUuid).push(u);
    }
  }

  const factionCultures = loadFactionCultures(args.mod);
  console.log(`factionCultures sample: ${player}=${factionCultures[player] || "(MISSING)"}`);

  // Find leaders across factions, focus on player.
  const leaders = flatByRegion.filter(c => c.isLeader);
  console.log(`\n-- leaders found in charactersByRegion: ${leaders.length} --`);
  for (const L of leaders) {
    const hasUnit = L.secondaryUuid && unitsByCmd.has(L.secondaryUuid);
    const inCmdInfo = L.secondaryUuid && commanderInfo.has(L.secondaryUuid);
    const culture = L.faction ? (factionCultures[String(L.faction).toLowerCase()] || null) : null;
    const swapWouldFire = inCmdInfo && culture;
    const isPlayer = String(L.faction).toLowerCase() === String(player).toLowerCase();
    console.log(`  ${isPlayer ? "★PLAYER " : "        "}${L.firstName} ${L.lastName || ""} faction=${L.faction || "(NULL)"} offset=${L.offset} secUuid=${L.secondaryUuid ? (L.secondaryUuid>>>0).toString(16) : "(none)"} hasBodyguardUnit=${!!hasUnit} inCommanderInfo=${!!inCmdInfo} culture=${culture || "(MISSING)"} → portraitSwapFires=${!!swapWouldFire ? "YES" : "NO → BODYGUARD ICON"}`);
  }

  // Faction-marker guard impact analysis.
  const mWith = findFactionMarkers(buf, true);   // new behavior (drop _rebel)
  const mWithout = findFactionMarkers(buf, false); // old behavior
  const dropped = mWithout.length - mWith.length;
  console.log(`\n-- faction markers: ${mWith.length} (new, _rebel dropped) vs ${mWithout.length} (old) → ${dropped} dropped --`);
  const rebelMarkers = mWithout.filter(m => /_rebel$/.test(m.faction));
  const uniqRebel = [...new Set(rebelMarkers.map(m => m.faction))];
  console.log(`   dropped _rebel marker names: ${uniqRebel.join(", ") || "(none)"}`);

  // For the player leader, did the dropped markers change its last-marker-before-offset?
  // ── Actual portrait FILE resolution for the player leader ──────────────
  // commanderInfo forces savePath=null → IPC hash pool. Reproduce that pick.
  function hashName(name) { let h = 5381; for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) | 0; return h >>> 0; }
  function resolvePool(bucketDir) {
    try { const g = path.join(bucketDir, "generals"); const dds = fs.readdirSync(g).filter(n => n.toLowerCase().endsWith(".tga.dds")).sort(); if (dds.length) return { dir: g, files: dds, ext: ".tga.dds" }; } catch {}
    try { const all = fs.readdirSync(bucketDir); const dds = all.filter(n => n.toLowerCase().endsWith(".tga.dds")).sort(); if (dds.length) return { dir: bucketDir, files: dds, ext: ".tga.dds" }; const tga = all.filter(n => n.toLowerCase().endsWith(".tga")).sort(); if (tga.length) return { dir: bucketDir, files: tga, ext: ".tga" }; } catch {}
    return null;
  }
  function loadPortraitMapping(modDir) {
    const out = {}; try {
      const text = fs.readFileSync(path.join(modDir, "descr_cultures.txt"), "utf8");
      let cur = null; for (const raw of text.split(/\r?\n/)) {
        const h = /^\t"([a-z_]+)"\s*:\s*$/.exec(raw); if (h) { cur = h[1].toLowerCase(); continue; }
        const m = /"portrait mapping"\s*:\s*"([a-z_]+)"/.exec(raw); if (m && cur) out[cur] = m[1].toLowerCase();
      }
    } catch {} return out;
  }
  const VANILLA_UI = "C:/Program Files (x86)/Steam/steamapps/common/Total War ROME REMASTERED/Contents/Resources/Data/data/ui";
  function resolvePortraitFile(modDir, culture, ctx) {
    const c = String(culture).toLowerCase();
    const dirs = [path.join(modDir, "ui"), VANILLA_UI];
    const VANILLA = ["roman","greek","eastern","egyptian","carthaginian","barbarian"];
    const mapping = loadPortraitMapping(modDir);
    const tryCultures = [c]; if (mapping[c] && mapping[c] !== c) tryCultures.push(mapping[c]);
    for (const v of VANILLA) if (!tryCultures.includes(v)) tryCultures.push(v);
    const ageNum = ctx.age != null ? Number(ctx.age) : null;
    const ageBucket = (ageNum != null && ageNum >= 35) ? "old" : "young";
    const nameHash = hashName([ctx.name, "", ctx.faction || ""].join("|"));
    for (const tc of tryCultures) for (const d of dirs) {
      const bucketDir = path.join(d, tc, "portraits", "portraits", ageBucket);
      const pool = resolvePool(bucketDir);
      if (!pool || pool.files.length === 0) continue;
      const idx = nameHash % pool.files.length;
      const isVanilla = d.includes("Total War ROME REMASTERED");
      return { ok: true, path: path.join(pool.dir, pool.files[idx]), culture: tc, bucket: ageBucket, idx, poolSize: pool.files.length, source: isVanilla ? "VANILLA" : "MOD", ext: pool.ext };
    }
    return { ok: false };
  }

  console.log(`\n-- actual portrait-file resolution for player leader (savePath forced null → hash pool) --`);
  const plr = leaders.filter(L => String(L.faction).toLowerCase() === String(player).toLowerCase());
  for (const L of plr) {
    const culture = factionCultures[String(L.faction).toLowerCase()] || L.faction;
    const ctx = { name: L.firstName, faction: L.faction, age: L.age };
    const res = resolvePortraitFile(args.mod, culture, ctx);
    const exists = res.ok && fs.existsSync(res.path);
    console.log(`  ${L.firstName} (age ${L.age}, culture ${culture}) → ${res.ok ? `[${res.source} ${res.ext}] ${res.culture}/${res.bucket} idx=${res.idx}/${res.poolSize} ${path.basename(res.path)} EXISTS=${exists}` : "NO POOL FOUND"}`);
  }

  const playerLeader = leaders.find(L => String(L.faction).toLowerCase() === String(player).toLowerCase())
    || leaders[0];
  if (playerLeader && typeof playerLeader.offset === "number") {
    const facNew = lastFactionBefore(mWith, playerLeader.offset);
    const facOld = lastFactionBefore(mWithout, playerLeader.offset);
    console.log(`\n-- marker attribution for leader "${playerLeader.firstName}" @offset ${playerLeader.offset}: old=${facOld} new=${facNew} ${facOld === facNew ? "(UNCHANGED)" : "*** CHANGED ***"}`);
  }
}

main();
