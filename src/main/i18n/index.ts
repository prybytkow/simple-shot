import type { LangCode, TranslationMap } from './types';
import { systemLocaleToLang } from './system-locale-map';
import { en } from './locales/en';
import { ru } from './locales/ru';
import { zh } from './locales/zh';
import { pl } from './locales/pl';
import { ua } from './locales/ua';
import { by } from './locales/by';
import { it } from './locales/it';
import { es } from './locales/es';
import { pt } from './locales/pt';
import { fr } from './locales/fr';

export type { LangCode } from './types';

const translations: Record<LangCode, TranslationMap> = {
  en,
  ru,
  zh,
  pl,
  ua,
  by,
  it,
  es,
  pt,
  fr
};

/** Resolve settings language ('system' or '') + app locale to supported lang code. Default: en. */
export function resolveLanguage(settingsLang: string | undefined, appLocale: string): LangCode {
  const normalized =
    settingsLang === 'uk' ? 'ua' :
    settingsLang === 'be' ? 'by' :
    settingsLang;
  if (normalized && normalized !== 'system' && translations[normalized as LangCode]) {
    return normalized as LangCode;
  }
  const locale = (appLocale || 'en').split('-')[0];
  const full = appLocale || 'en';
  return systemLocaleToLang[full] || systemLocaleToLang[locale] || 'en';
}

/** Get all translation strings for a language. */
export function getTranslations(lang: LangCode): TranslationMap {
  return translations[lang] || translations.en;
}

export const supportedLanguages: { code: string; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'ru', name: 'Русский' },
  { code: 'zh', name: '中文' },
  { code: 'pl', name: 'Polski' },
  { code: 'ua', name: 'Українська' },
  { code: 'by', name: 'Беларуская' },
  { code: 'it', name: 'Italiano' },
  { code: 'es', name: 'Español' },
  { code: 'pt', name: 'Português' },
  { code: 'fr', name: 'Français' },
];
