# 06 — История: миниатюры, поиск, повторное редактирование

## Цель

Превратить «Link History» из текстового списка URL в полноценную историю снимков: превью, поиск/фильтры и повторное открытие кадра в annotation UI.

## Текущее состояние

- `history.ts` v2 + `userData/history-media/` (`{id}.thumb.jpg`, `{id}.png`).
- UI `history.html`: thumbs, search, method chips, Copy / Open / Reveal / Re-edit / Delete.
- IPC: `get-history`, `history-delete`, `history-reedit`, `history-reveal`, `history-open`.
- Re-edit → `openHistoryReedit` → fixed annotation UI; новый export → `source: 'reedit'`.
- Full frames: последние 30 в media; local save ссылается на `urlOrPath` без дубля.

## Модель данных (v2)

```ts
interface HistoryEntryV2 {
  id: string;
  method: 'ssh' | 'ftp' | 's3' | 'api' | 'local' | 'clipboard' | 'file';
  urlOrPath: string;
  date: string;
  fileName?: string;
  width?: number;
  height?: number;
  format?: 'png' | 'jpg' | 'webp';
  profileId?: string;
  profileName?: string;
  thumbPath?: string;
  imagePath?: string;
  source?: 'capture' | 'drop' | 'reedit';
  note?: string;
}
```

Миграция v1 → v2 при load. API `recordCaptureToHistory` готов и для DnD ([07](07-drag-drop-upload.md)).

## Acceptance criteria

- [x] После скриншота в истории видна миниатюра.
- [x] Search фильтрует список.
- [x] Re-edit открывает редактор при наличии файла; Save/Upload создаёт новую запись.
- [x] Старые `history.json` открываются без потери URL.
- [x] Удаление записи чистит media.
- [ ] DnD-файлы ([07](07-drag-drop-upload.md)) — через тот же `recordCaptureToHistory`, когда 07 реализован.

## Вне scope

- Полнотекстовый индекс, облачная синхронизация истории.
- Re-edit с восстановлением векторных слоёв.
- Скачивание remote изображения для re-edit.
