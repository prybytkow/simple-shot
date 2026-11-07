# 07 — Drag-and-drop загрузка любых файлов

## Цель

Позволить загружать на активный upload-профиль **произвольные файлы** (не только скриншоты приложения) через drag-and-drop — аналог «share via Simple Shot».

## Текущее состояние

- Upload pipeline заточен под screenshot `Buffer` + generated `fileName` PNG.
- Uploaders: `uploadFile(fileBuffer, fileName, settings)` — уже достаточно универсальны по buffer.
- API uploader шлёт multipart field `image` с `image/png` — нужно обобщить MIME/имя.
- DnD в UI используется для **перемещения selection/toolbar**, не для файлов с диска.
- Нет drop-zone окна / tray drop target.

## Сценарии использования

1. Пользователь перетаскивает файл(ы) на окно Simple Shot / drop-zone.
2. (Опционально) перетаскивает на иконку в Dock/taskbar — платформенно ограничено; не MVP.
3. Tray menu → **Upload files…** → system open dialog (тот же pipeline без DnD).

## UX

### Drop target

Отдельное небольшое окно или зона в History/Settings:

- **Рекомендация MVP:** окно **Upload** / расширение History: «Drop files here to upload».
- Всегда доступно из Tray → Upload files… (открывает drop window + можно сразу dialog).
- Визуально: пунктирная область, список очереди файлов, активный профиль, кнопки Upload / Cancel.

### Поведение при drop

1. Принять один или несколько файлов (`event.dataTransfer.files`).
2. Показать очередь: имя, размер, MIME/icon.
3. Опционально: для изображений — миниатюра; **не** открывать annotation editor автоматически (это не capture).
4. Кнопка Upload → последовательная или параллельная (limit 2) загрузка через активный профиль.
5. Успех: URL в clipboard **для последнего** файла (или всех через history); toast/notification как после screenshot.
6. Ошибка одного файла не отменяет остальные; показать статус per-file.

### Ограничения

| Правило | Значение (настраиваемо later) |
|---------|--------------------------------|
| Max files per drop | 20 |
| Max size per file | 100 MB (предупреждение выше) |
| Типы | **любые**; blocklist только по желанию (`.exe` на upload server — ответственность пользователя) |
| Папки | MVP: игнор или отказ с сообщением «folders not supported»; later — flatten |

### Vault

Если vault locked — тот же `ensureVaultUnlockedForUpload` перед стартом очереди.

### Имена на сервере

- Сохранять **оригинальное имя файла** (sanitized), не `screenshot-…`.
- При коллизии: суффикс `-{timestamp}` или `-{n}` перед расширением.
- Шаблоны из [05](05-export-formats-and-naming.md) для DnD **не обязательны**; опция «Apply naming template to uploads» — later. MVP: original name.

## Техника

### Main process

Новый модуль или расширение `screen-capture.ts` → лучше `src/main/file-upload.ts`:

```ts
async function uploadUserFile(
  filePath: string,
  settings: RuntimeUploadSettings
): Promise<{ url: string; fileName: string }>
```

- Читать файл с диска в main (`fs.readFile`) — пути только из dialog/DnD после user gesture.
- Определить MIME по extension / `mime` map.
- Вызвать существующие uploaders с обобщённым Content-Type.
- `addToHistory({ method, urlOrPath, fileName, source: 'drop', thumbPath? })`.

### Renderer DnD

В Electron с `nodeIntegration: true` drop на BrowserWindow:

- `ondragover` / `ondrop`, `e.preventDefault()`.
- Передать в main список `path` через IPC (`file.path` в Electron).

Не читать содержимое файла в renderer для upload — только path metadata.

### IPC

| Канал | Payload |
|-------|---------|
| `upload-files` | `{ paths: string[] }` |
| `upload-files-progress` | `{ path, status, url?, error?, index, total }` |
| `upload-files-done` | summary |
| `show-upload-window` | — |

### API / S3 / FTP / SSH

| Uploader | Изменение |
|----------|-----------|
| SSH/FTP | Без изменений логики path; binary stream как сейчас |
| S3 | `ContentType` из MIME map; key = fileName |
| API | multipart: предпочтительно field `file` **или** сохранить `image` + корректный filename/MIME для совместимости; документировать breaking change если сервер жёстко ждёт PNG |

Рекомендация: отправлять `file` + fallback/dual field если нужна обратная совместимость с текущим backend пользователя.

## Связь с другими фичами

- История с thumbs: для image/* сгенерировать thumb ([06](06-history-thumbnails-reedit.md)); для прочих — иконка типа файла.
- Clipboard-only к DnD не применяется (это upload/share flow).
- Re-edit только если файл — изображение и сохранён в history-media.

## Acceptance criteria

- [x] Tray → Upload files / drop window принимает произвольный файл и загружает на активный профиль.
- [x] URL копируется; запись появляется в истории.
- [x] Несколько файлов обрабатываются с per-file статусом.
- [x] Locked vault блокирует upload с unlock prompt.
- [x] Не-image файлы (pdf, zip, txt) успешно уходят по SSH/FTP/S3 (при валидных credentials).
- [x] i18n; README Features дополнен пунктом Drag-and-drop upload.

## Вне scope

- Редактирование dropped изображений перед upload (можно later = «Open in editor»).
- Drop на system tray icon (Windows-specific hacks).
- Торренты / URL-drop (скачать по ссылке).
- Синхронизация папок.
