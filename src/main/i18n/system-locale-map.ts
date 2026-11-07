import type { LangCode } from './types';

export const systemLocaleToLang: Record<string, LangCode> = {
en: 'en', 'en-US': 'en', 'en-GB': 'en',
  ru: 'ru', 'ru-RU': 'ru',
  zh: 'zh', 'zh-CN': 'zh', 'zh-TW': 'zh',
  pl: 'pl', 'pl-PL': 'pl',
  ua: 'ua', uk: 'ua', 'uk-UA': 'ua', 'ua-UA': 'ua',
  by: 'by', be: 'by', 'be-BY': 'by', 'by-BY': 'by',
  it: 'it', 'it-IT': 'it',
  es: 'es', 'es-ES': 'es', 'es-MX': 'es',
  pt: 'pt', 'pt-BR': 'pt', 'pt-PT': 'pt',
  fr: 'fr', 'fr-FR': 'fr', 'fr-CA': 'fr',
};
