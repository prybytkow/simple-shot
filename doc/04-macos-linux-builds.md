# 04 — Сборки macOS и Linux в релизах

## Цель

Публиковать установщики/пакеты не только для Windows. README заявляет platform Windows | macOS | Linux.

## Текущее состояние

- Скрипты: `dist` / `dist:win` (Win), `dist:mac`, `dist:linux`.
- `build.mac`: universal `dmg` + `zip`, `icon.icns`, hardenedRuntime, entitlements, `extendInfo` (Screen Recording / Accessibility strings).
- `build.linux`: AppImage + deb, иконки `build/icons/`.
- Иконки: `npm run icons` → `assets/icon.icns`, `assets/iconTemplate.png`, `build/icons/{size}x{size}.png`.
- CI: `.github/workflows/release.yml` на теги `v*` (windows / macos / linux); mac с `CSC_IDENTITY_AUTO_DISCOVERY=false`.
- Runtime: Darwin tray template via `app-icon.ts`; capture backends уже разведены (GDI / Linux portal / desktopCapturer).

Кросс-компиляция ограничена: **macOS-артефакты собираются на macOS** (подпись/нотаризация). Linux — на Linux CI. Windows — на Windows.

## Целевые артефакты

| Платформа | Формат (MVP) | Дополнительно (nice-to-have) |
|-----------|--------------|------------------------------|
| Windows | NSIS `.exe` x64 | portable (`win-unpacked`) |
| macOS | universal `.dmg` | zip для updater |
| Linux | AppImage x64 | `.deb` (включён) |

Архитектуры:

- Windows: `x64`.
- macOS: `universal`.
- Linux: `x64`.

## Конфиг electron-builder

См. `package.json` → `build.mac` / `build.linux` / `build.dmg`. Черновик совпадает с реализацией (icon.icns, AppImage+deb, entitlements).

Скрипты:

| Script | Команда |
|--------|---------|
| `dist` | Windows (совместимость) |
| `dist:win` | `electron-builder --win` |
| `dist:mac` | `electron-builder --mac` |
| `dist:linux` | `electron-builder --linux` |
| CI | отдельные job'ы, не локальный `dist:all` |

## Ассеты

1. `npm run icons` из `assets/icon.png` → `.icns`, template, `build/icons`.
2. `copy-build-assets.js` копирует `assets/*` (кроме README) в `dist/main/assets/`.
3. `asarUnpack` для `koffi` — per-platform native bindings при `npm ci` на runner целевой ОС.

## Платформенные особенности приложения

| Область | Статус |
|---------|--------|
| Tray | macOS `iconTemplate.png` + `setTemplateImage(true)` |
| Screen capture | macOS Screen Recording prompt (`extendInfo`); Linux X11 vs Wayland |
| Paths | `app.getPath` |
| Auto-start | Не в MVP |
| Global shortcuts | См. [01](01-global-hotkeys.md) |

В Release notes / README: «Wayland window capture limited».

## CI matrix

Отдельные jobs (не единый matrix YAML): `windows-signed`, `macos-notarized`, `linux` → GitHub Release того же тега + `latest*.yml` для updater.

Связь с подписью: [03](03-auto-update-and-signing.md).

## Документация

README: секции Windows / macOS / Linux, таблица артефактов, ссылка на latest release, badge platform.

## Acceptance criteria

- [x] `dist:mac` на macOS даёт `.dmg` (+ zip для updater), universal.
- [x] `dist:linux` на Linux даёт AppImage и deb.
- [x] GitHub Release workflow публикует Win + Mac + Linux (или unsigned mac при отсутствии secrets).
- [ ] Приложение запускается на чистой VM каждой ОС: tray → capture region → save (ручной smoke после релиза).
- [x] Иконки: `.icns` / `build/icons` / tray template сгенерированы и подключены в конфиг.
- [x] README отражает реальные команды и артефакты.

## Вне scope

- Flatpak / Snap store публикация.
- Mac App Store.
- Поддержка Windows 7 / старых glibc.
