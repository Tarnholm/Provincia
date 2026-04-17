import React, { useState, useEffect, useCallback } from "react";
import CHANGELOG from "./changelog";
import "./WelcomeScreen.css";

const PUBLIC_URL = process.env.PUBLIC_URL || ".";

/* ── Onboarding pages (first install) ────────────────────────────── */
const ONBOARDING_PAGES = [
  {
    title: "Welcome to Provincia",
    body: "An interactive campaign map for Rome: Total War and its mods. Explore the map with its factions, provinces, buildings, armies, resources, and more!",
    image: `${PUBLIC_URL}/splash.png`,
    highlight: null,
  },
  {
    title: "Map Modes",
    body: "Switch between different map modes to explore your campaign from every angle \u2014 Faction territory, Culture, Religion, Population, Fertility, Resources, Armies, Victory conditions, and more.",
    tip: "Click a mode to switch instantly. Each one highlights different information on the map.",
    highlight: "map-modes",
  },
  {
    title: "View Options",
    body: "Toggle visual overlays like flat colours, grid lines, faction borders, settlement icons, and city/region labels. Mix and match to customise your view.",
    tip: "These options combine with any map mode \u2014 try Borders + Culture for a clear overview.",
    highlight: "view-options",
  },
  {
    title: "Factions & Search",
    body: "The right panel lists every faction. Click one to highlight its territory. Shift-click to select multiple factions at once. Use the search bar to find any province or city by name.",
    tip: "Double-click a faction to zoom directly to its territory.",
    highlight: "factions",
  },
  {
    title: "Region Details",
    body: "Hover over any region to see detailed info \u2014 owner, culture, religion, buildings, population breakdown, and resources. Click the lock icon to pin the info panel while you explore elsewhere.",
    tip: "Right-click a region for additional options.",
    highlight: "region-info",
  },
  {
    title: "Campaigns & Importing",
    body: "Switch between campaign maps using the toggle at the top. To load data from a mod, click Import and point it at your mod\u2019s data folder \u2014 the tool auto-detects all the files it needs.",
    tip: "Imported data is saved locally so you only need to import once per mod version.",
    highlight: "campaigns",
  },
];

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

export default function WelcomeScreen({ currentVersion, lastSeenVersion, onboardingDone, forceOnboarding, onPhaseChange, onDone, onHighlight, mapCenterX }) {
  // Defensive: if the saved lastSeenVersion is higher than every changelog
  // entry, it's stale (leftover from an earlier test-build numbering scheme).
  // In that case we fall back to the second-newest entry so "What's New"
  // shows only the delta between that and the newest — not every historical
  // entry back to the first release — and we also treat onboarding as not
  // yet completed, so the tour reappears on this install.
  const highestEntry = CHANGELOG[0]?.version;
  const previousEntry = CHANGELOG[1]?.version;
  const isStaleSavedVersion = lastSeenVersion && highestEntry
    && compareVersions(lastSeenVersion, highestEntry) > 0;
  const effectiveLastSeen = isStaleSavedVersion
    ? (previousEntry || null)
    : lastSeenVersion;
  const effectiveOnboardingDone = isStaleSavedVersion ? false : onboardingDone;

  const shouldShowOnboarding = FORCE_TEST_MODE || forceOnboarding || !effectiveOnboardingDone;
  const newEntries = FORCE_TEST_MODE ? CHANGELOG : (effectiveLastSeen ? getNewEntries(effectiveLastSeen) : CHANGELOG);
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
function Onboarding({ pages, currentVersion, onFinish, onHighlight, mapCenterX }) {
  const [page, setPage] = useState(0);
  const isLast = page === pages.length - 1;
  const p = pages[page];

  // Notify parent which UI element to highlight for the current page
  useEffect(() => {
    if (onHighlight) onHighlight(p.highlight || null);
  }, [page, p.highlight, onHighlight]);

  return (
    <div className="ws-overlay" style={mapCenterX ? { justifyContent: "flex-start" } : undefined}>
      <div className="ws-card ws-onboarding" style={mapCenterX ? { position: "absolute", left: mapCenterX, transform: "translateX(-50%)" } : undefined}>
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

        {/* Nav */}
        <div className="ws-nav">
          <button className="ws-btn ws-btn--skip" onClick={onFinish}>
            Skip
          </button>
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
                onClick={() => setPage(page + 1)}
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
    <div className="ws-overlay" style={mapCenterX ? { justifyContent: "flex-start" } : undefined}>
      <div className="ws-card ws-whatsnew" style={mapCenterX ? { position: "absolute", left: mapCenterX, transform: "translateX(-50%)" } : undefined}>
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
