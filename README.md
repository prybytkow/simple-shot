# Simple Shot

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A professional desktop application for capturing screen regions, annotating screenshots, and uploading them to SSH (SFTP), FTP, or Amazon S3. **Simple Shot** runs in the system tray and supports multiple displays, watermarks, blur regions, and 10 interface languages.

---

## Table of Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [Internationalization](#internationalization)
- [Project Structure](#project-structure)
- [Building](#building)
- [Building the Windows installer](#building-the-windows-installer)
- [Contributing](#contributing)
- [License](#license)

---

## Features

### Screen capture

- **Multi-display support** — Overlay on each monitor; choose the screen and drag to select the capture area.
- **Aspect-ratio crop** — Preset ratios (3:2, 2:3, 4:3, 3:4, 1:1, 16:9) or free selection.
- **Resize & move** — Adjust the selection with handles; move the whole area by dragging.

### Annotations (before save/upload)

- **Shapes** — Rectangle and circle (outline or filled; right-click toggles).
- **Text** — Single-line text with optional background (right-click toggles).
- **Number labels** — Auto-incrementing numbers with optional background.
- **Arrow** — Straight arrow from click to release.
- **Brush** — Freehand drawing.
- **Blur** — Rectangular blur area (e.g. for sensitive data); applied to the final image on save/upload.
- **Move** — Select and drag any annotation to reposition.
- **Undo** — Revert the last annotation.
- **Format** — Configure text color, highlight color, font size, and stroke width for annotations.

### Export & upload

- **Save to file** — Save as PNG via system dialog; path is copied to clipboard.
- **Upload to server** — Upload and get a URL; URL is copied to clipboard.
- **Upload methods:**
  - **SSH (SFTP)** — Host, port, username, password or private key, remote path.
  - **FTP / FTPS** — Host, port, credentials, destination path, optional TLS.
  - **Amazon S3** — Access key, secret, bucket, region, optional custom endpoint (S3-compatible storage).

### Watermark

- Optional text watermark on every saved/uploaded screenshot.
- Configurable: text, position (corners/center), font size, color, opacity.
- Stored in settings and applied during export.

### Other

- **Link history** — List of recent uploads and local saves (method, URL/path, date); click to copy.
- **System tray** — Runs from the tray; left-click starts capture, right-click opens menu (Capture, Settings, History, Exit).
- **Settings** — Stored in user data; base URL template for uploaded file links.

---

## Screenshots

*After starting capture from the tray, overlay windows appear on each display. Drag to select a region; the toolbar offers crop, annotations, save to file, and upload to server.*

---

## Requirements

- **Node.js** 18+ (LTS recommended)
- **npm** or **yarn**
- **Windows / macOS / Linux** (Electron supported platforms)

---

## Installation

```bash
# Clone the repository
git clone https://github.com/prybytkow/simple-shot.git
cd simple-shot

# Install dependencies
npm install

# Build TypeScript
npm run build
```

---

## Usage

**Start the app**

```bash
npm start
```

Or use the dev watcher (rebuilds on change):

```bash
npm run dev
```

**Workflow**

1. **Capture** — Click the tray icon (or choose “Capture Screen” from the tray menu). Overlay appears on each display.
2. **Select area** — Click and drag on the desired screen to define the region. Resize with corner/edge handles if needed.
3. **Optional** — Use the toolbar to crop by aspect ratio, add annotations (shapes, text, arrows, brush, blur), and change format.
4. **Export** — Click “Save to file” (PNG to disk) or “Upload to server” (SSH/FTP/S3). The file path or URL is copied to the clipboard.
5. **History** — Open “Link History” from the tray to see recent uploads/saves and copy URLs or paths.

**Shortcuts**

- **ESC** — Cancel capture and close overlay windows.

---

## Configuration

All settings are in **Settings** (tray → Settings). They are stored in the app’s user data directory (e.g. `%APPDATA%/simple-shot` on Windows).

### Save method

- **SSH (SFTP)** — Host, port (default 22), username, password or private key path, destination path.
- **FTP** — Host, port (default 21), username, password, destination path, optional “Secure connection (FTPS)”.
- **Amazon S3** — Access Key ID, Secret Access Key, bucket, region (default `us-east-1`), optional endpoint for S3-compatible backends.

### Base URL

Base URL for uploaded files (e.g. `https://vault.by`). The uploaded path is appended to form the full link copied to the clipboard.

### Watermark

- Enable/disable.
- Text, position (top-left, top-right, bottom-left, bottom-right, center), font size, color, opacity (0–1).

### Language

Choose interface language or “System default” (follows OS locale with fallback to English).

---

## Internationalization

The UI is translated for:

| Code | Language   |
|------|------------|
| `en` | English    |
| `ru` | Русский    |
| `zh` | 中文       |
| `pl` | Polski     |
| `uk` | Українська |
| `be` | Беларуская |
| `it` | Italiano   |
| `es` | Español    |
| `pt` | Português  |
| `fr` | Français   |

- Default language: **English**.
- If “System default” is selected, the app uses the system locale when it matches one of the above; otherwise it falls back to English.
- Language is saved in settings and applied to the tray menu, settings window, capture overlay, and history window.

---

## Project Structure

Source code and assets live in the repository; the `dist/` folder is generated by the build and is not committed.

```
simple-shot/
├── src/
│   └── main/
│       ├── main.ts           # App entry, tray, windows, IPC
│       ├── screen-capture.ts # Capture flow, watermark/compose, save/upload
│       ├── i18n.ts           # Translations and language resolution
│       ├── history.ts        # Local history of uploads/saves
│       ├── tray.ts
│       ├── ssh-handler.ts    # SSH/SFTP setup
│       └── uploaders/
│           ├── ssh-uploader.ts
│           ├── ftp-uploader.ts
│           └── s3-uploader.ts
├── renderer/                 # Renderer HTML (copied to dist/renderer on build)
│   ├── capture-window.html   # Capture overlay + annotations
│   ├── settings.html         # Settings form
│   └── history.html         # Link history list
├── assets/                   # App icons (copied to dist/main/assets on build)
│   ├── icon.png              # Tray icon
│   ├── icon.ico              # Windows app/installer icon
│   └── README.md
├── scripts/
│   └── copy-build-assets.js # Copies renderer + assets → dist
├── dist/                     # Generated by build (gitignored)
│   ├── main/                 # Compiled JS + assets
│   └── renderer/             # HTML from renderer/
├── package.json
├── tsconfig.json
├── README.md
└── LICENSE
```

---

## Building

```bash
# One-off build
npm run build

# Run app (builds if needed)
npm start

# Development with auto-rebuild
npm run dev
```

The main process is TypeScript (`src/main/*.ts`) and compiles to `dist/main/`. The build also copies `renderer/*.html` to `dist/renderer/` and `assets/*` to `dist/main/assets/` (see `scripts/copy-build-assets.js`). Ensure `dist/main/main.js` exists before running (e.g. after `npm run build`).

---

## Building the Windows installer

To build an installable Windows application (`.exe` installer and unpacked app), use [electron-builder](https://www.electron.build/). Builds must be run on **Windows**.

**Prerequisites**

- Windows (required for creating the Windows installer)
- Dependencies installed: `npm install` (includes `electron-builder`)

**Build steps**

```bash
# 1. Install dependencies (if not already done)
npm install

# 2. Build the installer and portable app
npm run dist
```

This runs `npm run build` (compiles TypeScript) and then `electron-builder --win`. Output is written to the **`release/`** folder:

| File / folder | Description |
|---------------|-------------|
| **Simple Shot Setup 1.0.0.exe** | NSIS installer — run to install the app (choose installation directory, add Start Menu and optional desktop shortcut). |
| **win-unpacked/** | Unpacked application — run `Simple Shot.exe` inside this folder for a portable run without installing. |

**Icons**

Place `icon.png` (tray) and `icon.ico` (Windows app/installer) in the **`assets/`** folder in the project root. The build copies them to `dist/main/assets/`. If you only have a PNG, create a multi-size `.ico` (e.g. 16×16, 32×32, 48×48, 256×256) for the installer.

**Icon not updating after rebuild?** Do a clean build: remove the `release/` and `dist/` folders, then run `npm run dist`. Windows caches icons: if the exe/taskbar still shows the old icon, clear the cache (e.g. delete `%LocalAppData%\IconCache.db`, then restart Explorer or reboot).

---

## Contributing

Contributions are welcome. Please open an issue first to discuss larger changes, and ensure the project builds and runs with `npm run build` and `npm start`.

---

## License

This project is licensed under the **MIT License**. See [LICENSE](LICENSE) for the full text.

Copyright © 2025 Aliaksei Prybytkou
