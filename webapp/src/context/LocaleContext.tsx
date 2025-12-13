import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { apiClient } from "../api/client";
import { translate, type Locale, type TranslationKey } from "../i18n";

interface LocaleContextType {
  locale: Locale;
  intlLocale: string; // "ru-RU", "en-US", "sr-RS"
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextType>({
  locale: "en",
  intlLocale: "en-US",
  t: (key) => key,
});

interface LocaleResponse {
  locale: Locale;
  intlLocale: string;
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>("en");
  const [intlLocale, setIntlLocale] = useState("en-US");

  useEffect(() => {
    apiClient<LocaleResponse>("/api/user/locale")
      .then((data) => {
        setLocale(data.locale);
        setIntlLocale(data.intlLocale);
      })
      .catch(() => {
        // Fallback to en-US on error
      });
  }, []);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) => {
      return translate(locale, key, params);
    },
    [locale]
  );

  return (
    <LocaleContext.Provider value={{ locale, intlLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}
