#!/usr/bin/env node
/**
 * RIS wiki: the developer diaries from Discord (#📒developer-diaries), one page per diary,
 * plus diaries.md.
 *
 *   node scripts/gen-ris-diary-pages.js [--cache C:/dev/ris-diaries-cache] [--out C:/RIS/_wiki] [--list]
 *
 * Reads what fetch-discord-diaries.js saved (no Discord access here, except downloading the
 * posts' images, which are public CDN links). --list prints every diary's first and last
 * lines instead of writing, to check the boundaries by eye.
 *
 * BOUNDARIES. A diary is several posts (Discord caps one at 2,000 characters). A new diary
 * starts when a post OPENS like one ("**Developer Diary 2**", "Welcome to...", "~~~~",
 * "Chaire"), when the previous post CLOSED one ("That's all for this week's Developer Diary",
 * "until next time"), or after more than GAP_HOURS of silence. Identical text posted twice in
 * a row counts once.
 *
 * IMAGES. Originals (full-size screenshots, ~3 MB each; 1,400 of them) stay in
 * <cache>/images. The site gets a resized WebP of each (<= 1600 px wide) in diary-images/:
 * GitHub Pages refuses sites over 1 GB, and the originals alone are ~4 GB.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const argv = process.argv.slice(2);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const CACHE = valOf("--cache", "C:/dev/ris-diaries-cache");
const OUT = valOf("--out", "C:/RIS/_wiki");
const LIST = argv.includes("--list");
const GAP_HOURS = 1;
const MAX_WIDTH = 1600;
const say = (s) => console.log(s);
const slug = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

// Tested on the post with divider lines ("~~~~", "————") removed: those separate SECTIONS
// inside a diary, they do not start one.
const START = /^\s*(\**\s*(developer|dev)\s+diary\s*#?\d+|welcome (to|back|friends)|hello(,)? (and welcome|everyone|again)|hello!|\*?chaire|greetings|salve|hi,? everyone|hear ye|today we will show|merry christmas everyone|i bet none saw)/i;
const stripDividers = (t) => String(t || "").replace(/^\s*([~\u2014\u2013-]{3,}\s*)+/g, "");
const ADDENDUM_HOURS = 6;   // a non-diary post this soon after a diary belongs to it
const MIN_DIARY_CHARS = 800; // less text than this is a teaser, link or chat, not a diary
const END = /(that'?s (all|it) (for|from)|that is (all|it) for|this concludes|that (does it|covers it) for|until next time|till next time|see you (all )?(next|in the next)|stay tuned for the next)/i;
const GREETING = /^(~+|welcome|hello|hi |hey|greetings|salve|\*?chaire|i bet|it has been|it's been|that'?s all)/i;

if (!fs.existsSync(path.join(CACHE, "channels.json"))) {
  say(`no diary cache at ${CACHE} - run fetch-discord-diaries.js first. Nothing written.`);
  process.exit(0);
}
const CHANNELS = JSON.parse(fs.readFileSync(path.join(CACHE, "channels.json"), "utf8"));
const CHANNEL_NAME = Object.fromEntries(CHANNELS.map((c) => [c.id, c.name]));

// ── Discord markup -> markdown ──────────────────────────────────────────────
function convert(text, msg) {
  const users = Object.fromEntries((msg.mentions || []).map((u) => [u.id, u.global_name || u.username]));
  return String(text || "")
    .replace(/<@!?(\d+)>/g, (m, id) => (users[id] ? `@${users[id]}` : "@someone"))
    .replace(/<@&\d+>/g, "")
    .replace(/<#(\d+)>/g, (m, id) => (CHANNEL_NAME[id] ? `#${CHANNEL_NAME[id]}` : "a channel"))
    .replace(/<a?:(\w+):\d+>/g, ":$1:")
    .replace(/<t:(\d+)(?::\w)?>/g, (m, t) => new Date(Number(t) * 1000).toISOString().slice(0, 10))
    .replace(/\|\|([\s\S]*?)\|\|/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/^-# (.*)$/gm, "_$1_")
    .replace(/^\s*~{3,}\s*$/gm, "")
    .replace(/@everyone|@here/g, "")
    .trim();
}
/** The diary's own heading: the first "# ..." or "**...**" line that is not a greeting. */
function titleOf(text) {
  for (const raw of String(text).split("\n").slice(0, 40)) {
    const l = raw.trim();
    const m = /^#{1,3}\s+(.+)$/.exec(l) || /^\*\*([^*]{3,90})\*\*:?$/.exec(l);
    if (m) {
      const t = m[1].replace(/[*_`]/g, "").trim();
      if (t && !GREETING.test(t)) return t;
    }
  }
  return null;
}

// ── group posts into diaries ────────────────────────────────────────────────
const diaries = [];
for (const c of CHANNELS) {
  const f = path.join(CACHE, `${c.id}.json`);
  if (!fs.existsSync(f)) continue;
  const msgs = JSON.parse(fs.readFileSync(f, "utf8")).filter((m) => m.type === 0 || m.type === 19);
  let cur = null, closed = false;
  for (const m of msgs) {
    const t = Date.parse(m.timestamp);
    const text = m.content || "";
    const starts = START.test(stripDividers(text));
    // A diary opens with its own greeting; posts before it (a quote, a banner image) are its
    // preamble and stay with it - so a START only splits once the group already has one.
    // A preamble is posted minutes before the greeting (Rex's in-character monologues run to
    // thousands of characters, so length cannot tell them apart); an older group without a
    // greeting is a diary of its own. A diary that CLOSED ("That's all from us") splits anyway.
    const preamble = cur && !cur.hasStart && t - cur.first < 20 * 60e3;
    const split = !cur || closed || t - cur.last > GAP_HOURS * 3600e3 || (starts && !preamble);
    if (split) { cur = { author: m.author.global_name || m.author.username, first: t, last: t, msgs: [], hasStart: false, chars: 0 }; diaries.push(cur); }
    cur.chars += text.length;
    if (starts) cur.hasStart = true;
    if (!(text && cur.msgs.some((x) => x.content === text))) cur.msgs.push(m);
    cur.last = t;
    closed = END.test(text);
  }
}
// A group with no greeting of its own that follows a diary within ADDENDUM_HOURS is that
// diary's follow-up (more screenshots, "let us know what you think").
for (let i = diaries.length - 1; i > 0; i--) {
  const d = diaries[i], p = diaries[i - 1];
  if (!d.hasStart && d.first - p.last < ADDENDUM_HOURS * 3600e3) { p.msgs.push(...d.msgs); p.last = d.last; diaries.splice(i, 1); }
}
const textLen = (d) => d.msgs.reduce((n, m) => n + (m.content || "").length, 0);
// Not diaries: too little text, or an announcement (an @everyone shout-out, a video link)
// with no diary greeting of its own.
const firstText = (d) => (d.msgs.find((m) => m.content) || {}).content || "";
const DROPPED = diaries.filter((d) => textLen(d) < MIN_DIARY_CHARS || (!d.hasStart && /@everyone|youtu\.?be|tiermaker/i.test(firstText(d))));
for (const d of DROPPED) diaries.splice(diaries.indexOf(d), 1);
// Titles written by reading each diary (scripts/ai-prose/diaries/titles.json, keyed by the
// diary's first message id); a diary without one is titled by its date.
const TITLES = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "ai-prose", "diaries", "titles.json"), "utf8")); } catch { return {}; } })();

// --openings: each diary's first 420 characters and its bold lines, to write titles from.
if (argv.includes("--openings")) {
  for (const d of diaries) {
    const all = d.msgs.map((m) => m.content || "").filter(Boolean);
    const t = all.join(" ").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ");
    const bold = [...new Set(all.join("\n").match(/\*\*[^*\n]{3,40}\*\*/g) || [])].slice(0, 8).join(", ");
    say(`${d.msgs[0].id} ${new Date(d.first).toISOString().slice(0, 10)} ${d.author} | ${t.slice(0, 420)} || bold: ${bold}`);
  }
  process.exit(0);
}
if (LIST) {
  say(`${diaries.length} diaries; left out as not diaries (under ${MIN_DIARY_CHARS} characters of text): ${DROPPED.length}`);
  diaries.forEach((d, i) => {
    const texts = d.msgs.map((m) => m.content).filter(Boolean);
    const one = (s) => JSON.stringify(String(s || "").replace(/\s+/g, " ").slice(0, 90));
    say(`#${i + 1} id=${d.msgs[0].id} ${new Date(d.first).toISOString().slice(0, 16)} ${d.author} | ${d.msgs.length} posts, ${d.msgs.reduce((n, m) => n + m.attachments.length, 0)} img, ${textLen(d)} chars | title: ${TITLES[d.msgs[0].id] || "-"}`);
    say(`    first: ${one(texts[0])}`);
    say(`    last:  ${one(texts[texts.length - 1])}`);
  });
  process.exit(0);
}

// ── images: download originals (8 at a time), resize for the site ───────────
const ORIG = path.join(CACHE, "images");
const IMG_DIR = path.join(OUT, "diary-images");
const isImage = (a) => /^image\//.test(a.content_type || "") || /\.(png|jpe?g|gif|webp)$/i.test(a.filename || "");
const baseName = (a) => `${slug(a.filename.replace(/\.[^.]+$/, ""))}${path.extname(a.filename).toLowerCase()}`;
// A post with several pastes calls every one "unknown.png": the post id alone made them one
// file, and the first picture stood in for all of them (131 pictures in 44 posts). In such a
// post every picture is named by its own attachment id; other posts keep their old names.
const origName = (a, m) => {
  const clash = (m.attachments || []).filter((b) => baseName(b) === baseName(a)).length > 1;
  return clash ? `${m.id}-${a.id}-${baseName(a)}` : `${m.id}-${baseName(a)}`;
};
async function downloadAll(jobs) {
  let i = 0, fails = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const j = jobs[i++];
      const file = path.join(ORIG, j.name);
      if (fs.existsSync(file)) continue;
      try {
        const r = await fetch(j.url);
        if (!r.ok) { fails++; continue; }
        fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      } catch { fails++; }
    }
  };
  fs.mkdirSync(ORIG, { recursive: true });
  await Promise.all(Array.from({ length: 8 }, worker));
  return fails;
}
function resizeAll(names) {
  fs.mkdirSync(IMG_DIR, { recursive: true });
  const todo = names.filter((n) => fs.existsSync(path.join(ORIG, n)) && !fs.existsSync(path.join(IMG_DIR, n.replace(/\.[^.]+$/, ".webp"))));
  if (!todo.length) return;
  const list = path.join(require("os").tmpdir(), "ris-diary-resize.txt");
  fs.writeFileSync(list, todo.join("\n"));
  const py = `
import sys, os
from PIL import Image
src, dst, lst, w = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
for n in open(lst, encoding="utf-8").read().split("\\n"):
    if not n: continue
    try:
        im = Image.open(os.path.join(src, n))
        if getattr(im, "is_animated", False): im.seek(0)
        im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
        if im.width > w: im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
        im.save(os.path.join(dst, os.path.splitext(n)[0] + ".webp"), "WEBP", quality=80, method=4)
    except Exception as e:
        print("skip", n, e)
`;
  execFileSync("python", ["-c", py, ORIG, IMG_DIR, list, String(MAX_WIDTH)], { stdio: "inherit" });
}

// Some diaries paste links to images uploaded in another channel instead of attaching them.
// The bare link 404s (Discord wants a signed URL), but the message's embed carries a signed
// copy, valid for about a day after the fetch - so those are downloaded here and shown inline.
const CDN_LINK = /https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/attachments\/\d+\/(\d+)\/([^\s?)>]+)(?:\?[^\s)>]*)?/g;
function linkedImages(m) {
  const out = new Map();
  for (const em of m.embeds || []) {
    const src = (em.image && em.image.url) || (em.thumbnail && em.thumbnail.url);
    const k = /\/attachments\/\d+\/(\d+)\//.exec(em.url || "");
    if (!k || !src || em.type !== "image") continue;
    const file = decodeURIComponent((em.url.split("?")[0].split("/").pop()) || "image.png");
    out.set(k[1], { name: `${k[1]}-${slug(file.replace(/\.[^.]+$/, ""))}${path.extname(file).toLowerCase() || ".png"}`, url: src });
  }
  return out;
}
// Pictures from other sites, pasted as a link: Discord's image proxy still serves them.
// Keyed by every form the link can take in the text (the original or a proxy address).
const EXT_LINK = /https:\/\/(?:images-ext-\d\.discordapp\.net\/external\/\S+|\S+\.(?:png|jpe?g|gif|webp))(?=[\s)>]|$)/gi;
function externalImages(m) {
  const out = new Map();
  for (const em of m.embeds || []) {
    const src = em.thumbnail && em.thumbnail.proxy_url;
    if (em.type !== "image" || !src || /discordapp\.(com|net)\/attachments\//.test(em.url || "")) continue;
    const tail = /\/https?\/(.+)$/.exec(src);
    const job = { name: `ext-${slug(em.url)}${path.extname(em.url.split("?")[0]).toLowerCase() || ".jpg"}`, url: src };
    for (const k of [em.url, src, tail && src.replace(/images-ext-\d/, "images-ext-2"), tail && src.replace(/images-ext-\d/, "images-ext-1")]) if (k) out.set(k, job);
  }
  return out;
}

// ── build ───────────────────────────────────────────────────────────────────
(async () => {
  const jobs = [];
  for (const d of diaries) for (const m of d.msgs) for (const a of m.attachments || []) if (isImage(a)) jobs.push({ name: origName(a, m), url: a.url });
  for (const d of diaries) for (const m of d.msgs) for (const li of linkedImages(m).values()) jobs.push(li);
  for (const d of diaries) for (const m of d.msgs) for (const li of externalImages(m).values()) jobs.push(li);
  const fails = await downloadAll(jobs);
  resizeAll(jobs.map((j) => j.name));

  fs.mkdirSync(path.join(OUT, "diaries"), { recursive: true });
  const rows = [];
  const used = new Set();
  let images = 0, empty = 0;
  for (const d of diaries) {
    const body = [];
    for (const m of d.msgs) {
      const linked = linkedImages(m);
      const external = externalImages(m);
      const text = convert(m.content, m).replace(CDN_LINK, (u, id) => {
        const li = linked.get(id);
        const web = li && li.name.replace(/\.[^.]+$/, ".webp");
        if (!web || !fs.existsSync(path.join(IMG_DIR, web))) return ""; // a dead link helps no one
        images++;
        return `\n\n![Developer diary image](../diary-images/${web})\n\n`;
      }).replace(EXT_LINK, (u) => {
        const li = external.get(u);
        const web = li && li.name.replace(/\.[^.]+$/, ".webp");
        if (!web || !fs.existsSync(path.join(IMG_DIR, web))) return u;
        images++;
        return `\n\n![Developer diary image](../diary-images/${web})\n\n`;
      }).replace(/\n{3,}/g, "\n\n").trim();
      if (text) body.push(text, "");
      for (const a of m.attachments || []) {
        if (!isImage(a)) continue;
        const web = origName(a, m).replace(/\.[^.]+$/, ".webp");
        if (!fs.existsSync(path.join(IMG_DIR, web))) continue;
        body.push(`![${(a.description || "").replace(/[[\]]/g, "") || "Developer diary image"}](../diary-images/${web})`, "");
        images++;
      }
    }
    const text = body.join("\n").trim();
    if (!text) { empty++; continue; }
    const date = new Date(d.first).toISOString().slice(0, 10);
    const title = TITLES[d.msgs[0].id] || `Developer diary, ${date}`;
    let key = `${date}-${slug(title)}`;
    while (used.has(key)) key += "-2";
    used.add(key);
    const bodyNoTitle = text.replace(/^\*\*(developer|dev) diary\s*#?\d+\*\*\n+/i, "");
    fs.writeFileSync(path.join(OUT, "diaries", `${key}.md`), `# ${title}\n\n_${date} · ${d.author}_\n\n${bodyNoTitle}\n`, "utf8");
    rows.push({ key, title, date, author: d.author });
  }
  // Pages from an earlier run whose diary is no longer produced (a boundary moved) go, and so do
  // pictures no page shows any more (e.g. the ones named before a rename). Both are this
  // generator's own output; the originals stay in the cache.
  for (const f of fs.readdirSync(path.join(OUT, "diaries"))) if (f.endsWith(".md") && !used.has(f.slice(0, -3))) fs.unlinkSync(path.join(OUT, "diaries", f));
  const shown = new Set();
  for (const f of fs.readdirSync(path.join(OUT, "diaries"))) for (const m of fs.readFileSync(path.join(OUT, "diaries", f), "utf8").matchAll(/diary-images\/([^)\s]+)/g)) shown.add(m[1]);
  let pruned = 0;
  for (const f of fs.readdirSync(IMG_DIR)) if (!shown.has(f)) { fs.unlinkSync(path.join(IMG_DIR, f)); pruned++; }
  if (pruned) say(`  removed ${pruned} picture(s) no diary shows any more`);
  const cell = (s) => String(s).replace(/\|/g, "\\|");
  const videoCount = await buildVideoPage();
  fs.writeFileSync(path.join(OUT, "diaries.md"), `# Developer diaries

The RIS team's developer diaries, as posted on the RIS Discord, newest first.${videoCount ? `
For videos about the mod made by players and YouTubers, see [community videos](community-videos.md).` : ""}

| Diary | Date | By |
|---|---|---|
${rows.slice().reverse().map((r) => `| [${cell(r.title)}](diaries/${r.key}.md) | ${r.date} | ${cell(r.author)} |`).join("\n")}
`, "utf8");
  say(`diaries: ${rows.length} pages from ${diaries.length} groups (${empty} empty skipped) · ${images} images${fails ? ` · ${fails} downloads FAILED` : ""}`);
  say(`community videos: ${videoCount}`);
})().catch((e) => { console.error(e); process.exit(1); });

// ── community videos ────────────────────────────────────────────────────────
// Every YouTube video shared in the diary channel (mostly creators' roster guides, faction
// guides and let's-plays, posted as shout-outs), on one page. Discord cuts titles to ~70
// characters, so the full title and channel come from YouTube's public oEmbed, cached in
// ai-prose/diaries/videos.json; a video YouTube no longer serves is left off. Thumbnails are
// copied into community-video-thumbs/ so the page does not hotlink.
async function buildVideoPage() {
  const CACHE_FILE = path.join(__dirname, "ai-prose", "diaries", "videos.json");
  let known = {};
  try { known = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); } catch {}
  const idOf = (u) => (/(?:[?&]v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/.exec(u || "") || [])[1];
  const shared = new Map(); // id -> first time it was shared
  for (const c of CHANNELS) {
    const f = path.join(CACHE, `${c.id}.json`);
    if (!fs.existsSync(f)) continue;
    for (const m of JSON.parse(fs.readFileSync(f, "utf8"))) {
      const ids = new Set([...(m.embeds || []).map((e) => idOf(e.url)), ...String(m.content || "").split(/\s+/).map(idOf)].filter(Boolean));
      for (const id of ids) if (!shared.has(id)) shared.set(id, Date.parse(m.timestamp));
    }
  }
  for (const id of shared.keys()) {
    if (known[id]) continue;
    try {
      const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`);
      known[id] = r.ok ? (({ title, author_name }) => ({ title, author: author_name }))(await r.json()) : { gone: r.status };
    } catch { /* offline: try again next run */ }
  }
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(known, null, 1) + "\n");

  const THUMBS = path.join(OUT, "community-video-thumbs");
  fs.mkdirSync(THUMBS, { recursive: true });
  const list = [...shared].filter(([id]) => known[id] && known[id].title).map(([id, t]) => ({ id, t, ...known[id] })).sort((a, b) => b.t - a.t);
  for (const v of list) {
    const file = path.join(THUMBS, `${v.id}.jpg`);
    if (fs.existsSync(file)) continue;
    try { const r = await fetch(`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`); if (r.ok) fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); } catch {}
  }
  for (const f of fs.readdirSync(THUMBS)) if (!list.some((v) => `${v.id}.jpg` === f)) fs.unlinkSync(path.join(THUMBS, f));
  if (!list.length) { fs.rmSync(path.join(OUT, "community-videos.md"), { force: true }); return 0; }

  // One card per video (thumbnail, title, channel, date), laid out as a grid by the site's .vids
  // CSS. Each card is a single line of HTML so the page renderer passes it through whole.
  const html = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const years = [...new Set(list.map((v) => new Date(v.t).getUTCFullYear()))];
  const creators = new Set(list.map((v) => v.author));
  const body = years.map((y) => `## ${y}

<div class="vids">
${list.filter((v) => new Date(v.t).getUTCFullYear() === y).map((v) => {
    const thumb = fs.existsSync(path.join(THUMBS, `${v.id}.jpg`)) ? `<img src="community-video-thumbs/${v.id}.jpg" alt="" width="320" height="180" loading="lazy">` : "";
    return `<a class="vid" href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener">${thumb}<span class="vt">${html(v.title)}</span><span class="vm">${html(v.author)} · ${new Date(v.t).toISOString().slice(0, 10)}</span></a>`;
  }).join("\n")}
</div>`).join("\n\n");
  fs.writeFileSync(path.join(OUT, "community-videos.md"), `# Community videos

[← developer diaries](diaries.md) · [wiki index](README.md)

${list.length} videos about RIS by ${creators.size} channels, as shared on the RIS Discord's developer-diaries channel, newest first: roster previews, faction guides, deep dives, rankings and campaigns. The videos are their makers' own work; each one opens on YouTube.

${body}
`, "utf8");
  return list.length;
}
