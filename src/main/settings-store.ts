/**
 * Settings store: named upload profiles + encrypted secrets vault.
 */
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import {
  VaultBlob,
  ProfileSecrets,
  SecretsPayload,
  encryptSecrets,
  decryptSecrets
} from './vault-crypto';

export type SaveMethod = 'ssh' | 'ftp' | 's3' | 'api';
export type AfterUploadFeedback = 'overlay' | 'notification' | 'window';

export interface UploadProfile {
  id: string;
  name: string;
  showInTray: boolean;
  saveMethod: SaveMethod;
  baseUrl: string;
  ssh: {
    host: string;
    port: number;
    username: string;
    privateKeyPath: string;
    destinationPath: string;
  };
  ftp: {
    host: string;
    port: number;
    username: string;
    destinationPath: string;
    secure: boolean;
  };
  s3: {
    accessKeyId: string;
    bucket: string;
    region: string;
    endpoint: string;
  };
  api: {
    endpoint: string;
  };
}

export interface AppSettings {
  language?: string;
  afterUploadFeedback?: AfterUploadFeedback;
  watermark?: {
    enabled: boolean;
    text: string;
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
    fontSize: number;
    color: string;
    opacity: number;
  };
  activeProfileId: string;
  profiles: UploadProfile[];
  /** Encrypted secrets for all profiles (scrypt + AES-256-GCM) */
  vault: VaultBlob | null;
}

/** Flat settings shape expected by uploaders */
export interface RuntimeUploadSettings {
  saveMethod: SaveMethod;
  baseUrl: string;
  afterUploadFeedback?: AfterUploadFeedback;
  watermark?: AppSettings['watermark'];
  language?: string;
  ssh: UploadProfile['ssh'] & { password: string };
  ftp: UploadProfile['ftp'] & { password: string };
  s3: UploadProfile['s3'] & { secretAccessKey: string };
  api: UploadProfile['api'] & { apiKey: string };
  profileId: string;
  profileName: string;
}

export interface ProfileSecretFlags {
  sshPasswordSet: boolean;
  ftpPasswordSet: boolean;
  s3SecretSet: boolean;
  apiKeySet: boolean;
}

export interface SettingsForUi {
  language?: string;
  afterUploadFeedback?: AfterUploadFeedback;
  watermark?: AppSettings['watermark'];
  activeProfileId: string;
  profiles: UploadProfile[];
  vault: { hasVault: boolean; isUnlocked: boolean; needsSetup: boolean };
  secretFlags: Record<string, ProfileSecretFlags>;
}

const settingsPath = (): string => path.join(app.getPath('userData'), 'settings.json');

let cached: AppSettings | null = null;
let unlockedSecrets: SecretsPayload | null = null;
let masterPasswordSession: string | null = null;

function emptySsh() {
  return { host: '', port: 22, username: '', privateKeyPath: '', destinationPath: '/uploads' };
}
function emptyFtp() {
  return { host: '', port: 21, username: '', destinationPath: '/uploads', secure: false };
}
function emptyS3() {
  return { accessKeyId: '', bucket: '', region: 'us-east-1', endpoint: '' };
}
function emptyApi() {
  return { endpoint: '' };
}

export function createEmptyProfile(name: string): UploadProfile {
  return {
    id: randomUUID(),
    name: name || 'Default',
    showInTray: true,
    saveMethod: 'ssh',
    baseUrl: 'https://mysite.com',
    ssh: emptySsh(),
    ftp: emptyFtp(),
    s3: emptyS3(),
    api: emptyApi()
  };
}

function defaultWatermark(): NonNullable<AppSettings['watermark']> {
  return {
    enabled: false,
    text: '',
    position: 'bottom-right',
    fontSize: 24,
    color: '#ffffff',
    opacity: 0.5
  };
}

function defaultAppSettings(): AppSettings {
  const profile = createEmptyProfile('Default');
  return {
    language: '',
    afterUploadFeedback: 'overlay',
    watermark: defaultWatermark(),
    activeProfileId: profile.id,
    profiles: [profile],
    vault: null
  };
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
    activeProfileId: profile.id,
    profiles: [profile],
    vault: null
  };
  return { settings, secrets };
}

function normalizeProfile(raw: any, fallbackName: string): UploadProfile {
  const base = createEmptyProfile(fallbackName);
  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : base.id,
    name: (raw?.name || fallbackName).trim() || fallbackName,
    showInTray: raw?.showInTray !== false,
    saveMethod: (['ssh', 'ftp', 's3', 'api'].includes(raw?.saveMethod) ? raw.saveMethod : 'ssh') as SaveMethod,
    baseUrl: raw?.baseUrl ?? base.baseUrl,
    ssh: { ...base.ssh, ...(raw?.ssh || {}), password: undefined } as UploadProfile['ssh'],
    ftp: { ...base.ftp, ...(raw?.ftp || {}), password: undefined } as UploadProfile['ftp'],
    s3: {
      accessKeyId: raw?.s3?.accessKeyId ?? '',
      bucket: raw?.s3?.bucket ?? '',
      region: raw?.s3?.region ?? 'us-east-1',
      endpoint: raw?.s3?.endpoint ?? ''
    },
    api: { endpoint: raw?.api?.endpoint ?? '' }
  };
}

function stripAccidentalSecrets(profile: UploadProfile): UploadProfile {
  const ssh = { ...profile.ssh } as any;
  const ftp = { ...profile.ftp } as any;
  const s3 = { ...profile.s3 } as any;
  const api = { ...profile.api } as any;
  delete ssh.password;
  delete ftp.password;
  delete s3.secretAccessKey;
  delete api.apiKey;
  return { ...profile, ssh, ftp, s3, api };
}

function persist(settings: AppSettings): void {
  const toWrite: AppSettings = {
    ...settings,
    profiles: settings.profiles.map(stripAccidentalSecrets),
    vault: settings.vault
  };
  fs.writeFileSync(settingsPath(), JSON.stringify(toWrite, null, 2), 'utf8');
  cached = settings;
}

export function loadAppSettings(): AppSettings {
  if (cached) return cached;
  const defaults = defaultAppSettings();
  try {
    const p = settingsPath();
    if (!fs.existsSync(p)) {
      cached = defaults;
      persist(defaults);
      return cached;
    }
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as any;
    if (isLegacySettings(parsed)) {
      const { settings, secrets } = migrateLegacy(parsed);
      // Keep migrated secrets in memory until user creates a vault
      if (Object.keys(secrets).length > 0) {
        unlockedSecrets = secrets;
        masterPasswordSession = null;
      }
      persist(settings);
      cached = settings;
      return settings;
    }

    let profiles: UploadProfile[] = Array.isArray(parsed.profiles)
      ? parsed.profiles.map((pr: any, i: number) => normalizeProfile(pr, i === 0 ? 'Default' : `Profile ${i + 1}`))
      : [];
    if (profiles.length === 0) profiles = defaults.profiles;

    let activeProfileId = parsed.activeProfileId;
    if (!profiles.some((pr) => pr.id === activeProfileId)) {
      activeProfileId = profiles[0].id;
    }

    const settings: AppSettings = {
      language: parsed.language ?? '',
      afterUploadFeedback:
        parsed.afterUploadFeedback === 'notification' || parsed.afterUploadFeedback === 'window'
          ? parsed.afterUploadFeedback
          : 'overlay',
      watermark: { ...defaultWatermark(), ...(parsed.watermark || {}) },
      activeProfileId,
      profiles,
      vault: parsed.vault && typeof parsed.vault === 'object' ? parsed.vault : null
    };
    cached = settings;
    return settings;
  } catch (e) {
    console.error('Error loading settings:', e);
    cached = defaults;
    return defaults;
  }
}

export function saveAppSettings( partial: {
  language?: string;
  afterUploadFeedback?: AfterUploadFeedback;
  watermark?: AppSettings['watermark'];
  activeProfileId?: string;
  profiles?: UploadProfile[];
}): AppSettings {
  const current = loadAppSettings();
  const next: AppSettings = {
    ...current,
    language: partial.language !== undefined ? partial.language : current.language,
    afterUploadFeedback:
      partial.afterUploadFeedback !== undefined ? partial.afterUploadFeedback : current.afterUploadFeedback,
    watermark: partial.watermark ? { ...defaultWatermark(), ...partial.watermark } : current.watermark,
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
  if (!next.profiles.some((p) => p.id === next.activeProfileId)) {
    next.activeProfileId = next.profiles[0]?.id || createEmptyProfile('Default').id;
  }
  persist(next);
  return next;
}

export function setActiveProfile(id: string): boolean {
  const s = loadAppSettings();
  if (!s.profiles.some((p) => p.id === id)) return false;
  s.activeProfileId = id;
  persist(s);
  return true;
}

export function getActiveProfile(): UploadProfile {
  const s = loadAppSettings();
  return s.profiles.find((p) => p.id === s.activeProfileId) || s.profiles[0];
}

function vaultStatus(): { hasVault: boolean; isUnlocked: boolean; needsSetup: boolean } {
  const s = loadAppSettings();
  const hasVault = !!s.vault;
  const isUnlocked = unlockedSecrets != null;
  const pendingSecrets = unlockedSecrets && Object.values(unlockedSecrets).some(hasAnySecret);
  const needsSetup = !hasVault && !!pendingSecrets;
  return { hasVault, isUnlocked, needsSetup };
}

/** True if user must unlock before upload (vault exists and locked) */
export function isVaultLockedBlocking(): boolean {
  const s = loadAppSettings();
  return !!s.vault && unlockedSecrets == null;
}

/** True if vault must be created before secrets can be persisted */
export function needsVaultSetup(): boolean {
  return !loadAppSettings().vault;
}

export function isVaultUnlocked(): boolean {
  return unlockedSecrets != null;
}

export function hasVault(): boolean {
  return !!loadAppSettings().vault;
}

export function unlockVault(password: string): { ok: boolean; error?: string } {
  const s = loadAppSettings();
  if (!s.vault) return { ok: false, error: 'no_vault' };
  try {
    unlockedSecrets = decryptSecrets(password, s.vault);
    masterPasswordSession = password;
    return { ok: true };
  } catch {
    unlockedSecrets = null;
    masterPasswordSession = null;
    return { ok: false, error: 'bad_password' };
  }
}

export function lockVault(): void {
  unlockedSecrets = null;
  masterPasswordSession = null;
}

export function setupVault(password: string): { ok: boolean; error?: string } {
  if (!password || password.length < 4) return { ok: false, error: 'weak_password' };
  const s = loadAppSettings();
  if (s.vault) return { ok: false, error: 'already_exists' };
  const payload: SecretsPayload = unlockedSecrets ? { ...unlockedSecrets } : {};
  // ensure all profile ids exist as keys
  for (const p of s.profiles) {
    if (!payload[p.id]) payload[p.id] = {};
  }
  try {
    s.vault = encryptSecrets(password, payload);
    unlockedSecrets = payload;
    masterPasswordSession = password;
    persist(s);
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: 'encrypt_failed' };
  }
}

export function changeVaultPassword(oldPassword: string, newPassword: string): { ok: boolean; error?: string } {
  if (!newPassword || newPassword.length < 4) return { ok: false, error: 'weak_password' };
  const s = loadAppSettings();
  if (!s.vault) return { ok: false, error: 'no_vault' };
  try {
    const payload = decryptSecrets(oldPassword, s.vault);
    s.vault = encryptSecrets(newPassword, payload);
    unlockedSecrets = payload;
    masterPasswordSession = newPassword;
    persist(s);
    return { ok: true };
  } catch {
    return { ok: false, error: 'bad_password' };
  }
}

export function resetVault(): void {
  const s = loadAppSettings();
  s.vault = null;
  unlockedSecrets = {};
  masterPasswordSession = null;
  persist(s);
}

function ensureUnlockedForSecrets(): void {
  if (unlockedSecrets == null) {
    unlockedSecrets = {};
  }
}

function persistVaultIfPossible(): void {
  const s = loadAppSettings();
  if (!s.vault || !masterPasswordSession || unlockedSecrets == null) return;
  s.vault = encryptSecrets(masterPasswordSession, unlockedSecrets);
  persist(s);
}

export function getSecretsForProfile(profileId: string): ProfileSecrets {
  if (!unlockedSecrets) return {};
  return unlockedSecrets[profileId] || {};
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
  if (s.vault && unlockedSecrets == null) {
    return { ok: false, error: 'locked' };
  }
  ensureUnlockedForSecrets();
  const cur = { ...(unlockedSecrets![profileId] || {}) };
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
  unlockedSecrets![profileId] = cur;

  if (s.vault) {
    if (!masterPasswordSession) return { ok: false, error: 'locked' };
    persistVaultIfPossible();
  }
  // If no vault yet and we have secrets — caller should prompt setup
  return { ok: true };
}

export function deleteProfileSecrets(profileId: string): void {
  if (!unlockedSecrets) return;
  delete unlockedSecrets[profileId];
  persistVaultIfPossible();
}

export function getSecretFlags(): Record<string, ProfileSecretFlags> {
  const s = loadAppSettings();
  const out: Record<string, ProfileSecretFlags> = {};
  for (const p of s.profiles) {
    if (unlockedSecrets) {
      out[p.id] = flagsFromSecrets(unlockedSecrets[p.id]);
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

export function getSettingsForUi(): SettingsForUi {
  const s = loadAppSettings();
  const status = vaultStatus();
  // needsSetup also if no vault and user never set one — first-time with secrets pending
  const pendingSecrets = unlockedSecrets && Object.values(unlockedSecrets).some(hasAnySecret);
  return {
    language: s.language,
    afterUploadFeedback: s.afterUploadFeedback,
    watermark: s.watermark,
    activeProfileId: s.activeProfileId,
    profiles: s.profiles.map(stripAccidentalSecrets),
    vault: {
      hasVault: status.hasVault,
      isUnlocked: status.isUnlocked,
      needsSetup: !status.hasVault && !!pendingSecrets
    },
    secretFlags: getSecretFlags()
  };
}

/**
 * Save full UI payload: global settings + profiles list + optional secrets per profile.
 * secretsByProfile: { [id]: { sshPassword?, ... } } empty string = keep
 */
export function saveFromUi(payload: {
  language?: string;
  afterUploadFeedback?: AfterUploadFeedback;
  watermark?: AppSettings['watermark'];
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
  const oldIds = new Set(prev.profiles.map((p) => p.id));
  const newProfiles = payload.profiles.map((pr, i) => normalizeProfile(pr, pr.name || `Profile ${i + 1}`));
  if (newProfiles.length === 0) {
    return { ok: false, error: 'no_profiles' };
  }

  if (prev.vault && unlockedSecrets == null && payload.secretsByProfile &&
      Object.values(payload.secretsByProfile).some((x) =>
        (x.sshPassword && x.sshPassword.length > 0) ||
        (x.ftpPassword && x.ftpPassword.length > 0) ||
        (x.s3SecretAccessKey && x.s3SecretAccessKey.length > 0) ||
        (x.apiKey && x.apiKey.length > 0)
      )) {
    return { ok: false, error: 'locked' };
  }

  let activeProfileId = payload.activeProfileId || prev.activeProfileId;
  if (!newProfiles.some((p) => p.id === activeProfileId)) {
    activeProfileId = newProfiles[0].id;
  }

  const next: AppSettings = {
    language: payload.language !== undefined ? payload.language : prev.language,
    afterUploadFeedback:
      payload.afterUploadFeedback !== undefined ? payload.afterUploadFeedback : prev.afterUploadFeedback,
    watermark: payload.watermark ? { ...defaultWatermark(), ...payload.watermark } : prev.watermark,
    activeProfileId,
    profiles: newProfiles,
    vault: prev.vault
  };
  persist(next);

  // Drop secrets for deleted profiles
  if (unlockedSecrets) {
    const newIds = new Set(newProfiles.map((p) => p.id));
    for (const id of Object.keys(unlockedSecrets)) {
      if (!newIds.has(id)) delete unlockedSecrets[id];
    }
  }

  if (payload.secretsByProfile) {
    for (const [id, sec] of Object.entries(payload.secretsByProfile)) {
      const r = updateProfileSecrets(id, sec);
      if (!r.ok) return { ok: false, error: r.error };
    }
  }

  // New profiles: ensure secret keys exist
  ensureUnlockedForSecrets();
  for (const p of newProfiles) {
    if (!oldIds.has(p.id) && unlockedSecrets && !unlockedSecrets[p.id]) {
      unlockedSecrets[p.id] = {};
    }
  }
  persistVaultIfPossible();

  const pending = unlockedSecrets && Object.values(unlockedSecrets).some(hasAnySecret);
  const needsVaultSetup = !loadAppSettings().vault && !!pending;
  return { ok: true, needsVaultSetup };
}

/** Runtime settings for uploaders based on active profile + unlocked secrets */
export function getRuntimeUploadSettings(): RuntimeUploadSettings | { error: 'locked' | 'no_profile' } {
  const s = loadAppSettings();
  const profile = s.profiles.find((p) => p.id === s.activeProfileId) || s.profiles[0];
  if (!profile) return { error: 'no_profile' };

  if (s.vault && unlockedSecrets == null) {
    return { error: 'locked' };
  }

  const sec = (unlockedSecrets && unlockedSecrets[profile.id]) || {};
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

/** Compatibility helper used by code that still calls loadSettings() */
export function loadSettingsCompat(): RuntimeUploadSettings & AppSettings {
  const appS = loadAppSettings();
  const runtime = getRuntimeUploadSettings();
  if ('error' in runtime) {
    // locked: return structure without secrets
    const profile = getActiveProfile();
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
