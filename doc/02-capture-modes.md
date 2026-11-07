# 02 — Режимы захвата: экран, окно, отложенный таймер

## Цель

Расширить единственный режим «выделение области» до трёх способов захвата плюс отложенный старт с обратным отсчётом.

## Текущее состояние

- `setupScreenCapture()` создаёт fullscreen overlay на каждом дисплее.
- Пользователь тянет selection → annotate → Save / Upload / Copy.
- Захват буфера: GDI (Windows), `desktopCapturer` / Linux helpers; всегда crop по `areaData`.
- Нет выбора «весь экран» / «окно» / countdown.

## Режимы

### 1. Region (существующий)

Без изменений UX: overlay → drag → toolbar.

### 2. Fullscreen (весь экран / монитор)

**Поведение:**

1. Пользователь выбирает режим Fullscreen (tray submenu / хоткей / settings default).
2. Если мониторов > 1:
   - **Вариант A (рекомендуемый):** краткий picker — клик по монитору (лёгкий overlay с номером/рамкой), затем мгновенный захват этого дисплея целиком.
   - **Вариант B:** сразу primary display.
3. После захвата открыть тот же annotation flow, что и для region (selection = весь кадр; resize handles опционально можно скрыть или оставить).
4. Watermark / upload / save — без изменений pipeline.

**Техника:** переиспользовать `captureScreenshot` с `area` = bounds выбранного display (в physical pixels), без drag-selection.

### 3. Window (конкретное окно)

**Поведение:**

1. Режим Window → скрыть/не показывать region overlay.
2. Показать список окон через `desktopCapturer.getSources({ types: ['window'] })` (и/или нативный picker на платформе).
3. UI: окно-пикер с миниатюрами thumbnails источников; клик → захват этого окна.
4. Дальше — annotation overlay на полученном изображении (не обязательно поверх реального окна): отдельное окно редактора размера image, либо fullscreen dimmed с центрированным canvas.

**Ограничения:**

| Платформа | Заметки |
|-----------|---------|
| Windows | `desktopCapturer` + при необходимости GDI для consistency |
| macOS | Screen Recording permission; окна других apps могут быть пустыми без permission |
| Linux/Wayland | Ограниченная поддержка window capture; fallback: message + предложить region/fullscreen |

Если источник недоступен — ошибка с i18n, без краша.

### 4. Delayed capture (таймер)

**Поведение:**

1. Пользователь задаёт задержку **N секунд** (настройки + опционально quick-picker 3 / 5 / 10).
2. Выбирает базовый режим: region | fullscreen | window (по умолчанию — last used / settings).
3. Старт:
   - Overlay/tray tooltip / compact always-on-top countdown: `3… 2… 1…`.
   - По желанию: звуковой tick (off by default).
4. По истечении таймера — обычный flow выбранного режима.
5. **Cancel:** ESC или клик по countdown → отмена, без захвата.
6. На время countdown приложение не должно захватывать сам countdown UI (скрыть перед кадром, как overlays сейчас через `hideOverlaysForCapture`).

**Настройки:**

```ts
capture?: {
  defaultMode: 'region' | 'fullscreen' | 'window';
  delaySeconds: number;      // 0 = без задержки; default 3
  lastDisplayId?: number;
  lastWindowId?: string;
};
```

## Точки входа UI

| Место | Содержание |
|-------|------------|
| Tray | Подменю Capture: Region / Full screen / Window / Delayed… |
| Hotkeys | См. [01](01-global-hotkeys.md) |
| Settings | Default mode, default delay |
| Capture overlay | Опционально: не менять toolbar region-режима |

## Изменения в коде (ориентир)

| Файл | Изменение |
|------|-----------|
| `screen-capture.ts` | `setupScreenCapture(options?: { mode, delaySeconds })`; ветки fullscreen/window; countdown helper |
| `main.ts` (tray menu) | Подменю Capture |
| `capture-window.html` | Поддержка «фиксированного» кадра (fullscreen/window) без обязательного drag |
| `settings-store.ts` | Поля `capture.*` |
| Новый `window-picker.html` (опц.) | Список окон с thumbnails |

## Pipeline после захвата

Единый: buffer → (optional annotations/watermark compose) → save / upload / clipboard-only ([05](05-export-formats-and-naming.md)).

Режимы отличаются **только источником кадра**, не экспортом.

## Acceptance criteria

- [ ] Region работает как сейчас.
- [ ] Fullscreen даёт целый монитор без ручного выделения.
- [ ] Window: выбор окна → редактирование → export.
- [ ] Delayed: countdown, cancel по ESC, затем выбранный режим.
- [ ] Multi-monitor: fullscreen не путает дисплеи (корректный `displayId` / scaleFactor).
- [ ] Wayland/macOS permissions: понятные ошибки.
- [x] i18n для всех новых строк; README Usage обновлён.

## Вне scope

- Запись видео / GIF.
- Захват области «под курсором» без overlay.
- Автоповтор по расписанию.
