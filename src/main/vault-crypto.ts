/**
 * Cross-platform vault crypto using only Node.js built-ins.
 * scrypt (KDF) + AES-256-GCM — works the same on Windows, macOS, and Linux.
 */
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'crypto';

export const VAULT_VERSION = 1;
export const KDF_NAME = 'scrypt' as const;

/** scrypt params: portable defaults (N=2^15, r=8, p=1) — ~32MB, fine for desktop unlock */
export const SCRYPT_N = 32768;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const KEY_LEN = 32;
export const SALT_LEN = 16;
export const IV_LEN = 12;

export interface VaultBlob {
  version: number;
  kdf: typeof KDF_NAME;
  salt: string; // base64
  N: number;
  r: number;
  p: number;
  iv: string; // base64
  tag: string; // base64
  ciphertext: string; // base64
}

export interface ProfileSecrets {
  sshPassword?: string;
  ftpPassword?: string;
  s3SecretAccessKey?: string;
  apiKey?: string;
}

/** All profile secrets keyed by profile id */
export type SecretsPayload = Record<string, ProfileSecrets>;

function deriveKey(password: string, salt: Buffer, N: number, r: number, p: number): Buffer {
  return scryptSync(password, salt, KEY_LEN, { N, r, p, maxmem: 256 * 1024 * 1024 });
}

export function encryptSecrets(password: string, payload: SecretsPayload): VaultBlob {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plain = Buffer.from(JSON.stringify(payload), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: VAULT_VERSION,
    kdf: KDF_NAME,
    salt: salt.toString('base64'),
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: enc.toString('base64')
  };
}

export function decryptSecrets(password: string, blob: VaultBlob): SecretsPayload {
  if (!blob || blob.kdf !== KDF_NAME) {
    throw new Error('Unsupported vault format');
  }
  const salt = Buffer.from(blob.salt, 'base64');
  const iv = Buffer.from(blob.iv, 'base64');
  const tag = Buffer.from(blob.tag, 'base64');
  const ciphertext = Buffer.from(blob.ciphertext, 'base64');
  const N = blob.N || SCRYPT_N;
  const r = blob.r || SCRYPT_R;
  const p = blob.p || SCRYPT_P;
  const key = deriveKey(password, salt, N, r, p);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const parsed = JSON.parse(dec.toString('utf8')) as SecretsPayload;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid vault payload');
  }
  return parsed;
}

export function reencryptSecrets(oldPassword: string, newPassword: string, blob: VaultBlob): VaultBlob {
  const payload = decryptSecrets(oldPassword, blob);
  return encryptSecrets(newPassword, payload);
}
