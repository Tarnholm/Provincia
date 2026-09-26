#!/usr/bin/env node
/**
 * Download the RIS developer diaries from Discord (read-only) for the wiki.
 *
 *   node scripts/fetch-discord-diaries.js [--out C:/dev/ris-diaries-cache] [--token-file <path>]
 *
 * Uses the RIS Crash Bot (needs View Channel + Read Message History on each channel, and the
 * Message Content intent). The token comes from DISCORD_TOKEN or --token-file. Nothing is
 * posted; every call is a GET. Output: <out>/<channel-id>.json, oldest message first, plus
 * <out>/channels.json naming each channel. gen-ris-diary-pages.js builds the wiki from these.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const OUT = valOf("--out", "C:/dev/ris-diaries-cache");
const TOKEN_FILE = valOf("--token-file", null);
const TOKEN = (process.env.DISCORD_TOKEN || (TOKEN_FILE && fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, "utf8") : "")).trim();
if (!TOKEN) { console.error("No token: set DISCORD_TOKEN or pass --token-file <path>"); process.exit(1); }

// 📒developer-diaries: every diary is posted here (the old per-diary channels are not used).
const DIARY_CHANNELS = [
  ["894286297802362931", "developer-diaries"],
];
// --channel <id or link> (repeatable): read other rooms instead, e.g. an old drafting room, to
// recover pictures whose post in the diary channel was deleted. They are saved under <out>/extra/
// and never become diary pages.
const EXTRA = argv.flatMap((a, i) => (a === "--channel" ? [String(argv[i + 1] || "").split("/").filter(Boolean).pop()] : [])).filter((id) => /^\d+$/.test(id));
const CHANNELS = EXTRA.length ? EXTRA.map((id) => [id, `extra-${id}`]) : DIARY_CHANNELS;
const DEST = EXTRA.length ? path.join(OUT, "extra") : OUT;
const H = { Authorization: `Bot ${TOKEN}`, "User-Agent": "RIS-wiki/1.0" };

(async () => {
  fs.mkdirSync(DEST, { recursive: true });
  const index = [];
  for (const [id, name] of CHANNELS) {
    const all = [];
    let before = null, status = "ok";
    for (;;) {
      const r = await fetch(`https://discord.com/api/v10/channels/${id}/messages?limit=100${before ? `&before=${before}` : ""}`, { headers: H });
      if (r.status === 429) { await new Promise((res) => setTimeout(res, 1500)); continue; }
      if (!r.ok) { status = `HTTP ${r.status}`; break; }
      const batch = await r.json();
      if (!batch.length) break;
      all.push(...batch);
      before = batch[batch.length - 1].id;
      if (batch.length < 100) break;
    }
    all.reverse();
    const withText = all.filter((m) => m.content && m.content.trim()).length;
    console.log(`${name.padEnd(20)} ${status.padEnd(9)} ${String(all.length).padStart(4)} messages, ${withText} with text, ${all.reduce((n, m) => n + m.attachments.length, 0)} attachments`);
    if (all.length && !withText) console.log("   (every message has empty text: switch on the bot's Message Content intent)");
    if (all.length) fs.writeFileSync(path.join(DEST, `${id}.json`), JSON.stringify(all, null, 1));
    index.push({ id, name, status, messages: all.length });
  }
  if (!EXTRA.length) fs.writeFileSync(path.join(OUT, "channels.json"), JSON.stringify(index, null, 1));
  console.log(`\nsaved to ${DEST}.${EXTRA.length ? "" : " next: node scripts/gen-ris-diary-pages.js"}`);
})().catch((e) => { console.error(e); process.exit(1); });
