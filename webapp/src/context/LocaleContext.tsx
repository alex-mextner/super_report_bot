import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { apiClient } from "../api/client";

type Locale = "ru" | "en" | "rs";

interface LocaleContextType {
  locale: Locale;
  intlLocale: string; // "ru-RU", "en-US", "sr-RS"
}

const LocaleContext = createContext<LocaleContextType>({
  locale: "en",
  intlLocale: "en-US",
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

  return (
    <LocaleContext.Provider value={{ locale, intlLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}
