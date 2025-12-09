import { describe, test, expect } from "bun:test";
import {
  extractUrls,
  stripUrls,
  isUrlOnlyMessage,
  fetchUrlContent,
  enrichMessageWithUrlContent,
} from "./url.ts";

describe("extractUrls", () => {
  test("extracts single URL", () => {
    const text = "Check this: https://example.com/page";
    expect(extractUrls(text)).toEqual(["https://example.com/page"]);
  });

  test("extracts multiple URLs", () => {
    const text = "See https://a.com and http://b.com/path?q=1";
    expect(extractUrls(text)).toEqual(["https://a.com", "http://b.com/path?q=1"]);
  });

  test("returns empty array for no URLs", () => {
    expect(extractUrls("Just text here")).toEqual([]);
  });

  test("handles URLs with complex paths", () => {
    const text = "https://avito.ru/moskva/kvartiry/prodam/123456?from=serp";
    expect(extractUrls(text)).toEqual([text]);
  });
});

describe("stripUrls", () => {
  test("removes URL leaving text", () => {
    const text = "Продаю iPhone https://example.com звоните";
    expect(stripUrls(text)).toBe("Продаю iPhone звоните");
  });

  test("handles multiple URLs", () => {
    const text = "Ссылки: https://a.com и https://b.com тут";
    expect(stripUrls(text)).toBe("Ссылки: и тут");
  });

  test("handles URL-only text", () => {
    expect(stripUrls("https://example.com")).toBe("");
  });
});

describe("isUrlOnlyMessage", () => {
  test("returns true for URL-only message", () => {
    expect(isUrlOnlyMessage("https://avito.ru/item/12345")).toBe(true);
  });

  test("returns true for URL with emoji", () => {
    expect(isUrlOnlyMessage("👇 https://example.com")).toBe(true);
  });

  test("returns true for multiple URLs only", () => {
    expect(isUrlOnlyMessage("https://a.com\nhttps://b.com")).toBe(true);
  });

  test("returns false for URL with description", () => {
    expect(isUrlOnlyMessage("Продаю диван за 5000р https://example.com")).toBe(false);
  });

  test("returns false for long text with URL", () => {
    const text = "Отличный товар в хорошем состоянии https://avito.ru недорого";
    expect(isUrlOnlyMessage(text)).toBe(false);
  });

  test("returns false for text without URL", () => {
    expect(isUrlOnlyMessage("Просто текст без ссылок")).toBe(false);
  });
});

describe("fetchUrlContent", () => {
  test("returns null for invalid URL", async () => {
    const result = await fetchUrlContent("not-a-url");
    expect(result).toBeNull();
  });

  test("returns null for non-existent domain", async () => {
    const result = await fetchUrlContent("https://this-domain-does-not-exist-12345.com", {
      timeout: 2000,
    });
    expect(result).toBeNull();
  });

  // Real fetch test - skip if network issues
  test.skip("fetches real page content", async () => {
    const result = await fetchUrlContent("https://example.com", { timeout: 5000 });
    expect(result).not.toBeNull();
    expect(result).toContain("Example Domain");
  });
});

describe("enrichMessageWithUrlContent", () => {
  test("returns original text if no URLs", async () => {
    const result = await enrichMessageWithUrlContent("Just text");
    expect(result.enrichedText).toBe("Just text");
    expect(result.wasEnriched).toBe(false);
    expect(result.fetchedUrls).toEqual([]);
  });

  test("returns original text if has meaningful content", async () => {
    const text = "Продаю iPhone 15 за 50000 рублей https://example.com";
    const result = await enrichMessageWithUrlContent(text);
    expect(result.enrichedText).toBe(text);
    expect(result.wasEnriched).toBe(false);
  });

  test("returns original if URL fetch fails", async () => {
    const text = "https://this-domain-does-not-exist-xyz.com";
    const result = await enrichMessageWithUrlContent(text, { timeout: 1000 });
    expect(result.enrichedText).toBe(text);
    expect(result.wasEnriched).toBe(false);
  });
});
