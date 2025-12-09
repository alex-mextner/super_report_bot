// URL detection and content extraction utilities

// Regex to match URLs
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;

/**
 * Extract all URLs from text
 */
export function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX);
  return matches ?? [];
}

/**
 * Remove URLs from text, leaving only non-URL content
 */
export function stripUrls(text: string): string {
  return text.replace(URL_REGEX, "").replace(/\s+/g, " ").trim();
}

/**
 * Check if message consists only of URLs (no meaningful text content)
 * Allows for small amounts of whitespace/punctuation around URLs
 */
export function isUrlOnlyMessage(text: string): boolean {
  const stripped = stripUrls(text);
  // Consider "URL-only" if remaining text is very short (less than 10 chars)
  // This allows for things like "👇" or punctuation around links
  return stripped.length < 10;
}

/**
 * Fetch page content and extract readable text
 * Returns null if fetch fails or content is too short
 */
export async function fetchUrlContent(
  url: string,
  options: { timeout?: number; maxLength?: number } = {}
): Promise<string | null> {
  const { timeout = 5000, maxLength = 2000 } = options;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TelegramBot/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      return null; // Not HTML/text content
    }

    const html = await response.text();
    const text = extractTextFromHtml(html);

    if (text.length < 50) {
      return null; // Too short, probably not useful
    }

    return text.slice(0, maxLength);
  } catch {
    return null;
  }
}

/**
 * Extract readable text from HTML
 * Simple extraction without heavy dependencies
 */
function extractTextFromHtml(html: string): string {
  // Remove scripts, styles, and other non-content elements
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "");

  // Try to extract from common content containers
  const mainContentMatch =
    text.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
    text.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ||
    text.match(/<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

  if (mainContentMatch?.[1]) {
    text = mainContentMatch[1];
  }

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch?.[1]?.trim() ?? "";

  // Extract meta description
  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
  const description = descMatch?.[1]?.trim() ?? "";

  // Extract Open Graph description as fallback
  const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
  const ogDescription = ogDescMatch?.[1]?.trim() ?? "";

  // Remove HTML tags and decode entities
  text = text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();

  // Combine title, description and body content
  const parts: string[] = [];
  if (title) parts.push(title);
  if (description) parts.push(description);
  else if (ogDescription) parts.push(ogDescription);
  if (text) parts.push(text);

  return parts.join(". ").replace(/\s+/g, " ").trim();
}

/**
 * Enrich message text by fetching content from URLs
 * If message is URL-only, returns fetched content
 * If message has text + URLs, returns original text (URLs are context)
 */
export async function enrichMessageWithUrlContent(
  text: string,
  options: { timeout?: number; maxLength?: number } = {}
): Promise<{ enrichedText: string; wasEnriched: boolean; fetchedUrls: string[] }> {
  const urls = extractUrls(text);

  // No URLs — return as is
  if (urls.length === 0) {
    return { enrichedText: text, wasEnriched: false, fetchedUrls: [] };
  }

  // If message has meaningful text besides URLs, don't fetch
  if (!isUrlOnlyMessage(text)) {
    return { enrichedText: text, wasEnriched: false, fetchedUrls: [] };
  }

  // URL-only message — try to fetch content
  const fetchedUrls: string[] = [];
  const contents: string[] = [];

  // Limit to first 2 URLs to avoid slowdowns
  for (const url of urls.slice(0, 2)) {
    const content = await fetchUrlContent(url, options);
    if (content) {
      contents.push(content);
      fetchedUrls.push(url);
    }
  }

  if (contents.length === 0) {
    // Couldn't fetch anything — return original but flag it
    return { enrichedText: text, wasEnriched: false, fetchedUrls: [] };
  }

  // Return fetched content
  const enrichedText = contents.join("\n\n");
  return { enrichedText, wasEnriched: true, fetchedUrls };
}
