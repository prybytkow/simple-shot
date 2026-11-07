/**
 * Plaintext settings.json I/O, load/migrate, plaintext prefs, saveFromUi, runtime upload settings.
 * Imports vault-state (never the other way around at load time).
 */
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { VaultBlob, ProfileSecrets, SecretsPayload } from './vault-crypto';
import {
  AppSettings,
  UploadProfile,
  SaveMethod,
  AfterUploadFeedback,
  CaptureSettings,
  UpdatesSettings,
  ExportSettings,
  SettingsForUi,
  RuntimeUploadSettings,
  createEmptyProfile,
  defaultHotkeys,
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
import {
  persistEncrypted,
  autoUnlockWithTimestamp,
  vaultStatus,
  getSecretFlags,
  updateProfileSecrets
} from './vault-state';

const settingsPath = (): string => path.join(app.getPath('userData'), 'settings.json');

function hasAnySecret(s?: ProfileSecrets): boolean {
  if (!s) return false;
  return !!(s.sshPassword || s.ftpPassword || s.s3SecretAccessKey || s.apiKey);
}

/** Detect legacy flat settings (pre-profiles) */
function isLegacySettings(parsed: Record<string, unknown>): boolean {
  return !Array.isArray(parsed.profiles) && (parsed.ssh != null || parsed.saveMethod != null);
}

function migrateLegacy(parsed: any): { settings: AppSettings; secrets: SecretsPayload } {
  const profile = createEmptyProfile('Default');
  profile.saveMethod = (parsed.saveMethod as SaveMethod) || 'ssh';
  profile.baseUrl = parsed.baseUrl || profile.baseUrl;
  profile.showInTray = true;
  if (parsed.ssh) {
    profile.ssh = {
      host: parsed.ssh.host || '',
      port: parsed.ssh.port || 22,
      username: parsed.ssh.username || '',
      privateKeyPath: parsed.ssh.privateKeyPath || '',
      destinationPath: parsed.ssh.destinationPath || '/uploads'
    };
  }
  if (parsed.ftp) {
    profile.ftp = {
      host: parsed.ftp.host || '',
      port: parsed.ftp.port || 21,
      username: parsed.ftp.username || '',
      destinationPath: parsed.ftp.destinationPath || '/uploads',
      secure: !!parsed.ftp.secure
    };
  }
  if (parsed.s3) {
    profile.s3 = {
      accessKeyId: parsed.s3.accessKeyId || '',
      bucket: parsed.s3.bucket || '',
      region: parsed.s3.region || 'us-east-1',
      endpoint: parsed.s3.endpoint || ''
    };
  }
  if (parsed.api) {
    profile.api = { endpoint: parsed.api.endpoint || '' };
  }

  const secrets: SecretsPayload = {};
  const sec: ProfileSecrets = {};
  if (parsed.ssh?.password) sec.sshPassword = String(parsed.ssh.password);
  if (parsed.ftp?.password) sec.ftpPassword = String(parsed.ftp.password);
  if (parsed.s3?.secretAccessKey) sec.s3SecretAccessKey = String(parsed.s3.secretAccessKey);
  if (parsed.api?.apiKey) sec.apiKey = String(parsed.api.apiKey);
  if (hasAnySecret(sec)) secrets[profile.id] = sec;

  const settings: AppSettings = {
    language: parsed.language ?? '',
    afterUploadFeedback:
      parsed.afterUploadFeedback === 'notification' || parsed.afterUploadFeedback === 'window'
        ? parsed.afterUploadFeedback
        : 'overlay',
    watermark: { ...defaultWatermark(), ...(parsed.watermark || {}) },
    hotkeys: normalizeHotkeys(parsed.hotkeys),
    capture: normalizeCapture(parsed.capture),
    updates: normalizeUpdates(parsed.updates),
    export: normalizeExport(parsed.export),
    activeProfileId: profile.id,
    profiles: [profile],
    vault: null
  };
  return { settings, secrets };
}

function parseInstallTimestamp(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw.trim());
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return null;
}

/** On disk: session.installTimestamp + vault ciphertext + plaintext hotkeys/capture/updates/export. */
export function writeDisk(vault: VaultBlob | null): void {
  if (session.loadFailed) return;
  const hotkeys = normalizeHotkeys(session.cached?.hotkeys);
  const capture = normalizeCapture(session.cached?.capture);
  const updates = normalizeUpdates(session.cached?.updates);
  const exportSettings = normalizeExport(session.cached?.export);
  const ts = ensureInstallTimestamp();
  fs.writeFileSync(
    settingsPath(),
    JSON.stringify(
      {
        installTimestamp: ts,
        vault,
        hotkeys,
        capture,
        updates,
        export: exportSettings
      },
      null,
      2
    ),
    'utf8'
  );
}

/** First run or empty disk: create session.installTimestamp and an encrypted empty vault. */
function bootstrapEncryptedDefaults(): AppSettings {
  const defaults = defaultAppSettings();
  session.cached = defaults;
  session.unlockedSecrets = {};
  for (const p of defaults.profiles) {
    session.unlockedSecrets[p.id] = {};
  }
  session.encryptionPasswordSession = encryptionPasswordFromTimestamp();
  session.vaultLocked = false;
  session.legacyNeedsUserUnlock = false;
  persistEncrypted();
  return session.cached!;
}

function settingsFromParsed(parsed: any): AppSettings {
  const defaults = defaultAppSettings();
  let profiles: UploadProfile[] = Array.isArray(parsed.profiles)
    ? parsed.profiles.map((pr: any, i: number) => normalizeProfile(pr, i === 0 ? 'Default' : `Profile ${i + 1}`))
    : [];
  if (profiles.length === 0) profiles = defaults.profiles;

  let activeProfileId = parsed.activeProfileId;
  if (!profiles.some((pr) => pr.id === activeProfileId)) {
    activeProfileId = profiles[0].id;
  }

  return {
    language: parsed.language ?? '',
    afterUploadFeedback:
      parsed.afterUploadFeedback === 'notification' || parsed.afterUploadFeedback === 'window'
        ? parsed.afterUploadFeedback
        : 'overlay',
    watermark: { ...defaultWatermark(), ...(parsed.watermark || {}) },
    hotkeys: normalizeHotkeys(parsed.hotkeys),
    capture: normalizeCapture(parsed.capture),
    updates: normalizeUpdates(parsed.updates),
    export: normalizeExport(parsed.export),
    activeProfileId,
    profiles,
    vault: null
  };
}

function fileHasPlaintextConfig(parsed: any): boolean {
  if (Array.isArray(parsed.profiles) && parsed.profiles.length > 0) return true;
  if (parsed.ssh || parsed.ftp || parsed.s3 || parsed.api || parsed.saveMethod) return true;
  if (parsed.watermark || parsed.activeProfileId || parsed.afterUploadFeedback) return true;
  if (typeof parsed.language === 'string' && parsed.language.length > 0) return true;
  return false;
}

export function loadAppSettings(): AppSettings {
  if (session.cached) return session.cached;
  try {
    const p = settingsPath();
    if (!fs.existsSync(p)) {
      return bootstrapEncryptedDefaults();
    }
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as any;
    const vault: VaultBlob | null = parsed.vault && typeof parsed.vault === 'object' ? parsed.vault : null;
    const diskHotkeys = normalizeHotkeys(parsed.hotkeys);
    const diskCapture = normalizeCapture(parsed.capture);
    const diskUpdates = normalizeUpdates(parsed.updates);
    const diskExport = normalizeExport(parsed.export);
    const diskTs = parseInstallTimestamp(parsed.installTimestamp);

    if (diskTs != null) {
      session.installTimestamp = diskTs;
    }

    // Legacy flat plaintext settings → encrypt with install timestamp
    if (isLegacySettings(parsed)) {
      const { settings, secrets } = migrateLegacy(parsed);
      settings.hotkeys = diskHotkeys;
      settings.capture = diskCapture;
      settings.updates = diskUpdates;
      settings.export = diskExport;
      session.cached = settings;
      session.unlockedSecrets = Object.keys(secrets).length > 0 ? secrets : {};
      for (const pr of settings.profiles) {
        if (!session.unlockedSecrets[pr.id]) session.unlockedSecrets[pr.id] = {};
      }
      session.encryptionPasswordSession = encryptionPasswordFromTimestamp();
      session.vaultLocked = false;
      session.legacyNeedsUserUnlock = false;
      persistEncrypted();
      return session.cached!;
    }

    // Plaintext profiles on disk (pre-vault or mixed) → fold into ciphertext
    if (fileHasPlaintextConfig(parsed) && !vault) {
      session.cached = settingsFromParsed(parsed);
      session.unlockedSecrets = {};
      for (const pr of session.cached.profiles) {
        session.unlockedSecrets[pr.id] = {};
      }
      session.encryptionPasswordSession = encryptionPasswordFromTimestamp();
      session.vaultLocked = false;
      session.legacyNeedsUserUnlock = false;
      persistEncrypted();
      return session.cached!;
    }

    if (vault && fileHasPlaintextConfig(parsed)) {
      // Passwords in vault, profiles still plaintext — need unlock then migrate
      session.legacySettings = settingsFromParsed(parsed);
      session.legacySettings.hotkeys = diskHotkeys;
      session.legacySettings.capture = diskCapture;
      session.legacySettings.updates = diskUpdates;
      session.legacySettings.export = diskExport;
      if (diskTs != null && autoUnlockWithTimestamp(vault, diskHotkeys, diskCapture, diskUpdates, diskExport)) {
        return session.cached!;
      }
      session.vaultLocked = true;
      session.legacyNeedsUserUnlock = diskTs == null;
      session.unlockedSecrets = null;
      session.encryptionPasswordSession = null;
      session.cached = lockedShell(vault, diskHotkeys, diskCapture, diskUpdates, diskExport);
      return session.cached;
    }

    if (vault) {
      if (diskTs != null && autoUnlockWithTimestamp(vault, diskHotkeys, diskCapture, diskUpdates, diskExport)) {
        return session.cached!;
      }
      // No timestamp (legacy master-password vault) or wrong key — wait for user unlock once
      session.vaultLocked = true;
      session.legacyNeedsUserUnlock = diskTs == null;
      session.unlockedSecrets = null;
      session.encryptionPasswordSession = null;
      session.cached = lockedShell(vault, diskHotkeys, diskCapture, diskUpdates, diskExport);
      return session.cached;
    }

    // Empty / unknown file → bootstrap
    return bootstrapEncryptedDefaults();
  } catch (e) {
    console.error('Error loading settings:', e);
    session.loadFailed = true;
    session.cached = defaultAppSettings();
    return session.cached;
  }
}

export function saveAppSettings(partial: {
  language?: string;
  afterUploadFeedback?: AfterUploadFeedback;
  watermark?: AppSettings['watermark'];
  activeProfileId?: string;
  profiles?: UploadProfile[];
}): AppSettings {
  const current = loadAppSettings();
  if (session.vaultLocked) return current;
  const next: AppSettings = {
    ...current,
    language: partial.language !== undefined ? partial.language : current.language,
    afterUploadFeedback:
      partial.afterUploadFeedback !== undefined ? partial.afterUploadFeedback : current.afterUploadFeedback,
    watermark: partial.watermark ? { ...defaultWatermark(), ...partial.watermark } : current.watermark,
    hotkeys: current.hotkeys ? normalizeHotkeys(current.hotkeys) : defaultHotkeys(),
    capture: normalizeCapture(current.capture),
    updates: normalizeUpdates(current.updates),
    export: normalizeExport(current.export),
    activeProfileId:
      partial.activeProfileId && current.profiles.some((p) => p.id === partial.activeProfileId)
        ? partial.activeProfileId
        : partial.profiles && partial.activeProfileId
          ? partial.activeProfileId
          : current.activeProfileId,
    profiles: partial.profiles
      ? partial.profiles.map((pr, i) => normalizeProfile(pr, pr.name || `Profile ${i + 1}`))
      : current.profiles,
    vault: current.vault
  };
  if (!next.profiles.some((p) => p.id === next.activeProfileId) && next.profiles.length > 0) {
    next.activeProfileId = next.profiles[0].id;
  }
  session.cached = next;
  if (!session.vaultLocked && session.unlockedSecrets != null) {
    try {
      persistEncrypted();
    } catch (e) {
      console.error(e);
    }
  }
  return next;
}

export function setActiveProfile(id: string): boolean {
  const s = loadAppSettings();
  if (session.vaultLocked) return false;
  if (!s.profiles.some((p) => p.id === id)) return false;
  s.activeProfileId = id;
  session.cached = s;
  if (!session.vaultLocked && session.unlockedSecrets != null) {
    try {
      persistEncrypted();
    } catch (e) {
      console.error(e);
    }
  }
  return true;
}

export function getActiveProfile(): UploadProfile | undefined {
  const s = loadAppSettings();
  if (s.profiles.length === 0) return undefined;
  return s.profiles.find((p) => p.id === s.activeProfileId) || s.profiles[0];
}

export function getSettingsForUi(): SettingsForUi {
  const s = loadAppSettings();
  const status = vaultStatus();
  if (session.vaultLocked) {
    return {
      language: '',
      afterUploadFeedback: 'overlay',
      watermark: defaultWatermark(),
      hotkeys: normalizeHotkeys(s.hotkeys),
      capture: normalizeCapture(s.capture),
      updates: normalizeUpdates(s.updates),
      export: normalizeExport(s.export),
      activeProfileId: '',
      profiles: [],
      vault: {
        hasVault: true,
        isUnlocked: false,
        needsSetup: false,
        needsLegacyUnlock: status.needsLegacyUnlock
      },
      secretFlags: {}
    };
  }
  return {
    language: s.language,
    afterUploadFeedback: s.afterUploadFeedback,
    watermark: s.watermark,
    hotkeys: normalizeHotkeys(s.hotkeys),
    capture: normalizeCapture(s.capture),
    updates: normalizeUpdates(s.updates),
    export: normalizeExport(s.export),
    activeProfileId: s.activeProfileId,
    profiles: s.profiles.map(stripAccidentalSecrets),
    vault: {
      hasVault: status.hasVault,
      isUnlocked: status.isUnlocked,
      needsSetup: status.needsSetup,
      needsLegacyUnlock: status.needsLegacyUnlock
    },
    secretFlags: getSecretFlags()
  };
}

/** Current hotkey map (works while vault is locked). */
export function getHotkeys(): Record<string, string> {
  return normalizeHotkeys(loadAppSettings().hotkeys);
}

/** Persist full hotkey map to disk (plaintext; does not require vault unlock). */
export function saveHotkeys(map: Record<string, string>): Record<string, string> {
  const s = loadAppSettings();
  const hotkeys = normalizeHotkeys(map);
  session.cached = { ...s, hotkeys };
  writeDisk(s.vault);
  if (s.vault && session.unlockedSecrets && !session.vaultLocked) {
    try {
      persistEncrypted();
    } catch (e) {
      console.error(e);
    }
  }
  return hotkeys;
}

/** Set or clear a single hotkey action. null/empty clears the slot. */
export function setHotkeySetting(actionId: string, accelerator: string | null): Record<string, string> {
  const current = getHotkeys();
  current[actionId] = accelerator && accelerator.trim() ? accelerator.trim() : '';
  return saveHotkeys(current);
}

/** Current capture prefs (works while vault is locked). */
export function getCaptureSettings(): CaptureSettings {
  return normalizeCapture(loadAppSettings().capture);
}

/** Persist capture prefs to disk (plaintext; does not require vault unlock). */
export function saveCaptureSettings(partial: Partial<CaptureSettings>): CaptureSettings {
  const s = loadAppSettings();
  const capture = normalizeCapture({ ...normalizeCapture(s.capture), ...partial });
  session.cached = { ...s, capture };
  writeDisk(s.vault);
  if (s.vault && session.unlockedSecrets && !session.vaultLocked) {
    try {
      persistEncrypted();
    } catch (e) {
      console.error(e);
    }
  }
  return capture;
}

/** Current auto-update prefs (works while vault is locked). */
export function getUpdatesSettings(): UpdatesSettings {
  return normalizeUpdates(loadAppSettings().updates);
}

/** Persist auto-update prefs to disk (plaintext; does not require vault unlock). */
export function saveUpdatesSettings(partial: Partial<UpdatesSettings>): UpdatesSettings {
  const s = loadAppSettings();
  const updates = normalizeUpdates({ ...normalizeUpdates(s.updates), ...partial });
  session.cached = { ...s, updates };
  writeDisk(s.vault);
  if (s.vault && session.unlockedSecrets && !session.vaultLocked) {
    try {
      persistEncrypted();
    } catch (e) {
      console.error(e);
    }
  }
  return updates;
}

/** Current export prefs (works while vault is locked). */
export function getExportSettings(): ExportSettings {
  return normalizeExport(loadAppSettings().export);
}

/** Persist export prefs to disk (plaintext; does not require vault unlock). */
export function saveExportSettings(partial: Partial<ExportSettings>): ExportSettings {
  const s = loadAppSettings();
  const exportSettings = normalizeExport({ ...normalizeExport(s.export), ...partial });
  session.cached = { ...s, export: exportSettings };
  writeDisk(s.vault);
  if (s.vault && session.unlockedSecrets && !session.vaultLocked) {
    try {
      persistEncrypted();
    } catch (e) {
      console.error(e);
    }
  }
  return exportSettings;
}

/**
 * Save full UI payload: global settings + profiles list + optional secrets per profile.
 * secretsByProfile: { [id]: { sshPassword?, ... } } empty string = keep.
 * With a vault, the whole config is re-encrypted. Without one, nothing is written to disk.
 */
export function saveFromUi(payload: {
  language?: string;
  afterUploadFeedback?: AfterUploadFeedback;
  watermark?: AppSettings['watermark'];
  capture?: CaptureSettings;
  updates?: UpdatesSettings;
  export?: ExportSettings;
  activeProfileId?: string;
  profiles: UploadProfile[];
  secretsByProfile?: Record<string, {
    sshPassword?: string;
    ftpPassword?: string;
    s3SecretAccessKey?: string;
    apiKey?: string;
  }>;
}): { ok: boolean; error?: string; needsVaultSetup?: boolean } {
  const prev = loadAppSettings();
  if (session.vaultLocked || (prev.vault && session.unlockedSecrets == null)) {
    return { ok: false, error: 'locked' };
  }

  const oldIds = new Set(prev.profiles.map((p) => p.id));
  const newProfiles = payload.profiles.map((pr, i) => normalizeProfile(pr, pr.name || `Profile ${i + 1}`));
  if (newProfiles.length === 0) {
    return { ok: false, error: 'no_profiles' };
  }

  let activeProfileId = payload.activeProfileId || prev.activeProfileId;
  if (!newProfiles.some((p) => p.id === activeProfileId)) {
    activeProfileId = newProfiles[0].id;
  }

  const nextCapture = payload.capture
    ? normalizeCapture({
        ...normalizeCapture(prev.capture),
        defaultMode: payload.capture.defaultMode,
        delaySeconds: payload.capture.delaySeconds
      })
    : normalizeCapture(prev.capture);

  const nextUpdates = payload.updates
    ? normalizeUpdates({
        ...normalizeUpdates(prev.updates),
        ...payload.updates
      })
    : normalizeUpdates(prev.updates);

  const nextExport = payload.export
    ? normalizeExport({
        ...normalizeExport(prev.export),
        ...payload.export
      })
    : normalizeExport(prev.export);

  session.cached = {
    language: payload.language !== undefined ? payload.language : prev.language,
    afterUploadFeedback:
      payload.afterUploadFeedback !== undefined ? payload.afterUploadFeedback : prev.afterUploadFeedback,
    watermark: payload.watermark ? { ...defaultWatermark(), ...payload.watermark } : prev.watermark,
    hotkeys: normalizeHotkeys(prev.hotkeys),
    capture: nextCapture,
    updates: nextUpdates,
    export: nextExport,
    activeProfileId,
    profiles: newProfiles,
    vault: prev.vault
  };

  if (session.unlockedSecrets) {
    const newIds = new Set(newProfiles.map((p) => p.id));
    for (const id of Object.keys(session.unlockedSecrets)) {
      if (!newIds.has(id)) delete session.unlockedSecrets[id];
    }
  }

  if (payload.secretsByProfile) {
    for (const [id, sec] of Object.entries(payload.secretsByProfile)) {
      const r = updateProfileSecrets(id, sec);
      if (!r.ok) return { ok: false, error: r.error };
    }
  }

  if (session.unlockedSecrets == null) session.unlockedSecrets = {};
  for (const p of newProfiles) {
    if (!oldIds.has(p.id) && session.unlockedSecrets && !session.unlockedSecrets[p.id]) {
      session.unlockedSecrets[p.id] = {};
    }
  }

  session.encryptionPasswordSession = session.encryptionPasswordSession || encryptionPasswordFromTimestamp();
  try {
    persistEncrypted();
  } catch (e) {
    console.error(e);
    return { ok: false, error: 'encrypt_failed' };
  }
  return { ok: true };
}

/** Runtime settings for uploaders based on active profile + unlocked secrets */
export function getRuntimeUploadSettings(): RuntimeUploadSettings | { error: 'locked' | 'no_profile' } {
  const s = loadAppSettings();
  if (session.vaultLocked || (s.vault && session.unlockedSecrets == null)) {
    return { error: 'locked' };
  }
  const profile = s.profiles.find((p) => p.id === s.activeProfileId) || s.profiles[0];
  if (!profile) return { error: 'no_profile' };

  const sec = (session.unlockedSecrets && session.unlockedSecrets[profile.id]) || {};
  return {
    saveMethod: profile.saveMethod,
    baseUrl: profile.baseUrl,
    afterUploadFeedback: s.afterUploadFeedback,
    watermark: s.watermark,
    language: s.language,
    profileId: profile.id,
    profileName: profile.name,
    ssh: { ...profile.ssh, password: sec.sshPassword || '' },
    ftp: { ...profile.ftp, password: sec.ftpPassword || '' },
    s3: { ...profile.s3, secretAccessKey: sec.s3SecretAccessKey || '' },
    api: { ...profile.api, apiKey: sec.apiKey || '' }
  };
}

/** App settings merged with active-profile upload credentials (empty secrets if locked). */
export function loadSettingsCompat(): RuntimeUploadSettings & AppSettings {
  const appS = loadAppSettings();
  const runtime = getRuntimeUploadSettings();
  if ('error' in runtime) {
    const profile = getActiveProfile() || createEmptyProfile('Default');
    return {
      ...appS,
      saveMethod: profile.saveMethod,
      baseUrl: profile.baseUrl,
      profileId: profile.id,
      profileName: profile.name,
      ssh: { ...profile.ssh, password: '' },
      ftp: { ...profile.ftp, password: '' },
      s3: { ...profile.s3, secretAccessKey: '' },
      api: { ...profile.api, apiKey: '' }
    };
  }
  return { ...appS, ...runtime };
}
