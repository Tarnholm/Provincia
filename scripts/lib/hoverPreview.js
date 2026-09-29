// ── hover previews ───────────────────────────────────────────────────────────
// Appended to the site's wiki.js by build-ris-wiki-site.js (asked for 2026-09-29, then "add
// more of those hover over windows"). Pointing at a link shows a small card of what is behind
// it. Units and factions have their own layout (units/compare.json, factions/preview.json);
// every other page family (regions, settlements, buildings down to the level, trade goods,
// traits, retinue, reforms, beliefs, cultures, sizes, revolts, mercenary pools, region tags)
// uses previews/<family>.json, built from the pages themselves (lib/pagePreviews.js). Each file
// is fetched once, on the first hover of its kind. Not on touch screens, where there is no hover.
(function(){
  if (window.matchMedia && matchMedia("(hover: none)").matches) return;
  var js = document.querySelector('script[src*="wiki.js"]');
  var ROOT = js ? js.getAttribute("src").split("wiki.js")[0] : "/";
  var FAMS = "units|factions|regions|settlements|buildings|goods|traits|ancillaries|reforms|religions|cultures|sizes|revolts|mercenaries|tags";
  var RE = new RegExp("(^|/)(" + FAMS + ")/([^/#?]+)\\.(md|html)(#([^?]*))?$");
  var KIND = { regions: "Region", settlements: "Settlement", buildings: "Building", goods: "Trade good", traits: "Trait",
    ancillaries: "Retinue", reforms: "Reform", religions: "Belief", cultures: "Culture", sizes: "Settlement size",
    revolts: "Revolt", mercenaries: "Mercenary pool", tags: "Region tag" };
  var data = {}, loading = {};
  function load(kind){
    if (data[kind] || loading[kind]) return loading[kind] || Promise.resolve(data[kind]);
    var file = kind === "units" ? "units/compare.json" : kind === "factions" ? "factions/preview.json" : "previews/" + kind + ".json";
    loading[kind] = fetch(ROOT + file).then(function(r){ return r.ok ? r.json() : {}; })
      .catch(function(){ return {}; }).then(function(d){ data[kind] = d; return d; });
    return loading[kind];
  }
  function esc(t){ return String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
  function num(v){ return typeof v === "number" ? v.toLocaleString("en-US") : v; }
  function rowsHtml(rows){
    return rows && rows.length ? "<table>" + rows.map(function(s){ return "<tr><th>" + esc(s[0]) + "</th><td>" + esc(num(s[1])) + "</td></tr>"; }).join("") + "</table>" : "";
  }
  var tip = document.createElement("div");
  tip.className = "hov";
  tip.hidden = true;
  document.body.appendChild(tip);

  function unitHtml(slug, d){
    var stats = [["Men", d.men], ["Attack", d.attack], ["Charge", d.charge], ["Defence", d.def], ["Morale", d.morale],
      ["Hit points", d.hp], ["Range", d.range], ["Cost", d.cost != null ? num(d.cost) + " dn" : null], ["Upkeep", d.upkeep != null ? num(d.upkeep) + " dn" : null]]
      .filter(function(s){ return s[1] != null && s[1] !== ""; });
    return '<div class="hov-h"><img src="' + ROOT + 'cards/' + slug + '.png" alt="" width="35" height="48" onerror="this.remove()">'
      + '<div><b>' + esc(d.n) + '</b><small>' + esc([d.cls, d.cat, d.merc ? "mercenary" : ""].filter(Boolean).join(" · ")) + '</small></div></div>'
      + rowsHtml(stats) + (d.abil && d.abil.length ? '<p>' + esc(d.abil.join(" · ")) + "</p>" : "");
  }
  function factionHtml(tok, d){
    return '<div class="hov-h">' + (d.e ? '<img src="' + ROOT + 'symbols/' + tok + '.png" alt="" width="44" height="44">' : "")
      + '<div><b>' + esc(d.n) + (d.r ? ' <span class="rm-tag">(R)</span>' : "") + "</b><small>" + esc(d.c || "") + "</small></div></div>"
      + rowsHtml([["Difficulty", d.d], ["Settlements", d.s], ["Faction units", d.u]].filter(function(s){ return s[1] != null; }));
  }
  function pageHtml(kind, d){
    // A map is shown across the card; an icon or card sits beside the title.
    var map = d.i && /maps\//.test(d.i), icon = d.i && !map;
    return '<div class="hov-h">' + (icon ? '<img src="' + ROOT + d.i + '" alt="" class="hov-ic" onerror="this.remove()">' : "")
      + "<div><b>" + esc(d.t) + "</b><small>" + esc([KIND[kind], d.k].filter(Boolean).join(" · ")) + "</small></div></div>"
      + (map ? '<img src="' + ROOT + d.i + '" alt="" class="hov-map" onerror="this.remove()">' : "")
      + (d.p ? "<p>" + esc(d.p) + "</p>" : "") + rowsHtml(d.r);
  }
  var current = null, timer = null;
  function place(e){
    var x = e.clientX + 16, y = e.clientY + 16, w = tip.offsetWidth, h = tip.offsetHeight;
    if (x + w > innerWidth - 8) x = e.clientX - w - 12;
    if (y + h > innerHeight - 8) y = e.clientY - h - 12;
    tip.style.left = Math.max(8, x) + "px"; tip.style.top = Math.max(8, y) + "px";
  }
  document.addEventListener("mouseover", function(e){
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a || a === current || a.closest("nav, .top, .hov")) return;
    var m = RE.exec(a.getAttribute("href"));
    if (!m || (m[2] === "factions" && m[3] === "non-playable")) return;
    var kind = m[2], page = decodeURIComponent(m[3]), anchor = m[6] ? decodeURIComponent(m[6]) : "";
    current = a;
    clearTimeout(timer);
    timer = setTimeout(function(){
      load(kind).then(function(d){
        if (current !== a || !d) return;
        var html = "";
        if (kind === "units") { if (d[page]) html = unitHtml(page, d[page]); }
        else if (kind === "factions") { if (d[page]) html = factionHtml(page, d[page]); }
        else { var v = (anchor && d[page + "#" + anchor]) || d[page]; if (v) html = pageHtml(kind, v); }
        if (!html) return;
        tip.innerHTML = html;
        tip.hidden = false;
        place(e);
      });
    }, 250);
  });
  document.addEventListener("mousemove", function(e){ if (!tip.hidden) place(e); });
  document.addEventListener("mouseout", function(e){
    if (!current) return;
    var to = e.relatedTarget;
    if (to && current.contains(to)) return;
    current = null; clearTimeout(timer); tip.hidden = true;
  });
})();
