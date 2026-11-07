/**
 * Vault unlock / reset IPC.
 */
import { BrowserWindow, ipcMain } from 'electron';
import {
  getSettingsForUi,
  unlockVault,
  resetVault,
  isVaultLockedBlocking,
  needsLegacyVaultUnlock
} from '../settings-store';
import { registerAllHotkeys } from '../hotkeys';

type UnlockMode = 'unlock' | 'setup' | 'change';

export interface VaultIpcDeps {
  buildTrayMenu: () => void;
  showUnlockWindow: (mode?: UnlockMode) => void;
  getSettingsWindow: () => BrowserWindow | null;
  getUnlockWindow: () => BrowserWindow | null;
}

let registered = false;

export function registerVaultIpc(deps: VaultIpcDeps): void {
  if (registered) return;
  registered = true;

  ipcMain.handle('vault-status', () => {
    const ui = getSettingsForUi();
    return ui.vault;
  });

  ipcMain.handle('vault-unlock', (_e, password: string) => {
    const result = unlockVault(password || '');
    deps.buildTrayMenu();
    if (result.ok) {
      registerAllHotkeys();
    }
    const settingsWindow = deps.getSettingsWindow();
    if (result.ok && settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('vault-updated');
    }
    return result;
  });

  ipcMain.handle('vault-setup', () => {
    return { ok: true };
  });

  ipcMain.handle('vault-change-password', () => {
    return { ok: false, error: 'not_supported' };
  });

  ipcMain.handle('vault-lock', () => {
    return { ok: true };
  });

  ipcMain.handle('vault-reset', () => {
    resetVault();
    deps.buildTrayMenu();
    registerAllHotkeys();
    const settingsWindow = deps.getSettingsWindow();
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('vault-updated');
    }
    return { ok: true };
  });

  ipcMain.handle('show-vault-window', (_e, mode: UnlockMode) => {
    if (mode === 'unlock' || needsLegacyVaultUnlock() || isVaultLockedBlocking()) {
      deps.showUnlockWindow('unlock');
    }
    return { ok: true };
  });

  ipcMain.handle('close-unlock-window', () => {
    const unlockWindow = deps.getUnlockWindow();
    if (unlockWindow && !unlockWindow.isDestroyed()) unlockWindow.close();
    return { ok: true };
  });
}
