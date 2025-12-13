// Types derived from ru.ts (source of truth)
import type { TranslationKeys, Translations } from "./ru";

// Supported locales
export type Locale = "ru" | "en" | "rs";

// Re-export for convenience
export type { TranslationKeys, Translations };

// Alias for backward compatibility
export type BaseTranslation = Translations;
export type TranslationKey = TranslationKeys;

// Translator function type
export type Translator = (
  key: TranslationKey,
  params?: Record<string, string | number>
) => string;
