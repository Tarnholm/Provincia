// The campaign variants the wiki covers besides the main campaign (the team, 2026-09-30).
// id: short name in site paths (v/<id>/...) and temp files; data: the submod's data folder;
// campaign: its campaign folder when it is not imperial_campaign; out: where its wiki is built;
// playable: factions that are not choosable in the main campaign but are in this one.
const VARIANTS = [
  // Four Romans: the two Roman rebel factions are the Houses of Aemilii and Cornelii.
  { id: "4r", name: "Four Romans", data: "C:/RIS/_submods/RIS_Four_Romans/data", campaign: null, playable: ["roman_rebels_1", "roman_rebels_2"] },
  { id: "light", name: "RIS Light", data: "C:/RIS/_submods/RIS_Light/data", campaign: "ris_light" },
  { id: "classic", name: "RIS Classic", data: "C:/RIS/_submods/RIS_Classic/data", campaign: "ris_classic" },
].map((v) => ({ ...v, out: `C:/RIS/_wiki-variants/${v.id}` }));
const MAIN_NAME = "Main campaign";
// The factions that are not choosable in the campaign being built (RIS_VARIANT, else the main
// one). They get no page of their own and share factions/non-playable.md, written by
// gen-ris-faction-pages.js; every generator that links a faction reads this one list.
const CURRENT = VARIANTS.find((v) => v.id === process.env.RIS_VARIANT);
const NON_PLAYER = [
  "slave", "roman_senate", "dummies",
  "roman_rebels_1", "roman_rebels_2", "hellenistic_rebels",
  "ptolemaic_rebels", "seleucid_rebels", "seleucid_rebels2",
].filter((f) => !((CURRENT && CURRENT.playable) || []).includes(f));
module.exports = { VARIANTS, MAIN_NAME, NON_PLAYER };
