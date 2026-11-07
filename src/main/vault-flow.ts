/**
 * Vault unlock flow for uploads — avoids circular imports with main.ts.
 * main registers the UI handler; capture / file-upload call ensureVaultUnlockedForUpload().
 */
import { isVaultLockedBlocking } from './settings-store';

let unlockUiHandler: (() => void) | null = null;

/** Called from main.ts to show the unlock window (or equivalent). */
export function setVaultUnlockUiHandler(handler: () => void): void {
  unlockUiHandler = handler;
}

/**
 * Returns true if uploads may proceed.
 * If the vault is locked, triggers the unlock UI and returns false.
 */
export function ensureVaultUnlockedForUpload(): boolean {
  if (!isVaultLockedBlocking()) return true;
  if (unlockUiHandler) unlockUiHandler();
  return false;
}
