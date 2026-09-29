// ── hover previews ───────────────────────────────────────────────────────────
// Appended to the site's wiki.js by build-ris-wiki-site.js (asked for 2026-09-29). Pointing at a
// link to a unit shows its card and main numbers; pointing at a faction shows its emblem,
// difficulty, culture and what it starts with. Data: units/compare.json (gen-ris-unit-pages.js)
// and factions/preview.json (gen-ris-faction-pages.js), each fetched once, on the first hover.
// Not on touch screens, where there is no hover.
(function(){
  if (window.matchMedia && matchMedia("(hover: none)").matches) return;
  var js = document.querySelector('script[src*="wiki.js"]');
  var ROOT = js ? js.getAttribute("src").split("wiki.js")[0] : "/";
  var RE = /(^|\/)(units|factions)\/([a-z0-9_]+)\.(md|html)(#|$)/;
  var data = { units: null, factions: null }, loading = {};
  function load(kind){
    if (data[kind] || loading[kind]) return loading[kind];
    var file = kind === "units" ? "units/compare.json" : "factions/preview.json";
    loading[kind] = fetch(ROOT + file).then(function(r){ return r.ok ? r.json() : {}; })
      .catch(function(){ return {}; }).then(function(d){ data[kind] = d; return d; });
    return loading[kind];
  }
  function esc(t){ return String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
  function num(v){ return typeof v === "number" ? v.toLocaleString("en-US") : v; }
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
      + '<table>' + stats.map(function(s){ return "<tr><th>" + s[0] + "</th><td>" + esc(num(s[1])) + "</td></tr>"; }).join("") + "</table>"
      + (d.abil && d.abil.length ? '<p>' + esc(d.abil.join(" · ")) + "</p>" : "");
  }
  function factionHtml(tok, d){
    return '<div class="hov-h">' + (d.e ? '<img src="' + ROOT + 'symbols/' + tok + '.png" alt="" width="44" height="44">' : "")
      + '<div><b>' + esc(d.n) + (d.r ? ' <span class="rm-tag">(R)</span>' : "") + "</b><small>" + esc(d.c || "") + "</small></div></div>"
      + "<table>" + [["Difficulty", d.d], ["Settlements", d.s], ["Faction units", d.u]]
        .filter(function(s){ return s[1] != null; }).map(function(s){ return "<tr><th>" + s[0] + "</th><td>" + esc(num(s[1])) + "</td></tr>"; }).join("") + "</table>";
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
    current = a;
    clearTimeout(timer);
    timer = setTimeout(function(){
      load(m[2]).then(function(d){
        if (current !== a) return;
        var v = d && d[m[3]];
        if (!v) return;
        tip.innerHTML = m[2] === "units" ? unitHtml(m[3], v) : factionHtml(m[3], v);
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
