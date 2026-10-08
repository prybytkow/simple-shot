/**
 * Settings store: named upload profiles + encrypted vault.
 * When a vault exists, settings.json on disk contains only the ciphertext.
 * Profiles, hosts, and secrets stay in memory after unlock.
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

/** Ciphertext version: whole config (profiles + secrets), not passwords alone. */
const CONFIG_VERSION = 2;

interface VaultConfigPayload {
  version: typeof CONFIG_VERSION;
  language?: string;
  afterUploadFeedback?: AfterUploadFeedback;
  watermark?: AppSettings['watermark'];
  activeProfileId: string;
  profiles: UploadProfile[];
  secrets: SecretsPayload;
}

/** Plaintext from an older settings.json, merged in on the next successful unlock. */
let legacySettings: AppSettings | null = null;
/** Vault exists and this session has not unlocked it. Profiles are not kept in memory. */
let vaultLocked = false;
/** Config changed or loaded from plaintext and still needs a master password. */
let pendingPlaintext = false;
/** Parsed file was unreadable — refuse to overwrite it. */
let loadFailed = false;

function lockedShell(vault: VaultBlob | null): AppSettings {
  return {
    language: '',
    afterUploadFeedback: 'overlay',
    watermark: defaultWatermark(),
    activeProfileId: '',
    profiles: [],
    vault
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

/** On disk: only the vault blob. Profiles are never written in the clear. */
function writeDisk(vault: VaultBlob | null): void {
  if (loadFailed) return;
  fs.writeFileSync(settingsPath(), JSON.stringify({ vault }, null, 2), 'utf8');
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
  if (cached) return cached;
  const defaults = defaultAppSettings();
  try {
    const p = settingsPath();
    if (!fs.existsSync(p)) {
      cached = defaults;
      writeDisk(null);
      return cached;
    }
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as any;
    const vault: VaultBlob | null = parsed.vault && typeof parsed.vault === 'object' ? parsed.vault : null;

    if (isLegacySettings(parsed)) {
      const { settings, secrets } = migrateLegacy(parsed);
      settings.vault = vault;
      if (Object.keys(secrets).length > 0) unlockedSecrets = secrets;
      else unlockedSecrets = {};
      pendingPlaintext = true;
      cached = settings;
      return settings;
    }

    if (vault && fileHasPlaintextConfig(parsed)) {
      // Old file: passwords in the vault, profiles still in the clear.
      // Hide profiles until unlock, then fold them into the ciphertext.
      legacySettings = settingsFromParsed(parsed);
      vaultLocked = true;
      unlockedSecrets = null;
      masterPasswordSession = null;
      cached = lockedShell(vault);
      return cached;
    }

    if (vault) {
      vaultLocked = true;
      unlockedSecrets = null;
      masterPasswordSession = null;
      cached = lockedShell(vault);
      return cached;
    }

    if (fileHasPlaintextConfig(parsed)) {
      unlockedSecrets = {};
      pendingPlaintext = true;
      cached = settingsFromParsed(parsed);
      return cached;
    }

    cached = defaults;
    return cached;
  } catch (e) {
    console.error('Error loading settings:', e);
    loadFailed = true;
    cached = defaults;
    return defaults;
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
  if (vaultLocked) return current;
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
  if (!next.profiles.some((p) => p.id === next.activeProfileId) && next.profiles.length > 0) {
    next.activeProfileId = next.profiles[0].id;
  }
  cached = next;
  if (next.vault && masterPasswordSession && unlockedSecrets) {
    persistEncrypted();
  } else if (!next.vault) {
    pendingPlaintext = true;
  }
  return next;
}

export function setActiveProfile(id: string): boolean {
  const s = loadAppSettings();
  if (vaultLocked) return false;
  if (!s.profiles.some((p) => p.id === id)) return false;
  s.activeProfileId = id;
  cached = s;
  if (s.vault && masterPasswordSession && unlockedSecrets) persistEncrypted();
  return true;
}

export function getActiveProfile(): UploadProfile | undefined {
  const s = loadAppSettings();
  if (s.profiles.length === 0) return undefined;
  return s.profiles.find((p) => p.id === s.activeProfileId) || s.profiles[0];
}

function vaultStatus(): { hasVault: boolean; isUnlocked: boolean; needsSetup: boolean } {
  const s = loadAppSettings();
  const hasVault = !!s.vault;
  const isUnlocked = hasVault && !vaultLocked && unlockedSecrets != null;
  const needsSetup = !hasVault && pendingPlaintext;
  return { hasVault, isUnlocked, needsSetup };
}

/** True if user must unlock before upload (vault exists and locked) */
export function isVaultLockedBlocking(): boolean {
  loadAppSettings();
  return vaultLocked;
}

/** True if vault must be created before settings can be stored on disk */
export function needsVaultSetup(): boolean {
  const s = loadAppSettings();
  return !s.vault && pendingPlaintext;
}

export function isVaultUnlocked(): boolean {
  loadAppSettings();
  return !!cached?.vault && !vaultLocked && unlockedSecrets != null;
}

export function hasVault(): boolean {
  return !!loadAppSettings().vault;
}

function buildConfigPayload(): VaultConfigPayload {
  const s = loadAppSettings();
  const secrets: SecretsPayload = unlockedSecrets ? { ...unlockedSecrets } : {};
  for (const p of s.profiles) {
    if (!secrets[p.id]) secrets[p.id] = {};
  }
  return {
    version: CONFIG_VERSION,
    language: s.language,
    afterUploadFeedback: s.afterUploadFeedback,
    watermark: s.watermark,
    activeProfileId: s.activeProfileId,
    profiles: s.profiles.map(stripAccidentalSecrets),
    secrets
  };
}

function applyConfigPayload(raw: VaultConfigPayload, vault: VaultBlob): void {
  const profiles = raw.profiles.map((pr, i) => normalizeProfile(pr, i === 0 ? 'Default' : `Profile ${i + 1}`));
  if (profiles.length === 0) profiles.push(createEmptyProfile('Default'));
  let activeProfileId = raw.activeProfileId;
  if (!profiles.some((p) => p.id === activeProfileId)) activeProfileId = profiles[0].id;
  cached = {
    language: raw.language ?? '',
    afterUploadFeedback:
      raw.afterUploadFeedback === 'notification' || raw.afterUploadFeedback === 'window'
        ? raw.afterUploadFeedback
        : 'overlay',
    watermark: { ...defaultWatermark(), ...(raw.watermark || {}) },
    activeProfileId,
    profiles,
    vault
  };
  unlockedSecrets = { ...(raw.secrets || {}) };
  for (const p of profiles) {
    if (!unlockedSecrets[p.id]) unlockedSecrets[p.id] = {};
  }
}

function persistEncrypted(): void {
  const s = loadAppSettings();
  if (!masterPasswordSession || unlockedSecrets == null) return;
  const blob = encryptSecrets(masterPasswordSession, buildConfigPayload());
  writeDisk(blob);
  s.vault = blob;
  cached = s;
}

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
  if (isConfigPayload(raw)) {
    applyConfigPayload(raw, vault);
  } else if (isLegacySecretsMap(raw)) {
    const base = legacySettings ? { ...legacySettings, vault } : { ...defaultAppSettings(), vault };
    cached = base;
    unlockedSecrets = { ...raw };
    for (const p of base.profiles) {
      if (!unlockedSecrets[p.id]) unlockedSecrets[p.id] = {};
    }
  } else {
    return { ok: false, error: 'bad_password' };
  }
  masterPasswordSession = password;
  vaultLocked = false;
  pendingPlaintext = false;
  try {
    persistEncrypted();
  } catch (e) {
    console.error(e);
    masterPasswordSession = null;
    vaultLocked = true;
    unlockedSecrets = null;
    cached = lockedShell(vault);
    return { ok: false, error: 'encrypt_failed' };
  }
  legacySettings = null;
  return { ok: true };
}

export function lockVault(): void {
  const s = loadAppSettings();
  if (!s.vault) return;
  const vault = s.vault;
  unlockedSecrets = null;
  masterPasswordSession = null;
  vaultLocked = true;
  legacySettings = null;
  cached = lockedShell(vault);
}

export function setupVault(password: string): { ok: boolean; error?: string } {
  if (!password || password.length < 4) return { ok: false, error: 'weak_password' };
  const s = loadAppSettings();
  if (s.vault) return { ok: false, error: 'already_exists' };
  if (unlockedSecrets == null) unlockedSecrets = {};
  for (const p of s.profiles) {
    if (!unlockedSecrets[p.id]) unlockedSecrets[p.id] = {};
  }
  masterPasswordSession = password;
  pendingPlaintext = false;
  legacySettings = null;
  vaultLocked = false;
  try {
    persistEncrypted();
    return { ok: true };
  } catch (e) {
    console.error(e);
    masterPasswordSession = null;
    pendingPlaintext = true;
    return { ok: false, error: 'encrypt_failed' };
  }
}

export function changeVaultPassword(oldPassword: string, newPassword: string): { ok: boolean; error?: string } {
  if (!newPassword || newPassword.length < 4) return { ok: false, error: 'weak_password' };
  const s = loadAppSettings();
  if (!s.vault) return { ok: false, error: 'no_vault' };
  try {
    decryptSecrets(oldPassword, s.vault);
  } catch {
    return { ok: false, error: 'bad_password' };
  }
  if (vaultLocked || unlockedSecrets == null) return { ok: false, error: 'locked' };
  const previousPassword = masterPasswordSession;
  masterPasswordSession = newPassword;
  try {
    persistEncrypted();
    return { ok: true };
  } catch (e) {
    console.error(e);
    masterPasswordSession = previousPassword;
    return { ok: false, error: 'encrypt_failed' };
  }
}

export function resetVault(): void {
  cached = defaultAppSettings();
  unlockedSecrets = {};
  masterPasswordSession = null;
  vaultLocked = false;
  pendingPlaintext = false;
  legacySettings = null;
  loadFailed = false;
  try {
    writeDisk(null);
  } catch (e) {
    console.error(e);
  }
}

function ensureUnlockedForSecrets(): void {
  if (unlockedSecrets == null) {
    unlockedSecrets = {};
  }
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
  return { ok: true };
}

export function deleteProfileSecrets(profileId: string): void {
  if (!unlockedSecrets) return;
  delete unlockedSecrets[profileId];
  if (masterPasswordSession && loadAppSettings().vault) persistEncrypted();
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
  if (vaultLocked) {
    return {
      language: '',
      afterUploadFeedback: 'overlay',
      watermark: defaultWatermark(),
      activeProfileId: '',
      profiles: [],
      vault: { hasVault: true, isUnlocked: false, needsSetup: false },
      secretFlags: {}
    };
  }
  return {
    language: s.language,
    afterUploadFeedback: s.afterUploadFeedback,
    watermark: s.watermark,
    activeProfileId: s.activeProfileId,
    profiles: s.profiles.map(stripAccidentalSecrets),
    vault: {
      hasVault: status.hasVault,
      isUnlocked: status.isUnlocked,
      needsSetup: status.needsSetup
    },
    secretFlags: getSecretFlags()
  };
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
  if (vaultLocked || (prev.vault && unlockedSecrets == null)) {
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

  cached = {
    language: payload.language !== undefined ? payload.language : prev.language,
    afterUploadFeedback:
      payload.afterUploadFeedback !== undefined ? payload.afterUploadFeedback : prev.afterUploadFeedback,
    watermark: payload.watermark ? { ...defaultWatermark(), ...payload.watermark } : prev.watermark,
    activeProfileId,
    profiles: newProfiles,
    vault: prev.vault
  };

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

  ensureUnlockedForSecrets();
  for (const p of newProfiles) {
    if (!oldIds.has(p.id) && unlockedSecrets && !unlockedSecrets[p.id]) {
      unlockedSecrets[p.id] = {};
    }
  }

  if (cached.vault) {
    if (!masterPasswordSession) return { ok: false, error: 'locked' };
    try {
      persistEncrypted();
    } catch (e) {
      console.error(e);
      return { ok: false, error: 'encrypt_failed' };
    }
    return { ok: true };
  }

  pendingPlaintext = true;
  return { ok: true, needsVaultSetup: true };
}

/** Runtime settings for uploaders based on active profile + unlocked secrets */
export function getRuntimeUploadSettings(): RuntimeUploadSettings | { error: 'locked' | 'no_profile' } {
  const s = loadAppSettings();
  if (vaultLocked || (s.vault && unlockedSecrets == null)) {
    return { error: 'locked' };
  }
  const profile = s.profiles.find((p) => p.id === s.activeProfileId) || s.profiles[0];
  if (!profile) return { error: 'no_profile' };

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
