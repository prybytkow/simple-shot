<p align="center">
  <img src="assets/icon.png" width="128" height="128" alt="Simple Shot logo"/>
</p>

<h1 align="center">Simple Shot</h1>

<p align="center">
  <strong>Professional screen capture with annotations and instant upload</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"/></a>
  <a href="https://www.electronjs.org/"><img src="https://img.shields.io/badge/Electron-44-47848F?logo=electron" alt="Electron"/></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-22+-339933?logo=node.js" alt="Node.js 22+"/></a>
  <a href="https://github.com/prybytkow/simple-shot/releases/latest"><img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="Platform"/></a>
  <a href="https://github.com/prybytkow/simple-shot/releases/latest"><img src="https://img.shields.io/github/v/release/prybytkow/simple-shot?label=latest%20release" alt="Latest release"/></a>
</p>

<p align="center">
  Capture region, screen, or window — annotate, watermark, then save, copy, or upload via <strong>SFTP</strong>, <strong>FTP</strong>, <strong>S3</strong>, or <strong>HTTP API</strong>.<br/>
  System tray app for <strong>Windows</strong>, <strong>macOS</strong>, and <strong>Linux</strong>. Auto-update, 10 languages.
</p>

---

## 📑 Table of Contents

- [Features](#-features)
- [Screenshots](#-screenshots)
- [Requirements](#-requirements)
- [Quick Start](#-quick-start)
- [Usage](#-usage)
- [Configuration](#-configuration)
- [Encryption & vault](#-encryption--vault)
- [Internationalization](#-internationalization)
- [Project Structure](#-project-structure)
- [Building](#-building)
- [Installers & auto-update](#-installers--auto-update)
- [Contributing](#-contributing)
- [License](#-license)

---

## ✨ Features

<table>
<tr>
<td width="50%">

### 📸 Screen capture

- **Region** — Overlay on each monitor; drag to select; annotate in place
- **Full screen** — Capture a monitor (per-display picker when several); open in fixed annotate window
- **Window** — Pick a window from thumbnails → fixed annotate window
- **Delayed capture** — Full-screen countdown; click anywhere or ESC to cancel; tray presets 3 / 5 / 10 s; Settings delay 0–120 s
- **Aspect-ratio crop** — 3:2, 2:3, 4:3, 3:4, 1:1, 16:9 or free
- **Resize & move** — Handles and drag to adjust the selection

### ⌨️ Global hotkeys

- Shortcuts for region / fullscreen / window / delayed capture, history, and settings
- Work while the app stays in the tray; conflicts keep the previous binding
- Settings UI: Record, Clear, Reset to defaults

### ✏️ Annotations

- **Shapes** — Rectangle, circle (outline/filled; right-click toggles)
- **Text & numbers** — Numbered markers auto-increment; optional background
- **Arrow** — Click start, click end
- **Brush** — Freehand draw
- **Blur** — Hide sensitive areas (applied on export)
- **Move** — Drag any annotation; **Undo** last change
- **Format** — Text color, highlight, font size, stroke / padding

</td>
<td width="50%">

### ☁️ Export & upload

- **Formats** — PNG, JPEG, WebP with quality settings
- **File name templates** — Tokens for date, size, profile, mode, uuid…
- **Destinations** — Upload, save to file, or clipboard-only (toolbar *Copy*)
- **SSH (SFTP)** — Host, port, user, password or key, path
- **FTP / FTPS** — With optional TLS
- **Amazon S3** — Bucket, region, optional custom endpoint
- **HTTP API** — Upload endpoint + API key (`X-API-Key` + Bearer)
- **Drag-and-drop upload** — Tray → *Upload files…*; up to 20 files/batch; folders skipped

### 🏷️ Watermark

- Optional text on every capture export
- Position, font size, color, opacity (Settings → Capture)

### 🔗 Other

- **Link history** — Thumbnails, search/filters, re-edit, reveal, copy / open / delete
- **Upload profiles** — Named configs as tabs; tray radio to switch active profile
- **Device encryption** — Settings encrypted with a machine-bound key (scrypt + AES-256-GCM); legacy master-password vaults migrate on one-time unlock
- **Auto-update** — Packaged builds check GitHub Releases (`electron-updater`)
- **Cross-platform** — Windows NSIS, macOS DMG (arm64 + x64), Linux AppImage / `.deb`
- **System tray** — Left-click = default mode + delay; right-click full menu
- **10 languages** — Including System default from OS locale

</td>
</tr>
</table>

---

## 📷 Screenshots

| Capture overlay | Settings |
|-----------------|----------|
| *Region / screen / window capture; toolbar for crop and annotations.* | *Tabbed settings: General, Capture, Export, Upload profiles, Hotkeys, Advanced.* |

> Start from the tray or a hotkey, annotate if needed, then upload, save (PNG/JPEG/WebP), or copy to the clipboard.

---

## 📋 Requirements

| Requirement | Version |
|-------------|---------|
| **Node.js** | 22.12+ (required by Electron 44) |
| **Package manager** | npm or yarn |
| **OS** | Windows, macOS, or Linux (Electron-supported) |

---

## 🚀 Quick Start

```bash
git clone https://github.com/prybytkow/simple-shot.git
cd simple-shot
npm install
npm run build
npm start
```

Or run in development mode (auto-rebuild on change):

```bash
npm run dev
```

---

## 📖 Usage

### Starting a capture

| How | Behavior |
|-----|----------|
| **Left-click tray** | Default mode + delay from Settings (`0` = immediate) |
| **Tray → Capture → Region / Full screen / Window** | Start that mode immediately |
| **Tray → Capture → Delayed…** | Countdown **3 / 5 / 10 s**, then the **default mode** from Settings |
| **Global hotkeys** | Region / fullscreen / window / delayed (settings delay; if delay is `0`, delayed hotkey uses **3 s**) |

### Capture flows

1. **Region** — Transparent overlay on every monitor. Drag to select, adjust with handles, annotate on the overlay, then Upload / Save / Copy.
2. **Full screen** — With multiple monitors, click the display badge to choose; then a **fixed annotate** window opens on the captured image.
3. **Window** — Thumbnail picker; then fixed annotate window.
4. **Delayed** — Full-screen countdown. **Click anywhere** or press **ESC** to cancel. Starting capture again while a countdown is running cancels it and starts a new one.

### Annotate (optional)

After selection (region) or in the fixed window (fullscreen / window / history re-edit):

- Crop with free or fixed aspect ratios
- Rectangle, circle, text, numbers, arrow, brush, blur
- Move mode, undo, format panel (colors, sizes)
- Maximize (fixed window) when useful

### Export

Use the toolbar or the **default destination** from Settings → Export:

| Destination | Result |
|-------------|--------|
| **Upload** | Active profile; public URL copied to clipboard (when configured) |
| **Save to file** | Save dialog; PNG / JPEG / WebP; path copied to clipboard |
| **Clipboard** / toolbar **Copy** | Image only on the clipboard (no file / upload) |

Watermark (if enabled) and annotations are baked in before encode/upload.

### History

**Tray → Link History**

- Thumbnails for recent captures
- Search + filter chips (all, local, ssh, ftp, s3, api, clipboard)
- **Copy** link/path, **Open** URL or file, **Reveal** in Explorer/Finder, **Re-edit** (when the full frame is still in `history-media/`), **Delete**
- Keeps up to **100** history entries and **30** full frames for re-edit
- Re-edit opens the fixed annotate UI on the saved raster (annotation layers are not restored)

### Upload arbitrary files

**Tray → Upload files…**

- Drop files or use the picker (not folders)
- Max **20** files per batch; warning above **100 MB** per file
- Uses the **active** upload profile (and unlocks a legacy vault if needed)
- Last successful URL copied to clipboard; optional system notification depending on *After upload* mode

### Overlay / picker shortcuts

| Shortcut | Action |
|----------|--------|
| **ESC** | Cancel capture overlay, countdown, window picker, or fixed annotate window |
| **Click anywhere** (during countdown) | Cancel delayed capture |

On macOS, Accessibility / Screen Recording permission may be required for global shortcuts and window capture. On Linux (especially Wayland), window capture may be limited — use region or fullscreen instead.

### Global hotkeys

Configurable in **Tray → Settings → Hotkeys**. Work while the app is in the tray only.

| Shortcut (default) | Action |
|--------------------|--------|
| **Ctrl+Shift+S** (⌘⇧S on macOS) | Capture region |
| **Ctrl+Shift+A** | Capture fullscreen |
| **Ctrl+Shift+W** | Capture window |
| **Ctrl+Shift+D** | Delayed capture (settings delay + default mode) |
| *(empty by default)* | Open history / Open settings |

If a shortcut is already used by another app, registration fails with a notification; the previous binding is kept. Use **Record**, **Clear**, or **Reset to defaults** in Settings.

---

## ⚙️ Configuration

**Tray → Settings** — sidebar tabs. Data lives under the Electron user-data folder (on Windows typically `%APPDATA%\Simple Shot`).

| Tab | Contents |
|-----|----------|
| **General** | Language; after-upload feedback (status auto-close / keep open / progress then system notification); update check & auto-download |
| **Capture** | Default mode (region / fullscreen / window); default delay **0–120** s (`0` = off); watermark (enable, text, position, font size, color, opacity) |
| **Export** | File name template + live preview; format PNG/JPEG/WebP; JPEG/WebP quality; default destination (upload / file / clipboard) |
| **Upload** | Profile **tabs** (New **+**, Duplicate, Delete); name; show in tray; active for uploads; method SSH/FTP/S3/API + fields/secrets; per-profile base URL |
| **Hotkeys** | Six actions — record accelerator, clear slot, reset all to defaults |
| **Advanced** | Encryption status; danger zone → **Reset vault** (wipes encrypted profiles/secrets) |

### File name template tokens

Default: `screenshot-{yyyy}-{MM}-{dd}_{HH}-{mm}-{ss}`

| Token | Meaning |
|-------|---------|
| `{yyyy}` `{yy}` `{MM}` `{dd}` `{HH}` `{mm}` `{ss}` | Local date/time |
| `{timestamp}` | `Date.now()` |
| `{uuid}` | Short hex id |
| `{width}` `{height}` | Final frame size |
| `{format}` | `png` / `jpg` / `webp` |
| `{profile}` | Active upload profile name (sanitized) |
| `{mode}` | `region` / `fullscreen` / `window` |

Extension always comes from the chosen format. Drag-and-drop file uploads keep the **original** file names (capture template does not apply).

### Upload profiles & tray

- Each profile has its own method, host/bucket/endpoint, credentials, and base URL for public links.
- Profiles marked **Show in tray** appear as a radio list under the tray menu to switch the active profile.
- Tray tooltip shows `Simple Shot — {active profile}`.

---

## 🔐 Encryption & vault

| Topic | Behavior |
|-------|----------|
| **Normal installs** | Config + secrets are encrypted with a key derived from an **`installTimestamp`** stored next to settings (scrypt + AES-256-GCM). The app unlocks automatically on the same machine — no daily master password. |
| **Plaintext on disk** | Hotkeys, capture prefs, update prefs, and export prefs are stored **outside** the ciphertext so they work even if the vault is locked. |
| **Legacy vaults** | Older files encrypted with a **master password** (no `installTimestamp`) require a **one-time unlock** to migrate. Until then Settings shows a lock screen and uploads that need secrets are blocked. |
| **Reset vault** | Settings → Advanced → danger zone. Deletes encrypted profiles/secrets; you must re-enter connection details. |

Renderer windows use **`contextIsolation`** and a preload bridge (`window.simpleShot`); the page has no Node/`require('electron')` access.

---

## 🌍 Internationalization

| Code | Language | Code | Language |
|------|----------|------|----------|
| `en` | English | `it` | Italiano |
| `ru` | Русский | `es` | Español |
| `zh` | 中文 | `pt` | Português |
| `pl` | Polski | `fr` | Français |
| `ua` | Українська | — | — |
| `by` | Беларуская | — | — |

- Default: **English**. *System default* maps OS locale (e.g. `uk` → `ua`, `be` → `by`) with fallback to English.
- Applied to tray, settings, capture overlay, countdown, history, unlock, upload, and feedback windows.

---

## 📁 Project Structure

Source and assets are in the repo; `dist/` is generated by the build (gitignored).

```
simple-shot/
├── src/main/                 # Main process (TypeScript)
│   ├── main.ts               # Tray, window factories, hotkey/updater wiring
│   ├── preload.ts            # contextBridge → window.simpleShot (IPC whitelist)
│   ├── preload-path.ts
│   ├── window-defaults.ts    # Secure BrowserWindow defaults
│   ├── screen-capture.ts     # Public capture API facade
│   ├── capture-session.ts    # Overlay/countdown/picker session state
│   ├── capture-windows.ts    # Overlay, countdown, picker, fixed annotate
│   ├── capture-platform.ts   # Screenshot backends (incl. GDI / Linux portal)
│   ├── capture-ipc.ts        # Capture-related ipcMain handlers
│   ├── save-or-upload.ts     # Encode, save, upload, feedback window
│   ├── export-encode.ts      # File name templates + PNG/JPEG/WebP
│   ├── file-upload.ts        # Drag-drop / picker upload queue
│   ├── settings-store.ts     # Facade re-export
│   ├── settings-types.ts     # Types, defaults, normalizers
│   ├── settings-disk.ts      # settings.json I/O, load/save UI
│   ├── settings-session.ts   # In-memory session state
│   ├── vault-state.ts        # Unlock/reset/secrets/persist
│   ├── vault-crypto.ts       # scrypt + AES-256-GCM
│   ├── vault-flow.ts         # Unlock UI hook (breaks cycles)
│   ├── ipc/                  # settings / vault / history IPC modules
│   ├── i18n/                 # Locales + resolveLanguage
│   ├── i18n.ts               # Shim → i18n/index
│   ├── history.ts
│   ├── hotkeys.ts
│   ├── updater.ts
│   ├── upload-url.ts
│   ├── app-icon.ts
│   ├── app-notify.ts
│   ├── gdi-capture.ts        # Windows capture helper
│   ├── linux-screen-capture.ts
│   └── uploaders/            # SSH, FTP, S3, API (+ lazy dispatch)
├── renderer/
│   ├── capture-window.html   # Capture / annotate UI
│   ├── capture/              # Classic scripts + capture-window.css
│   ├── countdown.html        # Delayed-capture overlay
│   ├── window-picker.html
│   ├── upload-feedback.html
│   ├── settings.html
│   ├── history.html
│   ├── upload.html
│   └── unlock.html           # Legacy vault unlock
├── build/                    # macOS entitlements, Linux icon sizes
├── assets/                   # icon.png / .ico / .icns / tray template
├── scripts/                  # copy-build-assets, generate-icons
├── doc/                      # Feature design notes / checklists
├── package.json
├── tsconfig.json
└── LICENSE
```

---

## 🔨 Building

| Command | Description |
|---------|-------------|
| `npm run icons` | Regenerate `.icns`, macOS tray template, and `build/icons/*` from `assets/icon.png` |
| `npm run build` | Compile TypeScript, copy renderer (recursive) + assets to `dist/` |
| `npm start` | Build and run the app |
| `npm run dev` | Watch mode: rebuild and restart on change |

Build output: `dist/main/` (JS + assets + preload), `dist/renderer/` (HTML + `capture/*`).

---

## 📦 Installers & auto-update

Build with [electron-builder](https://www.electron.build/) **on the target OS** (macOS artifacts need a Mac; Linux packages need Linux). Download prebuilt binaries from the [latest GitHub Release](https://github.com/prybytkow/simple-shot/releases/latest).

| Command | Build host | Artifacts in `release/` |
|---------|------------|-------------------------|
| `npm run dist` / `dist:win` | Windows | NSIS Setup `.exe` (x64), `win-unpacked/` |
| `npm run dist:mac` | macOS | `.dmg` + `.zip` per arch (arm64, x64) for updater |
| `npm run dist:linux` | Linux | `.AppImage` + `.deb` (x64) |

| Platform | Typical release files |
|----------|------------------------|
| Windows | `Simple Shot Setup x.y.z.exe` |
| macOS | `Simple Shot-x.y.z-arm64.dmg` / `-x64.dmg`, matching `.zip` |
| Linux | `Simple Shot-x.y.z.AppImage`, `.deb` |

Packaged builds check GitHub Releases via `electron-updater` (tray → *Check for updates*; Settings → General → Updates).

**Runtime notes:** On macOS, grant **Screen Recording** (and Accessibility for global hotkeys) when prompted. On Linux Wayland, window capture may be limited — use region or fullscreen.

### Code signing (release engineers)

Secrets stay in CI / local env — **never commit `.pfx` or Apple keys**.

| Platform | Variables | Notes |
|----------|-----------|--------|
| **Windows** | `CSC_LINK` (`.pfx` path or base64), `CSC_KEY_PASSWORD` | Signs Setup + `Simple Shot.exe`. Without them, builds stay unsigned (fine for local dev). SmartScreen may still warn until the cert has reputation (EV helps). Verify: `signtool verify /pa "Simple Shot Setup X.Y.Z.exe"` |
| **macOS** | `CSC_LINK` / `CSC_KEY_PASSWORD` (Developer ID), plus `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` (or App Store Connect API key) | Hardened runtime + `build/entitlements.mac.plist`. electron-builder notarizes when Apple credentials are present. CI sets `CSC_IDENTITY_AUTO_DISCOVERY=false` so unsigned builds do not fail looking for a keychain identity. |

Tag `v*` pushes run [`.github/workflows/release.yml`](.github/workflows/release.yml) (Windows / macOS / Linux) and publish `latest.yml` / `latest-mac.yml` / `latest-linux.yml` for the updater.

**Icons:** Source `assets/icon.png` (+ `icon.ico` for Windows). Run `npm run icons` to refresh `icon.icns`, `iconTemplate.png`, and `build/icons/`. Assets copy to `dist/main/assets/` on `npm run build`.

**Icon not updating?** Clean build: delete `release/` and `dist/`, then `npm run dist`. Clear Windows icon cache (`%LocalAppData%\IconCache.db`, restart Explorer) if needed.

---

## 🤝 Contributing

Contributions are welcome. For larger changes, open an issue first. Ensure the project builds and runs:

```bash
npm run build && npm start
```

Design notes and checklists for individual features live under [`doc/`](doc/).

---

## 📄 License

This project is licensed under the **MIT License** — see [LICENSE](LICENSE) for the full text.

**Copyright © 2026 Aliaksei Prybytkou**
