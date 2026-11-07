# 01 — Глобальные горячие клавиши

## Цель

Дать пользователю настраиваемые системные хоткеи для запуска захвата и связанных действий без открытия меню трея. Сейчас в README задокументирован только **ESC** (отмена оверлея).

## Текущее состояние

- Захват стартует из трея (`tray_capture` → `setupScreenCapture()`).
- В оверлее захвата: **ESC** скрывает окна / отменяет захват (локально в renderer).
- `globalShortcut` из Electron **не используется**.

## Требования

### Действия, привязываемые к хоткеям

| ID действия | Поведение | Примечание |
|-------------|-----------|------------|
| `capture.region` | Запуск текущего flow выделения области | Как клик по трею «Capture» |
| `capture.fullscreen` | Захват всего экрана (см. [02](02-capture-modes.md)) | После реализации режимов |
| `capture.window` | Захват окна (см. [02](02-capture-modes.md)) | После реализации режимов |
| `capture.delayed` | Отложенный захват с таймером (см. [02](02-capture-modes.md)) | Использует последний выбранный режим или region |
| `history.open` | Открыть окно истории | Как пункт трея |
| `settings.open` | Открыть настройки | Как пункт трея |

Минимальный MVP: `capture.region` + сохранение остальных слотов для следующих итераций (UI может показывать disabled/«скоро»).

### Дефолты (предложение)

| Действие | Windows / Linux | macOS |
|----------|-----------------|-------|
| `capture.region` | `Ctrl+Shift+S` | `Command+Shift+S` |
| `capture.fullscreen` | `Ctrl+Shift+A` | `Command+Shift+A` |
| `capture.window` | `Ctrl+Shift+W` | `Command+Shift+W` |
| `capture.delayed` | `Ctrl+Shift+D` | `Command+Shift+D` |
| `history.open` | *(пусто)* | *(пусто)* |
| `settings.open` | *(пусто)* | *(пусто)* |

Пустой слот = хоткей не зарегистрирован. ESC в оверлее остаётся локальным и **не** выносится в глобальные настройки.

### Настройки

В `AppSettings`:

```ts
hotkeys?: {
  [actionId: string]: string; // Accelerator Electron, напр. "CommandOrControl+Shift+S"
};
```

UI: секция **Settings → Hotkeys** — список действий, поле записи хоткея (кнопка «Record»), Clear, Reset to defaults.

### Регистрация

- Модуль `src/main/hotkeys.ts`: `registerAllHotkeys()`, `unregisterAll()`, `setHotkey(action, accelerator)`.
- Регистрация при `app.whenReady` и после сохранения настроек.
- При конфликте / `globalShortcut.register` → `false`: не падать; показать toast/notification «Hotkey unavailable» + оставить старое значение или пометить слот ошибкой в UI.
- На выходе из приложения — `globalShortcut.unregisterAll()`.
- Если vault locked и действие ведёт к upload — поведение как сейчас (unlock flow), хоткей всё равно открывает захват.

### Права ОС

| Платформа | Заметка |
|-----------|---------|
| macOS | Может потребоваться Accessibility для некоторых сценариев; документировать в README |
| Linux | Зависит от DE/Wayland; при отказе регистрации — понятное сообщение |
| Windows | Обычно работает без доп. прав |

### Конфликты с оверлеем

- Пока открыт capture overlay: глобальный хоткей повторного захвата игнорируется или отменяет текущий (выбрать одно поведение и зафиксировать: **рекомендация — ignore**).
- ESC только внутри overlay, не глобальный.

## IPC / API

| Канал | Направление | Payload |
|-------|-------------|---------|
| (internal) | main | hotkey → вызов существующего `setupScreenCapture` / open windows |
| `hotkeys-get` | renderer ↔ main | текущая карта + defaults |
| `hotkeys-set` | renderer → main | `{ actionId, accelerator \| null }` |
| `hotkeys-test-result` | main → settings | `{ actionId, ok, error? }` после попытки register |

## Acceptance criteria

- [ ] Пользователь может назначить/очистить хоткей для region capture в Settings.
- [ ] Хоткей работает при свёрнутом/скрытом UI (только tray).
- [ ] Невалидный/занятый accelerator не ломает приложение.
- [x] README: таблица хоткеев вместо одной строки про ESC; ESC описан отдельно как overlay shortcut.
- [ ] Все строки UI через i18n.

## Вне scope

- Хоткеи внутри annotation toolbar (кроме уже существующих UI-жестов).
- Глобальный «paste upload» (см. [07](07-drag-drop-upload.md) — отдельный entry point).
