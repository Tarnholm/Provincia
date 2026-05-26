// Compare ImHex pattern outputs across three saves
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname);
const files = {
  bactria_t964: "imhex-out-bactria-t964.json",
  dummies_t900: "imhex-out-dummies-t900.json",
  dummies_t1134: "imhex-out-dummies-t1134.json",
};

const data = {};
for (const [k, f] of Object.entries(files)) {
  data[k] = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
}

function rowsHeader() {
  const fields = [
    "magic", "campaign_uuid", "campaign_type_flag", "save_version",
    "hash_campaign", "hash_mod", "hash_variant",
    "session_timestamp", "campaign_name_len", "campaign_name",
  ];
  console.log("\n=== HEADER COMPARISON ===");
  console.log("field".padEnd(22), "bactria_t964".padEnd(22), "dummies_t900".padEnd(22), "dummies_t1134".padEnd(22), "same?");
  for (const f of fields) {
    const vs = Object.values(data).map(d => JSON.stringify(d.header[f]));
    const same = vs[0] === vs[1] && vs[1] === vs[2];
    console.log(f.padEnd(22), vs[0].padEnd(22), vs[1].padEnd(22), vs[2].padEnd(22), same ? "SAME" : "DIFF");
  }
}

function rowsUnknown() {
  console.log("\n=== UNKNOWN BYTES IN HEADER ===");
  for (const k of Object.keys(data)) {
    const u1 = data[k].header.unknown_08_1c.map(b => b.toString(16).padStart(2, "0")).join(" ");
    const u2 = data[k].header.unknown_34_3a.map(b => b.toString(16).padStart(2, "0")).join(" ");
    console.log(`${k}:\n  0x08..0x1c = ${u1}\n  0x34..0x3a = ${u2}`);
  }
}

function rowsDiscovered() {
  console.log("\n=== DISCOVERED BITMASK ===");
  for (const k of Object.keys(data)) {
    const d = data[k].discovered;
    const sent = d.sentinel.map(b => b.toString(16).padStart(2, "0")).join(" ");
    const bits = d.bits.map(b => b.toString(16).padStart(2, "0")).join(" ");
    console.log(`${k}: sentinel=${sent} byte_count=${d.byte_count} bits=${bits}`);
  }
}

function rowsMod() {
  console.log("\n=== MOD INFO ===");
  for (const k of Object.keys(data)) {
    const d = data[k];
    const name = d.mod_display_name ? d.mod_display_name.chars : "(none)";
    const hash = d.mod_content_hash ? d.mod_content_hash.chars : "(none)";
    const mpath = d.mod_path ? d.mod_path.chars : "(none)";
    console.log(`${k}: action_counter=${d.action_counter}`);
    console.log(`  mod_display_name = ${JSON.stringify(name)}`);
    console.log(`  mod_content_hash = ${JSON.stringify(hash)}`);
    console.log(`  mod_path         = ${JSON.stringify(mpath)}`);
  }
}

function rowsRegistry() {
  console.log("\n=== SECTION REGISTRY (first 10 entries at each candidate offset) ===");
  for (const k of Object.keys(data)) {
    console.log(`\n[${k}]`);
    for (const which of ["registry_at_566", "registry_at_3310"]) {
      const arr = data[k][which];
      if (!arr) { console.log(`  ${which}: (missing)`); continue; }
      // Show first 12 entries, name + count, also flag if name looks valid
      const first = arr.slice(0, 12).map(e => `${e.name}=${e.count}`).join(", ");
      console.log(`  ${which}: ${first}`);
    }
  }
}

rowsHeader();
rowsUnknown();
rowsDiscovered();
rowsMod();
rowsRegistry();
