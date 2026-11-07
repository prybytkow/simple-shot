/**
 * Preload bridge: renderer gets only whitelisted IPC + helpers (no Node).
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron';

const INVOKE = new Set([
  'get-settings',
  'get-translations',
  'save-settings',
  'export-preview-filename',
  'create-empty-profile',
  'set-active-profile',
  'vault-status',
  'vault-unlock',
  'vault-setup',
  'vault-change-password',
  'vault-lock',
  'vault-reset',
  'show-vault-window',
  'close-unlock-window',
  'get-history',
  'history-delete',
  'history-reedit',
  'history-reveal',
  'history-open',
  'hotkeys-get',
  'hotkeys-set',
  'hotkeys-reset',
  'pick-upload-files',
  'upload-files',
  'stat-upload-paths',
  'updater-check',
  'updater-status',
  'updater-install'
]);

const SEND = new Set([
  'copy-text',
  'countdown-cancel',
  'countdown-done',
  'pick-display',
  'window-picked',
  'window-picker-cancel',
  'activate-single-window',
  'close-all-windows',
  'capture-area',
  'fixed-capture-area',
  'watermark-done',
  'watermark-error',
  'compose-image-done',
  'compose-image-error',
  'upload-feedback-close',
  'upload-feedback-open'
]);

const ON = new Set([
  'apply-watermark',
  'compose-image',
  'load-fixed-image',
  'upload-complete',
  'upload-feedback-state',
  'upload-files-progress',
  'window-sources',
  'hotkeys-test-result',
  'vault-updated'
]);

function assertChannel(kind: 'invoke' | 'send' | 'on', channel: string, allowed: Set<string>): void {
  if (!allowed.has(channel)) {
    throw new Error(`Blocked IPC ${kind}: ${channel}`);
  }
}

contextBridge.exposeInMainWorld('simpleShot', {
  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    assertChannel('invoke', channel, INVOKE);
    return ipcRenderer.invoke(channel, ...args);
  },
  send(channel: string, ...args: unknown[]): void {
    assertChannel('send', channel, SEND);
    ipcRenderer.send(channel, ...args);
  },
  on(channel: string, listener: (...args: unknown[]) => void): () => void {
    assertChannel('on', channel, ON);
    const wrapped = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  /** Absolute path for a File from drag-and-drop (Electron 32+). */
  getPathForFile(file: File): string {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch {
      return '';
    }
  },
  basename(filePath: string): string {
    const s = String(filePath || '');
    const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    return i >= 0 ? s.slice(i + 1) : s;
  }
});
