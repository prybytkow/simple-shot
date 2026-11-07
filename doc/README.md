# Simple Shot — спецификации фич

Документы описывают целевое поведение фич поверх текущего приложения (Electron main + renderer, захват области, upload-профили, история ссылок).

| # | Документ | Статус в коде (базовая линия) |
|---|----------|-------------------------------|
| 01 | [Глобальные горячие клавиши](01-global-hotkeys.md) | Только ESC в оверлее захвата |
| 02 | [Режимы захвата и таймер](02-capture-modes.md) | Только выделение области (region) |
| 03 | [Автообновление и подпись](03-auto-update-and-signing.md) | Нет `electron-updater`, нет подписи |
| 04 | [Сборки macOS и Linux](04-macos-linux-builds.md) | `npm run dist` → только Windows NSIS |
| 05 | [Имена, форматы, буфер](05-export-formats-and-naming.md) | `screenshot-{ts}.png`, Save/Upload |
| 06 | [История: миниатюры, поиск, повторное редактирование](06-history-thumbnails-reedit.md) | Список URL/путей без превью |
| 07 | [Drag-and-drop любых файлов](07-drag-drop-upload.md) | Нет DnD-загрузки |

## Общие правила для реализации

- Логика файлов/сети/горячих клавиш — в **main process** (`src/main/`).
- UI-строки — через **i18n** (`src/main/i18n.ts` + `data-i18n`).
- Настройки — в `settings-store.ts` / Settings UI; секреты только в vault.
- IPC: явные каналы, typed payloads; renderer не получает credentials.
- Обратная совместимость: миграция `settings.json` / `history.json` без потери данных.
