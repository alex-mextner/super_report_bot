export interface ExtractedPrice {
  raw: string | null;
  normalized: number | null;
}

const PRICE_PATTERNS = [
  // Rubles: "50000 руб", "50 000₽", "50000р"
  /(\d{1,3}(?:[\s\u00A0]?\d{3})*)\s*(?:руб\.?|₽|р\.?|рублей)/gi,
  // Thousands: "50к", "50 тыс", "50т"
  /(\d{1,3}(?:[\s\u00A0]?\d{3})*)\s*(?:тыс\.?|т\.?|к)\b/gi,
  // USD: "$500", "500$"
  /\$\s*(\d{1,3}(?:[\s\u00A0,]?\d{3})*)/gi,
  /(\d{1,3}(?:[\s\u00A0,]?\d{3})*)\s*\$/gi,
  // Price label: "цена: 50000", "цена 50000"
  /цена[:\s]+(\d{1,3}(?:[\s\u00A0]?\d{3})*)/gi,
  // Just number with space separators (last resort)
  /(\d{1,3}(?:[\s\u00A0]\d{3})+)\b/g,
];

const USD_TO_RUB = 90;

export function extractPrice(text: string): ExtractedPrice {
  for (const pattern of PRICE_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match) {
      const raw = match[0];
      const matchedNumber = match[1];
      if (!matchedNumber) continue;
      let normalized = parseInt(matchedNumber.replace(/[\s\u00A0,]/g, ""), 10);

      if (isNaN(normalized)) continue;

      // Handle thousands notation
      if (/(?:тыс|т\.|к)\b/i.test(raw)) {
        normalized *= 1000;
      }

      // Convert USD to RUB
      if (/\$/.test(raw)) {
        normalized *= USD_TO_RUB;
      }

      return { raw, normalized };
    }
  }

  return { raw: null, normalized: null };
}
