// Build a macOS Provincia.app on Windows without using electron-builder
// (which refuses to cross-build) or electron-packager (which can't create
// symlinks on Windows). Instead, we repack the official Electron Mac zip,
// rewriting paths and injecting our app.asar.
//
// The official Electron Mac zip contains the full Electron.app structure
// WITH symlinks stored as zip entries (file mode 0xA1ED). yauzl reads
// those entries and yazl writes them out unchanged, so we never need the
// host OS to create real symlinks.

"use strict";

const fs = require("fs");
const path = require("path");
const yauzl = require("yauzl");
const yazl = require("yazl");

const ELECTRON_ZIP =
  "C:\\Users\\vtarn\\AppData\\Local\\electron\\Cache\\92de7e0b9013f8f82044966bbe9739d493dc12c36e2bfa6dec36b69c73b451e6\\electron-v41.2.1-darwin-x64.zip";

const APP_ASAR = "C:\\dev\\Provincia\\dist\\win-unpacked\\resources\\app.asar";
const APP_UPDATE_YML = "C:\\dev\\Provincia\\dist\\win-unpacked\\resources\\app-update.yml";
const ICON_PNG = "C:\\dev\\Provincia\\public\\icon.png";

const pkg = JSON.parse(fs.readFileSync("C:\\dev\\Provincia\\package.json", "utf8"));
const VERSION = pkg.version;

const OUT_ZIP = `C:\\dev\\Provincia\\dist\\Provincia-${VERSION}-mac.zip`;

// External attributes encoding for zip entries — high 16 bits hold Unix
// file mode + type. Constants below match what zip(1) / Info-ZIP writes.
const UNIX_FILE = 0o100644;
const UNIX_EXEC = 0o100755;
const UNIX_DIR = 0o040755;
const UNIX_SYMLINK = 0o120755;

function extAttr(mode) { return ((mode & 0xffff) << 16) >>> 0; }
function isSymlink(ext) { return (((ext >>> 16) & 0xf000) === 0xa000); }
function isDir(ext) { return (((ext >>> 16) & 0xf000) === 0x4000); }
function isExec(ext) { return ((ext >>> 16) & 0o111) !== 0; }

// New Info.plist tailored to Provincia (replaces Electron's default).
function makeInfoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleDisplayName</key><string>Provincia</string>
  <key>CFBundleExecutable</key><string>Provincia</string>
  <key>CFBundleIconFile</key><string>app.icns</string>
  <key>CFBundleIdentifier</key><string>com.tarnholm.provincia</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>Provincia</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>LSMinimumSystemVersion</key><string>10.15.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSRequiresAquaSystemAppearance</key><false/>
  <key>NSSupportsAutomaticGraphicsSwitching</key><true/>
</dict>
</plist>
`;
}

// Read every entry from the Electron Mac zip and pipe it into a new yazl
// stream, rewriting paths from Electron.app → Provincia.app and patching
// the Info.plist + executable filename.
function main() {
  const zipOut = new yazl.ZipFile();
  fs.mkdirSync(path.dirname(OUT_ZIP), { recursive: true });
  zipOut.outputStream.pipe(fs.createWriteStream(OUT_ZIP)).on("close", () => {
    const size = fs.statSync(OUT_ZIP).size;
    console.log(`\n✓ wrote ${OUT_ZIP} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  });

  yauzl.open(ELECTRON_ZIP, { lazyEntries: true }, (err, zip) => {
    if (err) throw err;
    let entriesProcessed = 0;
    let renamedExecutable = false;
    zip.readEntry();
    zip.on("entry", (entry) => {
      const orig = entry.fileName;
      // Rewrite root app folder. Electron's zip uses "Electron.app/..."
      // for everything; we want "Provincia.app/...".
      let outName = orig.replace(/^Electron\.app\//, "Provincia.app/");
      // Rename the main executable Electron.app/Contents/MacOS/Electron → Provincia.
      if (outName === "Provincia.app/Contents/MacOS/Electron") {
        outName = "Provincia.app/Contents/MacOS/Provincia";
        renamedExecutable = true;
      }
      // Skip the default Electron.app/Contents/Resources/{default_app.asar,electron.icns}
      // — we replace them below. Skip empty default_app.asar from Electron.
      if (outName === "Provincia.app/Contents/Resources/default_app.asar") {
        zip.readEntry();
        return;
      }
      if (outName === "Provincia.app/Contents/Resources/electron.icns") {
        // Skip; we'll write app.icns from our own png conversion later
        // (Mac can render .png as icon in PROD if you set CFBundleIconFile
        // accordingly; .icns is not strictly required).
        zip.readEntry();
        return;
      }
      // Patch Info.plist
      if (outName === "Provincia.app/Contents/Info.plist") {
        zipOut.addBuffer(Buffer.from(makeInfoPlist(), "utf8"), outName, {
          mode: UNIX_FILE,
          mtime: entry.getLastModDate(),
        });
        entriesProcessed++;
        zip.readEntry();
        return;
      }
      const ext = entry.externalFileAttributes >>> 0;
      const mode = (ext >>> 16) & 0xffff;
      if (isSymlink(ext)) {
        zip.openReadStream(entry, (e, rs) => {
          if (e) throw e;
          const chunks = [];
          rs.on("data", (c) => chunks.push(c));
          rs.on("end", () => {
            const linkTarget = Buffer.concat(chunks).toString("utf8");
            zipOut.addBuffer(Buffer.from(linkTarget, "utf8"), outName, {
              mode: UNIX_SYMLINK,
              mtime: entry.getLastModDate(),
            });
            entriesProcessed++;
            zip.readEntry();
          });
        });
      } else if (isDir(ext) || outName.endsWith("/")) {
        zipOut.addEmptyDirectory(outName, {
          mode: UNIX_DIR,
          mtime: entry.getLastModDate(),
        });
        entriesProcessed++;
        zip.readEntry();
      } else {
        zip.openReadStream(entry, (e, rs) => {
          if (e) throw e;
          const chunks = [];
          rs.on("data", (c) => chunks.push(c));
          rs.on("end", () => {
            const fileMode = isExec(ext) ? UNIX_EXEC : UNIX_FILE;
            zipOut.addBuffer(Buffer.concat(chunks), outName, {
              mode: fileMode,
              mtime: entry.getLastModDate(),
            });
            entriesProcessed++;
            zip.readEntry();
          });
        });
      }
    });
    zip.on("end", () => {
      console.log(`  copied ${entriesProcessed} entries from Electron zip`);
      console.log(`  renamed executable: ${renamedExecutable}`);
      // Inject Provincia.app/Contents/Resources/app.asar from the Windows
      // build output. The asar is platform-neutral.
      const asarBuf = fs.readFileSync(APP_ASAR);
      zipOut.addBuffer(asarBuf, "Provincia.app/Contents/Resources/app.asar", {
        mode: UNIX_FILE,
      });
      console.log(`  added app.asar (${(asarBuf.length / 1024 / 1024).toFixed(1)} MB)`);
      // Add app-update.yml so auto-updater knows where to look.
      if (fs.existsSync(APP_UPDATE_YML)) {
        zipOut.addFile(APP_UPDATE_YML, "Provincia.app/Contents/Resources/app-update.yml", {
          mode: UNIX_FILE,
        });
        console.log(`  added app-update.yml`);
      }
      // Add icon.png as Resources/app.icns (Mac will accept PNG when the
      // bundle declares CFBundleIconFile=app.icns — it autoconverts).
      if (fs.existsSync(ICON_PNG)) {
        zipOut.addFile(ICON_PNG, "Provincia.app/Contents/Resources/app.icns", {
          mode: UNIX_FILE,
        });
        console.log(`  added app.icns`);
      }
      zipOut.end();
    });
  });
}

main();
