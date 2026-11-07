# 03 — Автообновление (electron-updater) и подпись установщика

## Цель

Безопасные обновления из GitHub Releases (или иного feed) и доверие ОС: **Authenticode** на Windows (снижение SmartScreen), **notarization** на macOS. Без подписи автообновление на проде не рекомендуется.

## Текущее состояние

- `electron-updater` + `src/main/updater.ts`; tray / Settings / IPC (`updater-check`, `updater-status`, `updater-install`).
- `package.json` → `publish.github` (`prybytkow/simple-shot`), `win.signingHashAlgorithms`, `mac` hardenedRuntime + entitlements, `linux` AppImage.
- CI: `.github/workflows/release.yml` на теги `v*` (Windows / macOS / Linux).
- Подпись: через env `CSC_*` / Apple notary secrets; без секретов — unsigned локальная сборка.

## Часть A — electron-updater

### Зависимости и конфиг

1. Добавить `electron-updater` в `dependencies`.
2. В `package.json` → `build`:

```json
"publish": [
  {
    "provider": "github",
    "owner": "<github-owner>",
    "repo": "simple-shot"
  }
]
```

3. Main: модуль `src/main/updater.ts`, вызов после `app.whenReady` (и при необходимости по таймеру / пункту меню).

### Поведение

| Событие | UX |
|---------|-----|
| Проверка при старте (через ~5–10 с после ready) | Тихо, без модалки если обновлений нет |
| Найдено обновление | Notification или tray badge + пункт «Update available…» |
| Скачивание | Progress в notification / маленькое окно |
| Готово | «Restart to update» — `quitAndInstall()` |
| Ошибка (сеть, подпись) | Лог + опционально notification; приложение продолжает работать |
| Ручная проверка | Tray → Check for updates |

Настройки:

```ts
updates?: {
  autoCheck: boolean;     // default true
  autoDownload: boolean;  // default true на Win/mac; false на Linux portable по необходимости
};
```

### Каналы

- Stable: теги `vX.Y.Z` / GitHub Release.
- Опционально later: `allowPrerelease` для beta (не в MVP).

### Безопасность

- Обновления только с подписанных артефактов (Win/mac).
- Linux: AppImage update через electron-updater при наличии `.yml` в релизе; deb/rpm — документировать «обновление через пакетный менеджер / новый файл», если auto-update ограничен.

### IPC

| Канал | Назначение |
|-------|------------|
| `updater-check` | Ручной check |
| `updater-status` | main → UI: idle / checking / available / downloading / ready / error |
| `updater-install` | quitAndInstall |

## Часть B — Подпись Windows (SmartScreen)

### Что нужно

1. **Code signing certificate** (OV или EV). EV быстрее набирает репутацию SmartScreen.
2. CI/локально: переменные electron-builder:

| Переменная | Назначение |
|------------|------------|
| `CSC_LINK` | `.pfx` / путь к сертификату (или base64) |
| `CSC_KEY_PASSWORD` | Пароль |
| или Azure / cloud HSM | По схеме вендора сертификата |

3. `win.certificateSubjectName` / `signingHashAlgorithms: ["sha256"]` при необходимости.
4. NSIS installer и `Simple Shot.exe` внутри должны быть подписаны (electron-builder делает при наличии CSC).

### SmartScreen

- Подпись **не гарантирует** отсутствие предупреждения сразу: нужна репутация (скачивания) или EV.
- Документировать в `doc`/README: «после подписи предупреждение может сохраняться первые релизы».
- Не хранить `.pfx` в git; только CI secrets.

### Проверка

```text
signtool verify /pa "Simple Shot Setup X.Y.Z.exe"
```

## Часть C — Подпись и notarization macOS

### Требования Apple

1. Apple Developer Program.
2. Developer ID Application (+ Installer при pkg).
3. App-specific password / API key для notarytool.
4. `electron-builder` + `notarize` (после sign):

Типичные env:

| Переменная | Назначение |
|------------|------------|
| `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | notarytool |
| или `APP_STORE_CONNECT_API_KEY*` | API key |
| `CSC_LINK` / `CSC_KEY_PASSWORD` | сертификат Developer ID |

5. Entitlements: `assets/entitlements.mac.plist` (camera/screen не нужны для screen capture через API, но Screen Recording — runtime permission пользователя).
6. `hardenedRuntime: true`, `gatekeeperAssess: false` на этапе build (стандарт electron-builder).

### После нотаризации

- Staple ticket к `.dmg` / `.app`.
- Проверка: `spctl --assess --type execute` / `xcrun stapler validate`.

## CI / релизный процесс (целевой)

1. Tag `v*` → GitHub Actions (или ручной `npm run dist:*` на нужной ОС).
2. Сборка + подпись на runner с secrets.
3. Upload артефактов + `latest.yml` / `latest-mac.yml` / `latest-linux.yml` для updater.
4. Changelog в Release body.

Отдельные job'ы: `windows-signed`, `macos-notarized`, `linux` (см. [04](04-macos-linux-builds.md)).

## Acceptance criteria

- [x] При наличии publish-конфига приложение проверяет обновления и предлагает перезапуск.
- [x] Tray: Check for updates + статус.
- [x] Windows Setup/exe подписаны при заданных `CSC_*`; без секретов — unsigned build для локальной разработки (как сейчас).
- [x] macOS: signed + notarized артефакт при наличии Apple secrets.
- [x] Секреты не в репозитории; README/docs описывают env для релиз-инженера.
- [x] Отказ сети/подписи не ломает захват.

## Вне scope

- Auto-update из произвольного HTTP без подписи.
- Mac App Store / Microsoft Store distribution.
- Delta-патчи вне того, что даёт electron-updater из коробки.
