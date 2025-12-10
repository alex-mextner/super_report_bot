export interface ExtractedPrice {
  raw: string | null;
  value: number | null;
  currency: string | null; // ISO: RUB, USD, EUR, RSD
}

interface CurrencyPattern {
  pattern: RegExp;
  currency: string;
  multiplier?: number; // for "50к" -> 50000
}

const CURRENCY_PATTERNS: CurrencyPattern[] = [
  // Rubles: "50000 руб", "50 000₽", "50000р"
  {
    pattern: /(\d{1,3}(?:[\s\u00A0]?\d{3})*)\s*(?:руб\.?|₽|р\.?|рублей)/gi,
    currency: "RUB",
  },
  // Thousands (RUB): "50к", "50 тыс", "50т"
  {
    pattern: /(\d{1,3}(?:[\s\u00A0]?\d{3})*)\s*(?:тыс\.?|т\.?|к)\b/gi,
    currency: "RUB",
    multiplier: 1000,
  },
  // USD: "$500", "500$"
  {
    pattern: /\$\s*(\d{1,3}(?:[\s\u00A0,]?\d{3})*)/gi,
    currency: "USD",
  },
  {
    pattern: /(\d{1,3}(?:[\s\u00A0,]?\d{3})*)\s*\$/gi,
    currency: "USD",
  },
  // EUR: "€500", "500€", "500 евро"
  {
    pattern: /€\s*(\d{1,3}(?:[\s\u00A0,]?\d{3})*)/gi,
    currency: "EUR",
  },
  {
    pattern: /(\d{1,3}(?:[\s\u00A0,]?\d{3})*)\s*(?:€|евро)/gi,
    currency: "EUR",
  },
  // RSD (Serbian Dinar): "500 din", "500 дин", "500 RSD"
  {
    pattern: /(\d{1,3}(?:[\s\u00A0.]?\d{3})*)\s*(?:din|дин|rsd)/gi,
    currency: "RSD",
  },
  // Price label (default RUB): "цена: 50000", "цена 50000"
  {
    pattern: /цена[:\s]+(\d{1,3}(?:[\s\u00A0]?\d{3})*)/gi,
    currency: "RUB",
  },
];

// Fallback pattern for numbers with space separators (assume RUB)
const FALLBACK_PATTERN = /(\d{1,3}(?:[\s\u00A0]\d{3})+)\b/g;

export function extractPrice(text: string): ExtractedPrice {
  // Try currency-specific patterns first
  for (const { pattern, currency, multiplier } of CURRENCY_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match) {
      const raw = match[0];
      const matchedNumber = match[1];
      if (!matchedNumber) continue;

      let value = parseInt(matchedNumber.replace(/[\s\u00A0,.]/g, ""), 10);
      if (isNaN(value)) continue;

      if (multiplier) {
        value *= multiplier;
      }

      return { raw, value, currency };
    }
  }

  // Fallback: number with space separators (assume RUB)
  FALLBACK_PATTERN.lastIndex = 0;
  const fallbackMatch = FALLBACK_PATTERN.exec(text);
  if (fallbackMatch) {
    const raw = fallbackMatch[0];
    const matchedNumber = fallbackMatch[1];
    if (matchedNumber) {
      const value = parseInt(matchedNumber.replace(/[\s\u00A0]/g, ""), 10);
      if (!isNaN(value)) {
        return { raw, value, currency: "RUB" };
      }
    }
  }

  return { raw: null, value: null, currency: null };
}
