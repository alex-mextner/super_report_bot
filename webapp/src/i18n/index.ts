import { ru, type TranslationKey, type Translations } from "./ru";
import { en } from "./en";
import { rs } from "./rs";

export type Locale = "ru" | "en" | "rs";

export type { TranslationKey, Translations };

const translations: Record<Locale, Translations> = {
  ru,
  en,
  rs,
};

export function getTranslations(locale: Locale): Translations {
  return translations[locale] || translations.en;
}

export function translate(
  locale: Locale,
  key: TranslationKey,
  params?: Record<string, string | number>
): string {
  const dict = getTranslations(locale);
  let text = dict[key] || key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }

  return text;
}
