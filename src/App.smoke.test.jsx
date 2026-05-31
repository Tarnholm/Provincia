// @vitest-environment jsdom
//
// RENDER SMOKE-TEST for the top-level <App/> component.
//
// WHY THIS EXISTS
// ---------------
// v0.9.768 shipped a renderer Temporal-Dead-Zone bug: a `useState` block was
// declared AFTER the map-draw code that read it, producing
// "Cannot access 'Wd' before initialization" at first render — the app crashed
// on launch for every auto-update user. `vite build` compiled fine (TDZ is a
// runtime error, not a compile error) and the existing vitest unit suite never
// renders <App/>, so neither caught it.
//
// This test actually mounts <App/> in a jsdom DOM. If any const/let is read
// before its declaration in the render path, React throws a ReferenceError
// during render and this test fails — BEFORE a release ships.
//
// SCOPE: it only needs to reach (and run) the component body. It is NOT a
// functional/UI test. App.js touches many browser/electron globals on mount,
// so we stub them minimally to get PAST mount; we do not exercise real UI.
//
// TEST-ONLY: this file is never bundled. build.files in package.json is an
// explicit whitelist that lists only specific src/*.js parsers — *.test files
// and the whole test toolchain are excluded from the shipped app.

import { describe, it, expect, beforeAll, afterEach } from "vitest";

// --- Minimal global stubs so the render reaches the component body ----------

// 1) electronAPI: a Proxy whose every property is a no-op function. Calls
//    return a resolved Promise (most of App's IPC is `await api.foo()`), and
//    event-subscribe methods (onX / subscribeX) return an unsubscribe fn so
//    effect cleanups don't blow up. The Proxy means we don't have to enumerate
//    all 100+ API methods — anything App reaches for just works as a no-op.
function makeElectronApiStub() {
  const noop = () => {};
  const handler = {
    get(_target, prop) {
      if (typeof prop === "symbol") return undefined;
      // Subscribe-style methods return an unsubscribe function (App stores the
      // return value as an effect cleanup, e.g. `return api.onUpdateStatus(h)`).
      const isSubscribe = /^on[A-Z]/.test(prop) || /^subscribe/.test(prop);
      return (..._args) => {
        if (isSubscribe) return noop; // unsubscribe fn
        // Generic IPC call. Resolve to an empty object rather than undefined:
        // several mount-time effects do `const x = await api.foo(); if (x.bar)`
        // and would throw on `undefined.bar`. An empty object makes every such
        // property read a falsy `undefined` (the path is then skipped) without
        // a TypeError that would surface as an unhandled rejection.
        return Promise.resolve({});
      };
    },
    has() {
      return true;
    },
  };
  return new Proxy({}, handler);
}

// 2) matchMedia: jsdom does not implement it. App reads it in a useState
//    initializer (render-phase) AND in effects, so it must exist before mount.
function installMatchMedia() {
  if (typeof window.matchMedia === "function") return;
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// 3) Canvas 2D context: jsdom's canvas has no real 2D backend. Return a Proxy
//    that answers every method as a no-op and every property as a benign value,
//    plus the handful of methods App calls that must return a shaped object.
function installCanvasContext() {
  const make2dContext = () =>
    new Proxy(
      {
        canvas: null,
        // Methods that must return something usable:
        getImageData: (_x, _y, w = 1, h = 1) => ({
          data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
          width: Math.max(1, w),
          height: Math.max(1, h),
        }),
        createImageData: (w = 1, h = 1) => ({
          data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
          width: Math.max(1, w),
          height: Math.max(1, h),
        }),
        measureText: () => ({ width: 0 }),
        createLinearGradient: () => ({ addColorStop: () => {} }),
        createRadialGradient: () => ({ addColorStop: () => {} }),
        createPattern: () => ({}),
      },
      {
        get(target, prop) {
          if (prop in target) return target[prop];
          // Everything else (fillRect, drawImage, putImageData, save, ...) is a no-op.
          return () => {};
        },
        set(target, prop, value) {
          target[prop] = value;
          return true;
        },
      }
    );

  HTMLCanvasElement.prototype.getContext = function getContext(type) {
    if (type === "2d") return make2dContext();
    return null; // webgl etc. not needed
  };
  HTMLCanvasElement.prototype.toDataURL = function () {
    return "data:image/png;base64,";
  };
}

// 4) ResizeObserver: used in an effect; jsdom lacks it.
function installResizeObserver() {
  if (typeof window.ResizeObserver === "function") return;
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// 5) Audio: App constructs `new Audio(...)` in an effect. jsdom's HTMLMediaElement
//    has no real backend, so stub play/pause to avoid "not implemented" noise.
function installAudio() {
  try {
    if (typeof window.HTMLMediaElement !== "undefined") {
      window.HTMLMediaElement.prototype.play = () => Promise.resolve();
      window.HTMLMediaElement.prototype.pause = () => {};
      window.HTMLMediaElement.prototype.load = () => {};
    }
  } catch {
    /* ignore */
  }
}

// 6) clipboard — used behind user-action handlers, but install defensively.
function installClipboard() {
  if (!navigator.clipboard) {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.resolve(), readText: () => Promise.resolve("") },
    });
  }
}

beforeAll(() => {
  // jsdom provides a working localStorage; make sure it's empty so getItem()
  // returns null (App reads several keys in useState initializers).
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
  window.electronAPI = makeElectronApiStub();
  installMatchMedia();
  installCanvasContext();
  installResizeObserver();
  installAudio();
  installClipboard();
});

describe("App render smoke-test", () => {
  let root;
  let container;

  afterEach(async () => {
    // Tear down between assertions if a root was mounted.
    if (root) {
      const ReactDOM = await import("react-dom/client");
      void ReactDOM;
      try {
        root.unmount();
      } catch {
        /* ignore */
      }
      root = null;
    }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    container = null;
  });

  it("mounts <App/> without throwing a render-phase error (TDZ guard)", async () => {
    // Import lazily so the jsdom globals above are installed first.
    const React = (await import("react")).default;
    const ReactDOM = await import("react-dom/client");
    const App = (await import("./App")).default;

    container = document.createElement("div");
    container.id = "root";
    document.body.appendChild(container);

    // React surfaces render-phase throws (including TDZ ReferenceErrors) by
    // re-throwing them out of the synchronous flushSync render. We capture any
    // error and assert there was none, surfacing the message so a TDZ like
    // "Cannot access 'X' before initialization" is obvious in the failure.
    let caught = null;
    const onError = (ev) => {
      // jsdom dispatches uncaught render errors to window 'error'.
      caught = caught || ev.error || new Error(ev.message);
    };
    window.addEventListener("error", onError);

    try {
      const { flushSync } = await import("react-dom");
      root = ReactDOM.createRoot(container, {
        // Swallow React's console.error spam but still throw out of render.
        onUncaughtError: (err) => {
          caught = caught || err;
        },
        onCaughtError: (err) => {
          caught = caught || err;
        },
      });
      flushSync(() => {
        root.render(React.createElement(App));
      });
    } catch (err) {
      caught = caught || err;
    } finally {
      window.removeEventListener("error", onError);
    }

    if (caught) {
      // Surface the message so a TDZ shows clearly in CI output.
      throw new Error(
        "App failed to render (render-phase exception): " +
          (caught && caught.message ? caught.message : String(caught))
      );
    }

    // Sanity: the mount produced DOM. (App always renders at least a splash
    // root div.) Empty output would mean App short-circuited before its body.
    expect(container.childNodes.length).toBeGreaterThan(0);
  });
});
