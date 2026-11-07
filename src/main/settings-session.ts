/**
 * Mutable session state shared by vault-state and settings-disk.
 * Internal module: NOT re-exported from settings-store.
 * Lives in its own file so vault-state never has to import settings-disk at load time.
 */
import type { SecretsPayload, VaultBlob } from './vault-crypto';
import {
  AppSettings,
  CaptureSettings,
  UpdatesSettings,
  ExportSettings,
  defaultWatermark,
  defaultHotkeys,
  defaultCaptureSettings,
  defaultUpdatesSettings,
  defaultExportSettings,
  normalizeHotkeys,
  normalizeCapture,
  normalizeUpdates,
  normalizeExport
} from './settings-types';

export interface SettingsSession {
  cached: AppSettings | null;
  unlockedSecrets: SecretsPayload | null;
  /** AES password for the current session (= String(installTimestamp) after migration). */
  encryptionPasswordSession: string | null;
  /** First-run / install time; plaintext on disk; used as encryption password. */
  installTimestamp: number | null;
  /** Old vault without installTimestamp — waiting for one-time master-password unlock. */
  legacyNeedsUserUnlock: boolean;
  /** Plaintext from an older settings.json, merged in on the next successful unlock. */
  legacySettings: AppSettings | null;
  /** Vault exists and this session has not unlocked it. Profiles are not kept in memory. */
  vaultLocked: boolean;
  /** Parsed file was unreadable — refuse to overwrite it. */
  loadFailed: boolean;
}

export const session: SettingsSession = {
  cached: null,
  unlockedSecrets: null,
  encryptionPasswordSession: null,
  installTimestamp: null,
  legacyNeedsUserUnlock: false,
  legacySettings: null,
  vaultLocked: false,
  loadFailed: false
};

export function ensureInstallTimestamp(): number {
  if (session.installTimestamp == null || !Number.isFinite(session.installTimestamp)) {
    session.installTimestamp = Date.now();
  }
  return session.installTimestamp;
}

export function encryptionPasswordFromTimestamp(): string {
  return String(ensureInstallTimestamp());
}

export function lockedShell(
  vault: VaultBlob | null,
  hotkeys?: Record<string, string>,
  capture?: CaptureSettings,
  updates?: UpdatesSettings,
  exportSettings?: ExportSettings
): AppSettings {
  return {
    language: '',
    afterUploadFeedback: 'overlay',
    watermark: defaultWatermark(),
    hotkeys: hotkeys ? normalizeHotkeys(hotkeys) : (session.cached?.hotkeys ? normalizeHotkeys(session.cached.hotkeys) : defaultHotkeys()),
    capture: capture
      ? normalizeCapture(capture)
      : session.cached?.capture
        ? normalizeCapture(session.cached.capture)
        : defaultCaptureSettings(),
    updates: updates
      ? normalizeUpdates(updates)
      : session.cached?.updates
        ? normalizeUpdates(session.cached.updates)
        : defaultUpdatesSettings(),
    export: exportSettings
      ? normalizeExport(exportSettings)
      : session.cached?.export
        ? normalizeExport(session.cached.export)
        : defaultExportSettings(),
    activeProfileId: '',
    profiles: [],
    vault
  };
}
