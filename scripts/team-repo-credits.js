#!/usr/bin/env node
// The RIS Team page (RIS-Team.md on the GitHub wiki): who worked on what, one section per
// version, newest first, each area folded (asked for 2026-10-27/28; the team wanted areas and
// names only - no files per person, no commit counts, no years).
//
//   node scripts/team-repo-credits.js [C:/RIS] [report|md] [--changelog C:/RIS/_wiki/changelog]
//
// md prints the whole page; report lists each version's areas with commit counts, the paths no
// area takes and the changelog roles no area takes, to check the tables below.
//
// Two sources, because the repo's history only starts on 2022-03-24, during 0.5's development:
//   - the RIS git history (every branch), for 0.5 onward: a commit belongs to the version whose
//     last release came out after it (0.5 up to release-0.5.5, 0.6 up to release-0.6.7, 0.7
//     after that). By date, not ancestry: 0.5.2 onward sit on a squashed release branch.
//   - the release notes' team lists ("The team!", "The Team (as of this version)!", "New members
//     to the team"), for every version that has them: 0.1-0.3, 0.5 and 0.6. 0.4's notes name no
//     one and it predates the repo, so 0.4 has no section rather than an invented one.
// Names are the ones the team uses; a person with no known handle shows their git name's first
// name only, never the full real name.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const REPO = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "C:/RIS";
const MODE = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : "report";
const opt = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const NOTES = opt("--changelog", path.join(REPO, "_wiki", "changelog"));
const tagDate = (t) => execFileSync("git", ["-C", REPO, "log", "-1", "--format=%ad", "--date=short", t], { encoding: "utf8" }).trim();

// Newest first. `until`: the version's last release (a commit dated after the previous one's,
// up to and including this one's, is this version's work). `notes`: its release notes.
const VERSIONS = [
  { title: "v0.7", until: null, notes: /^0\.7\./ },
  { title: "v0.6", until: "release-0.6.7", notes: /^0\.6\./ },
  { title: "v0.5", until: "release-0.5.5", notes: /^0\.5\./ },
  { title: "v0.4", until: null, notes: /^0\.4\./, noGit: true },
  { title: "v0.3", until: null, notes: /^0\.3\./, noGit: true },
  { title: "v0.2", until: null, notes: /^0\.2\./, noGit: true },
  { title: "v0.1", until: null, notes: /^0\.1\./, noGit: true },
];
for (const v of VERSIONS) v.to = v.until ? tagDate(v.until) : null;
const gitVersions = VERSIONS.filter((v) => !v.noGit);
const versionOf = (date) => {
  // The oldest git version whose last release is on or after the date; past every release: 0.7.
  for (let i = gitVersions.length - 1; i >= 0; i--) if (gitVersions[i].to && date <= gitVersions[i].to) return gitVersions[i];
  return gitVersions[0];
};

// The repo's first 24 commits (2022-03-24/25) are ahowl11 uploading the 0.4 files folder by
// folder ("Animals", "models_strat; models_unit", "tools and other files"): an import, not 0.5
// work. Real work starts with "Updated map region ownerships based off of todays work".
const IMPORT = ["bb0945730260", "f0fa13980528", "ea8cf38c36df", "8e77fec7d3c1", "f391a65fc5b3", "761dc5282c46",
  "779a88118fd5", "9c5c20a56853", "b4a0d020e72d", "64b5d92a171b", "c2f76e5397fe", "d8616ca74fd8", "a5003ed7e2e3",
  "fd1fb03283f9", "237cd27be967", "26b94d8ddf2c", "06933dd65321", "b00bdf4e0fae", "f26ca15a0112", "085bb2986666",
  "26f6ea79c1fc", "825012d1f037", "ee5c9892e843", "22afb138fcbe"];

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

// The release notes' roles, each comma-separated phrase into every area it names. A phrase that
// names no specific area but says coding/debugging/bug fixing goes to "Coding and gameplay".
const ROLES = [
  ["Leadership and organisation", /\bleader\b|founder|face of the mod|gitlab|repository|mod file management|artist workflow admin|manager of testers/],
  ["Testing", /test|quality assurance|feedback/],
  ["History and research", /histor|research|advisor|(celtic|germanic|seleucid|latin|armenian) specialist/],
  ["Texts and descriptions", /descri|\btexts?\b|text editing|\beditor\b|names data|\.txt|dev diaries/],
  ["Community and public relations", /public relations|\bpr support|discord|workshop|moddb|moderation/],
  ["Music and sound", /music|soundtrack|main menu theme/],
  ["Interface, unit cards, banners and menus", /unit cards|\bui\b|loading screens|faction symbols|banners|faction icons|faction maps|splash screen|menu video|2d art/],
  ["Unit models, textures and animations", /3d|model|\blods?\b|textur|assembly|clothing|helmet|linothorax|greaves|upscal|shields/],
  ["Battle maps, terrain, weather and vegetation", /environments|vegetation|weather|lighting|graphics/],
  ["Campaign map", /mapping|resource coding|campaign graphics|geography/],
  ["Buildings and settlements", /settlement plans|\bedb|building/],
  ["Units", /unit stats|^units$|battle balancing/],
  ["Campaign AI", /ai balancing/],
  ["Coding and gameplay", /gameplay balancing/],
  ["Traits and ancillaries", /^traits$|ancillar/],
  ["Factions and campaign setup", /characters|religions|cultures/],
  ["Campaign scripts and events", /\bscript(?!.*tool)/],  // \b: "description writer" holds "script"
  ["Tools", /\btool/],
];
const GENERIC = /coding|debugging|bug fixing/;
const IGNORE = /^(etc|miscellaneous stuff|and many other testers)$/;

const ORDER = ["Leadership and organisation", "Factions and campaign setup", "Campaign map", "Campaign scripts and events",
  "Campaign AI", "Units", "Coding and gameplay", "Unit models, textures and animations", "Buildings and settlements",
  "Traits and ancillaries", "Texts and descriptions", "History and research", "Interface, unit cards, banners and menus",
  "Battle maps, terrain, weather and vegetation", "Music and sound", "Campaign variants (Four Romans, Light, Classic)",
  "Tools", "Testing", "Community and public relations", "Wiki", "Joined the team"];

// ── git ─────────────────────────────────────────────────────────────────────
const commits = []; // { who, date, cats }
const unclassified = new Map();
let cur = null;
const log = execFileSync("git", ["-C", REPO, "log", "--all", "--no-merges", "--no-renames", "--format=@%H|%ae|%an|%ad", "--date=short", "--name-only"], { encoding: "utf8", maxBuffer: 1 << 30 });
for (const line of log.split("\n")) {
  if (line.startsWith("@")) {
    const [hash, email, name, date] = line.slice(1).split("|");
    cur = IMPORT.some((h) => hash.startsWith(h)) ? null : { who: WHO[email] || name, date, cats: new Set() };
    if (cur) commits.push(cur);
  } else if (line.trim() && cur) {
    const c = CATS.find(([, re]) => re.test(line));
    if (c) cur.cats.add(c[0]);
    else { const k = line.split("/").slice(0, 3).join("/"); unclassified.set(k, (unclassified.get(k) || 0) + 1); }
  }
}
for (const v of VERSIONS) v.git = new Map(); // cat -> Map(person -> commits)
for (const c of commits) {
  const v = versionOf(c.date);
  for (const cat of c.cats) {
    if (!v.git.has(cat)) v.git.set(cat, new Map());
    v.git.get(cat).set(c.who, (v.git.get(cat).get(c.who) || 0) + 1);
  }
}

// ── release notes ───────────────────────────────────────────────────────────
const key = (n) => String(n).toLowerCase().replace(/[-_\s]+/g, " ").trim();
const DISPLAY = new Map(); // key -> name as shown: the git name, else the newest notes' spelling
const vnum = (f) => f.replace(/\.md$/, "").split(".").map(Number);
const noteFiles = fs.existsSync(NOTES) ? fs.readdirSync(NOTES).filter((f) => /^\d+\.\d+\.\d+\.md$/.test(f))
  .sort((a, b) => { const x = vnum(a), y = vnum(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; }) : [];
const unmapped = new Map();
for (const v of VERSIONS) v.notes_ = new Map(); // cat -> [keys in order]
const credit = (v, cat, name) => {
  const k = key(name);
  if (!v.notes_.has(cat)) v.notes_.set(cat, []);
  if (!v.notes_.get(cat).includes(k)) v.notes_.get(cat).push(k);
};
// Newest release of a version first, so its own order (the lead first) is the one kept.
for (const f of noteFiles.slice().reverse()) {
  const ver = f.replace(/\.md$/, "");
  const v = VERSIONS.find((x) => x.notes.test(ver + "."));
  if (!v) continue;
  let sec = null;
  for (const l of fs.readFileSync(path.join(NOTES, f), "utf8").split(/\r?\n/)) {
    if (/^## /.test(l)) { sec = /new members/i.test(l) ? "new" : /team/i.test(l) ? "team" : null; continue; }
    if (!sec) continue;
    const m = /^- ([^:]{1,60}?):\s*(.+)$/.exec(l);
    if (sec === "new" && !m) { const n = /^- (.+)$/.exec(l); if (n) { credit(v, "Joined the team", n[1].trim()); if (!DISPLAY.has(key(n[1]))) DISPLAY.set(key(n[1]), n[1].trim()); } continue; }
    if (!m) continue;
    if (/testers/i.test(m[1])) {
      for (const n of m[2].split(/,\s*/)) if (n.trim()) { credit(v, "Testing", n.trim()); if (!DISPLAY.has(key(n))) DISPLAY.set(key(n), n.trim()); }
      continue;
    }
    const name = m[1].trim();
    if (!DISPLAY.has(key(name))) DISPLAY.set(key(name), name);
    for (const raw of m[2].replace(/[.!]+$/, "").split(/,\s*/)) {
      const p = raw.trim().replace(/^and\s+/i, "").toLowerCase();
      if (!p || IGNORE.test(p)) continue;
      const hit = ROLES.filter(([, re]) => re.test(p)).map(([c]) => c);
      if (!hit.length && GENERIC.test(p)) hit.push("Coding and gameplay");
      if (!hit.length) unmapped.set(p, (unmapped.get(p) || 0) + 1);
      // "2D Art for 0.1.0", "modDB page maintainer 0.1.0": later notes keep crediting old work;
      // it counts for the version it names, not for every version whose notes repeat it.
      const said = /\b(\d+\.\d+)\.\d+\b/.exec(p);
      const tv = (said && VERSIONS.find((x) => x.title === "v" + said[1])) || v;
      for (const c of hit) credit(tv, c, name);
    }
  }
}
for (const n of new Set(Object.values(WHO))) DISPLAY.set(key(n), n);

// ── the page ────────────────────────────────────────────────────────────────
function section(v) {
  const mainArea = new Map(); // person -> the area with most of their commits in this version
  for (const [cat, m] of v.git) for (const [w, n] of m) if (!mainArea.has(w) || n > v.git.get(mainArea.get(w)).get(w)) mainArea.set(w, cat);
  const out = [];
  for (const cat of ORDER) {
    // From git: most active first; a single commit in an area is a passing touch, not work
    // there, unless it is the area that person worked in most. Then the release notes' names.
    const names = [...(v.git.get(cat) || [])].filter(([w, n]) => n > 1 || mainArea.get(w) === cat)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([w]) => w);
    for (const k of v.notes_.get(cat) || []) { const n = DISPLAY.get(k) || k; if (!names.some((x) => key(x) === k)) names.push(n); }
    if (!names.length) continue;
    out.push(`<details><summary>${cat}</summary>`, "", ...names.map((n) => `- ${n}`), "", "</details>", "");
  }
  return out.length ? [`## ${v.title}`, "", ...out] : [];
}

if (MODE === "md") process.stdout.write(["# RIS Team", "", ...VERSIONS.flatMap(section)].join("\n").trimEnd() + "\n");
if (MODE === "report") {
  for (const v of VERSIONS) {
    console.log(`\n######## ${v.title}${v.to ? " (to " + v.to + ")" : ""}`);
    for (const cat of ORDER) {
      const g = [...(v.git.get(cat) || [])].sort((a, b) => b[1] - a[1]).map(([w, n]) => `${w} ${n}`);
      const nn = (v.notes_.get(cat) || []).map((k) => DISPLAY.get(k) || k);
      if (g.length || nn.length) console.log(`  ${cat}: ${g.join(", ")}${nn.length ? "  | notes: " + nn.join(", ") : ""}`);
    }
  }
  console.log("\n== changelog roles no area takes: " + [...unmapped].map(([p, n]) => `${p} (${n})`).join(" | "));
  console.log("\n== unclassified paths (file count): " + [...unclassified].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, n]) => `${n} ${k}`).join(" | "));
}
