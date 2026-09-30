// The campaign variants the wiki covers besides the main campaign (the team, 2026-09-30).
// id: short name in site paths (v/<id>/...) and temp files; data: the submod's data folder;
// campaign: its campaign folder when it is not imperial_campaign; out: where its wiki is built.
const VARIANTS = [
  { id: "4r", name: "Four Romans", data: "C:/RIS/_submods/RIS_Four_Romans/data", campaign: null },
  { id: "light", name: "RIS Light", data: "C:/RIS/_submods/RIS_Light/data", campaign: "ris_light" },
  { id: "classic", name: "RIS Classic", data: "C:/RIS/_submods/RIS_Classic/data", campaign: "ris_classic" },
].map((v) => ({ ...v, out: `C:/RIS/_wiki-variants/${v.id}` }));
const MAIN_NAME = "Main campaign";
module.exports = { VARIANTS, MAIN_NAME };
