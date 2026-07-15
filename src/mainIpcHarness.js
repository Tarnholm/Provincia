// TEST-ONLY harness (not shipped — not required by main.js, so packagedFiles
// won't include it). Loads the REAL main.js under a mocked Electron so its
// ipcMain.handle handlers can be invoked and asserted in unit tests. main.js
// touches Electron only via require("electron") + require("electron-updater");
// a Module._load hook makes those resolve to the mocks below. app.whenReady()
// returns a never-resolving promise so no window / app-lifecycle code runs —
// only the top-level handler registrations, which is what we test.
"use strict";
const Module = require("module");
const os = require("os");
const path = require("path");

let cached = null;

function makeElectron(captured) {
  const noop = () => {};
  const app = {
    getPath: () => os.tmpdir(),
    getVersion: () => "0.0.0-harness",
    getName: () => "Provincia",
    isPackaged: false,
    requestSingleInstanceLock: () => true,
    whenReady: () => new Promise(() => {}), // never resolves → no window/lifecycle
    on: noop, once: noop, quit: noop, exit: noop, focus: noop,
    setAppUserModelId: noop, disableHardwareAcceleration: noop,
    commandLine: { appendSwitch: noop, hasSwitch: () => false },
  };
  const ipcMain = {
    handle: (channel, fn) => { captured.set(channel, fn); },
    handleOnce: (channel, fn) => { captured.set(channel, fn); },
    removeHandler: (channel) => { captured.delete(channel); },
    on: noop, once: noop, removeAllListeners: noop,
  };
  class BrowserWindow {
    constructor() { this.webContents = { on: noop, send: noop, session: {}, setWindowOpenHandler: noop, openDevTools: noop }; }
    static getAllWindows() { return []; }
    static fromWebContents() { return null; }
    loadURL() {} loadFile() {} on() {} once() {} show() {} focus() {}
    setMenuBarVisibility() {} maximize() {} isMinimized() { return false; } restore() {}
  }
  const session = { defaultSession: { webRequest: { onHeadersReceived: noop }, setSpellCheckerEnabled: noop } };
  const dialog = {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true }),
    showMessageBox: async () => ({ response: 0 }),
  };
  const shell = { openExternal: noop, openPath: async () => "", showItemInFolder: noop };
  const Menu = { setApplicationMenu: noop, buildFromTemplate: () => ({ popup: noop }) };
  const nativeImage = {
    createFromPath: () => ({ isEmpty: () => true, getSize: () => ({ width: 0, height: 0 }), toPNG: () => Buffer.alloc(0), toBitmap: () => Buffer.alloc(0) }),
    createFromBuffer: () => ({ isEmpty: () => true }),
  };
  return { app, BrowserWindow, Menu, session, dialog, ipcMain, shell, nativeImage };
}

// Load main.js once; return { channels, invoke, electron }. invoke(channel, ...args)
// calls the registered handler with a stub event and returns its (possibly async) result.
function loadMainHandlers() {
  if (cached) return cached;
  const captured = new Map();
  const electron = makeElectron(captured);
  const updater = {
    autoUpdater: {
      autoDownload: false, autoInstallOnAppQuit: false, logger: null,
      on: () => {}, checkForUpdates: async () => {}, quitAndInstall: () => {},
    },
  };
  const origLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === "electron") return electron;
    if (request === "electron-updater") return updater;
    return origLoad.call(this, request, ...rest);
  };
  try {
    require(path.join(__dirname, "..", "main.js"));
  } finally {
    Module._load = origLoad;
  }
  const invoke = (channel, ...args) => {
    const fn = captured.get(channel);
    if (!fn) throw new Error(`no IPC handler registered for channel: ${channel}`);
    return fn({ sender: { send: () => {} } }, ...args);
  };
  cached = { channels: [...captured.keys()], invoke, electron };
  return cached;
}

module.exports = { loadMainHandlers };
