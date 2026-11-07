import { clipboard, ipcMain, screen } from 'electron';
import { app } from 'electron';
import { resolveLanguage, getTranslations } from './i18n';
import {
  getRuntimeUploadSettings,
  loadAppSettings,
  CaptureMode
} from './settings-store';
import { ensureVaultUnlockedForUpload } from './vault-flow';
import {
  closeAllCaptureWindows,
  closeWindowPicker,
  getActiveWindow,
  getOverlayWindows,
  getPendingWatermark,
  getPendingFixedCapture,
  getLastFixedMode
} from './capture-session';
import { captureScreenshot } from './capture-platform';
import {
  resolveDestination,
  resolveCaptureSettings,
  replyUploadComplete,
  saveOrUploadScreenshot,
  asPngBuffer
} from './save-or-upload';
import {
  finishCountdown,
  runFullscreenCapture,
  runWindowCapture,
  handleActivateSingleWindow
} from './capture-windows';

let captureIpcRegistered = false;

export function registerCaptureIpc(): void {
  if (captureIpcRegistered) return;
  captureIpcRegistered = true;

  ipcMain.on('copy-text', (_event, text: string) => {
    if (typeof text === 'string' && text) clipboard.writeText(text);
  });

  ipcMain.on('countdown-cancel', () => finishCountdown(false));
  ipcMain.on('countdown-done', () => finishCountdown(true));

  ipcMain.on('pick-display', (_event, displayIdRaw: unknown) => {
    const displayId = typeof displayIdRaw === 'number' ? displayIdRaw : Number(displayIdRaw);
    if (!Number.isFinite(displayId)) return;
    closeAllCaptureWindows();
    void runFullscreenCapture(displayId);
  });

  ipcMain.on('window-picked', (_event, sourceId: unknown) => {
    if (typeof sourceId !== 'string' || !sourceId) return;
    void runWindowCapture(sourceId);
  });

  ipcMain.on('window-picker-cancel', () => {
    closeWindowPicker();
  });

  ipcMain.on('activate-single-window', (_event, screenId) => {
    handleActivateSingleWindow(screenId);
  });

  ipcMain.on('close-all-windows', () => {
    setTimeout(() => closeAllCaptureWindows(), 150);
  });

  ipcMain.on('capture-area', async (event, areaData) => {
    const destination = resolveDestination(areaData);
    const mode: CaptureMode = 'region';

    if (destination === 'upload') {
      const runtime = getRuntimeUploadSettings();
      if ('error' in runtime && runtime.error === 'locked') {
        ensureVaultUnlockedForUpload();
        const appS = loadAppSettings();
        const lang = resolveLanguage(appS.language || 'system', app.getLocale());
        const tr = getTranslations(lang);
        replyUploadComplete(event, {
          success: false,
          error: tr.vault_errLocked || 'Unlock the vault first',
          saveLocally: false,
          destination
        });
        return;
      }
    }

    const settings = resolveCaptureSettings(destination);
    const activeWindow = getActiveWindow();
    const overlayWindows = getOverlayWindows();

    try {
      let sourceDisplayId: number | undefined;
      if (activeWindow) {
        sourceDisplayId = (activeWindow as any).displayId;
        console.log(`Using active window display ID: ${sourceDisplayId}`);
      } else if (overlayWindows.length > 0) {
        sourceDisplayId = (overlayWindows[0] as any).displayId;
        console.log(`Using single window display ID: ${sourceDisplayId}`);
      } else {
        sourceDisplayId = screen.getPrimaryDisplay().id;
        console.log(`Using primary display ID: ${sourceDisplayId}`);
      }

      const screenshotBuffer = await captureScreenshot(areaData, sourceDisplayId);

      const watermarkEnabled =
        settings.watermark?.enabled && (settings.watermark?.text || '').trim() !== '';
      const hasAnnotations =
        areaData.annotations && Array.isArray(areaData.annotations) && areaData.annotations.length > 0;

      const pendingWatermark = getPendingWatermark();

      if (watermarkEnabled || hasAnnotations) {
        pendingWatermark.set(event.sender.id, { destination, mode, settings });
        if (hasAnnotations) {
          event.reply('compose-image', {
            pngBuffer: screenshotBuffer,
            annotations: areaData.annotations,
            watermark: watermarkEnabled ? settings.watermark : null
          });
        } else {
          event.reply('apply-watermark', { pngBuffer: screenshotBuffer, watermark: settings.watermark });
        }
        return;
      }

      await saveOrUploadScreenshot(event, screenshotBuffer, destination, mode, settings);
    } catch (error) {
      console.error('Upload failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      replyUploadComplete(
        event,
        {
          success: false,
          error: errorMessage,
          saveLocally: destination === 'file',
          destination
        },
        settings
      );
    }
  });

  ipcMain.on('watermark-done', async (event, pngPayload: Buffer | Uint8Array | ArrayBuffer) => {
    const pendingWatermark = getPendingWatermark();
    const pending = pendingWatermark.get(event.sender.id);
    pendingWatermark.delete(event.sender.id);
    if (!pending) return;
    try {
      const buffer = asPngBuffer(pngPayload);
      await saveOrUploadScreenshot(event, buffer, pending.destination, pending.mode, pending.settings);
    } catch (error) {
      console.error('Watermark save failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      replyUploadComplete(
        event,
        {
          success: false,
          error: errorMessage,
          saveLocally: pending.destination === 'file',
          destination: pending.destination
        },
        pending.settings
      );
    }
  });

  ipcMain.on('watermark-error', (event, errorMessage: string) => {
    const pendingWatermark = getPendingWatermark();
    const pending = pendingWatermark.get(event.sender.id);
    pendingWatermark.delete(event.sender.id);
    if (pending) {
      replyUploadComplete(
        event,
        {
          success: false,
          error: errorMessage || 'Ошибка наложения водяного знака',
          saveLocally: pending.destination === 'file',
          destination: pending.destination
        },
        pending.settings
      );
    } else {
      closeAllCaptureWindows();
    }
  });

  ipcMain.on('compose-image-done', async (event, pngPayload: Buffer | Uint8Array | ArrayBuffer) => {
    const pendingWatermark = getPendingWatermark();
    const pending = pendingWatermark.get(event.sender.id);
    pendingWatermark.delete(event.sender.id);
    if (!pending) return;
    try {
      const buffer = asPngBuffer(pngPayload);
      await saveOrUploadScreenshot(event, buffer, pending.destination, pending.mode, pending.settings);
    } catch (error) {
      console.error('Compose image save failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      replyUploadComplete(
        event,
        {
          success: false,
          error: errorMessage,
          saveLocally: pending.destination === 'file',
          destination: pending.destination
        },
        pending.settings
      );
    }
  });

  ipcMain.on('compose-image-error', (event, errorMessage: string) => {
    const pendingWatermark = getPendingWatermark();
    const pending = pendingWatermark.get(event.sender.id);
    pendingWatermark.delete(event.sender.id);
    if (pending) {
      replyUploadComplete(
        event,
        {
          success: false,
          error: errorMessage || 'Ошибка композиции изображения',
          saveLocally: pending.destination === 'file',
          destination: pending.destination
        },
        pending.settings
      );
    } else {
      closeAllCaptureWindows();
    }
  });

  ipcMain.on('fixed-capture-area', async (event, areaData) => {
    const destination = resolveDestination(areaData);
    const mode: CaptureMode = getLastFixedMode() === 'window' ? 'window' : 'fullscreen';
    const screenshotBuffer = getPendingFixedCapture().get(event.sender.id);
    if (!screenshotBuffer) {
      replyUploadComplete(event, {
        success: false,
        error: 'No captured image',
        saveLocally: destination === 'file',
        destination
      });
      return;
    }

    if (destination === 'upload') {
      const runtime = getRuntimeUploadSettings();
      if ('error' in runtime && runtime.error === 'locked') {
        ensureVaultUnlockedForUpload();
        const appS = loadAppSettings();
        const lang = resolveLanguage(appS.language || 'system', app.getLocale());
        const tr = getTranslations(lang);
        replyUploadComplete(event, {
          success: false,
          error: tr.vault_errLocked || 'Unlock the vault first',
          saveLocally: false,
          destination
        });
        return;
      }
    }

    const settings = resolveCaptureSettings(destination);

    try {
      const watermarkEnabled =
        settings.watermark?.enabled && (settings.watermark?.text || '').trim() !== '';
      const hasAnnotations =
        areaData.annotations && Array.isArray(areaData.annotations) && areaData.annotations.length > 0;

      const pendingWatermark = getPendingWatermark();

      if (watermarkEnabled || hasAnnotations) {
        pendingWatermark.set(event.sender.id, { destination, mode, settings });
        if (hasAnnotations) {
          event.reply('compose-image', {
            pngBuffer: screenshotBuffer,
            annotations: areaData.annotations,
            watermark: watermarkEnabled ? settings.watermark : null
          });
        } else {
          event.reply('apply-watermark', { pngBuffer: screenshotBuffer, watermark: settings.watermark });
        }
        return;
      }

      await saveOrUploadScreenshot(event, screenshotBuffer, destination, mode, settings);
    } catch (error) {
      console.error('Fixed capture export failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      replyUploadComplete(
        event,
        {
          success: false,
          error: errorMessage,
          saveLocally: destination === 'file',
          destination
        },
        settings
      );
    }
  });
}
