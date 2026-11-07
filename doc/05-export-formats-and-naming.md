# 05 — Шаблоны имён, формат/качество, режим «только в буфер»

## Цель

Уйти от жёсткого `screenshot-${Date.now()}.png`: настраиваемые имена файлов, PNG/JPG/WebP с качеством и режим экспорта **только в буфер обмена** (без save dialog и без upload).

## Текущее состояние

- Настройки `export` (plaintext): template, format, jpeg/webp quality, defaultDestination.
- `src/main/export-encode.ts` — renderFileName + encodeImage (PNG / JPEG / WebP via Electron или sharp).
- Save / upload / clipboard в `screen-capture.ts`; toolbar Copy → clipboard image.
- Uploaders: MIME для API/S3; SSH/FTP с корректным расширением в имени.
- Settings → Export: template + live preview, format, quality, destination.

## 1. Шаблоны имён файлов

### Настройка

```ts
export?: {
  fileNameTemplate: string; // default: "screenshot-{yyyy}-{MM}-{dd}_{HH}-{mm}-{ss}"
  format: 'png' | 'jpg' | 'webp';
  jpegQuality: number;      // 1–100, default 92
  webpQuality: number;      // 1–100, default 90
  defaultDestination: 'upload' | 'file' | 'clipboard';
};
```

### Плейсхолдеры

| Токен | Значение |
|-------|----------|
| `{yyyy}` `{yy}` `{MM}` `{dd}` `{HH}` `{mm}` `{ss}` | Дата/время локальные |
| `{timestamp}` | `Date.now()` |
| `{uuid}` | короткий uuid (10 hex) |
| `{width}` `{height}` | размер итогового кадра |
| `{format}` | `png` / `jpg` / `webp` |
| `{profile}` | имя активного upload-профиля (sanitized) |
| `{mode}` | `region` / `fullscreen` / `window` |

Расширение всегда из `format`, не из шаблона (дубль в шаблоне снимается).

### Санитизация

- Заменить `\ / : * ? " < > |` и управляющие символы на `_`.
- Stem ≤ 120 символов.
- Пустой результат → `screenshot-{timestamp}.{format}`.

### UI

Settings → Export: template + live preview, format, quality (disabled для PNG), default destination.

## 2. Форматы и качество

После compose (annotations + watermark):

```
PNG buffer → encode(format, quality) → Buffer + Content-Type + fileName
```

JPG: белый фон под альфой. Clipboard: lossless `writeImage` из PNG bitmap.

## 3. Режим «только в буфер»

Toolbar Copy / destination `clipboard`: `clipboard.writeImage`, без dialog/upload; history `{ method: 'Clipboard', urlOrPath: '' }`; feedback Copied.

## Acceptance criteria

- [x] Шаблон из настроек применяется к save и upload.
- [x] Preview в Settings совпадает с реальным именем (с точностью до секунды / mock preview).
- [x] PNG / JPG / WebP сохраняются и загружаются с верным MIME и расширением.
- [x] JPG quality влияет на размер файла.
- [x] Clipboard-only: изображение в буфере; файл/upload не создаются.
- [x] Миграция: отсутствие `export` → дефолты (png + шаблон с датой).
- [x] i18n + README Configuration.

## Вне scope

- HEIC, AVIF.
- Отдельный шаблон пути remote (`destinationPath` остаётся в профиле).
- Пакетная конвертация истории.
- Thumbnails в history (см. [06](06-history-thumbnails-reedit.md)).
