/**
 * Global hotkeys via Electron globalShortcut.
 * Handlers are injected from main.ts to avoid circular imports.
 */
import { globalShortcut, BrowserWindow, app } from 'electron';
import {
  defaultHotkeys,
  getHotkeys,
  saveHotkeys,
  setHotkeySetting,
  normalizeHotkeys,
  loadAppSettings
} from './settings-store';
import { resolveLanguage, getTranslations } from './i18n';
import { showAppNotification } from './app-notify';

export type HotkeyActionId =
  | 'capture.region'
  | 'capture.fullscreen'
  | 'capture.window'
  | 'capture.delayed'
  | 'history.open'
  | 'settings.open';

export interface HotkeyActionMeta {
  id: HotkeyActionId;
  /** False = shown in UI as soon / not registered yet */
  enabled: boolean;
}

export const HOTKEY_ACTIONS: HotkeyActionMeta[] = [
  { id: 'capture.region', enabled: true },
  { id: 'capture.fullscreen', enabled: true },
  { id: 'capture.window', enabled: true },
  { id: 'capture.delayed', enabled: true },
  { id: 'history.open', enabled: true },
  { id: 'settings.open', enabled: true }
];

export type HotkeyHandlers = Partial<Record<HotkeyActionId, () => void>>;

let handlers: HotkeyHandlers = {};
let settingsWindowGetter: (() => BrowserWindow | null) | null = null;

export function setHotkeyHandlers(h: HotkeyHandlers): void {
  handlers = { ...handlers, ...h };
}

export function setHotkeySettingsWindowGetter(getter: () => BrowserWindow | null): void {
  settingsWindowGetter = getter;
}

function getLang(): string {
  const settings = loadAppSettings();
  return resolveLanguage(settings.language || 'system', app.getLocale());
}

function notifyUnavailable(actionId: string): void {
  const t = getTranslations(getLang() as any);
  showAppNotification({
    title: t.notify_hotkeyUnavailableTitle || 'Hotkey unavailable',
    body: (t.notify_hotkeyUnavailableBody || 'Could not register hotkey for {action}').replace(
      '{action}',
      actionId
    )
  });
}

function emitTestResult(payload: { actionId: string; ok: boolean; error?: string }): void {
  const win = settingsWindowGetter?.();
  if (win && !win.isDestroyed()) {
    win.webContents.send('hotkeys-test-result', payload);
  }
}

function isEnabled(actionId: string): boolean {
  return HOTKEY_ACTIONS.some((a) => a.id === actionId && a.enabled);
}

function runAction(actionId: HotkeyActionId): void {
  const fn = handlers[actionId];
  if (fn) fn();
}

/** Unregister all global shortcuts. */
export function unregisterAll(): void {
  try {
    globalShortcut.unregisterAll();
  } catch (e) {
    console.error('[hotkeys] unregisterAll', e);
  }
}

/**
 * Re-register all enabled hotkeys from settings.
 * Returns per-action results; failed slots stay unregistered but values remain in settings.
 */
export function registerAllHotkeys(): { actionId: string; ok: boolean; error?: string }[] {
  unregisterAll();
  const map = getHotkeys();
  const results: { actionId: string; ok: boolean; error?: string }[] = [];

  for (const meta of HOTKEY_ACTIONS) {
    if (!meta.enabled) continue;
    const accel = (map[meta.id] || '').trim();
    if (!accel) {
      results.push({ actionId: meta.id, ok: true });
      continue;
    }
    try {
      const ok = globalShortcut.register(accel, () => runAction(meta.id));
      if (!ok) {
        console.warn('[hotkeys] register failed:', meta.id, accel);
        results.push({ actionId: meta.id, ok: false, error: 'unavailable' });
        notifyUnavailable(meta.id);
        emitTestResult({ actionId: meta.id, ok: false, error: 'unavailable' });
      } else {
        results.push({ actionId: meta.id, ok: true });
      }
    } catch (e) {
      console.error('[hotkeys] register error:', meta.id, e);
      results.push({ actionId: meta.id, ok: false, error: 'invalid' });
      notifyUnavailable(meta.id);
      emitTestResult({ actionId: meta.id, ok: false, error: 'invalid' });
    }
  }
  return results;
}

export function getHotkeysPayload(): {
  current: Record<string, string>;
  defaults: Record<string, string>;
  actions: HotkeyActionMeta[];
} {
  return {
    current: getHotkeys(),
    defaults: defaultHotkeys(),
    actions: HOTKEY_ACTIONS.map((a) => ({ ...a }))
  };
}

/**
 * Set or clear one hotkey. On register failure, previous value is kept.
 * null / empty clears the slot.
 */
export function setHotkey(
  actionId: string,
  accelerator: string | null
): { ok: boolean; error?: string; current: Record<string, string> } {
  if (!HOTKEY_ACTIONS.some((a) => a.id === actionId)) {
    return { ok: false, error: 'unknown_action', current: getHotkeys() };
  }
  if (!isEnabled(actionId)) {
    return { ok: false, error: 'disabled', current: getHotkeys() };
  }

  const prev = getHotkeys();
  const nextAccel = accelerator && accelerator.trim() ? accelerator.trim() : '';

  // Clear: unregister all and re-register without this slot
  if (!nextAccel) {
    setHotkeySetting(actionId, null);
    registerAllHotkeys();
    emitTestResult({ actionId, ok: true });
    return { ok: true, current: getHotkeys() };
  }

  // Conflict with another action in our map
  for (const [otherId, otherAccel] of Object.entries(prev)) {
    if (otherId !== actionId && otherAccel === nextAccel && isEnabled(otherId)) {
      emitTestResult({ actionId, ok: false, error: 'conflict' });
      notifyUnavailable(actionId);
      return { ok: false, error: 'conflict', current: prev };
    }
  }

  // Try register in isolation first
  unregisterAll();
  let registered = false;
  try {
    registered = globalShortcut.register(nextAccel, () => runAction(actionId as HotkeyActionId));
  } catch {
    registered = false;
  }

  if (!registered) {
    // Restore previous registrations; do not persist new value
    registerAllHotkeys();
    emitTestResult({ actionId, ok: false, error: 'unavailable' });
    notifyUnavailable(actionId);
    return { ok: false, error: 'unavailable', current: prev };
  }

  setHotkeySetting(actionId, nextAccel);
  registerAllHotkeys();
  emitTestResult({ actionId, ok: true });
  return { ok: true, current: getHotkeys() };
}

/** Reset all hotkeys to defaults and re-register. */
export function resetHotkeysToDefaults(): {
  ok: boolean;
  current: Record<string, string>;
  results: { actionId: string; ok: boolean; error?: string }[];
} {
  const defaults = defaultHotkeys();
  saveHotkeys(normalizeHotkeys(defaults));
  const results = registerAllHotkeys();
  return { ok: true, current: getHotkeys(), results };
}
