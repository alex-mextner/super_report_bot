/**
 * Deep product analysis using:
 * 1. Brave Search API for market prices (with source links)
 * 2. DeepSeek for analysis
 * 3. Deterministic scam risk assessment (not LLM-based where possible)
 * 4. Currency conversion via open.er-api.com
 * 5. Multi-item support with separate searches
 */

import { queries } from "../db/index.ts";
import { apiLog } from "../logger.ts";

const BRAVE_API = "https://api.search.brave.com/res/v1/web/search";
const BRAVE_KEY = process.env.BRAVE_API_KEY;

const DEEPSEEK_API = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;

const EXCHANGE_API = "https://open.er-api.com/v6/latest/EUR";

// ============= Search Region =============

type SearchRegion = "serbia" | "general";

const SERBIA_PATTERNS = /серб|сербия|белград|нов[ыи]й\s*сад|serbian|belgrade|novi\s*sad/i;

function detectSearchRegion(groupTitle: string | null | undefined): SearchRegion {
  if (!groupTitle) return "general";
  if (SERBIA_PATTERNS.test(groupTitle)) return "serbia";
  return "general";
}

// Search queries with fallback chain for Serbia: KupujemProdajem → Belgrade → Russia
function getSearchQueries(baseQuery: string, region: SearchRegion): string[] {
  if (region === "serbia") {
    return [
      `site:kupujemprodajem.com ${baseQuery} cena`,
      `${baseQuery} cena beograd`,
      `${baseQuery} цена купить`,
    ];
  }
  return [`${baseQuery} цена купить`];
}

// ============= Types =============

interface BraveResult {
  title: string;
  url: string;
  description: string;
}

interface PriceSource {
  title: string;
  url: string;
  price: string | null;
}

interface ItemAnalysis {
  name: string;
  extractedPrice: string | null;
  extractedPriceNormalized: number | null;
  extractedCurrency: string | null;
  marketPriceMin: number | null;
  marketPriceMax: number | null;
  marketPriceAvg: number | null;
  marketCurrency: string | null;
  // Converted to same currency for comparison
  priceInEur: number | null;
  marketAvgInEur: number | null;
  priceVerdict: "good_deal" | "overpriced" | "fair" | "unknown";
  worthBuying: boolean;
  worthBuyingReason: string;
  sources: PriceSource[];
}

interface ScamRisk {
  level: "low" | "medium" | "high";
  score: number; // 0-100
  flags: string[];
  recommendation: string;
}

interface SimilarProduct {
  id: number;
  groupId: number;
  messageId: number;
  text: string;
  price: number | null;
  currency: string | null;
  date: number;
  link: string | null;
}

export interface DeepAnalysisResult {
  isListing: boolean;
  listingType: "sale" | "rent" | "service" | "other" | null;
  notListingReason: string | null;
  items: ItemAnalysis[];
  scamRisk: ScamRisk;
  overallVerdict: string;
  similarItems: SimilarProduct[];
}

// ============= Currency Conversion =============

interface ExchangeRates {
  rates: Record<string, number>;
  validUntil: number; // timestamp of next midnight UTC
}

let cachedRates: ExchangeRates | null = null;

function getNextMidnightUTC(): number {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return tomorrow.getTime();
}

async function getExchangeRates(): Promise<Record<string, number>> {
  const now = Date.now();

  if (cachedRates && now < cachedRates.validUntil) {
    return cachedRates.rates;
  }

  try {
    const response = await fetch(EXCHANGE_API);
    if (!response.ok) {
      throw new Error(`Exchange API error: ${response.status}`);
    }
    const data = (await response.json()) as { rates: Record<string, number> };
    cachedRates = { rates: data.rates, validUntil: getNextMidnightUTC() };
    apiLog.debug({ ratesCount: Object.keys(data.rates).length }, "Exchange rates fetched, cached until midnight UTC");
    return data.rates;
  } catch (error) {
    apiLog.error({ err: error }, "Failed to fetch exchange rates");
    // Fallback rates
    return {
      EUR: 1,
      USD: 1.05,
      RUB: 105,
      RSD: 117,
      GBP: 0.85,
    };
  }
}

function convertToEur(amount: number, currency: string, rates: Record<string, number>): number | null {
  const rate = rates[currency.toUpperCase()];
  if (!rate) return null;
  return amount / rate;
}

// Normalize currency code from LLM response (may return "рубли", "rubles", etc.)
function normalizeCurrency(currency: string | null): string | null {
  if (!currency) return null;
  const upper = currency.toUpperCase().trim();

  // Direct matches
  if (["RUB", "EUR", "USD", "RSD", "GBP"].includes(upper)) return upper;

  // Common variations
  if (/РУБ|РУБЛ|RUBL/i.test(currency)) return "RUB";
  if (/ЕВР|EURO/i.test(currency)) return "EUR";
  if (/ДОЛЛ|DOLL/i.test(currency)) return "USD";
  if (/ДИН|DINAR/i.test(currency)) return "RSD";
  if (/ФУНТ|POUND/i.test(currency)) return "GBP";

  return upper; // Return as-is, convertToEur will handle unknown
}

// ============= Web Search =============

async function searchWeb(query: string): Promise<BraveResult[]> {
  try {
    if (!BRAVE_KEY) {
      apiLog.warn("BRAVE_API_KEY not set");
      return [];
    }
    const url = `${BRAVE_API}?q=${encodeURIComponent(query)}&count=10`;
    const response = await fetch(url, {
      headers: {
        "X-Subscription-Token": BRAVE_KEY,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      apiLog.warn({ status: response.status }, "Brave search failed");
      return [];
    }

    const data = (await response.json()) as {
      web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
    };
    return (data.web?.results || []).map((r) => ({
      title: r.title || "",
      url: r.url || "",
      description: r.description || "",
    }));
  } catch (error) {
    apiLog.error({ err: error }, "Brave search error");
    return [];
  }
}

// ============= LLM Calls =============

async function callDeepSeek(systemPrompt: string, userPrompt: string, maxTokens = 2000): Promise<string> {
  try {
    if (!DEEPSEEK_KEY) {
      throw new Error("DEEPSEEK_API_KEY not set");
    }
    const response = await fetch(DEEPSEEK_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DEEPSEEK_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      apiLog.warn({ status: response.status, text }, "DeepSeek request failed");
      throw new Error(`DeepSeek API error: ${response.status}`);
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content || "";
  } catch (error) {
    apiLog.error({ err: error }, "DeepSeek error");
    throw error;
  }
}

// ============= Listing Extraction =============

interface NormalizedPrice {
  value: number;
  currency: string;
}

interface ExtractedItem {
  name: string;
  price: NormalizedPrice | null;
  searchQuery: string;
}

async function extractListingInfo(text: string): Promise<{
  isListing: boolean;
  listingType: "sale" | "rent" | "service" | "other" | null;
  notListingReason: string | null;
  items: ExtractedItem[];
}> {
  const systemPrompt = `Ты эксперт по анализу объявлений.
Проанализируй текст и определи:
1. Это объявление (продажа, аренда, услуга)?
2. Какие товары/услуги предлагаются (может быть несколько)?
3. Цены для каждого товара — НОРМАЛИЗУЙ в числовой формат
4. Поисковые запросы для проверки цен каждого товара

ВАЖНО:
- Если в тексте несколько товаров — выдели КАЖДЫЙ отдельно
- Аренда квартиры — тоже объявление (listingType: "rent")
- Если это НЕ объявление — объясни почему (notListingReason)
- Цены ВСЕГДА в формате {"value": число, "currency": "код ISO 4217"}
- "5 тыс руб" → {"value": 5000, "currency": "RUB"}
- "100€" → {"value": 100, "currency": "EUR"}
- "50к" без валюты в русском тексте → {"value": 50000, "currency": "RUB"}
- Отвечай ТОЛЬКО в формате JSON без markdown`;

  const userPrompt = `Текст объявления:
${text}

Верни JSON:
{
  "isListing": boolean,
  "listingType": "sale" | "rent" | "service" | "other" | null,
  "notListingReason": "причина, почему это не объявление (если isListing=false)" | null,
  "items": [
    {
      "name": "название товара/услуги",
      "price": {"value": число, "currency": "код ISO 4217"} или null,
      "searchQuery": "запрос для поиска цены на этот товар"
    }
  ]
}`;

  try {
    const response = await callDeepSeek(systemPrompt, userPrompt);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    apiLog.error({ err: error }, "Failed to extract listing info");
  }

  return { isListing: false, listingType: null, notListingReason: "Не удалось проанализировать текст", items: [] };
}

// ============= Price Analysis =============

async function analyzeItemPrice(
  itemName: string,
  extractedPrice: NormalizedPrice | null,
  searchQuery: string,
  rates: Record<string, number>,
  region: SearchRegion
): Promise<ItemAnalysis> {
  // Convert extracted price to EUR
  const extractedCurrency = extractedPrice?.currency ? normalizeCurrency(extractedPrice.currency) : null;
  const priceInEur =
    extractedPrice?.value && extractedCurrency
      ? convertToEur(extractedPrice.value, extractedCurrency, rates)
      : null;

  // Format for display
  const extractedPriceDisplay = extractedPrice
    ? `${extractedPrice.value.toLocaleString("ru-RU")} ${extractedPrice.currency}`
    : null;

  apiLog.debug(
    { itemName, extractedPrice, extractedCurrency, priceInEur, region },
    "Extracted price from LLM"
  );

  // Search for market prices with fallback chain
  const queries = getSearchQueries(searchQuery, region);
  let searchResults: BraveResult[] = [];

  for (const query of queries) {
    searchResults = await searchWeb(query);
    if (searchResults.length > 0) {
      apiLog.debug({ itemName, query, resultsCount: searchResults.length }, "Search found results");
      break;
    }
    apiLog.debug({ itemName, query }, "Search returned no results, trying fallback");
  }

  if (searchResults.length === 0) {
    return {
      name: itemName,
      extractedPrice: extractedPriceDisplay,
      extractedPriceNormalized: extractedPrice?.value ?? null,
      extractedCurrency,
      marketPriceMin: null,
      marketPriceMax: null,
      marketPriceAvg: null,
      marketCurrency: null,
      priceInEur,
      marketAvgInEur: null,
      priceVerdict: "unknown",
      worthBuying: true,
      worthBuyingReason: "Недостаточно данных для оценки",
      sources: [],
    };
  }

  // Build context with URLs
  const context = searchResults
    .slice(0, 8)
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.description}`)
    .join("\n\n");

  const systemPrompt = `Ты эксперт по анализу цен.
Проанализируй результаты поиска и определи рыночную цену товара.

ВАЖНО:
- Извлеки цены из результатов поиска и НОРМАЛИЗУЙ их в числовой формат
- Укажи валюту найденных цен в формате ISO 4217
- НЕ конвертируй валюты — просто укажи как есть
- Отвечай ТОЛЬКО в формате JSON без markdown`;

  const userPrompt = `Товар: ${itemName}
Цена в объявлении: ${extractedPriceDisplay || "не указана"}

Результаты поиска:
${context}

Верни JSON:
{
  "minPrice": {"value": число, "currency": "код ISO 4217"} или null,
  "maxPrice": {"value": число, "currency": "код ISO 4217"} или null,
  "avgPrice": {"value": число, "currency": "код ISO 4217"} или null,
  "worthBuying": boolean (стоит ли вообще покупать такой товар — качество, отзывы),
  "worthBuyingReason": "причина рекомендации",
  "sources": [
    {"index": номер источника 1-8, "price": "найденная цена как текст или null"}
  ]
}`;

  try {
    const response = await callDeepSeek(systemPrompt, userPrompt);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);

      // Map sources back to URLs
      const sources: PriceSource[] = (parsed.sources || [])
        .map((s: { index: number; price: string | null }) => {
          const result = searchResults[s.index - 1];
          if (!result) return null;
          return {
            title: result.title,
            url: result.url,
            price: s.price,
          };
        })
        .filter(Boolean);

      // Extract market price from normalized format
      const marketAvg = parsed.avgPrice as NormalizedPrice | null;
      const marketMin = parsed.minPrice as NormalizedPrice | null;
      const marketMax = parsed.maxPrice as NormalizedPrice | null;

      // Normalize and convert market price to EUR for comparison
      const normalizedMarketCurrency = marketAvg?.currency ? normalizeCurrency(marketAvg.currency) : null;
      const marketAvgInEur =
        marketAvg?.value && normalizedMarketCurrency
          ? convertToEur(marketAvg.value, normalizedMarketCurrency, rates)
          : null;

      apiLog.debug(
        { itemName, marketAvg, normalizedMarketCurrency, marketAvgInEur, priceInEur },
        "Market price converted"
      );

      // Deterministic price verdict
      const priceVerdict = calculatePriceVerdict(priceInEur, marketAvgInEur);
      apiLog.debug({ itemName, priceVerdict, priceInEur, marketAvgInEur }, "Price verdict calculated");

      return {
        name: itemName,
        extractedPrice: extractedPriceDisplay,
        extractedPriceNormalized: extractedPrice?.value ?? null,
        extractedCurrency,
        marketPriceMin: marketMin?.value ?? null,
        marketPriceMax: marketMax?.value ?? null,
        marketPriceAvg: marketAvg?.value ?? null,
        marketCurrency: normalizedMarketCurrency,
        priceInEur,
        marketAvgInEur,
        priceVerdict,
        worthBuying: parsed.worthBuying ?? true,
        worthBuyingReason: parsed.worthBuyingReason || "",
        sources,
      };
    }
  } catch (error) {
    apiLog.error({ err: error, itemName }, "Failed to analyze item price");
  }

  return {
    name: itemName,
    extractedPrice: extractedPriceDisplay,
    extractedPriceNormalized: extractedPrice?.value ?? null,
    extractedCurrency,
    marketPriceMin: null,
    marketPriceMax: null,
    marketPriceAvg: null,
    marketCurrency: null,
    priceInEur,
    marketAvgInEur: null,
    priceVerdict: "unknown",
    worthBuying: true,
    worthBuyingReason: "Не удалось проанализировать",
    sources: searchResults.slice(0, 3).map((r) => ({
      title: r.title,
      url: r.url,
      price: null,
    })),
  };
}

// ============= Deterministic Logic =============

function calculatePriceVerdict(
  priceInEur: number | null,
  marketAvgInEur: number | null
): "good_deal" | "overpriced" | "fair" | "unknown" {
  if (!priceInEur || !marketAvgInEur) return "unknown";

  const ratio = priceInEur / marketAvgInEur;

  if (ratio < 0.7) return "good_deal";
  if (ratio > 1.3) return "overpriced";
  return "fair";
}

interface ScamFlags {
  flags: string[];
  score: number;
}

// Minimum price threshold for scam detection (in EUR)
// Below this, scam risk from price alone is not flagged
const SCAM_PRICE_THRESHOLD_EUR = 150;

// Apple products have higher scam risk threshold
const APPLE_PATTERNS = /\b(iphone|ipad|macbook|airpods|apple\s*watch|imac|mac\s*(mini|pro|studio))\b/i;

function detectScamFlags(text: string, items: ItemAnalysis[]): ScamFlags {
  const flags: string[] = [];
  let score = 0;

  const textLower = text.toLowerCase();
  const hasAppleProduct = APPLE_PATTERNS.test(text);

  // 1. Suspiciously low price — show only the MOST severe flag
  // Only flag items worth >= 150 EUR (scammers don't bother with cheap stuff)
  const veryLowItems: Array<{ name: string; percent: number }> = []; // <50%
  const lowItems: Array<{ name: string; percent: number }> = []; // 50-70%

  for (const item of items) {
    if (item.priceInEur && item.marketAvgInEur) {
      // Skip cheap items unless it's Apple (always check Apple)
      const isAppleItem = APPLE_PATTERNS.test(item.name);
      if (item.marketAvgInEur < SCAM_PRICE_THRESHOLD_EUR && !isAppleItem && !hasAppleProduct) {
        continue;
      }

      const ratio = item.priceInEur / item.marketAvgInEur;
      const percent = Math.round((1 - ratio) * 100);
      if (ratio < 0.5) {
        veryLowItems.push({ name: item.name, percent });
      } else if (ratio < 0.7) {
        lowItems.push({ name: item.name, percent });
      }
    }
  }

  // Show only the strongest price flag
  if (veryLowItems.length > 0) {
    // Find the most extreme one
    const worst = veryLowItems.reduce((a, b) => (a.percent > b.percent ? a : b));
    if (veryLowItems.length === 1) {
      flags.push(`Подозрительно низкая цена: ${worst.name} (на ${worst.percent}% ниже рынка)`);
    } else {
      flags.push(`Подозрительно низкие цены на ${veryLowItems.length} товара (до ${worst.percent}% ниже рынка)`);
    }
    score += 35;
  } else if (lowItems.length > 0) {
    // Only show "below market" if there's no "suspiciously low"
    const worst = lowItems.reduce((a, b) => (a.percent > b.percent ? a : b));
    if (lowItems.length === 1) {
      flags.push(`Цена ниже рынка: ${worst.name} (на ${worst.percent}% дешевле)`);
    } else {
      flags.push(`Цены ниже рынка на ${lowItems.length} товара (до ${worst.percent}% дешевле)`);
    }
    score += 15;
  }

  // 2. Urgency keywords
  const urgencyPatterns = [
    /срочно/i,
    /только сегодня/i,
    /улетаю/i,
    /уезжаю/i,
    /последний день/i,
    /быстр(о|ая|ый)/i,
    /горящ/i,
  ];
  for (const pattern of urgencyPatterns) {
    if (pattern.test(textLower)) {
      flags.push("Срочность в тексте");
      score += 15;
      break;
    }
  }

  // 3. Prepayment requests
  const prepaymentPatterns = [/предоплат/i, /аванс/i, /залог/i, /переве(ди|сти)/i];
  for (const pattern of prepaymentPatterns) {
    if (pattern.test(textLower)) {
      flags.push("Упоминание предоплаты");
      score += 20;
      break;
    }
  }

  // 4. Suspicious payment methods
  const cryptoPatterns = [/крипт/i, /bitcoin|btc|eth|usdt/i, /binance/i];
  for (const pattern of cryptoPatterns) {
    if (pattern.test(textLower)) {
      flags.push("Криптовалюта как способ оплаты");
      score += 25;
      break;
    }
  }

  // 5. No specific details (very short text)
  if (text.length < 100) {
    flags.push("Очень короткое описание");
    score += 10;
  }

  // Cap score at 100
  score = Math.min(score, 100);

  return { flags, score };
}

function calculateScamLevel(score: number): "low" | "medium" | "high" {
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

function generateScamRecommendation(level: "low" | "medium" | "high", flags: string[]): string {
  if (level === "high") {
    return "⛔ ВЫСОКИЙ РИСК МОШЕННИЧЕСТВА. НЕ ПЕРЕВОДИТЕ НИКАКИХ ДЕНЕГ! Ни предоплату, ни залог, ни «комиссию». Настаивайте на личной встрече и проверке товара перед оплатой.";
  }
  if (level === "medium") {
    return "⚠️ Будьте осторожны. Не переводите деньги заранее. Проверьте продавца, договоритесь о безопасном способе сделки.";
  }
  if (flags.length > 0) {
    return "Незначительные риски. Соблюдайте стандартные меры предосторожности.";
  }
  return "Явных рисков не обнаружено. Стандартные меры предосторожности при онлайн-сделках.";
}

// ============= Similar Products =============

// Currency patterns for price extraction
const PRICE_PATTERNS: Array<{ pattern: RegExp; currency: string; multiplier?: number }> = [
  { pattern: /(\d[\d\s]*)\s*(€|eur|евро)/i, currency: "EUR" },
  { pattern: /(\d[\d\s]*)\s*(\$|usd|долл)/i, currency: "USD" },
  { pattern: /(\d[\d\s]*)\s*(din|динар|дин)/i, currency: "RSD" },
  { pattern: /(\d[\d\s]*)\s*(£|gbp|фунт)/i, currency: "GBP" },
  { pattern: /(\d[\d\s]*)\s*тыс\.?\s*(руб|р\.?|₽)?/i, currency: "RUB", multiplier: 1000 },
  { pattern: /(\d[\d\s]*)\s*к\b/i, currency: "RUB", multiplier: 1000 },
  { pattern: /(\d[\d\s]*)\s*(руб|р\.|₽)/i, currency: "RUB" },
];

function extractPriceFromText(text: string): { price: number; currency: string } | null {
  for (const { pattern, currency, multiplier } of PRICE_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const numStr = match[1].replace(/\s/g, "");
      const num = parseInt(numStr, 10);
      if (!isNaN(num)) {
        return { price: num * (multiplier || 1), currency };
      }
    }
  }
  return null;
}

function buildTelegramLink(groupId: number, messageId: number): string | null {
  // Public groups: t.me/c/GROUP_ID/MESSAGE_ID (for private groups with numeric ID)
  // The group_id from Telegram is negative, we need to remove the -100 prefix
  const normalizedGroupId = Math.abs(groupId);
  // Remove 100 prefix if present (supergroup format)
  const chatId = normalizedGroupId > 1000000000000
    ? normalizedGroupId - 1000000000000
    : normalizedGroupId;
  return `https://t.me/c/${chatId}/${messageId}`;
}

function findSimilarInHistory(items: Array<{ name: string }>, limit: number = 5): SimilarProduct[] {
  if (items.length === 0) return [];

  const firstItem = items[0];
  if (!firstItem) return [];

  const keywords = firstItem.name.toLowerCase().split(/\s+/).slice(0, 3).join(" ");
  const messages = queries.searchMessagesLike(keywords, 20);

  return messages
    .map((msg) => {
      const priceInfo = extractPriceFromText(msg.text);
      return {
        id: msg.id,
        groupId: msg.group_id,
        messageId: msg.message_id,
        text: msg.text.slice(0, 150),
        price: priceInfo?.price ?? null,
        currency: priceInfo?.currency ?? null,
        date: msg.timestamp,
        link: buildTelegramLink(msg.group_id, msg.message_id),
      };
    })
    .filter((p) => p.price !== null)
    .slice(0, limit);
}

// ============= Overall Verdict =============

function generateOverallVerdict(
  items: ItemAnalysis[],
  scamRisk: ScamRisk,
  listingType: string | null
): string {
  const parts: string[] = [];

  // Scam risk summary
  if (scamRisk.level === "high") {
    parts.push("⚠️ ВЫСОКИЙ РИСК МОШЕННИЧЕСТВА");
  } else if (scamRisk.level === "medium") {
    parts.push("⚡ Умеренный риск — будьте внимательны");
  }

  // Price summary
  const goodDeals = items.filter((i) => i.priceVerdict === "good_deal");
  const overpriced = items.filter((i) => i.priceVerdict === "overpriced");

  if (goodDeals.length > 0) {
    parts.push(`✅ Выгодная цена: ${goodDeals.map((i) => i.name).join(", ")}`);
  }
  if (overpriced.length > 0) {
    parts.push(`❌ Завышена цена: ${overpriced.map((i) => i.name).join(", ")}`);
  }

  // Worth buying
  const notWorth = items.filter((i) => !i.worthBuying);
  if (notWorth.length > 0) {
    parts.push(`🚫 Не рекомендуется: ${notWorth.map((i) => i.name).join(", ")}`);
  }

  if (parts.length === 0) {
    if (listingType === "rent") {
      parts.push("Объявление об аренде. Проверьте документы и осмотрите объект лично.");
    } else {
      parts.push("Недостаточно данных для полной оценки.");
    }
  }

  return parts.join("\n");
}

// ============= Main Function =============

export async function deepAnalyze(text: string, groupTitle?: string | null): Promise<DeepAnalysisResult> {
  const region = detectSearchRegion(groupTitle);
  apiLog.info({ textLength: text.length, groupTitle, region }, "Starting deep analysis");

  // Step 1: Get exchange rates
  const rates = await getExchangeRates();

  // Step 2: Extract listing info and items
  const listingInfo = await extractListingInfo(text);
  apiLog.debug({ listingInfo }, "Listing info extracted");

  if (!listingInfo.isListing) {
    const reason = listingInfo.notListingReason || "Не удалось определить тип объявления";
    return {
      isListing: false,
      listingType: null,
      notListingReason: reason,
      items: [],
      scamRisk: {
        level: "low",
        score: 0,
        flags: [],
        recommendation: reason,
      },
      overallVerdict: `Это не объявление: ${reason}`,
      similarItems: [],
    };
  }

  // Step 3: Analyze each item's price (parallel, region-specific search)
  const itemPromises = listingInfo.items.map((item) =>
    analyzeItemPrice(item.name, item.price, item.searchQuery, rates, region)
  );
  const items = await Promise.all(itemPromises);

  // Step 4: Deterministic scam detection
  const { flags, score } = detectScamFlags(text, items);
  const level = calculateScamLevel(score);
  const recommendation = generateScamRecommendation(level, flags);

  const scamRisk: ScamRisk = {
    level,
    score,
    flags,
    recommendation,
  };

  // Step 5: Find similar in history
  const similarItems = findSimilarInHistory(listingInfo.items);

  // Step 6: Generate overall verdict
  const overallVerdict = generateOverallVerdict(items, scamRisk, listingInfo.listingType);

  apiLog.info(
    {
      isListing: true,
      listingType: listingInfo.listingType,
      itemCount: items.length,
      scamLevel: scamRisk.level,
      scamScore: scamRisk.score,
    },
    "Deep analysis complete"
  );

  return {
    isListing: true,
    listingType: listingInfo.listingType,
    notListingReason: null,
    items,
    scamRisk,
    overallVerdict,
    similarItems,
  };
}
