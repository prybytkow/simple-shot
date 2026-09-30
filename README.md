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
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="Platform"/>
</p>

<p align="center">
  Capture regions, annotate, add watermarks — save locally or upload via <strong>SFTP</strong>, <strong>FTP</strong>, <strong>S3</strong>, or <strong>HTTP API</strong> (API key).<br/>
  Runs in the system tray. Multi-monitor, 10 languages.
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
- [Windows Installer](#-windows-installer)
- [Contributing](#-contributing)
- [License](#-license)

---

## ✨ Features

<table>
<tr>
<td width="50%">

### 📸 Screen capture

- **Multi-display** — Overlay on each monitor; pick a screen and drag to select
- **Aspect-ratio crop** — 3:2, 2:3, 4:3, 3:4, 1:1, 16:9 or free
- **Resize & move** — Handles and drag to adjust the selection

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

- **Save to file** — PNG via save dialog; path to clipboard
- **Upload** — URL to clipboard
- **SSH (SFTP)** — Host, port, user, password or key, path
- **FTP / FTPS** — With optional TLS
- **Amazon S3** — Bucket, region, optional custom endpoint
- **HTTP API** — Upload endpoint + API key (`X-API-Key` / Bearer)

### 🏷️ Watermark

- Optional text on every export
- Position, font size, color, opacity

### 🔗 Other

- **Link history** — Recent uploads/saves; click to copy
- **System tray** — Left-click capture, right-click menu
- **Settings** — Stored in user data

</td>
</tr>
</table>

---

## 📷 Screenshots

| Capture overlay | Settings |
|-----------------|----------|
| *Overlay on each display; drag to select, toolbar for crop and annotations.* | *Language, save method (SSH/FTP/S3/HTTP API), base URL, watermark.* |

> After starting capture from the tray, overlay windows appear on each display. Drag to select a region; use the toolbar to crop, annotate, then save to file or upload to server.

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

1. **Start** — Click the tray icon or choose *Capture* from the tray menu.
2. **Select** — Click and drag on the desired screen to define the region; resize with handles if needed.
3. **Annotate** (optional) — Use the toolbar: crop, shapes, text, arrows, brush, blur; set format.
4. **Export** — *Save to file* (PNG, path to clipboard) or *Upload to server* (URL to clipboard).
5. **History** — Tray → *Link History* to see recent uploads/saves and copy links.

| Shortcut | Action |
|----------|--------|
| **ESC** | Cancel capture and hide overlay |

---

## ⚙️ Configuration

All settings: **Tray → Settings**. Stored in user data (e.g. `%APPDATA%\simple-shot` on Windows).

| Section | Description |
|---------|-------------|
| **Upload profiles** | Named configs (SSH/FTP/S3/API); optional “Show in tray”; one active profile |
| **Master password vault** | Secrets encrypted with scrypt + AES-256-GCM (portable Win/macOS/Linux) |
| **Base URL** | Per-profile prefix for uploaded file links |
| **Watermark** | Enable, text, position, font size, color, opacity (0–1) |
| **Language** | Interface language or *System default* |
| **After upload** | Overlay toast / system notification / link window |

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
- Language is saved and applied to tray, settings, capture overlay, and history.

---

## 📁 Project Structure

Source and assets are in the repo; `dist/` is generated by the build (gitignored).

```
simple-shot/
├── src/main/              # Main process (TypeScript)
│   ├── main.ts            # Entry, tray, windows, IPC
│   ├── settings-store.ts  # Profiles + vault persistence
│   ├── vault-crypto.ts    # scrypt + AES-256-GCM (cross-platform)
│   ├── screen-capture.ts  # Capture, watermark, save/upload
│   ├── i18n.ts            # Translations
│   ├── history.ts         # Upload/save history
│   ├── ssh-handler.ts     # SSH/SFTP
│   └── uploaders/         # SSH, FTP, S3, HTTP API uploaders
├── renderer/              # HTML UIs → dist/renderer
│   ├── capture-window.html
│   ├── settings.html
│   ├── unlock.html        # Master password unlock/setup
│   └── history.html
├── assets/                # Icons → dist/main/assets
│   ├── icon.png
│   └── icon.ico
├── scripts/
│   └── copy-build-assets.js
├── package.json
├── tsconfig.json
└── LICENSE
```

---

## 🔨 Building

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript, copy renderer + assets to `dist/` |
| `npm start` | Build (if needed) and run the app |
| `npm run dev` | Watch mode: rebuild and restart on change |

Build output: `dist/main/` (JS + assets), `dist/renderer/` (HTML).

---

## 📦 Windows Installer

Build an installable Windows app (NSIS `.exe` and portable) with [electron-builder](https://www.electron.build/). Run on **Windows**.

```bash
npm install
npm run dist
```

Output in **`release/`**:

| Output | Description |
|--------|-------------|
| **Simple Shot Setup 1.0.0.exe** | NSIS installer — choose directory, Start Menu, desktop shortcut |
| **win-unpacked/** | Portable — run `Simple Shot.exe` without installing |

**Icons:** Put `icon.png` and `icon.ico` in `assets/`. They are copied to `dist/main/assets/` on build. Use a multi-size `.ico` (16×16, 32×32, 48×48, 256×256) for best results.

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

**Copyright © 2025 Aliaksei Prybytkou**
