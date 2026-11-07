/**
 * Settings store: named upload profiles + encrypted vault.
 * When a vault exists, settings.json on disk contains the ciphertext plus
 * plaintext hotkeys (not secrets — needed while vault is locked).
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
export type CaptureMode = 'region' | 'fullscreen' | 'window';

export interface CaptureSettings {
  defaultMode: CaptureMode;
  /** 0 = no delay; default 3 */
  delaySeconds: number;
  lastDisplayId?: number;
  lastWindowId?: string;
}

export interface UpdatesSettings {
  /** Quiet check shortly after launch (default true) */
  autoCheck: boolean;
  /** Download when an update is found (default true on Win/mac) */
  autoDownload: boolean;
}

export type ExportFormat = 'png' | 'jpg' | 'webp';
export type ExportDestination = 'upload' | 'file' | 'clipboard';

export interface ExportSettings {
  fileNameTemplate: string;
  format: ExportFormat;
  jpegQuality: number;
  webpQuality: number;
  defaultDestination: ExportDestination;
}

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
  /** Electron accelerators by action id; empty string = unregistered */
  hotkeys?: Record<string, string>;
  /** Capture mode defaults (also stored plaintext on disk like hotkeys) */
  capture?: CaptureSettings;
  /** Auto-update prefs (plaintext on disk; works while vault is locked) */
  updates?: UpdatesSettings;
  /** Export filename template / format (plaintext on disk) */
  export?: ExportSettings;
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
  hotkeys?: Record<string, string>;
  capture?: CaptureSettings;
  updates?: UpdatesSettings;
  export?: ExportSettings;
  activeProfileId: string;
  profiles: UploadProfile[];
  vault: { hasVault: boolean; isUnlocked: boolean; needsSetup: boolean };
  secretFlags: Record<string, ProfileSecretFlags>;
}

/** Default global hotkey accelerators (Electron format). */
export function defaultHotkeys(): Record<string, string> {
  return {
    'capture.region': 'CommandOrControl+Shift+S',
    'capture.fullscreen': 'CommandOrControl+Shift+A',
    'capture.window': 'CommandOrControl+Shift+W',
    'capture.delayed': 'CommandOrControl+Shift+D',
    'history.open': '',
    'settings.open': ''
  };
}

export function normalizeHotkeys(raw: unknown): Record<string, string> {
  const out = defaultHotkeys();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

export function defaultCaptureSettings(): CaptureSettings {
  return { defaultMode: 'region', delaySeconds: 3 };
}

export function normalizeCapture(raw: unknown): CaptureSettings {
  const out = defaultCaptureSettings();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const o = raw as Record<string, unknown>;
  if (o.defaultMode === 'region' || o.defaultMode === 'fullscreen' || o.defaultMode === 'window') {
    out.defaultMode = o.defaultMode;
  }
  const delay = Number(o.delaySeconds);
  if (Number.isFinite(delay) && delay >= 0) {
    out.delaySeconds = Math.min(120, Math.floor(delay));
  }
  if (typeof o.lastDisplayId === 'number' && Number.isFinite(o.lastDisplayId)) {
    out.lastDisplayId = o.lastDisplayId;
  }
  if (typeof o.lastWindowId === 'string' && o.lastWindowId) {
    out.lastWindowId = o.lastWindowId;
  }
  return out;
}

export function defaultUpdatesSettings(): UpdatesSettings {
  return {
    autoCheck: true,
    autoDownload: process.platform !== 'linux'
  };
}

export function normalizeUpdates(raw: unknown): UpdatesSettings {
  const out = defaultUpdatesSettings();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const o = raw as Record<string, unknown>;
  if (typeof o.autoCheck === 'boolean') out.autoCheck = o.autoCheck;
  if (typeof o.autoDownload === 'boolean') out.autoDownload = o.autoDownload;
  return out;
}

export function defaultExportSettings(): ExportSettings {
  return {
    fileNameTemplate: 'screenshot-{yyyy}-{MM}-{dd}_{HH}-{mm}-{ss}',
    format: 'png',
    jpegQuality: 92,
    webpQuality: 90,
    defaultDestination: 'upload'
  };
}

export function normalizeExport(raw: unknown): ExportSettings {
  const out = defaultExportSettings();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const o = raw as Record<string, unknown>;
  if (typeof o.fileNameTemplate === 'string' && o.fileNameTemplate.trim()) {
    out.fileNameTemplate = o.fileNameTemplate.trim();
  }
  if (o.format === 'png' || o.format === 'jpg' || o.format === 'webp') {
    out.format = o.format;
  }
  const jq = Number(o.jpegQuality);
  if (Number.isFinite(jq)) out.jpegQuality = Math.max(1, Math.min(100, Math.round(jq)));
  const wq = Number(o.webpQuality);
  if (Number.isFinite(wq)) out.webpQuality = Math.max(1, Math.min(100, Math.round(wq)));
  if (o.defaultDestination === 'upload' || o.defaultDestination === 'file' || o.defaultDestination === 'clipboard') {
    out.defaultDestination = o.defaultDestination;
  }
  return out;
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
    hotkeys: defaultHotkeys(),
    capture: defaultCaptureSettings(),
    updates: defaultUpdatesSettings(),
    export: defaultExportSettings(),
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
  hotkeys?: Record<string, string>;
  capture?: CaptureSettings;
  updates?: UpdatesSettings;
  export?: ExportSettings;
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

function lockedShell(
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
    hotkeys: hotkeys ? normalizeHotkeys(hotkeys) : (cached?.hotkeys ? normalizeHotkeys(cached.hotkeys) : defaultHotkeys()),
    capture: capture
      ? normalizeCapture(capture)
      : cached?.capture
        ? normalizeCapture(cached.capture)
        : defaultCaptureSettings(),
    updates: updates
      ? normalizeUpdates(updates)
      : cached?.updates
        ? normalizeUpdates(cached.updates)
        : defaultUpdatesSettings(),
    export: exportSettings
      ? normalizeExport(exportSettings)
      : cached?.export
        ? normalizeExport(cached.export)
        : defaultExportSettings(),
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

/** On disk: vault ciphertext + plaintext hotkeys/capture/updates/export. Profiles are never written in the clear. */
function writeDisk(vault: VaultBlob | null): void {
  if (loadFailed) return;
  const hotkeys = normalizeHotkeys(cached?.hotkeys);
  const capture = normalizeCapture(cached?.capture);
  const updates = normalizeUpdates(cached?.updates);
  const exportSettings = normalizeExport(cached?.export);
  fs.writeFileSync(
    settingsPath(),
    JSON.stringify({ vault, hotkeys, capture, updates, export: exportSettings }, null, 2),
    'utf8'
  );
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
    const diskHotkeys = normalizeHotkeys(parsed.hotkeys);
    const diskCapture = normalizeCapture(parsed.capture);
    const diskUpdates = normalizeUpdates(parsed.updates);
    const diskExport = normalizeExport(parsed.export);

    if (isLegacySettings(parsed)) {
      const { settings, secrets } = migrateLegacy(parsed);
      settings.vault = vault;
      settings.hotkeys = diskHotkeys;
      settings.capture = diskCapture;
      settings.updates = diskUpdates;
      settings.export = diskExport;
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
      legacySettings.hotkeys = diskHotkeys;
      legacySettings.capture = diskCapture;
      legacySettings.updates = diskUpdates;
      legacySettings.export = diskExport;
      vaultLocked = true;
      unlockedSecrets = null;
      masterPasswordSession = null;
      cached = lockedShell(vault, diskHotkeys, diskCapture, diskUpdates, diskExport);
      return cached;
    }

    if (vault) {
      vaultLocked = true;
      unlockedSecrets = null;
      masterPasswordSession = null;
      cached = lockedShell(vault, diskHotkeys, diskCapture, diskUpdates, diskExport);
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
  cached = {
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
      : normalizeCapture(raw.capture ?? cached?.capture),
    updates: preserveUpdates
      ? normalizeUpdates(preserveUpdates)
      : normalizeUpdates(raw.updates ?? cached?.updates),
    export: preserveExport
      ? normalizeExport(preserveExport)
      : normalizeExport(raw.export ?? cached?.export),
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
  const keepHotkeys = normalizeHotkeys(s.hotkeys);
  const keepCapture = normalizeCapture(s.capture);
  const keepUpdates = normalizeUpdates(s.updates);
  const keepExport = normalizeExport(s.export);
  if (isConfigPayload(raw)) {
    applyConfigPayload(raw, vault, keepHotkeys, keepCapture, keepUpdates, keepExport);
  } else if (isLegacySecretsMap(raw)) {
    const base = legacySettings
      ? { ...legacySettings, vault, hotkeys: keepHotkeys, capture: keepCapture, updates: keepUpdates, export: keepExport }
      : { ...defaultAppSettings(), vault, hotkeys: keepHotkeys, capture: keepCapture, updates: keepUpdates, export: keepExport };
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
    cached = lockedShell(vault, keepHotkeys, keepCapture, keepUpdates, keepExport);
    return { ok: false, error: 'encrypt_failed' };
  }
  legacySettings = null;
  return { ok: true };
}

export function lockVault(): void {
  const s = loadAppSettings();
  if (!s.vault) return;
  const vault = s.vault;
  const keepHotkeys = normalizeHotkeys(s.hotkeys);
  const keepCapture = normalizeCapture(s.capture);
  const keepUpdates = normalizeUpdates(s.updates);
  const keepExport = normalizeExport(s.export);
  unlockedSecrets = null;
  masterPasswordSession = null;
  vaultLocked = true;
  legacySettings = null;
  cached = lockedShell(vault, keepHotkeys, keepCapture, keepUpdates, keepExport);
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
      hotkeys: normalizeHotkeys(s.hotkeys),
      capture: normalizeCapture(s.capture),
      updates: normalizeUpdates(s.updates),
      export: normalizeExport(s.export),
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
    hotkeys: normalizeHotkeys(s.hotkeys),
    capture: normalizeCapture(s.capture),
    updates: normalizeUpdates(s.updates),
    export: normalizeExport(s.export),
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

/** Current hotkey map (works while vault is locked). */
export function getHotkeys(): Record<string, string> {
  return normalizeHotkeys(loadAppSettings().hotkeys);
}

/** Persist full hotkey map to disk (plaintext; does not require vault unlock). */
export function saveHotkeys(map: Record<string, string>): Record<string, string> {
  const s = loadAppSettings();
  const hotkeys = normalizeHotkeys(map);
  cached = { ...s, hotkeys };
  writeDisk(s.vault);
  if (s.vault && masterPasswordSession && unlockedSecrets && !vaultLocked) {
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
  cached = { ...s, capture };
  writeDisk(s.vault);
  if (s.vault && masterPasswordSession && unlockedSecrets && !vaultLocked) {
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
  cached = { ...s, updates };
  writeDisk(s.vault);
  if (s.vault && masterPasswordSession && unlockedSecrets && !vaultLocked) {
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
  cached = { ...s, export: exportSettings };
  writeDisk(s.vault);
  if (s.vault && masterPasswordSession && unlockedSecrets && !vaultLocked) {
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

  cached = {
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

  // Persist plaintext capture (and hotkeys) even before vault setup
  writeDisk(cached.vault);

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
