/**
 * Settings / profiles / translations IPC.
 */
import { app, ipcMain } from 'electron';
import {
  getSettingsForUi,
  saveFromUi,
  createEmptyProfile,
  setActiveProfile,
  UploadProfile
} from '../settings-store';
import { resolveLanguage, getTranslations } from '../i18n';
import { previewFileName } from '../export-encode';
import { refreshUpdaterSettings } from '../updater';

export interface SettingsIpcDeps {
  buildTrayMenu: () => void;
}

let registered = false;

export function registerSettingsIpc(deps: SettingsIpcDeps): void {
  if (registered) return;
  registered = true;

  ipcMain.handle('get-settings', () => getSettingsForUi());

  ipcMain.handle('get-translations', (_event, lang: string) => {
    return getTranslations(resolveLanguage(lang || 'system', app.getLocale()) as any);
  });

  ipcMain.handle('save-settings', (_event, payload: {
    language?: string;
    afterUploadFeedback?: 'overlay' | 'notification' | 'window';
    watermark?: any;
    capture?: { defaultMode?: 'region' | 'fullscreen' | 'window'; delaySeconds?: number };
    updates?: { autoCheck?: boolean; autoDownload?: boolean };
    export?: {
      fileNameTemplate?: string;
      format?: 'png' | 'jpg' | 'webp';
      jpegQuality?: number;
      webpQuality?: number;
      defaultDestination?: 'upload' | 'file' | 'clipboard';
    };
    activeProfileId?: string;
    profiles: UploadProfile[];
    secretsByProfile?: Record<string, any>;
  }) => {
    const result = saveFromUi({
      ...payload,
      capture: payload.capture
        ? {
            defaultMode:
              payload.capture.defaultMode === 'fullscreen' || payload.capture.defaultMode === 'window'
                ? payload.capture.defaultMode
                : 'region',
            delaySeconds:
              typeof payload.capture.delaySeconds === 'number' ? payload.capture.delaySeconds : 3
          }
        : undefined,
      updates: payload.updates
        ? {
            autoCheck: payload.updates.autoCheck !== false,
            autoDownload: payload.updates.autoDownload !== false
          }
        : undefined,
      export: payload.export
        ? {
            fileNameTemplate:
              typeof payload.export.fileNameTemplate === 'string' && payload.export.fileNameTemplate.trim()
                ? payload.export.fileNameTemplate.trim()
                : 'screenshot-{yyyy}-{MM}-{dd}_{HH}-{mm}-{ss}',
            format:
              payload.export.format === 'jpg' || payload.export.format === 'webp'
                ? payload.export.format
                : 'png',
            jpegQuality:
              typeof payload.export.jpegQuality === 'number' ? payload.export.jpegQuality : 92,
            webpQuality:
              typeof payload.export.webpQuality === 'number' ? payload.export.webpQuality : 90,
            defaultDestination:
              payload.export.defaultDestination === 'file' ||
              payload.export.defaultDestination === 'clipboard'
                ? payload.export.defaultDestination
                : 'upload'
          }
        : undefined
    });
    refreshUpdaterSettings();
    deps.buildTrayMenu();
    return result;
  });

  ipcMain.handle('export-preview-filename', (_e, payload: { template?: string; format?: string }) => {
    const format =
      payload?.format === 'jpg' || payload?.format === 'webp' ? payload.format : 'png';
    const template =
      typeof payload?.template === 'string' && payload.template.trim()
        ? payload.template.trim()
        : 'screenshot-{yyyy}-{MM}-{dd}_{HH}-{mm}-{ss}';
    return previewFileName(template, format);
  });

  ipcMain.handle('create-empty-profile', (_e, name?: string) => {
    return createEmptyProfile(name || 'New profile');
  });

  ipcMain.handle('set-active-profile', (_e, id: string) => {
    const ok = setActiveProfile(id);
    deps.buildTrayMenu();
    return { success: ok };
  });
}
