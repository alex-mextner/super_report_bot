/**
 * Deep product analysis using:
 * 1. Brave Search API for market prices (with source links)
 * 2. GLM-4.6 (Z.AI) for analysis
 * 3. Deterministic scam risk assessment (not LLM-based where possible)
 * 4. Currency conversion via open.er-api.com
 * 5. Multi-item support with separate searches
 * 6. Group metadata (country/currency) for localized search and display
 */

import { queries } from "../db/index.ts";
import { apiLog } from "../logger.ts";
import { fetchMediaForMessage } from "../listener/index.ts";
import { analyzeListingImage, type ListingImageAnalysis } from "./vision.ts";
import { semanticSearch } from "../embeddings/search.ts";
import type { GroupMetadata } from "../types.ts";
import { getTranslatorForLocale } from "../i18n/index.ts";
import { withRetry, callZAI, MODELS, type LLMMessage } from "./index.ts";

// Simple English pluralization for items count
const pluralItems = (n: number): string => {
  return n === 1 ? `${n} item` : `${n} items`;
};

const BRAVE_API = "https://api.search.brave.com/res/v1/web/search";
const BRAVE_KEY = process.env.BRAVE_API_KEY;

const EXCHANGE_API = "https://open.er-api.com/v6/latest/EUR";

// ============= Search Region =============

// ISO 3166-1 alpha-2 country codes to search region mapping
type SearchRegion = "RS" | "RU" | "AM" | "GE" | "ME" | "general";

// Fallback detection from group title (for groups without metadata)
const SERBIA_PATTERNS = /серб|сербия|белград|нов[ыи]й\s*сад|serbian|belgrade|novi\s*sad/i;
const RUSSIA_PATTERNS = /росси|москв|питер|спб|russian|moscow|piter/i;
const ARMENIA_PATTERNS = /армен|ереван|armenian|yerevan/i;
const GEORGIA_PATTERNS = /груз|тбилиси|батуми|georgian|tbilisi|batumi/i;

function detectSearchRegion(groupMetadata: GroupMetadata | null, groupTitle?: string | null): SearchRegion {
  // First, use country from metadata if available
  if (groupMetadata?.country) {
    const country = groupMetadata.country.toUpperCase();
    if (["RS", "RU", "AM", "GE", "ME"].includes(country)) {
      return country as SearchRegion;
    }
  }

  // Fallback: detect from group title
  if (groupTitle) {
    if (SERBIA_PATTERNS.test(groupTitle)) return "RS";
    if (RUSSIA_PATTERNS.test(groupTitle)) return "RU";
    if (ARMENIA_PATTERNS.test(groupTitle)) return "AM";
    if (GEORGIA_PATTERNS.test(groupTitle)) return "GE";
  }

  return "general";
}

// Country to default currency mapping
const COUNTRY_CURRENCY: Record<string, string> = {
  RS: "RSD",
  RU: "RUB",
  AM: "AMD",
  GE: "GEL",
  ME: "EUR",
  BA: "BAM",
};

// Search queries with fallback chain per region
function getSearchQueries(baseQuery: string, region: SearchRegion): string[] {
  switch (region) {
    case "RS":
      return [
        `site:kupujemprodajem.com ${baseQuery} cena`,
        `${baseQuery} cena beograd`,
        `${baseQuery} цена купить`, // fallback to Russian
      ];
    case "RU":
      return [
        `site:avito.ru ${baseQuery} цена`,
        `${baseQuery} цена купить москва`,
        `${baseQuery} цена купить`,
      ];
    case "AM":
      return [
        `site:list.am ${baseQuery} price`,
        `${baseQuery} цена ереван`,
        `${baseQuery} цена купить`,
      ];
    case "GE":
      return [
        `site:mymarket.ge ${baseQuery} price`,
        `${baseQuery} цена тбилиси`,
        `${baseQuery} цена купить`,
      ];
    case "ME":
      return [
        `${baseQuery} cena crna gora`,
        `${baseQuery} цена черногория`,
        `${baseQuery} цена купить`,
      ];
    default:
      return [`${baseQuery} цена купить`];
  }
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
  // Converted to group's display currency
  priceInDisplayCurrency: number | null;
  marketAvgInDisplayCurrency: number | null;
  displayCurrency: string | null;
  priceVerdict: "good_deal" | "overpriced" | "fair" | "unknown";
  priceDataFound: boolean; // true if market prices were found in search results
  worthBuying: boolean; // false ONLY if negative reviews found
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
  imageAnalysis?: ListingImageAnalysis;
  // Group metadata used for analysis
  groupCountry: string | null;
  displayCurrency: string | null;
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
    // Fallback rates (approximate)
    return {
      EUR: 1,
      USD: 1.05,
      RUB: 105,
      RSD: 117,
      GBP: 0.85,
      AMD: 430,
      GEL: 2.9,
      BAM: 1.96,
    };
  }
}

function convertToEur(amount: number, currency: string, rates: Record<string, number>): number | null {
  const rate = rates[currency.toUpperCase()];
  if (!rate) return null;
  return amount / rate;
}

function convertFromEur(amountInEur: number, targetCurrency: string, rates: Record<string, number>): number | null {
  const rate = rates[targetCurrency.toUpperCase()];
  if (!rate) return null;
  return amountInEur * rate;
}

// Normalize currency code from LLM response (may return Russian "рубли", "rubles", etc.)
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

async function callLLM(systemPrompt: string, userPrompt: string, maxTokens = 2000): Promise<string> {
  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  return withRetry(
    () => callZAI(MODELS.GLM_46, messages, maxTokens, 0.3),
    3, // 3 retries
    2000 // 2s base delay
  );
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
  const systemPrompt = `You are an expert at analyzing listings/advertisements.
Analyze the text and determine:
1. Is this a listing (sale, rent, service)?
2. What products/services are offered (may be multiple)?
3. Prices for each item — NORMALIZE to numeric format
4. Search queries to verify prices for each item

IMPORTANT:
- If text contains multiple items — extract EACH separately
- Apartment rental is also a listing (listingType: "rent")
- If NOT a listing — explain why (notListingReason)
- Prices ALWAYS in format {"value": number, "currency": "ISO 4217 code"}
- "5 тыс руб" / "5k rubles" → {"value": 5000, "currency": "RUB"}
- "100€" → {"value": 100, "currency": "EUR"}
- "50к" without currency in Russian text → {"value": 50000, "currency": "RUB"}
- Respond ONLY in JSON format without markdown`;

  const userPrompt = `Listing text:
${text}

Return JSON:
{
  "isListing": boolean,
  "listingType": "sale" | "rent" | "service" | "other" | null,
  "notListingReason": "reason why this is not a listing (if isListing=false)" | null,
  "items": [
    {
      "name": "product/service name",
      "price": {"value": number, "currency": "ISO 4217 code"} or null,
      "searchQuery": "search query to check price for this item"
    }
  ]
}`;

  try {
    const response = await callLLM(systemPrompt, userPrompt);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    apiLog.error({ err: error }, "Failed to extract listing info");
  }

  return { isListing: false, listingType: null, notListingReason: "Failed to analyze text", items: [] };
}

// ============= Price Analysis =============

async function analyzeItemPrice(
  itemName: string,
  extractedPrice: NormalizedPrice | null,
  searchQuery: string,
  rates: Record<string, number>,
  region: SearchRegion,
  displayCurrency: string | null
): Promise<ItemAnalysis> {
  // Convert extracted price to EUR
  const extractedCurrency = extractedPrice?.currency ? normalizeCurrency(extractedPrice.currency) : null;
  const priceInEur =
    extractedPrice?.value && extractedCurrency
      ? convertToEur(extractedPrice.value, extractedCurrency, rates)
      : null;

  // Convert to display currency (for user-facing output)
  const priceInDisplayCurrency =
    priceInEur && displayCurrency ? convertFromEur(priceInEur, displayCurrency, rates) : null;

  // Format for display
  const extractedPriceDisplay = extractedPrice
    ? `${extractedPrice.value.toLocaleString("ru-RU")} ${extractedPrice.currency}`
    : null;

  apiLog.debug(
    { itemName, extractedPrice, extractedCurrency, priceInEur, displayCurrency, priceInDisplayCurrency, region },
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
      priceInDisplayCurrency,
      marketAvgInDisplayCurrency: null,
      displayCurrency,
      priceVerdict: "unknown",
      priceDataFound: false, // no search results
      worthBuying: true,
      worthBuyingReason: "",
      sources: [],
    };
  }

  // Build context with URLs
  const context = searchResults
    .slice(0, 8)
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.description}`)
    .join("\n\n");

  const systemPrompt = `You are a price analysis expert.
Analyze search results and determine the market price for the product.

IMPORTANT:
- Extract prices from search results and NORMALIZE them to numeric format
- Specify currency of found prices in ISO 4217 format
- DO NOT convert currencies — just report as-is
- Respond ONLY in JSON format without markdown`;

  const userPrompt = `Product: ${itemName}
Listing price: ${extractedPriceDisplay || "not specified"}

Search results:
${context}

Return JSON:
{
  "minPrice": {"value": number, "currency": "ISO 4217 code"} or null,
  "maxPrice": {"value": number, "currency": "ISO 4217 code"} or null,
  "avgPrice": {"value": number, "currency": "ISO 4217 code"} or null,
  "priceDataFound": boolean (whether prices were found in search results),
  "worthBuying": boolean (false ONLY if negative reviews about product quality were found, otherwise true),
  "worthBuyingReason": "reason for NOT recommending if worthBuying=false, otherwise null",
  "sources": [
    {"index": source number 1-8, "price": "found price as text or null"}
  ]
}`;

  try {
    const response = await callLLM(systemPrompt, userPrompt);
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

      // Convert market price to display currency
      const marketAvgInDisplayCurrency =
        marketAvgInEur && displayCurrency ? convertFromEur(marketAvgInEur, displayCurrency, rates) : null;

      apiLog.debug(
        { itemName, marketAvg, normalizedMarketCurrency, marketAvgInEur, priceInEur, marketAvgInDisplayCurrency },
        "Market price converted"
      );

      // Deterministic price verdict
      const priceVerdict = calculatePriceVerdict(priceInEur, marketAvgInEur);
      apiLog.debug({ itemName, priceVerdict, priceInEur, marketAvgInEur }, "Price verdict calculated");

      // Determine if price data was found (either from LLM response or by checking if we have market prices)
      const priceDataFound = parsed.priceDataFound ?? (marketAvg?.value != null);

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
        priceInDisplayCurrency,
        marketAvgInDisplayCurrency,
        displayCurrency,
        priceVerdict,
        priceDataFound,
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
    priceInDisplayCurrency,
    marketAvgInDisplayCurrency: null,
    displayCurrency,
    priceVerdict: "unknown",
    priceDataFound: false, // LLM call failed
    worthBuying: true,
    worthBuyingReason: "",
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

function detectScamFlags(
  text: string,
  items: ItemAnalysis[],
  imageAnalysis?: ListingImageAnalysis
): ScamFlags {
  const flags: string[] = [];
  let score = 0;

  const textLower = text.toLowerCase();
  const hasAppleProduct = APPLE_PATTERNS.test(text);

  // 0. Image analysis flags
  if (imageAnalysis) {
    if (imageAnalysis.quality === "stock_photo") {
      flags.push("Stock photo (not a real product)");
      score += 20;
    } else if (imageAnalysis.quality === "screenshot") {
      flags.push("Screenshot instead of product photo");
      score += 10;
    }
    // Add any suspicious flags from vision analysis
    for (const flag of imageAnalysis.suspiciousFlags) {
      if (!flags.includes(flag)) {
        flags.push(flag);
        score += 5;
      }
    }
    // Condition mismatch between text and photo
    if (imageAnalysis.conditionMismatch && imageAnalysis.mismatchReason) {
      flags.push(`Text/photo mismatch: ${imageAnalysis.mismatchReason}`);
      score += 20;
    }
  }

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
      flags.push(`Suspiciously low price: ${worst.name} (${worst.percent}% below market)`);
    } else {
      flags.push(`Suspiciously low prices on ${pluralItems(veryLowItems.length)} (up to ${worst.percent}% below market)`);
    }
    score += 35;
  } else if (lowItems.length > 0) {
    // Only show "below market" if there's no "suspiciously low"
    const worst = lowItems.reduce((a, b) => (a.percent > b.percent ? a : b));
    if (lowItems.length === 1) {
      flags.push(`Below market price: ${worst.name} (${worst.percent}% cheaper)`);
    } else {
      flags.push(`Below market prices on ${pluralItems(lowItems.length)} (up to ${worst.percent}% cheaper)`);
    }
    score += 15;
  }

  // 2. Urgency keywords (Russian/English)
  const urgencyPatterns = [
    /срочно/i,
    /только сегодня/i,
    /улетаю/i,
    /уезжаю/i,
    /последний день/i,
    /быстр(о|ая|ый)/i,
    /горящ/i,
    /urgent/i,
    /today only/i,
    /last day/i,
    /leaving/i,
    /must sell/i,
  ];
  for (const pattern of urgencyPatterns) {
    if (pattern.test(textLower)) {
      flags.push("Urgency language in text");
      score += 15;
      break;
    }
  }

  // 3. Prepayment requests (Russian/English)
  const prepaymentPatterns = [
    /предоплат/i,
    /аванс/i,
    /залог/i,
    /переве(ди|сти)/i,
    /prepay/i,
    /advance payment/i,
    /deposit required/i,
    /wire transfer/i,
  ];
  for (const pattern of prepaymentPatterns) {
    if (pattern.test(textLower)) {
      flags.push("Prepayment mentioned");
      score += 20;
      break;
    }
  }

  // 4. Suspicious payment methods
  const cryptoPatterns = [/крипт/i, /crypto/i, /bitcoin|btc|eth|usdt/i, /binance/i];
  for (const pattern of cryptoPatterns) {
    if (pattern.test(textLower)) {
      flags.push("Cryptocurrency as payment method");
      score += 25;
      break;
    }
  }

  // 5. No specific details (very short text)
  if (text.length < 100) {
    flags.push("Very short description");
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
    return "⛔ HIGH SCAM RISK. DO NOT SEND ANY MONEY! No prepayment, no deposit, no \"commission\". Insist on meeting in person and inspecting the item before payment.";
  }
  if (level === "medium") {
    return "⚠️ Be careful. Do not transfer money in advance. Verify the seller, agree on a safe transaction method.";
  }
  if (flags.length > 0) {
    return "Minor risks. Follow standard safety precautions.";
  }
  return "No obvious risks detected. Standard precautions for online transactions.";
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

async function findSimilarInHistory(items: Array<{ name: string }>, limit: number = 5): Promise<SimilarProduct[]> {
  if (items.length === 0) return [];

  const firstItem = items[0];
  if (!firstItem) return [];

  try {
    // Semantic search via BGE-M3 + sqlite-vec
    const similar = await semanticSearch(firstItem.name, limit * 3);

    return similar
      .map((msg) => {
        const priceInfo = extractPriceFromText(msg.text);
        return {
          id: msg.id,
          groupId: msg.groupId,
          messageId: msg.messageId,
          text: msg.text.slice(0, 150),
          price: priceInfo?.price ?? null,
          currency: priceInfo?.currency ?? null,
          date: msg.timestamp,
          link: buildTelegramLink(msg.groupId, msg.messageId),
        };
      })
      .filter((p) => p.price !== null)
      .slice(0, limit);
  } catch (error) {
    // Fallback to LIKE search if semantic search fails
    apiLog.warn({ err: error }, "Semantic search failed, falling back to LIKE");
    return findSimilarByLike(firstItem.name, limit);
  }
}

// Fallback: simple LIKE search (used when BGE unavailable)
function findSimilarByLike(name: string, limit: number): SimilarProduct[] {
  const keywords = name.toLowerCase().split(/\s+/).slice(0, 3).join(" ");
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

// ============= Overall Verdict Helpers =============

function formatNumber(n: number): string {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 0 });
}

function formatPhotoSection(img: ListingImageAnalysis | undefined): string | null {
  if (!img) return null;

  const qualityMap: Record<string, string> = {
    real_photo: "Real photo",
    stock_photo: "Possibly stock photo ⚠️",
    screenshot: "Screenshot ⚠️",
    unknown: "Photo",
  };

  const quality = qualityMap[img.quality] || "Photo";
  const lines = [`📷 ${quality}`];

  if (img.description) {
    lines.push(`   └ ${img.description}`);
  }

  if (img.suspiciousFlags?.length > 0) {
    for (const flag of img.suspiciousFlags) {
      lines.push(`   └ ⚠️ ${flag}`);
    }
  }

  return lines.join("\n");
}

function formatPriceSection(item: ItemAnalysis): string {
  const lines: string[] = [];

  // Item name + price + verdict
  const verdictEmoji: Record<string, string> = {
    good_deal: "✅",
    overpriced: "❌",
    fair: "➖",
    unknown: "❓",
  };
  const verdictText: Record<string, string> = {
    good_deal: "good price",
    overpriced: "overpriced",
    fair: "fair price",
    unknown: "",
  };

  const emoji = verdictEmoji[item.priceVerdict] || "";
  const verdict = verdictText[item.priceVerdict] || "";
  const currency = item.displayCurrency || item.extractedCurrency || "";

  let priceStr = "";
  if (item.priceInDisplayCurrency) {
    priceStr = `${formatNumber(item.priceInDisplayCurrency)} ${currency}`;
  } else if (item.extractedPrice) {
    priceStr = item.extractedPrice;
  }

  if (priceStr) {
    lines.push(`💰 ${item.name}: ${priceStr}${verdict ? ` — ${verdict}` : ""} ${emoji}`);
  } else {
    lines.push(`💰 ${item.name}: price not specified ${emoji}`);
  }

  // Market price range
  if (item.priceDataFound && item.marketPriceMin && item.marketPriceMax) {
    const marketCurrency = item.displayCurrency || item.marketCurrency || "";
    const min = item.marketAvgInDisplayCurrency
      ? formatNumber(item.marketPriceMin * (item.marketAvgInDisplayCurrency / (item.marketPriceAvg || 1)))
      : formatNumber(item.marketPriceMin);
    const max = item.marketAvgInDisplayCurrency
      ? formatNumber(item.marketPriceMax * (item.marketAvgInDisplayCurrency / (item.marketPriceAvg || 1)))
      : formatNumber(item.marketPriceMax);
    const avg = item.marketAvgInDisplayCurrency
      ? formatNumber(item.marketAvgInDisplayCurrency)
      : item.marketPriceAvg
        ? formatNumber(item.marketPriceAvg)
        : null;

    let marketLine = `   └ Market: ${min}–${max} ${marketCurrency}`;
    if (avg) {
      marketLine += ` (avg ${avg})`;
    }
    lines.push(marketLine);
  } else if (!item.priceDataFound) {
    lines.push("   └ No market data found");
  }

  // Not recommended reason
  if (!item.worthBuying && item.worthBuyingReason) {
    lines.push(`   └ 🚫 ${item.worthBuyingReason}`);
  }

  return lines.join("\n");
}

function formatHistorySection(similar: SimilarProduct[] | undefined): string | null {
  if (!similar || similar.length === 0) return null;

  const withPrice = similar.filter((s) => s.price !== null);
  if (withPrice.length === 0) return null;

  const prices = withPrice.map((s) => s.price!);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const currency = withPrice[0]?.currency || "";

  return `📜 History: ${withPrice.length} similar for ${formatNumber(minPrice)}–${formatNumber(maxPrice)} ${currency}`;
}

function formatFlagsSection(flags: string[]): string | null {
  if (!flags || flags.length === 0) return null;

  const lines = ["⚠️ Pay attention:"];
  for (const flag of flags) {
    lines.push(`   • ${flag}`);
  }
  return lines.join("\n");
}

function generateFinalConclusion(items: ItemAnalysis[], scamRisk: ScamRisk, listingType: string | null): string {
  if (scamRisk.level === "high") {
    return "🚫 High scam risk — not recommended";
  }

  if (scamRisk.level === "medium") {
    return "⚡ Moderate risk — verify seller and inspect item in person";
  }

  const goodDeals = items.filter((i) => i.priceVerdict === "good_deal");
  const overpriced = items.filter((i) => i.priceVerdict === "overpriced");
  const noData = items.filter((i) => !i.priceDataFound);

  if (goodDeals.length > 0 && overpriced.length === 0) {
    return "✅ Good deal";
  }

  if (overpriced.length > 0) {
    return "💸 Price is high — consider negotiating";
  }

  if (noData.length === items.length) {
    return "❓ Not enough data to evaluate price";
  }

  if (listingType === "rent") {
    return "🏠 Check documents and inspect property in person";
  }

  return "➖ Fair offer";
}

// ============= Overall Verdict =============

function generateOverallVerdict(
  items: ItemAnalysis[],
  scamRisk: ScamRisk,
  listingType: string | null,
  imageAnalysis?: ListingImageAnalysis,
  similarItems?: SimilarProduct[]
): string {
  const sections: string[] = [];

  // 1. Photo section
  const photoSection = formatPhotoSection(imageAnalysis);
  if (photoSection) sections.push(photoSection);

  // 2. Price section for each item
  for (const item of items) {
    sections.push(formatPriceSection(item));
  }

  // 3. History section
  const historySection = formatHistorySection(similarItems);
  if (historySection) sections.push(historySection);

  // 4. Flags section (only if there are flags)
  const flagsSection = formatFlagsSection(scamRisk.flags);
  if (flagsSection) sections.push(flagsSection);

  // 5. Final conclusion
  sections.push(generateFinalConclusion(items, scamRisk, listingType));

  return sections.join("\n\n");
}

// ============= Main Function =============

export async function deepAnalyze(
  text: string,
  groupTitle?: string | null,
  firstPhotoPath?: string | null,
  groupId?: number | null
): Promise<DeepAnalysisResult> {
  // Get group metadata if groupId provided
  const groupMetadata = groupId ? queries.getGroupMetadata(groupId) : null;

  // Determine display currency: from metadata, or from country, or null
  const displayCurrency =
    groupMetadata?.currency ||
    (groupMetadata?.country ? COUNTRY_CURRENCY[groupMetadata.country.toUpperCase()] : null) ||
    null;

  const region = detectSearchRegion(groupMetadata, groupTitle);
  apiLog.info(
    {
      textLength: text.length,
      groupTitle,
      groupId,
      country: groupMetadata?.country,
      displayCurrency,
      region,
      hasPhoto: !!firstPhotoPath,
    },
    "Starting deep analysis"
  );

  // Step 1: Get exchange rates + analyze image (in parallel)
  const ratesPromise = getExchangeRates();
  const imagePromise = firstPhotoPath ? analyzeImage(firstPhotoPath, text) : Promise.resolve(undefined);

  const [rates, imageAnalysis] = await Promise.all([ratesPromise, imagePromise]);

  if (imageAnalysis) {
    apiLog.debug(
      { description: imageAnalysis.description?.slice(0, 50), quality: imageAnalysis.quality },
      "Image analysis complete"
    );
  }

  // Step 2: Extract listing info and items
  const listingInfo = await extractListingInfo(text);
  apiLog.debug({ listingInfo }, "Listing info extracted");

  if (!listingInfo.isListing) {
    const reason = listingInfo.notListingReason || "Could not determine listing type";
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
      overallVerdict: `Not a listing: ${reason}`,
      similarItems: [],
      imageAnalysis,
      groupCountry: groupMetadata?.country ?? null,
      displayCurrency,
    };
  }

  // Step 3: Analyze each item's price (parallel, region-specific search)
  const itemPromises = listingInfo.items.map((item) =>
    analyzeItemPrice(item.name, item.price, item.searchQuery, rates, region, displayCurrency)
  );
  const items = await Promise.all(itemPromises);

  // Step 4: Deterministic scam detection (including image analysis)
  const { flags, score } = detectScamFlags(text, items, imageAnalysis);
  const level = calculateScamLevel(score);
  const recommendation = generateScamRecommendation(level, flags);

  const scamRisk: ScamRisk = {
    level,
    score,
    flags,
    recommendation,
  };

  // Step 5: Find similar in history
  const similarItems = await findSimilarInHistory(listingInfo.items);

  // Step 6: Generate overall verdict
  const overallVerdict = generateOverallVerdict(
    items,
    scamRisk,
    listingInfo.listingType,
    imageAnalysis,
    similarItems
  );

  apiLog.info(
    {
      isListing: true,
      listingType: listingInfo.listingType,
      itemCount: items.length,
      scamLevel: scamRisk.level,
      scamScore: scamRisk.score,
      imageQuality: imageAnalysis?.quality,
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
    imageAnalysis,
    groupCountry: groupMetadata?.country ?? null,
    displayCurrency,
  };
}

/**
 * Load image from file and analyze it
 * @param photoPath - path to the image file
 * @param listingText - listing text for context and comparison
 */
async function analyzeImage(
  photoPath: string,
  listingText: string
): Promise<ListingImageAnalysis | undefined> {
  try {
    const file = Bun.file(photoPath);
    if (!(await file.exists())) {
      apiLog.warn({ photoPath }, "Photo file not found");
      return undefined;
    }

    const buffer = await file.arrayBuffer();
    return await analyzeListingImage(new Uint8Array(buffer), listingText);
  } catch (error) {
    apiLog.error({ error, photoPath }, "Failed to analyze image");
    return undefined;
  }
}

// ============= Unified Entry Point =============

/**
 * Get photo path for a message, fetching from Telegram if needed
 */
export async function getPhotoPath(messageId: number, groupId: number): Promise<string | null> {
  // Check existing media in DB
  let mediaRows = queries.getMediaForMessage(messageId, groupId);
  let firstPhoto = mediaRows.find((m) => m.media_type === "photo");

  // If no photo in DB, try to fetch from Telegram
  if (!firstPhoto) {
    try {
      const fetched = await fetchMediaForMessage(messageId, groupId);
      if (fetched) {
        mediaRows = queries.getMediaForMessage(messageId, groupId);
        firstPhoto = mediaRows.find((m) => m.media_type === "photo");
      }
    } catch (error) {
      apiLog.error({ error, messageId, groupId }, "Failed to fetch media");
    }
  }

  return firstPhoto ? `data/media/${firstPhoto.file_path}` : null;
}

export interface AnalyzeParams {
  text: string;
  messageId?: number;
  groupId?: number;
  groupTitle?: string | null;
}

/**
 * Unified entry point for deep analysis with automatic photo fetching
 */
export async function analyzeWithMedia(params: AnalyzeParams): Promise<DeepAnalysisResult> {
  const { text, messageId, groupId, groupTitle } = params;

  // Get photo path if we have message coordinates
  const photoPath = messageId && groupId
    ? await getPhotoPath(messageId, groupId)
    : null;

  return deepAnalyze(text, groupTitle, photoPath, groupId);
}
