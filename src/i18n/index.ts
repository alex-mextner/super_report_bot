import type { Locale, BaseTranslation, TranslationKey, Translator } from "./types";
import ru from "./ru";
import en from "./en";
import rs from "./rs";
import { queries } from "../db/index.ts";
import pluralRu from "plural-ru";

export type { Locale, TranslationKey, Translator } from "./types";

// All translations
const translations: Record<Locale, BaseTranslation> = { ru, en, rs };

// Locale names for display
export const localeNames: Record<Locale, string> = {
  ru: "Русский",
  en: "English",
  rs: "Srpski",
};

// Locale flags for display
export const localeFlags: Record<Locale, string> = {
  ru: "🇷🇺",
  en: "🇬🇧",
  rs: "🇷🇸",
};

// Default locale
export const defaultLocale: Locale = "ru";

// Check if locale is valid
export function isValidLocale(locale: string): locale is Locale {
  return locale === "ru" || locale === "en" || locale === "rs";
}

// Detect locale from Telegram language code
export function detectLocale(telegramLangCode?: string): Locale {
  if (!telegramLangCode) return defaultLocale;

  const code = telegramLangCode.toLowerCase().split("-")[0];

  switch (code) {
    case "ru":
      return "ru";
    case "en":
      return "en";
    case "sr":
      return "rs";
    default:
      return defaultLocale;
  }
}

// Simple interpolation for translations with {param} placeholders
function interpolate(
  template: string,
  params: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? ""));
}

// English plural: simple 1 vs other
function pluralEn(n: number, one: string, other: string): string {
  return Math.abs(n) === 1 ? one : other;
}

// Create translation function for a locale
export function createTranslator(locale: Locale): Translator {
  const trans = translations[locale] ?? translations[defaultLocale];

  return function t(
    key: TranslationKey,
    params?: Record<string, string | number>
  ): string {
    let template = trans[key];
    if (!template) return String(key);

    // Auto-pluralize: if template has | and params.n is a number
    if (template.includes("|") && params && typeof params.n === "number") {
      const forms = template.split("|");
      const f0 = forms[0] ?? template;
      const f1 = forms[1] ?? f0;
      const f2 = forms[2] ?? f1;
      if (locale === "en") {
        // English: 2 forms (one|other)
        template = pluralEn(params.n, f0, f1);
      } else {
        // Russian/Serbian: 3 forms via plural-ru
        template = pluralRu(params.n, f0, f1, f2);
      }
    }

    if (!params) return template;
    return interpolate(template, params);
  };
}

// Cache for translators
const translatorCache = new Map<Locale, Translator>();

// Get cached translator for locale
export function getTranslatorForLocale(locale: Locale): Translator {
  let translator = translatorCache.get(locale);
  if (!translator) {
    translator = createTranslator(locale);
    translatorCache.set(locale, translator);
  }
  return translator;
}

/**
 * Get user's locale from DB, fallback to default
 */
export function getUserLocale(telegramId: number): Locale {
  const lang = queries.getUserLanguage(telegramId);
  if (lang && isValidLocale(lang)) return lang;
  return defaultLocale;
}

/**
 * Get translator for user by telegram ID
 * Retrieves user's language from DB and returns cached translator
 */
export function getTranslator(telegramId: number): Translator {
  const locale = getUserLocale(telegramId);
  return getTranslatorForLocale(locale);
}

/**
 * Translate a key for a specific user
 * Shorthand for getTranslator(userId)(key, params)
 */
export function t(
  telegramId: number,
  key: TranslationKey,
  params?: Record<string, string | number>
): string {
  return getTranslator(telegramId)(key, params);
}

/**
 * Set user's language and return new translator
 */
export function setUserLanguage(telegramId: number, locale: Locale): Translator {
  queries.setUserLanguage(telegramId, locale);
  return getTranslatorForLocale(locale);
}


/**
 * Get language name for LLM prompts
 * Returns the language name in English for instructing LLMs
 */
export function getLanguageNameForLLM(locale: Locale): string {
  switch (locale) {
    case "ru":
      return "Russian";
    case "en":
      return "English";
    case "rs":
      return "Serbian";
    default:
      return "Russian";
  }
}

/**
 * Get language name for LLM prompts by user ID
 */
export function getLLMLanguage(telegramId: number): string {
  const locale = getUserLocale(telegramId);
  return getLanguageNameForLLM(locale);
}

// Re-export translations for direct access if needed
export { ru, en, rs };
