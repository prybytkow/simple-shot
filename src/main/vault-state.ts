/**
 * Vault session + encryption: persistEncrypted, unlock/reset/setup, secrets API, status helpers.
 * Session variables live in settings-session. Disk I/O (writeDisk / loadAppSettings) is in
 * settings-disk, which imports this module — so it is only loaded lazily here to avoid a cycle.
 */
import {
  VaultBlob,
  ProfileSecrets,
  SecretsPayload,
  encryptSecrets,
  decryptSecrets
} from './vault-crypto';
import {
  AppSettings,
  CaptureSettings,
  UpdatesSettings,
  ExportSettings,
  ProfileSecretFlags,
  VaultConfigPayload,
  CONFIG_VERSION,
  createEmptyProfile,
  defaultWatermark,
  defaultAppSettings,
  normalizeProfile,
  stripAccidentalSecrets,
  normalizeHotkeys,
  normalizeCapture,
  normalizeUpdates,
  normalizeExport
} from './settings-types';
import { session, ensureInstallTimestamp, encryptionPasswordFromTimestamp, lockedShell } from './settings-session';

/** Lazy access to settings-disk (it imports this module; a static import would be circular). */
function disk(): typeof import('./settings-disk') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('./settings-disk');
}
function loadAppSettings(): AppSettings {
  return disk().loadAppSettings();
}
function writeDisk(vault: VaultBlob | null): void {
  disk().writeDisk(vault);
}

function emptyFlags(): ProfileSecretFlags {
  return { sshPasswordSet: false, ftpPasswordSet: false, s3SecretSet: false, apiKeySet: false };
}

function flagsFromSecrets(s?: ProfileSecrets): ProfileSecretFlags {
  return {
    sshPasswordSet: !!(s && s.sshPassword),
    ftpPasswordSet: !!(s && s.ftpPassword),
    s3SecretSet: !!(s && s.s3SecretAccessKey),
    apiKeySet: !!(s && s.apiKey)
  };
}

function isConfigPayload(raw: unknown): raw is VaultConfigPayload {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Partial<VaultConfigPayload>;
  return o.version === CONFIG_VERSION && Array.isArray(o.profiles) && !!o.secrets && typeof o.secrets === 'object';
}

function isLegacySecretsMap(raw: unknown): raw is SecretsPayload {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw) && !isConfigPayload(raw);
}

/** Encrypt current in-memory config with the install-timestamp password. */
export function persistEncrypted(): void {
  const s = session.cached ?? loadAppSettings();
  if (session.unlockedSecrets == null) return;
  const password = session.encryptionPasswordSession || encryptionPasswordFromTimestamp();
  session.encryptionPasswordSession = password;
  const blob = encryptSecrets(password, buildConfigPayload());
  writeDisk(blob);
  s.vault = blob;
  session.cached = s;
  session.vaultLocked = false;
  session.legacyNeedsUserUnlock = false;
}

function applyUnlockedPayload(
  raw: unknown,
  vault: VaultBlob,
  password: string,
  keepHotkeys: Record<string, string>,
  keepCapture: CaptureSettings,
  keepUpdates: UpdatesSettings,
  keepExport: ExportSettings
): boolean {
  if (isConfigPayload(raw)) {
    applyConfigPayload(raw, vault, keepHotkeys, keepCapture, keepUpdates, keepExport);
  } else if (isLegacySecretsMap(raw)) {
    const base = session.legacySettings
      ? { ...session.legacySettings, vault, hotkeys: keepHotkeys, capture: keepCapture, updates: keepUpdates, export: keepExport }
      : { ...defaultAppSettings(), vault, hotkeys: keepHotkeys, capture: keepCapture, updates: keepUpdates, export: keepExport };
    session.cached = base;
    session.unlockedSecrets = { ...raw };
    for (const p of base.profiles) {
      if (!session.unlockedSecrets[p.id]) session.unlockedSecrets[p.id] = {};
    }
  } else {
    return false;
  }
  session.encryptionPasswordSession = password;
  session.vaultLocked = false;
  session.legacyNeedsUserUnlock = false;
  return true;
}

export function autoUnlockWithTimestamp(
  vault: VaultBlob,
  keepHotkeys: Record<string, string>,
  keepCapture: CaptureSettings,
  keepUpdates: UpdatesSettings,
  keepExport: ExportSettings
): boolean {
  const password = encryptionPasswordFromTimestamp();
  try {
    const raw = decryptSecrets(password, vault);
    if (!applyUnlockedPayload(raw, vault, password, keepHotkeys, keepCapture, keepUpdates, keepExport)) {
      return false;
    }
    // Re-persist so disk always matches current crypto params / payload shape
    try {
      persistEncrypted();
    } catch (e) {
      console.error(e);
    }
    session.legacySettings = null;
    return true;
  } catch {
    return false;
  }
}

export function vaultStatus(): {
  hasVault: boolean;
  isUnlocked: boolean;
  needsSetup: boolean;
  needsLegacyUnlock: boolean;
} {
  const s = loadAppSettings();
  const hasVault = !!s.vault;
  const isUnlocked = hasVault && !session.vaultLocked && session.unlockedSecrets != null;
  // needsSetup kept for UI compat; timestamp scheme never needs manual setup
  return {
    hasVault,
    isUnlocked,
    needsSetup: false,
    needsLegacyUnlock: session.legacyNeedsUserUnlock && session.vaultLocked
  };
}

/** True if user must unlock before upload (legacy vault still locked) */
export function isVaultLockedBlocking(): boolean {
  loadAppSettings();
  return session.vaultLocked;
}

/** @deprecated Timestamp protection never needs manual vault setup */
export function needsVaultSetup(): boolean {
  return false;
}

export function isVaultUnlocked(): boolean {
  loadAppSettings();
  return !!session.cached?.vault && !session.vaultLocked && session.unlockedSecrets != null;
}

export function hasVault(): boolean {
  return !!loadAppSettings().vault;
}

/** True when an old master-password vault must be unlocked once to migrate. */
export function needsLegacyVaultUnlock(): boolean {
  loadAppSettings();
  return session.legacyNeedsUserUnlock && session.vaultLocked;
}

export function getInstallTimestamp(): number | null {
  loadAppSettings();
  return session.installTimestamp;
}

function buildConfigPayload(): VaultConfigPayload {
  const s = loadAppSettings();
  const secrets: SecretsPayload = session.unlockedSecrets ? { ...session.unlockedSecrets } : {};
  for (const p of s.profiles) {
    if (!secrets[p.id]) secrets[p.id] = {};
  }
  return {
    version: CONFIG_VERSION,
    language: s.language,
    afterUploadFeedback: s.afterUploadFeedback,
    watermark: s.watermark,
    hotkeys: normalizeHotkeys(s.hotkeys),
    capture: normalizeCapture(s.capture),
    updates: normalizeUpdates(s.updates),
    export: normalizeExport(s.export),
    activeProfileId: s.activeProfileId,
    profiles: s.profiles.map(stripAccidentalSecrets),
    secrets
  };
}

function applyConfigPayload(
  raw: VaultConfigPayload,
  vault: VaultBlob,
  preserveHotkeys?: Record<string, string>,
  preserveCapture?: CaptureSettings,
  preserveUpdates?: UpdatesSettings,
  preserveExport?: ExportSettings
): void {
  const profiles = raw.profiles.map((pr, i) => normalizeProfile(pr, i === 0 ? 'Default' : `Profile ${i + 1}`));
  if (profiles.length === 0) profiles.push(createEmptyProfile('Default'));
  let activeProfileId = raw.activeProfileId;
  if (!profiles.some((p) => p.id === activeProfileId)) activeProfileId = profiles[0].id;
  session.cached = {
    language: raw.language ?? '',
    afterUploadFeedback:
      raw.afterUploadFeedback === 'notification' || raw.afterUploadFeedback === 'window'
        ? raw.afterUploadFeedback
        : 'overlay',
    watermark: { ...defaultWatermark(), ...(raw.watermark || {}) },
    // Plaintext disk prefs are source of truth; vault copy is backup only
    hotkeys: preserveHotkeys
      ? normalizeHotkeys(preserveHotkeys)
      : normalizeHotkeys(raw.hotkeys),
    capture: preserveCapture
      ? normalizeCapture(preserveCapture)
      : normalizeCapture(raw.capture ?? session.cached?.capture),
    updates: preserveUpdates
      ? normalizeUpdates(preserveUpdates)
      : normalizeUpdates(raw.updates ?? session.cached?.updates),
    export: preserveExport
      ? normalizeExport(preserveExport)
      : normalizeExport(raw.export ?? session.cached?.export),
    activeProfileId,
    profiles,
    vault
  };
  session.unlockedSecrets = { ...(raw.secrets || {}) };
  for (const p of profiles) {
    if (!session.unlockedSecrets[p.id]) session.unlockedSecrets[p.id] = {};
  }
}

/**
 * One-time unlock for legacy master-password vaults.
 * After success, settings are re-encrypted with session.installTimestamp (created if missing).
 */
export function unlockVault(password: string): { ok: boolean; error?: string } {
  const s = loadAppSettings();
  if (!s.vault) return { ok: false, error: 'no_vault' };
  let raw: unknown;
  try {
    raw = decryptSecrets(password, s.vault);
  } catch {
    return { ok: false, error: 'bad_password' };
  }
  const vault = s.vault;
  const keepHotkeys = normalizeHotkeys(s.hotkeys);
  const keepCapture = normalizeCapture(s.capture);
  const keepUpdates = normalizeUpdates(s.updates);
  const keepExport = normalizeExport(s.export);
  if (!applyUnlockedPayload(raw, vault, password, keepHotkeys, keepCapture, keepUpdates, keepExport)) {
    return { ok: false, error: 'bad_password' };
  }
  // Migrate to install-timestamp key
  session.encryptionPasswordSession = encryptionPasswordFromTimestamp();
  try {
    persistEncrypted();
  } catch (e) {
    console.error(e);
    session.encryptionPasswordSession = null;
    session.vaultLocked = true;
    session.unlockedSecrets = null;
    session.legacyNeedsUserUnlock = true;
    session.cached = lockedShell(vault, keepHotkeys, keepCapture, keepUpdates, keepExport);
    return { ok: false, error: 'encrypt_failed' };
  }
  session.legacySettings = null;
  return { ok: true };
}

/** No-op under timestamp protection (settings stay unlocked in-session). */
export function lockVault(): void {
  // Intentionally empty — key is session.installTimestamp, not a user session lock.
}

/** Ensure vault exists and is encrypted with session.installTimestamp (password arg ignored). */
export function setupVault(_password?: string): { ok: boolean; error?: string } {
  loadAppSettings();
  if (session.vaultLocked) return { ok: false, error: 'locked' };
  if (session.unlockedSecrets == null) session.unlockedSecrets = {};
  const s = loadAppSettings();
  for (const p of s.profiles) {
    if (!session.unlockedSecrets[p.id]) session.unlockedSecrets[p.id] = {};
  }
  session.encryptionPasswordSession = encryptionPasswordFromTimestamp();
  session.legacySettings = null;
  session.vaultLocked = false;
  try {
    persistEncrypted();
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: 'encrypt_failed' };
  }
}

/** Password changes are not supported — key is session.installTimestamp. */
export function changeVaultPassword(_oldPassword: string, _newPassword: string): { ok: boolean; error?: string } {
  return { ok: false, error: 'not_supported' };
}

export function resetVault(): void {
  session.cached = defaultAppSettings();
  session.unlockedSecrets = {};
  for (const p of session.cached.profiles) {
    session.unlockedSecrets[p.id] = {};
  }
  // Keep existing session.installTimestamp when present so the machine key stays stable
  ensureInstallTimestamp();
  session.encryptionPasswordSession = encryptionPasswordFromTimestamp();
  session.vaultLocked = false;
  session.legacyNeedsUserUnlock = false;
  session.legacySettings = null;
  session.loadFailed = false;
  try {
    persistEncrypted();
  } catch (e) {
    console.error(e);
  }
}

function ensureUnlockedForSecrets(): void {
  if (session.unlockedSecrets == null) {
    session.unlockedSecrets = {};
  }
}

export function getSecretsForProfile(profileId: string): ProfileSecrets {
  if (!session.unlockedSecrets) return {};
  return session.unlockedSecrets[profileId] || {};
}

/**
 * Update secrets for a profile. Empty string fields mean "keep existing".
 * Requires unlocked vault (or no vault yet — secrets stay in memory until setup).
 */
export function updateProfileSecrets(
  profileId: string,
  incoming: {
    sshPassword?: string;
    ftpPassword?: string;
    s3SecretAccessKey?: string;
    apiKey?: string;
  }
): { ok: boolean; error?: string } {
  const s = loadAppSettings();
  if (s.vault && session.unlockedSecrets == null) {
    return { ok: false, error: 'locked' };
  }
  ensureUnlockedForSecrets();
  const cur = { ...(session.unlockedSecrets![profileId] || {}) };
  if (incoming.sshPassword !== undefined && incoming.sshPassword !== '') {
    cur.sshPassword = incoming.sshPassword;
  }
  if (incoming.ftpPassword !== undefined && incoming.ftpPassword !== '') {
    cur.ftpPassword = incoming.ftpPassword;
  }
  if (incoming.s3SecretAccessKey !== undefined && incoming.s3SecretAccessKey !== '') {
    cur.s3SecretAccessKey = incoming.s3SecretAccessKey;
  }
  if (incoming.apiKey !== undefined && incoming.apiKey !== '') {
    cur.apiKey = incoming.apiKey;
  }
  session.unlockedSecrets![profileId] = cur;
  return { ok: true };
}

export function deleteProfileSecrets(profileId: string): void {
  if (!session.unlockedSecrets) return;
  delete session.unlockedSecrets[profileId];
  if (!session.vaultLocked && session.unlockedSecrets != null && loadAppSettings().vault) {
    try {
      persistEncrypted();
    } catch (e) {
      console.error(e);
    }
  }
}

export function getSecretFlags(): Record<string, ProfileSecretFlags> {
  const s = loadAppSettings();
  const out: Record<string, ProfileSecretFlags> = {};
  for (const p of s.profiles) {
    if (session.unlockedSecrets) {
      out[p.id] = flagsFromSecrets(session.unlockedSecrets[p.id]);
    } else if (s.vault) {
      // locked: we don't know per-field; assume may have secrets
      out[p.id] = {
        sshPasswordSet: true,
        ftpPasswordSet: true,
        s3SecretSet: true,
        apiKeySet: true
      };
    } else {
      out[p.id] = emptyFlags();
    }
  }
  return out;
}
