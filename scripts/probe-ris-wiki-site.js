#!/usr/bin/env node
/**
 * Open the built RIS wiki site as a FILE, in a real browser, and report what actually loaded.
 *
 *   npx electron scripts/probe-ris-wiki-site.js [--site <dir>]
 *
 * WHY THIS EXISTS ALONGSIDE check-ris-wiki-site.js. That check resolves every path itself and
 * proves the folder is internally consistent. It cannot prove a BROWSER agrees: a stylesheet
 * that fails to apply, a background-image in CSS that the checker never sees as a URL, an
 * inline script that throws on its first line because file:// documents are denied storage —
 * all of those leave every path correct and the page still broken. So this loads the pages
 * over file:// in Chromium (Electron is already a devDependency here, so nothing is added for
 * it), watches every network request the renderer makes, and reports what came back.
 *
 * It checks the three things a static export of a server-rendered site gets wrong:
 *   - subresources that 404 under file:// because their path assumed a document root;
 *   - images that resolve but do not decode;
 *   - the page script dying, which costs the theme toggle and the search box together.
 */
const path = require("path");
const fs = require("fs");
const { app, BrowserWindow } = require("electron");

const argv = process.argv.slice(1);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const SITE = path.resolve(valOf("--site", "C:/dev/ris-wiki-site"));
const n = (x) => x.toLocaleString("en-US");

const problems = [];
const fileUrl = (rel) => "file:///" + path.join(SITE, rel).replace(/\\/g, "/");

// Pages chosen for the DEPTH they sit at, not for their content: the root and each generated
// section carry a different number of "../" in every URL on them, and a depth calculation that
// is wrong is wrong per level. The per-section page is DISCOVERED rather than named, so this
// keeps working when a page is renamed and cannot quietly probe nothing.
const pick = (dir) => {
  try {
    const f = fs.readdirSync(path.join(SITE, dir)).filter((x) => /\.html$/i.test(x)).sort()[0];
    return f ? `${dir}/${f}` : null;
  } catch { return null; }
};
const PAGES = [
  ["index.html", "the double-click entry point"],
  ["units.html", "the roster index — the biggest table in the wiki"],
  [pick("units"), "a unit page: one level down, card image, info-card link"],
  [pick("regions"), "a region page: the icon-heavy one"],
  [pick("factions"), "a faction page: symbol beside a territory map"],
  [pick("settlements"), "a settlement page"],
  [pick("goods"), "a trade good page"],
  ["search.html", "search"],
  ["units-sortable.html", "a sortable view, whose row links live in embedded JSON"],
].filter(([p]) => p);

// What the renderer asked for, and what it got. file:// has no status code, so a request that
// resolves to nothing surfaces as an error rather than as a 404.
const requests = new Map();      // url -> "ok" | error string
function watch(win) {
  const wr = win.webContents.session.webRequest;
  wr.onCompleted({ urls: ["<all_urls>"] }, (d) => { if (!requests.has(d.url)) requests.set(d.url, "ok"); });
  wr.onErrorOccurred({ urls: ["<all_urls>"] }, (d) => requests.set(d.url, d.error || "failed"));
}

// Run inside the page. Returns what a reader would see.
const INSPECT = `(() => {
  const cs = getComputedStyle(document.body);
  const imgs = [...document.images];
  return {
    title: document.title,
    // A stylesheet that did not apply leaves the body transparent and no custom properties
    // defined. Rule COUNT is not the test — the wiki's stylesheet has 97 top-level rules and a
    // threshold of 100 called every correctly-styled page unstyled.
    bg: cs.backgroundColor,
    accent: getComputedStyle(document.documentElement).getPropertyValue('--acc').trim(),
    font: cs.fontFamily.slice(0, 24),
    styleLinks: [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.getAttribute('href')),
    sheetRules: [...document.styleSheets].reduce((a, s) => { try { return a + s.cssRules.length; } catch (e) { return a; } }, 0),
    imgTotal: imgs.length,
    // BROKEN means the browser finished with it and got nothing: complete && naturalWidth 0.
    // An image still waiting is not broken, and the sortable views mark 1,132 cards
    // loading="lazy" — most are below the fold and correctly never fetched at all. Counting
    // those as broken reported eight perfectly good card files as missing.
    imgBroken: imgs.filter(i => i.complete && i.naturalWidth === 0).map(i => i.getAttribute('src')).slice(0, 8),
    imgPending: imgs.filter(i => !i.complete).length,
    navLinks: document.querySelectorAll('nav.side a').length,
    crumb: (document.querySelector('.crumb') || {}).textContent || '',
    hasThemeButton: !!document.getElementById('theme'),
    hasSearchBox: !!document.querySelector('.top input'),
    // The h1 rule is a CSS background-image, which no link checker sees as a URL.
    ruleImage: document.querySelector('h1') ? getComputedStyle(document.querySelector('h1'), '::after').backgroundImage : '(no h1)',
    scriptErrors: window.__probeErrors || [],
  };
})()`;

async function load(win, rel) {
  await win.loadURL(fileUrl(rel));
  // Images are fetched after the document settles; give the renderer a beat before asking.
  await new Promise((r) => setTimeout(r, 900));
  return win.webContents.executeJavaScript(INSPECT);
}

app.on("window-all-closed", () => {});

app.whenReady().then(async () => {
  if (!fs.existsSync(SITE)) { console.error(`site not found: ${SITE}`); app.exit(2); return; }
  const win = new BrowserWindow({ show: false, width: 1600, height: 1000,
    webPreferences: { contextIsolation: true, nodeIntegration: false } });
  watch(win);
  // Uncaught errors in the page, collected before anything else runs.
  win.webContents.on("did-finish-load", () => {
    win.webContents.executeJavaScript(
      `window.__probeErrors = window.__probeErrors || []; addEventListener('error', e => window.__probeErrors.push(String(e.message)));`)
      .catch(() => {});
  });
  const consoleErrors = [];
  win.webContents.on("console-message", (_e, level, message) => {
    // Electron warns every renderer about Content-Security-Policy. That is a warning about the
    // harness this probe runs in, not about the page, and it fired 13 times on 9 pages.
    if (level >= 2 && !/Electron Security Warning/.test(message)) consoleErrors.push(message.slice(0, 200));
  });

  console.log(`probing ${SITE} over file:// in Chromium ${process.versions.chrome}\n`);

  for (const [rel, why] of PAGES) {
    const target = rel.replace(/\.md$/, ".html");
    if (!fs.existsSync(path.join(SITE, target))) { problems.push(`no such page: ${target}`); continue; }
    const r = await load(win, target);
    // The sortable views are standalone pages with their own inline stylesheet and no sidebar
    // — they predate the shell and were never part of it. Holding them to the shell's chrome
    // would report four failures on three pages that are working exactly as intended.
    const isShell = r.navLinks > 0;
    const styled = r.accent !== "" && r.bg !== "rgba(0, 0, 0, 0)" && r.sheetRules > 20;
    const ruleOk = /url\(/.test(r.ruleImage) && !/^none/.test(r.ruleImage);
    console.log(`${target}  — ${why}${isShell ? "" : "   [standalone page, no shell]"}`);
    console.log(`  title        ${r.title}`);
    console.log(`  stylesheet   ${r.styleLinks.join(", ") || "(inline)"} — ${n(r.sheetRules)} rules, body ${r.bg}, --acc ${r.accent || "(unset)"}${styled ? "" : "   ← NOT STYLED"}`);
    console.log(`  images       ${n(r.imgTotal)} on the page, ${r.imgBroken.length} broken${r.imgBroken.length ? ": " + r.imgBroken.join(", ") : ""}${r.imgPending ? `, ${n(r.imgPending)} lazy and below the fold` : ""}`);
    if (isShell) {
      console.log(`  nav          ${r.navLinks} links   crumbs: ${JSON.stringify(r.crumb.trim().slice(0, 60))}`);
      console.log(`  title rule   ${r.ruleImage.slice(0, 90)}`);
      console.log(`  chrome       theme button ${r.hasThemeButton ? "yes" : "NO"}, search box ${r.hasSearchBox ? "yes" : "NO"}`);
    }
    if (r.scriptErrors.length) console.log(`  script errors ${r.scriptErrors.join(" | ")}`);
    console.log("");
    if (!styled) problems.push(`${target}: the stylesheet did not apply`);
    if (r.imgBroken.length) problems.push(`${target}: ${r.imgBroken.length} image(s) did not load — ${r.imgBroken[0]}`);
    if (isShell && !ruleOk) problems.push(`${target}: the rule under the page title has no background image (${r.ruleImage.slice(0, 60)})`);
    if (isShell && !r.hasSearchBox) problems.push(`${target}: no search box`);
    if (r.scriptErrors.length) problems.push(`${target}: ${r.scriptErrors[0]}`);
  }

  // ── the two things that are script, not markup ──────────────────────────────
  await load(win, "index.html");
  const theme = await win.webContents.executeJavaScript(`(() => {
    const before = document.documentElement.getAttribute('data-theme');
    document.getElementById('theme').click();
    const after = document.documentElement.getAttribute('data-theme');
    let stored = null, storageWorks = true;
    try { stored = localStorage.getItem('ris-wiki-theme'); } catch (e) { storageWorks = false; }
    return { before, after, stored, storageWorks, accent: getComputedStyle(document.documentElement).getPropertyValue('--acc').trim() };
  })()`);
  console.log(`theme toggle: ${theme.before || "(os default)"} -> ${theme.after}, accent now ${theme.accent}, `
    + `localStorage ${theme.storageWorks ? `usable (remembered "${theme.stored}")` : "DENIED to file:// — falling back to memory, theme resets on navigation"}`);
  if (theme.before === theme.after) problems.push("the theme button did not change the theme");

  // Search: type, submit, and see whether the reader lands on results.
  await load(win, "index.html");
  await win.webContents.executeJavaScript(
    `(() => { const i = document.querySelector('.top input'); i.value = 'hastati';
       document.querySelector('.top form').dispatchEvent(new Event('submit', {cancelable:true, bubbles:true})); })()`);
  await new Promise((r) => setTimeout(r, 1200));
  const search = await win.webContents.executeJavaScript(`(() => ({
    url: location.href.split('/').pop(),
    indexed: (window.RIS_PAGES || []).length,
    note: (document.getElementById('q-note') || {}).textContent || '',
    hits: document.querySelectorAll('#q-res li').length,
    first: (document.querySelector('#q-res li a') || {}).getAttribute ? document.querySelector('#q-res li a').getAttribute('href') : null,
  }))()`);
  console.log(`search:       submitted "hastati" from the front page -> ${search.url}`);
  console.log(`              ${n(search.indexed)} titles indexed in the browser, ${search.hits} results, first is ${search.first}`);
  console.log(`              "${search.note.trim()}"`);
  if (!search.hits) problems.push("search returned nothing for a term that is a page title");

  // Following the first result proves the search index's paths are relative to the right place.
  if (search.first) {
    await win.webContents.executeJavaScript(`document.querySelector('#q-res li a').click()`);
    await new Promise((r) => setTimeout(r, 900));
    const landed = await win.webContents.executeJavaScript(`({ title: document.title, imgs: document.images.length,
      broken: [...document.images].filter(i => !i.naturalWidth).length })`);
    console.log(`              clicking it lands on "${landed.title}" (${landed.imgs} images, ${landed.broken} broken)`);
    if (landed.broken) problems.push(`the page reached from search has ${landed.broken} broken image(s)`);
    if (/not found/i.test(landed.title)) problems.push("the first search result does not resolve");
  }

  // ── every request the renderer made ─────────────────────────────────────────
  const failed = [...requests].filter(([, s]) => s !== "ok");
  console.log(`\nrequests: ${n(requests.size)} made by the renderer over file://, ${failed.length} failed`);
  for (const [u, s] of failed.slice(0, 10)) console.log(`  ${s}  ${u}`);
  if (failed.length) problems.push(`${failed.length} file:// request(s) failed`);
  if (consoleErrors.length) {
    console.log(`console errors: ${consoleErrors.length}`);
    for (const c of consoleErrors.slice(0, 6)) console.log(`  ${c}`);
    problems.push(`${consoleErrors.length} console error(s)`);
  } else console.log("console errors: 0");

  if (problems.length) {
    console.error(`\n${problems.length} problem(s):`);
    for (const p of problems) console.error(`  ${p}`);
    app.exit(1);
  } else {
    console.log("\nfile:// verified in a real browser: styled, images decoded, nav and crumbs live, theme and search working.");
    app.exit(0);
  }
});
