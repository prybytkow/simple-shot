/** Settings types and pure normalizers. */
import { randomUUID } from 'crypto';
import type { VaultBlob, SecretsPayload } from './vault-crypto';

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
  vault: {
    hasVault: boolean;
    isUnlocked: boolean;
    needsSetup: boolean;
    /** Old master-password vault awaiting one-time unlock */
    needsLegacyUnlock?: boolean;
  };
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

export function defaultWatermark(): NonNullable<AppSettings['watermark']> {
  return {
    enabled: false,
    text: '',
    position: 'bottom-right',
    fontSize: 24,
    color: '#ffffff',
    opacity: 0.5
  };
}

export function defaultAppSettings(): AppSettings {
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

export function normalizeProfile(raw: any, fallbackName: string): UploadProfile {
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

export function stripAccidentalSecrets(profile: UploadProfile): UploadProfile {
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
export const CONFIG_VERSION = 2;

export interface VaultConfigPayload {
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
