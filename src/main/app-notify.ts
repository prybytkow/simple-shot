/**
 * System notifications with Simple Shot branding (name + icon).
 * On Windows the toast header app name comes from AppUserModelId;
 * call configureAppIdentity() before app.whenReady().
 */
import { Notification, shell } from 'electron';
import * as fs from 'fs';
import { appIconPath, notificationIconPath } from './app-icon';

export type AppNotifyOptions = {
  title: string;
  body: string;
  /** Open this URL when the toast is clicked */
  openUrl?: string;
  onClick?: () => void;
  silent?: boolean;
};

/** Absolute path for Notification.icon (string paths are more reliable on Windows toasts). */
function resolveNotifyIcon(): string | undefined {
  const preferred = notificationIconPath();
  if (preferred) return preferred;
  const fallback = appIconPath();
  return fs.existsSync(fallback) ? fallback : undefined;
}

export function showAppNotification(opts: AppNotifyOptions): void {
  if (!Notification.isSupported()) return;
  try {
    const icon = resolveNotifyIcon();
    const n = new Notification({
      title: opts.title,
      body: opts.body,
      icon,
      silent: opts.silent === true
    });
    n.on('click', () => {
      if (opts.onClick) {
        opts.onClick();
        return;
      }
      if (opts.openUrl && /^https?:\/\//i.test(opts.openUrl)) {
        shell.openExternal(opts.openUrl).catch(() => {});
      }
    });
    n.show();
  } catch (e) {
    console.error('[notify] failed', e);
  }
}
