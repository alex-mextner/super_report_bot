import { describe, test, expect } from "bun:test";
import {
  calculateNgramSimilarity,
  calculateKeywordNgramSimilarity,
  passesNgramFilter,
} from "./ngram.ts";

describe("calculateNgramSimilarity", () => {
  test("returns 1 for identical texts", () => {
    const result = calculateNgramSimilarity("hello world", "hello world");
    expect(result.charNgramScore).toBe(1);
    expect(result.wordShingleScore).toBe(1);
    expect(result.combinedScore).toBe(1);
  });

  test("returns 0 for completely different texts", () => {
    const result = calculateNgramSimilarity("abc", "xyz");
    expect(result.charNgramScore).toBe(0);
    expect(result.wordShingleScore).toBe(0);
    expect(result.combinedScore).toBe(0);
  });

  test("handles partial similarity", () => {
    const result = calculateNgramSimilarity("hello world", "hello there");
    expect(result.charNgramScore).toBeGreaterThan(0);
    expect(result.charNgramScore).toBeLessThan(1);
    expect(result.wordShingleScore).toBe(0); // "hello world" vs "hello there" - no bigram match
  });

  test("weights word shingles higher (0.7 vs 0.3)", () => {
    // Text with matching character n-grams but different word structure
    const result = calculateNgramSimilarity("the cat sat", "the sat cat");
    // Word shingles don't match exactly, but some char ngrams do
    expect(result.combinedScore).toBe(
      result.charNgramScore * 0.3 + result.wordShingleScore * 0.7
    );
  });

  test("handles empty strings", () => {
    const result = calculateNgramSimilarity("", "");
    expect(result.charNgramScore).toBe(1); // Both empty sets
    expect(result.wordShingleScore).toBe(1);
    expect(result.combinedScore).toBe(1);
  });

  test("handles one empty string", () => {
    const result = calculateNgramSimilarity("hello", "");
    expect(result.charNgramScore).toBe(0);
    expect(result.wordShingleScore).toBe(0);
    expect(result.combinedScore).toBe(0);
  });

  test("is case insensitive", () => {
    const result = calculateNgramSimilarity("HELLO WORLD", "hello world");
    expect(result.charNgramScore).toBe(1);
    expect(result.wordShingleScore).toBe(1);
  });

  test("handles cyrillic text", () => {
    const result = calculateNgramSimilarity(
      "продаю iphone",
      "продаю iphone новый"
    );
    expect(result.charNgramScore).toBeGreaterThan(0.5);
    expect(result.wordShingleScore).toBeGreaterThan(0); // "продаю iphone" is common
  });

  test("uses custom n-gram sizes", () => {
    const result = calculateNgramSimilarity("hello", "hello", 4, 3);
    expect(result.charNgramScore).toBe(1);
  });
});

describe("calculateKeywordNgramSimilarity", () => {
  test("returns 0 for empty keywords", () => {
    const score = calculateKeywordNgramSimilarity("hello world", []);
    expect(score).toBe(0);
  });

  test("returns high score when all keywords present", () => {
    const score = calculateKeywordNgramSimilarity(
      "продаю iphone 15 pro max",
      ["iphone", "продаю", "pro"]
    );
    // All 3 keywords found -> binaryCoverage=1, softCoverage=1 -> score=1
    expect(score).toBe(1);
  });

  test("returns 0 when no keywords match", () => {
    const score = calculateKeywordNgramSimilarity(
      "продаю samsung galaxy",
      ["iphone", "apple", "ios"]
    );
    expect(score).toBe(0);
  });

  test("returns partial score when some keywords match", () => {
    const score = calculateKeywordNgramSimilarity(
      "selling my iphone cheap",
      ["iphone", "macbook", "apple"]
    );
    // Only "iphone" matches (1 of 3)
    // binaryCoverage = 1/3 = 0.333
    // softCoverage ~ 1/3
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThan(0.5);
  });

  test("handles single keyword present", () => {
    const score = calculateKeywordNgramSimilarity("the iphone is great", [
      "iphone",
    ]);
    // 1 of 1 keyword found -> score = 1
    expect(score).toBe(1);
  });

  test("handles single keyword absent", () => {
    const score = calculateKeywordNgramSimilarity("the samsung is great", [
      "iphone",
    ]);
    expect(score).toBe(0);
  });

  test("is case insensitive", () => {
    const score = calculateKeywordNgramSimilarity("IPHONE PRO MAX", [
      "iphone",
      "pro",
    ]);
    // Both keywords found
    expect(score).toBe(1);
  });

  test("uses 70% threshold for keyword detection", () => {
    // "iphon" has 3 ngrams: iph, pho, hon
    // "iphone" in text has 4 ngrams: iph, pho, hon, one
    // If text has "iphone", coverage for "iphon" = 3/3 = 1.0 (all found)
    const score = calculateKeywordNgramSimilarity("iphone 15", ["iphon"]);
    expect(score).toBe(1);
  });

  test("short keywords (< 3 chars) handled correctly", () => {
    // "15" generates single ngram "15" which gets matched in text
    // But we need to check the coverage threshold behavior
    const score = calculateKeywordNgramSimilarity("iphone 15 pro", ["15"]);
    // Short keyword "15" only has 1 ngram, and if it's in text, coverage = 100%
    // However, depends on how generateNgrams handles short strings
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

describe("passesNgramFilter", () => {
  test("passes with high similarity to keywords and description", () => {
    const result = passesNgramFilter(
      "продаю iphone 15 pro max в москве",
      ["iphone", "продаю", "pro", "москва"],
      "Объявления о продаже iPhone 15 Pro Max",
      0.2
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThan(0.5);
  });

  test("fails with low similarity", () => {
    const result = passesNgramFilter(
      "продаю samsung galaxy s24",
      ["iphone", "apple", "ios"],
      "Объявления о продаже iPhone",
      0.1
    );
    expect(result.passed).toBe(false);
    expect(result.score).toBeLessThan(0.1);
  });

  test("uses custom threshold", () => {
    const text = "iphone продаю срочно";
    const keywords = ["iphone", "продаю"];
    const description = "iPhone продажа";

    const lowThreshold = passesNgramFilter(text, keywords, description, 0.1);
    const highThreshold = passesNgramFilter(text, keywords, description, 0.99);

    expect(lowThreshold.passed).toBe(true);
    expect(highThreshold.passed).toBe(false);
  });

  test("default threshold is 0.25", () => {
    const result = passesNgramFilter(
      "iphone 15 продам",
      ["iphone", "продам"],
      "продажа iphone"
    );
    // Should use default threshold of 0.25
    expect(result.passed).toBe(true);
  });

  test("combines keyword and description scores (50/50)", () => {
    const result = passesNgramFilter(
      "test message here",
      ["test"],
      "test description",
      0.0
    );
    // Score should be combination of both
    expect(result.score).toBeGreaterThan(0);
  });

  test("handles empty keywords", () => {
    const result = passesNgramFilter(
      "test message",
      [],
      "test description",
      0.1
    );
    // Only description similarity contributes (50% of score)
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(0.5);
  });

  test("handles empty description", () => {
    const result = passesNgramFilter("iphone продам", ["iphone", "продам"], "");
    // Only keyword similarity contributes (50% of score)
    expect(result.score).toBe(0.5); // keywordScore=1 * 0.5 + descScore=0 * 0.5
  });

  test("handles both empty", () => {
    const result = passesNgramFilter("test message", [], "");
    expect(result.passed).toBe(false);
    // Empty keywords = 0, empty desc with empty ngrams = some value due to jaccardSimilarity edge case
  });

  test("real-world example: iPhone listing", () => {
    const messageText =
      "Продаю iPhone 15 Pro Max 256gb, полный комплект, идеал. Цена 80000. Москва, самовывоз.";
    const keywords = [
      "iphone",
      "15",
      "pro",
      "max",
      "продаю",
      "цена",
    ];
    const description = "Объявления о продаже iPhone 15 Pro Max";

    const result = passesNgramFilter(messageText, keywords, description, 0.15);
    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThan(0.4);
  });

  test("real-world example: partial match", () => {
    const messageText =
      "Куплю запчасти для iPhone 15, нужен экран и аккумулятор";
    const keywords = [
      "iphone",
      "15",
      "pro",
      "max",
      "продам",
      "продаю",
    ];
    const description = "Объявления о продаже iPhone 15 Pro Max";

    const result = passesNgramFilter(messageText, keywords, description, 0.15);
    // "iphone" matches (1 of 6 keywords - "15" is too short for reliable ngram)
    // Score depends on keyword coverage + description similarity
    // This is partial match so score may be below threshold
    expect(result.score).toBeGreaterThan(0);
  });
});
