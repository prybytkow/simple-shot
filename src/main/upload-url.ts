/**
 * Shared helpers for public URLs and history method labels after upload.
 */
import { HistoryMethod } from './history';

export interface UploadUrlSettings {
  saveMethod?: string;
  baseUrl?: string;
}

export function historyMethodFromSaveMethod(saveMethod: string): HistoryMethod {
  if (saveMethod === 's3') return 's3';
  if (saveMethod === 'ftp') return 'ftp';
  if (saveMethod === 'api') return 'api';
  return 'ssh';
}

/** Build the public URL shown to the user / copied to clipboard after a network upload. */
export function buildPublicUrl(
  result: string,
  settings: UploadUrlSettings,
  fileName: string
): string {
  const baseUrl = (settings.baseUrl || '').trim().replace(/\/$/, '') || 'https://vault.by';
  if (settings.saveMethod === 'api' && /^https?:\/\//i.test(result)) {
    return result;
  }
  if (settings.saveMethod === 'ssh' || settings.saveMethod === 'ftp') {
    return `${baseUrl}/${fileName}`;
  }
  const urlPath = result.startsWith('/') ? result : `/${result}`;
  return `${baseUrl}${urlPath}`;
}
