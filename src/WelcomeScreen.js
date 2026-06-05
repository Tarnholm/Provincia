import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import CHANGELOG from "./changelog";
import "./WelcomeScreen.css";

const PUBLIC_URL = import.meta.env.BASE_URL || ".";

/* ── Onboarding pages (first install) ────────────────────────────── */
const ONBOARDING_PAGES = [
  {
    title: "Welcome to Provincia",
    body: "Provincia is a living map and companion for Rome: Total War and its mods. Load a mod, point it at your campaign, and watch it unfold turn by turn \u2014 armies on the march, borders redrawn, treasuries and diplomacy shifting in real time. Dig into any faction, province, building, character or resource, and when you want to tinker, the built-in editor reshapes the mod and writes it straight back.",
    image: `${PUBLIC_URL}/splash.png`,
    highlight: null,
  },
  {
    title: "Two Slots \u2014 Vanilla & Your Mod",
    body: "Up in the title bar are two campaign slots. Slot 1 (left) is loaded with Vanilla Rome \u2014 that's the map you're looking at right now. Slot 2 (right) is empty, ready for your mod: RIGHT-CLICK Slot 2 and point it at your mod's data folder. Provincia auto-detects everything it needs, then jumps straight to your world.",
    tip: "Imported data is saved locally \u2014 you only import once per mod version, and you can re-import any time by right-clicking a slot.",
    highlight: "campaigns",
    requireImport: true,
  },
  {
    title: "Map Modes \u2014 Grouped",
    body: "Map modes are organised into categories along the top of the map \u2014 Geopolitics, Government, Demography, Population, Economy, Military and Geography. Click a category tab to fan its modes out in a row beneath it, then pick one. The tab shows the active mode.",
    tip: "Ctrl+1\u20137 open the groups by keyboard. Click elsewhere to collapse a group.",
    highlight: "map-modes",
  },
  {
    title: "Overlays",
    body: "The green OVERLAYS button (next to the map-mode categories) holds display toggles you can stack on top of any map mode \u2014 flat colours, grid, faction borders, faction pin, settlements, terrain, heights, resources, armies, events, insights, and labels.",
    tip: "Overlays are green so they read as distinct from the slate map-mode groups; the button shows how many are on.",
    highlight: "overlays",
  },
  {
    title: "Factions & Search",
    body: "Every faction is listed in the panel under the map. Click one to highlight its territory, shift-click to select several, and double-click to zoom straight to its lands. The search bar below the map finds any province or city by name.",
    tip: "The faction grid widens to fit more columns as you grow the window, and the panel scrolls when the list is long.",
    highlight: "factions",
  },
  {
    title: "Region Details",
    body: "Hover or click a province for its panel \u2014 settlement & tier, owner, culture, religion, fertility, resources, hidden resources, tags, and the full building list. Click the lock (\ud83d\udd12) to pin a region while you explore elsewhere.",
    tip: "Hover a value mode (Population, Recruitment\u2026) to see that region's number right at the cursor.",
    highlight: "region-info",
  },
  {
    title: "Diplomacy, Characters & Armies",
    body: "The right column shows the owning faction's treasury, AI personality and diplomacy (wars / allies / trade); the region's characters with the \ud83d\udc6a Family Tree button; the garrison and any field armies (general face-cards included); and the units recruitable there. Open the Wealth list from the Diplomacy & Treasury header.",
    tip: "Leader \ud83d\udc51 and heir markers show in the Characters list; the panels fill the space as you grow the window.",
    highlight: "region-diplo",
  },
  {
    title: "Live Mode \u2014 Watch Your Campaign",
    body: "Click \u201cLive\u201d (right after the map-mode tabs) and point it at your Rome Remastered logs folder. Provincia parses every autosave \u2014 armies, characters, owners, buildings, build & recruit queues, traits, ancillaries, stats, treasury, diplomacy, fog-of-war, and family events all update as you play.",
    tip: "Your faction auto-detects from the autosave filename and the save's captain banner \u2014 no manual picking. The save folder is found automatically.",
    highlight: "live",
  },
  {
    title: "Family Tree & Character Info",
    body: "Open the Family Tree from the Characters header to see each faction's house \u2014 engine-assigned portraits, spouses, children, leader + heir markers, and faded deceased members. Right-click ANY character (list, tree, or a commander's bodyguard card) for full stats, every trait and ancillary with effects, clan links, and children.",
    tip: "A general's bodyguard unit card is swapped for the engine's face card of the commanding character.",
    highlight: "region-family",
  },
  {
    title: "Shortcuts & Dev Mode",
    body: "Press the \u201c?\u201d in the title bar for the full keyboard-shortcut list. Toggle DEV MODE (Ctrl+Shift+D) to unlock editing \u2014 building chains, diplomacy, add-a-general, icon replacement, validators, the embedded Scripts suite, and per-slot import tools.",
    tip: "Dev-only controls stay hidden until you switch dev mode on; everything else works for everyone.",
    highlight: "shortcuts",
  },
];

/* ── Highlight → element selector(s). Most keys map to a single
   [data-ui-highlight] anchor; the region cards ring specific RegionInfo
   widgets (each carries a data-widget id) so they don't light the whole
   right column. ─────────────────────────────────────────────────────── */
const HIGHLIGHT_SELECTORS = {
  factions: ['[data-ui-highlight="factions"]', '#ws-province-search'], // faction panel + the province search box
  "region-info": ['[data-widget="region.info"]', '[data-ui-highlight="region-info"]'], // settlement details + lock
  "region-diplo": ['[data-widget="region.diplomacy"]', '[data-widget="region.characters"]', '[data-widget="region.garrison"]'],
  "region-family": ['[data-widget="region.characters"]'],
};

/* Deterministic card corner per highlight key: [justifyContent, alignItems].
   Keeps the card clear of the UI it points at, set once on page change (no
   re-positioning jump). Top-left controls → card bottom-right; right-column
   region panels → card left; etc. */
const CARD_PLACEMENT = {
  campaigns: ["flex-end", "flex-end"],
  "map-modes": ["flex-end", "flex-end"],
  overlays: ["flex-end", "flex-end"],
  live: ["flex-end", "flex-end"],
  factions: ["center", "flex-start"],
  "region-info": ["flex-start", "center"],
  "region-diplo": ["flex-start", "center"],
  "region-family": ["flex-start", "center"],
  shortcuts: ["flex-start", "center"],
};

/* ── Type badge colours ──────────────────────────────────────────── */
const TYPE_COLOURS = {
  feature: "#4a9",
  fix: "#c66",
  improvement: "#6ac",
  change: "#ba6",
};

/* ── Helper: get entries newer than a version ────────────────────── */
function numericParts(s) {
  // Accepts "0.9.2", "0.9.2-10" (semver prerelease), "0.9.2.1" (4-part).
  return (s || "").split(/[-.]/).filter(p => /^\d+$/.test(p)).map(Number);
}

function compareVersions(a, b) {
  const pa = numericParts(a);
  const pb = numericParts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

function getNewEntries(lastVersion) {
  if (!lastVersion) return CHANGELOG;
  return CHANGELOG.filter((e) => compareVersions(e.version, lastVersion) > 0);
}

// Strip the 4th+ segment ("edition" counter) for UI display.
function displayVersion(v) {
  const parts = (v || "").split(/[-.]/).filter(p => /^\d+$/.test(p));
  return parts.slice(0, 3).join(".") || v;
}

/* ── Component ───────────────────────────────────────────────────── */
const FORCE_TEST_MODE = false;

export default function WelcomeScreen({ currentVersion, lastSeenVersion, onboardingDone, forceOnboarding, onPhaseChange, onDone, onHighlight, mapCenterX, onCalibrate, statsCacheCount, modImported }) {
  // Persisted state is the source of truth. (We previously had a
  // "stale-saved-version" check that fired whenever lastSeenVersion was
  // higher than the topmost changelog entry — but the saved version is the
  // app's own version when the user dismisses, and once the app version
  // outpaces the latest changelog entry that check would re-fire onboarding
  // every launch. Drop it.)
  const previousEntry = CHANGELOG[1]?.version;
  const effectiveLastSeen = lastSeenVersion;
  const effectiveOnboardingDone = onboardingDone;

  const shouldShowOnboarding = FORCE_TEST_MODE || forceOnboarding || !effectiveOnboardingDone;
  // In test builds the changelog is part of what we want to verify, so show
  // at least the latest entry regardless of what the user has already seen.
  // Release builds keep the normal "only entries newer than lastSeen" logic.
  const newEntries = FORCE_TEST_MODE
    ? CHANGELOG
    : forceOnboarding
      ? (previousEntry ? getNewEntries(previousEntry) : CHANGELOG.slice(0, 1))
      : (effectiveLastSeen ? getNewEntries(effectiveLastSeen) : CHANGELOG);
  const [phase, setPhase] = useState(shouldShowOnboarding ? "onboarding" : "whatsnew");

  // Let the parent know which phase is currently active (used to gate music).
  useEffect(() => { if (onPhaseChange) onPhaseChange(phase); }, [phase, onPhaseChange]);

  // If nothing to show, skip entirely
  useEffect(() => {
    if (!FORCE_TEST_MODE && !shouldShowOnboarding && newEntries.length === 0) onDone();
  }, [shouldShowOnboarding, newEntries.length, onDone]);

  const handleFinish = useCallback(() => {
    // Save the max of (currentVersion, highest changelog version we just showed).
    // This way a returning user on an older display version won't be re-prompted
    // with the same what's-new entries.
    const topEntry = newEntries[0]?.version;
    const savedVersion = topEntry && compareVersions(topEntry, currentVersion) > 0
      ? topEntry
      : currentVersion;
    try {
      localStorage.setItem("welcomeLastVersion", savedVersion);
      localStorage.setItem("onboardingDone", "1");
    } catch {}
    if (window.electronAPI?.saveUserFile) {
      window.electronAPI.saveUserFile("welcome_version.txt", savedVersion);
      window.electronAPI.saveUserFile("onboarding_done.txt", "1");
    }
    if (onHighlight) onHighlight(null);
    onDone(savedVersion);
  }, [currentVersion, newEntries, onDone, onHighlight]);

  const handleOnboardingDone = useCallback(() => {
    if (onHighlight) onHighlight(null);
    if (FORCE_TEST_MODE || newEntries.length > 0) {
      setPhase("whatsnew");
    } else {
      handleFinish();
    }
  }, [newEntries.length, handleFinish, onHighlight]);

  if (!FORCE_TEST_MODE && !shouldShowOnboarding && newEntries.length === 0) return null;

  if (phase === "onboarding") {
    return (
      <Onboarding
        pages={ONBOARDING_PAGES}
        currentVersion={currentVersion}
        onFinish={handleOnboardingDone}
        onHighlight={onHighlight}
        mapCenterX={mapCenterX}
        modImported={modImported}
      />
    );
  }

  return (
    <WhatsNew
      entries={newEntries}
      currentVersion={currentVersion}
      onFinish={handleFinish}
      mapCenterX={mapCenterX}
    />
  );
}

/* ── Onboarding walkthrough ──────────────────────────────────────── */
function Onboarding({ pages, currentVersion, onFinish, onHighlight, mapCenterX, modImported }) {
  const [page, setPage] = useState(0);
  const [spotRects, setSpotRects] = useState([]); // live bounding boxes of highlighted UI element(s)
  const isLast = page === pages.length - 1;
  const p = pages[page];
  // Skip is only offered when the dev launched this run via the First-run test
  // button (sessionStorage flag, gone on real restart) — never for genuine
  // first-timers, who must go through the guided import.
  const allowSkip = (() => { try { return sessionStorage.getItem("devOnboardingTest") === "1"; } catch { return false; } })();

  // Notify parent which UI element to highlight for the current page
  useEffect(() => {
    if (onHighlight) onHighlight(p.highlight || null);
  }, [page, p.highlight, onHighlight]);

  // Track the highlighted element(s)' on-screen rects so we can draw glowing
  // spotlight ring(s) that are ALWAYS visible (an element's own z-index can be
  // trapped in a parent stacking context and never rise above the overlay).
  // Several elements may share one highlight key (e.g. the faction panel AND the
  // search box) — we ring each. The rects also push the card clear of them.
  useEffect(() => {
    const key = p.highlight;
    if (!key) { setSpotRects([]); return; }
    let raf = 0, timer = 0, cancelled = false;
    const selectors = HIGHLIGHT_SELECTORS[key] || [`[data-ui-highlight="${key}"]`];
    const measure = () => {
      if (cancelled) return;
      const rects = [];
      selectors.forEach((sel) => document.querySelectorAll(sel).forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 1 && r.height > 1) rects.push({ top: r.top, left: r.left, width: r.width, height: r.height });
      }));
      setSpotRects(rects);
    };
    raf = requestAnimationFrame(measure);
    timer = setInterval(measure, 400); // re-measure: targets may mount / reflow after the card appears
    window.addEventListener("resize", measure);
    return () => { cancelled = true; cancelAnimationFrame(raf); clearInterval(timer); window.removeEventListener("resize", measure); };
  }, [page, p.highlight]);

  // Auto-advance off an import-gated card the moment a mod is imported.
  const prevImportedRef = useRef(modImported);
  useEffect(() => {
    if (modImported && !prevImportedRef.current && p.requireImport && !isLast) setPage((pg) => pg + 1);
    prevImportedRef.current = modImported;
  }, [modImported, p.requireImport, isLast]);

  // Deterministic per-card placement so the card lands in its spot ONCE (no
  // jump from centre once the rings are measured). [justify, align].
  const [justifyContent, alignItems] = CARD_PLACEMENT[p.highlight] || ["center", "center"];

  return (
    <div className="ws-overlay" style={{ justifyContent, alignItems, padding: "5vh 4vw" }}>
      {/* Rings render through a portal to <body> so their position:fixed coords
          are truly viewport-relative (a transformed ancestor of the overlay
          would otherwise shift them — that's why the lock ring was off-centre). */}
      {typeof document !== "undefined" && createPortal(
        spotRects.map((r, i) => (
          <div
            key={i}
            aria-hidden
            style={{
              position: "fixed",
              top: r.top - 3, left: r.left - 3,
              width: r.width + 6, height: r.height + 6,
              border: "2px solid #e8c873", borderRadius: 8,
              boxShadow: "0 0 12px 2px rgba(232,200,115,0.65)",
              pointerEvents: "none", zIndex: 10011,
              animation: "ws-pulse 1.8s ease-in-out infinite",
            }}
          />
        )),
        document.body
      )}
      <div className="ws-card ws-onboarding">
        {p.image && (
          <img
            src={p.image}
            alt=""
            className="ws-hero"
            draggable={false}
          />
        )}
        <div className="ws-body">
          <h2 className="ws-title">{p.title}</h2>
          <p className="ws-text">{p.body}</p>
          {p.tip && <p className="ws-tip">{p.tip}</p>}
        </div>

        {/* Dots */}
        <div className="ws-dots">
          {pages.map((_, i) => (
            <button
              key={i}
              className={`ws-dot ${i === page ? "ws-dot--active" : ""}`}
              onClick={() => setPage(i)}
              aria-label={`Page ${i + 1}`}
            />
          ))}
        </div>

        {/* Import gate hint */}
        {p.requireImport && !modImported && (
          <p className="ws-tip" style={{ color: "#dca64a", fontWeight: 600 }}>
            ⤴ Right-click <b>Slot 2</b> and import your mod to continue.
          </p>
        )}

        {/* Nav — Skip only in dev test runs (guided flow otherwise) */}
        <div className="ws-nav" style={{ justifyContent: allowSkip ? "space-between" : "flex-end" }}>
          {allowSkip && (
            <button className="ws-btn ws-btn--skip" onClick={onFinish}>Skip (dev)</button>
          )}
          <div className="ws-nav-right">
            {page > 0 && (
              <button
                className="ws-btn ws-btn--secondary"
                onClick={() => setPage(page - 1)}
              >
                Back
              </button>
            )}
            {isLast ? (
              <button className="ws-btn ws-btn--primary" onClick={onFinish}>
                Get Started
              </button>
            ) : (
              <button
                className="ws-btn ws-btn--primary"
                disabled={p.requireImport && !modImported}
                style={p.requireImport && !modImported ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
                onClick={() => { if (!(p.requireImport && !modImported)) setPage(page + 1); }}
              >
                Next
              </button>
            )}
          </div>
        </div>

        <div className="ws-version">v{currentVersion}</div>
      </div>
    </div>
  );
}

/* ── What's New (update changelog) ───────────────────────────────── */
function WhatsNew({ entries, currentVersion, onFinish, mapCenterX }) {
  return (
    <div className="ws-overlay">
      <div className="ws-card ws-whatsnew">
        <div className="ws-body">
          <h2 className="ws-title">What's New</h2>
          <p className="ws-subtitle">
            Updated to v{currentVersion}
          </p>

          <div className="ws-changelog">
            {entries.map((entry) => (
              <div key={entry.version} className="ws-entry">
                <div className="ws-entry-header">
                  <span className="ws-entry-version">v{displayVersion(entry.version)}</span>
                  <span className="ws-entry-date">{entry.date}</span>
                </div>
                <ul className="ws-entry-list">
                  {entry.items.map((item, i) => (
                    <li key={i} className="ws-entry-item">
                      <span
                        className="ws-badge"
                        style={{ background: TYPE_COLOURS[item.type] || "#888" }}
                      >
                        {item.type}
                      </span>
                      {item.text}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="ws-nav" style={{ justifyContent: "flex-end" }}>
          <button className="ws-btn ws-btn--primary" onClick={onFinish}>
            Continue
          </button>
        </div>

        <div className="ws-version">v{currentVersion}</div>
      </div>
    </div>
  );
}
