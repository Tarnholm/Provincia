#!/usr/bin/env node
// The RIS Team page's "v0.7" section: who worked on what in the RIS repo since the 0.6.7 release, by
// category (asked for 2026-10-27; the team wanted categories, each folded, not files per person).
//
//   node scripts/team-repo-credits.js [C:/RIS] [report|md] [--after release-0.6.7] [--title v0.7]
//
// report (default) lists every category with its people and the paths no category takes;
// md prints the section to paste into RIS-Team.md on the GitHub wiki, replacing the old one. Only
// commits that are not part of the --after release count (every branch), under the heading --title.
// Names are the ones the team page uses; a person with no known handle shows their git name's
// first name only, never the full real name.
const { execFileSync } = require("child_process");
const fs = require("fs");
const REPO = process.argv[2] || "C:/RIS";
const MODE = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : "report";
const opt = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const AFTER = opt("--after", "release-0.6.7");
const TITLE = opt("--title", "v0.7");

// One person per email (several machines and spellings each); names as the team page writes them.
const WHO = {
  "ahowl1193@gmail.com": "Ahowl11",
  "8-jorellaf@users.noreply.gitlab.example.com": "Jorellaf",
  "vik.tarnholm@me.com": "Apple",
  "jojo.exterminator@web.de": "exi",
  "balbor.valis@gmail.com": "Balbor",
  "boo_themighty@hotmail.com": "GIR",
  "luis_mitridates@hotmail.com": "Luis",
  "philliparnvig@gmail.com": "philliparnvig",
  "sloot.patrick@gmail.com": "Patrick",
  "whalsema@hotmail.com": "Logis0550",
  "knorrskorpan@hotmail.com": "knorr",
  "eduardo_martins_carvalho@hotmail.com": "Eduardo",
  "mitchell_27@live.ca": "Mitchell",
  "lpetitto036@alumnos.frh.utn.edu.ar": "Luis G.",
  "navnet_mitt88@hotmail.com": "Hans Erik",
  "carlos_mogege@hotmail.com": "Lusitanio",
  "mauritsthedutchman@gmail.com": "Maurits",
  "m.den.hollander@outlook.com": "Maurits",
  "tonyandkatywillis@gmail.com": "tone",
  "diegoymetro@gmail.com": "moscaflaca",
  "fc55881@alunos.fc.ul.pt": "Swagger",
  "TWC_Swagger": "Swagger",
  "luke@email.com": "Lvcke",
  "luke.p@hotmail.co.uk": "Lvcke",
  "luke@yarddigital.com": "Lvcke",
  "arjan.rijvers@gmail.com": "Hadrian",
  "xristospereira@gmail.com": "Zeus Nikephoros",
  "dgxpiano@gmail.com": "NakedSpur",
  "delgado1giner@gmail.com": "ortiga",
  "dalamar1@outlook.dk": "Wopper",
  "sandehballs@gmail.com": "capy_the_bara",
  "nagydav90@gmail.com": "zuzaman",
  "43804445+zuzaman@users.noreply.github.com": "zuzaman",
  "dementive@email.com": "Dementive",
  "nathanvandrei@yahoo.com": "Dementive",
  "landerote@gmail.com": "Landerote",
  "brianguerrero246@gmail.com": "Refract",
  "41439659+daedsidog@users.noreply.github.com": "daedsidog",
  "contact@daedsidog.com": "daedsidog",
};

// First match wins. A commit counts once in each category it touches.
const CATS = [
  ["Wiki", /^(_wiki|RIS\/wiki\/|wiki\/)/],
  ["Tools", /^(_?tools\/|RIS\/data\/enhanced_tweaks\/)/],
  ["Campaign variants (Four Romans, Light, Classic)", /^_submods\/RIS_(Four_Romans|Light|Classic|classic|Light_Four_Romans|Mundus_Magnus|Vanilla|native_faction_names)/],
  ["Music and sound", /^(RIS\/data\/(sounds|music)\/|"?_resources\/sounds|_submods\/RIS_vanilla_music)/],
  ["Campaign scripts and events", /^RIS\/data\/(world\/maps\/campaign\/[^/]+\/(campaign_script|.*script.*\.txt$|descr_events)|major_event_scripts\/|descr_sm_major_events|export_descr_advice|scripts\/|toggles\/)|^RIS\/data\/text\/(major_events|export_vnvs_events)/],
  ["Campaign AI", /^RIS\/data\/(feral_descr_ai_personality|descr_formations_ai|descr_campaign_ai|descr_sm_factions_difficulty|world\/maps\/campaign\/[^/]+\/descr_campaign_ai)/],
  ["Units", /^RIS\/data\/(export_descr_unit|descr_mount|descr_projectile|descr_unit_variation|world\/maps\/campaign\/[^/]+\/descr_mercenaries)|^unit_issues/],
  ["Unit models, textures and animations", /^RIS\/data\/(descr_model_battle|models_unit|characters\/|animations\/|animals\/|descr_skeleton|unit_models\/|textures\/|models\/textures\/|sprites\/|SPRITES\/|models_effects\/|models_missile\/|models_engine\/|descr_engines)/],
  ["Buildings and settlements", /^RIS\/data\/(export_descr_buildings|descr_building_battle|models_building\/|settlement_plans\/|descr_settlement_plan|descr_walls|descr_ui_buildings|ui\/[^/]+\/buildings\/|descr_landscape_ambient_settlements)/],
  ["Traits and ancillaries", /^RIS\/data\/(export_descr_character_traits|export_descr_ancillaries|text\/export_ancillaries|ui\/ancillaries\/)/],
  ["Campaign map", /^(RIS\/data\/(world\/maps\/base\/|models_strat\/|descr_model_strat|descr_sm_resources|custom_locations|descr_geography|models\/riverbanks\/)|_resources\/maps\/|Resources\/map_generation\/|_submods\/RIS_alternate_map_textures\/)/],
  ["Factions and campaign setup", /^RIS\/data\/(world\/maps\/campaign\/|descr_sm_factions|descr_rebel_factions|descr_cultures|descr_beliefs|descr_character|descr_names|descr_namelists|descr_campaigns|descr_win_conditions|descr_items)|^RIS\/data\/items\//],
  ["Texts and descriptions", /^RIS\/data\/(text\/|string_overrides\/)/],
  ["Interface, unit cards, banners and menus", /^RIS\/data\/(ui\/|menu\/|banners\/|descr_banners|descr_standards|descr_sm_faction_logos|loading_screen\/|ui_overrides\/|ui_scaling|original_overrides\/|feral_textures\/|fmv\/)/],
  ["Battle maps, terrain, weather and vegetation", /^_resources\/SwaggersLatestTS\/|^_submods\/vanilla_grass\/|^RIS\/(truesky\/|data\/(terrain\/|vegetation\/|models_vegetation\/|models_landscape\/|feral_descr_truesky|feral_descr_grass|descr_vegetation|descr_landscape|world\/maps\/battle\/|world\/maps\/custom\/|battlefield\/|descr_quick_battle|weather|descr_weather|descr_sky|descr_lighting|feral_descr_movement|descr_climates))/],
];

const per = new Map(); // cat -> Map(person -> {n, first, last})
const unclassified = new Map();
const add = (cat, who, date) => {
  if (!per.has(cat)) per.set(cat, new Map());
  const m = per.get(cat);
  const e = m.get(who) || { n: 0, first: date, last: date };
  e.n++; if (date < e.first) e.first = date; if (date > e.last) e.last = date;
  m.set(who, e);
};
let cur = null;
// Old feature branches never merged into the release are not part of it either, so a commit
// must also be dated after the release to count.
const SINCE = execFileSync("git", ["-C", REPO, "log", "-1", "--format=%ad", "--date=short", AFTER], { encoding: "utf8" }).trim();
const flush = () => {
  if (!cur || cur.date <= SINCE) return;
  for (const c of cur.cats) add(c, cur.who, cur.date);
};
for (const line of execFileSync("git", ["-C", REPO, "log", "--all", `^${AFTER}`, "--no-merges", "--no-renames", "--format=@%H|%ae|%an|%ad", "--date=short", "--name-only"], { encoding: "utf8", maxBuffer: 1 << 30 }).split("\n")) {
  if (line.startsWith("@")) {
    flush();
    const [, email, name, date] = line.slice(1).split("|");
    cur = { who: WHO[email] || name, date, cats: new Set() };
  } else if (line.trim() && cur) {
    const c = CATS.find(([, re]) => re.test(line));
    if (c) cur.cats.add(c[0]);
    else { const k = line.split("/").slice(0, 3).join("/"); unclassified.set(k, (unclassified.get(k) || 0) + 1); }
  }
}
flush();

if (MODE === "report") {
  for (const [cat] of CATS) {
    const m = per.get(cat); if (!m) continue;
    console.log(`\n== ${cat}`);
    console.log([...m].sort((a, b) => b[1].n - a[1].n).map(([w, e]) => `${w} ${e.n} (${e.first.slice(0, 4)}-${e.last.slice(0, 4)})`).join(", "));
  }
  console.log("\n== unclassified paths (file count)");
  console.log([...unclassified].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, n]) => `${n} ${k}`).join(" | "));
}
if (MODE === "json") console.log(JSON.stringify(Object.fromEntries(CATS.filter(([c]) => per.has(c)).map(([c]) => [c, Object.fromEntries([...per.get(c)].sort((a, b) => b[1].n - a[1].n))]))));

// The team page section: one folded block per category, people by commits.
if (MODE === "md") {
  const ORDER = ["Factions and campaign setup", "Campaign map", "Campaign scripts and events", "Campaign AI", "Units",
    "Unit models, textures and animations", "Buildings and settlements", "Traits and ancillaries", "Texts and descriptions",
    "Interface, unit cards, banners and menus", "Battle maps, terrain, weather and vegetation", "Music and sound",
    "Campaign variants (Four Romans, Light, Classic)", "Tools", "Wiki"];
  const mainArea = new Map(); // person -> the category with most of their commits
  for (const [cat, m] of per) for (const [w, e] of m) if (!mainArea.has(w) || e.n > per.get(mainArea.get(w)).get(w).n) mainArea.set(w, cat);
  const out = [`## ${TITLE}`, ""];
  for (const cat of ORDER) {
    const m = per.get(cat); if (!m) continue;
    // Names only (no commit counts or years, as the team asked), most active first. A single commit in an area
    // is a passing touch, not work there, unless it is the area that person worked in most.
    const people = [...m].filter(([w, e]) => e.n > 1 || mainArea.get(w) === cat).sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]));
    if (!people.length) continue;
    out.push(`<details><summary>${cat}</summary>`, "");
    for (const [w] of people) out.push(`- ${w}`);
    out.push("", "</details>", "");
  }
  process.stdout.write(out.join("\n"));
}
