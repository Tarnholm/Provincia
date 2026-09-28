// ── remastered factions: a red (R) after the name ────────────────────────────
// Appended to the site's wiki.js by build-ris-wiki-site.js, after window.RIS_REMASTERED (the
// faction tokens gen-ris-faction-pages.js wrote to factions/remastered.json). Every link to a
// remastered faction's page, on any page, gets the tag after its text, and so does the title
// of the faction's own page. Tables that redraw themselves (the sortable views, the compare
// rows) are watched, so their links are tagged too. Links with no text (an emblem alone) and
// the menu are left alone.
(function(){
  var list = window.RIS_REMASTERED || [];
  if (!list.length) return;
  var set = {};
  list.forEach(function(f){ set[f] = 1; });
  var FAC = /(^|\/)factions\/([a-z0-9_]+)\.(md|html)([#?]|$)/;
  function tag(){
    var t = document.createElement("span");
    t.className = "rm-tag";
    t.title = "Remastered: This faction has been remastered by the Mod team";
    t.textContent = "(R)";
    return t;
  }
  function run(root){
    root.querySelectorAll('a[href*="factions/"]').forEach(function(a){
      if (a.getAttribute("data-rm") || a.closest("nav, .crumb, .top")) return;
      var m = FAC.exec(a.getAttribute("href"));
      a.setAttribute("data-rm", "1");
      if (!m || !set[m[2]] || !a.textContent.trim()) return;
      var next = a.nextSibling;
      if (next && next.nodeType === 1 && next.classList.contains("rm-tag")) return;
      a.parentNode.insertBefore(tag(), next);
    });
  }
  var main = document.querySelector("main") || document.body;
  run(main);
  var own = FAC.exec(location.pathname), h1 = main.querySelector("h1");
  if (own && set[own[2]] && h1 && !h1.querySelector(".rm-tag")) h1.appendChild(tag());
  var queued = false;
  new MutationObserver(function(){
    if (queued) return;
    queued = true;
    requestAnimationFrame(function(){ queued = false; run(main); });
  }).observe(main, { childList: true, subtree: true });
})();
