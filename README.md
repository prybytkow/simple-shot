<p align="center">
  <img src="assets/icon.png" width="128" height="128" alt="Simple Shot logo"/>
</p>

<h1 align="center">Simple Shot</h1>

<p align="center">
  <strong>Professional screen capture with annotations and instant upload</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"/></a>
  <a href="https://www.electronjs.org/"><img src="https://img.shields.io/badge/Electron-39-47848F?logo=electron" alt="Electron"/></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-18+-339933?logo=node.js" alt="Node.js 18+"/></a>
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

- **Region** — Overlay on each monitor; drag to select
- **Full screen** — Capture a monitor (picker when several displays)
- **Window** — Pick a window from thumbnails
- **Delayed capture** — Countdown 3 / 5 / 10 s (or custom), then default mode
- **Aspect-ratio crop** — 3:2, 2:3, 4:3, 3:4, 1:1, 16:9 or free
- **Resize & move** — Handles and drag to adjust the selection

### ⌨️ Global hotkeys

- Configurable shortcuts for region / fullscreen / window / delayed capture, history, and settings
- Work while the app stays in the tray; conflicts keep the previous binding

### ✏️ Annotations

- **Shapes** — Rectangle, circle (outline/filled; right-click toggles)
- **Text & numbers** — With optional background
- **Arrow** — Click to release
- **Brush** — Freehand draw
- **Blur** — Hide sensitive areas (applied on export)
- **Move** — Drag any annotation; **Undo** last change
- **Format** — Text color, highlight, font size, stroke

</td>
<td width="50%">

### ☁️ Export & upload

- **Formats** — PNG, JPEG, WebP with quality settings
- **File name templates** — Tokens for date, size, profile, mode, uuid…
- **Destinations** — Upload, save to file, or clipboard-only (toolbar *Copy*)
- **SSH (SFTP)** — Host, port, user, password or key, path
- **FTP / FTPS** — With optional TLS
- **Amazon S3** — Bucket, region, optional custom endpoint
- **HTTP API** — Upload endpoint + API key (`X-API-Key` / Bearer)
- **Drag-and-drop upload** — Tray → *Upload files…*; drop or pick any files (PDF, ZIP, images, …) onto the active profile

### 🏷️ Watermark

- Optional text on every export
- Position, font size, color, opacity

### 🔗 Other

- **Link history** — Thumbnails, search/filters, re-edit, copy / open / delete
- **Upload profiles + vault** — Named configs; secrets behind master password (scrypt + AES-256-GCM)
- **Auto-update** — Packaged builds check GitHub Releases (`electron-updater`)
- **Cross-platform** — Windows NSIS, macOS universal DMG, Linux AppImage / `.deb`
- **System tray** — Left-click capture, right-click menu
- **10 languages** — Including System default from OS locale

</td>
</tr>
</table>

---

## 📷 Screenshots

| Capture overlay | Settings |
|-----------------|----------|
| *Region / screen / window capture; toolbar for crop and annotations.* | *Profiles, vault, hotkeys, export formats, watermark, updates.* |

> Start from the tray or a hotkey, annotate if needed, then upload, save (PNG/JPEG/WebP), or copy to the clipboard.

---

## 📋 Requirements

| Requirement | Version |
|-------------|---------|
| **Node.js** | 18+ (LTS recommended) |
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

1. **Start** — Click the tray icon (uses default mode + delay from Settings) or open the *Capture* tray submenu:
   - **Region** — drag a selection on screen
   - **Full screen** — capture a monitor (picker if multiple displays)
   - **Window** — pick a window from thumbnails
   - **Delayed…** — countdown 3 / 5 / 10 s, then the default mode
2. **Annotate** (optional) — After selection or capture, use the toolbar: crop, shapes, text, arrows, brush, blur; set format.
3. **Export** — Use the toolbar or the default destination from Settings:
   - *Upload* — URL to clipboard
   - *Save to file* — PNG / JPEG / WebP via save dialog; path to clipboard
   - *Copy* / clipboard destination — image on the clipboard only
4. **History** — Tray → *Link History* for thumbnails, search, copy/open, and re-edit when the original frame is still on disk.
5. **Upload files** — Tray → *Upload files…* to drop or pick arbitrary files onto the active upload profile (folders skipped; last successful URL to clipboard).

### Global hotkeys

Configurable in **Tray → Settings → Hotkeys**. Work while the app is in the tray only.

| Shortcut (default) | Action |
|--------------------|--------|
| **Ctrl+Shift+S** (⌘⇧S on macOS) | Capture region |
| **Ctrl+Shift+A** | Capture fullscreen |
| **Ctrl+Shift+W** | Capture window |
| **Ctrl+Shift+D** | Delayed capture (settings delay + default mode) |
| *(empty by default)* | Open history / Open settings |

If a shortcut is already used by another app, registration fails with a notification; the previous binding is kept.

### Overlay / picker shortcuts

| Shortcut | Action |
|----------|--------|
| **ESC** | Cancel capture overlay, countdown, or window picker (local, not a global hotkey) |
| **Click countdown** | Cancel delayed capture |

On macOS, Accessibility / Screen Recording permission may be required for global shortcuts and window capture. On Linux (especially Wayland), window capture may be limited — use region or fullscreen instead.

---

## ⚙️ Configuration

All settings: **Tray → Settings**. Stored in user data (e.g. `%APPDATA%\simple-shot` on Windows).

| Section | Description |
|---------|-------------|
| **Capture** | Default mode (region / fullscreen / window) and default delay in seconds (`0` = off) |
| **Upload profiles** | Named configs (SSH/FTP/S3/API); optional “Show in tray”; one active profile |
| **Master password vault** | Profiles and secrets encrypted with scrypt + AES-256-GCM. Hidden until unlock (Win/macOS/Linux) |
| **Hotkeys** | Global shortcuts for capture, history, and settings |
| **Base URL** | Per-profile prefix for uploaded file links |
| **Watermark** | Enable, text, position, font size, color, opacity (0–1) |
| **Language** | Interface language or *System default* |
| **After upload** | Overlay toast / system notification / link window |
| **Updates** | Check on startup / auto-download (packaged builds only) |
| **Export** | File name template (`{yyyy}`, `{uuid}`, `{width}`…), PNG/JPEG/WebP + quality, default destination (upload / file / clipboard). Toolbar *Copy* puts the image on the clipboard |
| **History** | Thumbnails under user data; search/filters; re-edit opens the annotation UI when the original frame is still available |
| **Upload files** | Tray window: drop zone + file picker; queue with per-file status; uses the active upload profile (vault unlock if needed) |

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

- Default: **English**. *System default* uses OS locale with fallback to English.
- Language is saved and applied to tray, settings, capture overlay, history, and the upload window.

---

## 📁 Project Structure

Source and assets are in the repo; `dist/` is generated by the build (gitignored).

```
simple-shot/
├── src/main/              # Main process (TypeScript)
│   ├── main.ts            # Entry, tray, windows, IPC
│   ├── app-icon.ts        # Platform tray / window icons
│   ├── updater.ts         # electron-updater (GitHub Releases)
│   ├── settings-store.ts  # Profiles + vault persistence
│   ├── vault-crypto.ts    # scrypt + AES-256-GCM (cross-platform)
│   ├── screen-capture.ts  # Capture, watermark, save/upload
│   ├── export-encode.ts   # File name templates + PNG/JPEG/WebP
│   ├── file-upload.ts     # Drag-drop / picker upload queue
│   ├── hotkeys.ts         # Global shortcuts registration
│   ├── i18n.ts            # Translations
│   ├── history.ts         # Upload/save history + media thumbs
│   ├── ssh-handler.ts     # SSH/SFTP
│   └── uploaders/         # SSH, FTP, S3, HTTP API uploaders
├── renderer/              # HTML UIs → dist/renderer
│   ├── capture-window.html
│   ├── settings.html
│   ├── unlock.html        # Master password unlock/setup
│   ├── history.html
│   └── upload.html        # Drop zone for arbitrary files
├── build/
│   ├── entitlements.mac.plist
│   └── icons/             # Linux PNG sizes (npm run icons)
├── assets/                # Icons → dist/main/assets
│   ├── icon.png
│   ├── icon.ico
│   ├── icon.icns
│   └── iconTemplate.png
├── scripts/
│   ├── copy-build-assets.js
│   └── generate-icons.js
├── package.json
├── tsconfig.json
└── LICENSE
```

---

## 🔨 Building

| Command | Description |
|---------|-------------|
| `npm run icons` | Regenerate `.icns`, macOS tray template, and `build/icons/*` from `assets/icon.png` |
| `npm run build` | Compile TypeScript, copy renderer + assets to `dist/` |
| `npm start` | Build (if needed) and run the app |
| `npm run dev` | Watch mode: rebuild and restart on change |

Build output: `dist/main/` (JS + assets), `dist/renderer/` (HTML).

---

## 📦 Installers & auto-update

Build with [electron-builder](https://www.electron.build/) **on the target OS** (macOS artifacts need a Mac; Linux packages need Linux). Download prebuilt binaries from the [latest GitHub Release](https://github.com/prybytkow/simple-shot/releases/latest).

| Command | Build host | Artifacts in `release/` |
|---------|------------|-------------------------|
| `npm run dist` / `dist:win` | Windows | NSIS Setup `.exe` (x64), `win-unpacked/` |
| `npm run dist:mac` | macOS | Universal `.dmg` + `.zip` (updater) |
| `npm run dist:linux` | Linux | `.AppImage` + `.deb` (x64) |

| Platform | Typical release files |
|----------|------------------------|
| Windows | `Simple Shot Setup x.y.z.exe` |
| macOS | `Simple Shot-x.y.z-universal.dmg`, matching `.zip` |
| Linux | `Simple Shot-x.y.z.AppImage`, `.deb` |

Packaged builds check GitHub Releases via `electron-updater` (tray → *Check for updates*; Settings → Updates).

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

---

## 📄 License

This project is licensed under the **MIT License** — see [LICENSE](LICENSE) for the full text.

**Copyright © 2026 Aliaksei Prybytkou**
