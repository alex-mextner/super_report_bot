import { describe, test, expect } from "bun:test";
import { fuzzySearch, jaccardSimilarity } from "./index.ts";

describe("jaccardSimilarity", () => {
  test("returns 1 for identical sets", () => {
    const a = new Set(["a", "b", "c"]);
    const b = new Set(["a", "b", "c"]);
    expect(jaccardSimilarity(a, b)).toBe(1);
  });

  test("returns 0 for completely different sets", () => {
    const a = new Set(["a", "b", "c"]);
    const b = new Set(["x", "y", "z"]);
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  test("returns 1 for two empty sets", () => {
    const a = new Set<string>();
    const b = new Set<string>();
    expect(jaccardSimilarity(a, b)).toBe(1);
  });

  test("returns 0 when one set is empty", () => {
    const a = new Set(["a", "b"]);
    const b = new Set<string>();
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  test("calculates partial overlap correctly", () => {
    const a = new Set(["a", "b", "c"]);
    const b = new Set(["b", "c", "d"]);
    // intersection = 2 (b, c), union = 4 (a, b, c, d)
    expect(jaccardSimilarity(a, b)).toBe(0.5);
  });

  test("handles single element overlap", () => {
    const a = new Set(["a", "b", "c"]);
    const b = new Set(["c", "d", "e"]);
    // intersection = 1 (c), union = 5
    expect(jaccardSimilarity(a, b)).toBe(0.2);
  });
});

describe("fuzzySearch", () => {
  const testItems = [
    { id: 1, text: "Продаю iPhone 15 Pro Max 256gb в отличном состоянии" },
    { id: 2, text: "Куплю Samsung Galaxy S24 Ultra недорого" },
    { id: 3, text: "iPhone 14 Pro на запчасти, разбит экран" },
    { id: 4, text: "Продам MacBook Pro M3 новый в коробке" },
    { id: 5, text: "Ноутбук Lenovo ThinkPad T14 для работы" },
    { id: 6, text: "Продаю айфон 13 мини срочно дешево" },
    { id: 7, text: "Apple Watch Series 9 45mm GPS" },
    { id: 8, text: "Наушники AirPods Pro 2 оригинал" },
  ];

  describe("exact matches", () => {
    test("finds exact word match", () => {
      const results = fuzzySearch(testItems, "iPhone");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.item.text).toContain("iPhone");
    });

    test("finds exact phrase match", () => {
      const results = fuzzySearch(testItems, "iPhone 15 Pro");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.item.id).toBe(1);
    });

    test("finds cyrillic exact match", () => {
      const results = fuzzySearch(testItems, "Продаю");
      expect(results.length).toBeGreaterThan(0);
      const ids = results.map((r) => r.item.id);
      expect(ids).toContain(1);
      expect(ids).toContain(6);
    });
  });

  describe("fuzzy matches", () => {
    test("finds with typo - айфон vs iPhone", () => {
      const results = fuzzySearch(testItems, "айфон");
      expect(results.length).toBeGreaterThan(0);
      // Should find item 6 which has "айфон"
      expect(results.some((r) => r.item.id === 6)).toBe(true);
    });

    test("finds partial word match", () => {
      const results = fuzzySearch(testItems, "Macbook");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.item.id).toBe(4);
    });

    test("is case insensitive", () => {
      const resultsLower = fuzzySearch(testItems, "iphone");
      const resultsUpper = fuzzySearch(testItems, "IPHONE");
      expect(resultsLower.length).toBe(resultsUpper.length);
      expect(resultsLower[0]!.item.id).toBe(resultsUpper[0]!.item.id);
    });

    test("finds with missing letters - продаю vs прдаю", () => {
      const results = fuzzySearch(testItems, "прдаю");
      expect(results.length).toBeGreaterThan(0);
      // n-gram should still match "продаю" because many trigrams overlap
    });
  });

  describe("scoring and ranking", () => {
    test("ranks exact matches higher than partial", () => {
      const results = fuzzySearch(testItems, "iPhone 15");
      expect(results.length).toBeGreaterThan(1);
      // Item 1 has "iPhone 15" exactly
      expect(results[0]!.item.id).toBe(1);
      expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
    });

    test("returns scores between 0 and 1", () => {
      const results = fuzzySearch(testItems, "iPhone");
      for (const r of results) {
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1);
      }
    });

    test("higher scores for more complete matches", () => {
      const results = fuzzySearch(testItems, "iPhone Pro");
      const item1 = results.find((r) => r.item.id === 1);
      const item3 = results.find((r) => r.item.id === 3);
      // Item 1 has "iPhone 15 Pro", item 3 has "iPhone 14 Pro"
      // Both should match but with similar scores
      expect(item1).toBeDefined();
      expect(item3).toBeDefined();
    });
  });

  describe("threshold filtering", () => {
    test("default threshold filters irrelevant results", () => {
      const results = fuzzySearch(testItems, "велосипед");
      // No items contain anything about bikes
      expect(results.length).toBe(0);
    });

    test("custom low threshold returns more results", () => {
      const resultsDefault = fuzzySearch(testItems, "Pro");
      const resultsLow = fuzzySearch(testItems, "Pro", 0.01);
      expect(resultsLow.length).toBeGreaterThanOrEqual(resultsDefault.length);
    });

    test("custom high threshold returns fewer results", () => {
      const resultsDefault = fuzzySearch(testItems, "iPhone", 0.05);
      const resultsHigh = fuzzySearch(testItems, "iPhone", 0.3);
      expect(resultsHigh.length).toBeLessThanOrEqual(resultsDefault.length);
    });
  });

  describe("edge cases", () => {
    test("empty query returns all items with score 1", () => {
      const results = fuzzySearch(testItems, "");
      expect(results.length).toBe(testItems.length);
      expect(results.every((r) => r.score === 1)).toBe(true);
    });

    test("whitespace-only query returns all items", () => {
      const results = fuzzySearch(testItems, "   ");
      expect(results.length).toBe(testItems.length);
    });

    test("empty items array returns empty results", () => {
      const results = fuzzySearch([], "iPhone");
      expect(results.length).toBe(0);
    });

    test("very short query (1-2 chars) returns empty (ngram min is 3)", () => {
      const results = fuzzySearch(testItems, "15");
      // "15" is too short for meaningful trigram matching
      // This is expected behavior - need at least 3 chars for trigrams
      expect(results.length).toBe(0);
    });

    test("query with 3+ chars works", () => {
      const results = fuzzySearch(testItems, "256");
      // "256" generates 1 trigram, should find "256gb"
      expect(results.length).toBeGreaterThan(0);
    });

    test("very long query", () => {
      const longQuery = "Продаю iPhone 15 Pro Max 256gb в отличном состоянии";
      const results = fuzzySearch(testItems, longQuery);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.item.id).toBe(1);
      expect(results[0]!.score).toBeGreaterThan(0.9);
    });

    test("special characters in query", () => {
      const results = fuzzySearch(testItems, "iPhone! 15? Pro...");
      // Should normalize and still find matches
      expect(results.length).toBeGreaterThan(0);
    });

    test("emoji in query", () => {
      const results = fuzzySearch(testItems, "📱 iPhone");
      // Should normalize and still find matches
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("real-world scenarios", () => {
    test("user searches for brand - finds items with brand name", () => {
      const results = fuzzySearch(testItems, "Apple");
      const ids = results.map((r) => r.item.id);
      expect(ids).toContain(7); // Apple Watch - has "Apple" in text
      // Note: AirPods (id:8) doesn't contain "Apple" in text, so won't match
    });

    test("user searches for 'продам' - finds selling posts", () => {
      const results = fuzzySearch(testItems, "продам");
      expect(results.length).toBeGreaterThan(0);
      // Should find items with "Продаю" and "Продам"
    });

    test("user searches with mixed languages", () => {
      const results = fuzzySearch(testItems, "новый iPhone");
      expect(results.length).toBeGreaterThan(0);
    });

    test("user misspells common words", () => {
      // "айфоне" -> should still find "айфон"
      const results = fuzzySearch(testItems, "айфоне");
      expect(results.some((r) => r.item.id === 6)).toBe(true);
    });
  });

  describe("multi-word queries", () => {
    test("all words present in different order", () => {
      const results = fuzzySearch(testItems, "Pro MacBook");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.item.id).toBe(4);
    });

    test("only some words present", () => {
      const results = fuzzySearch(testItems, "iPhone Android");
      // Should still find iPhone items even though Android isn't there
      expect(results.length).toBeGreaterThan(0);
    });
  });
});
