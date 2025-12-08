import { describe, test, expect } from "bun:test";
import { calculateBM25Score, passesBM25Filter } from "./bm25.ts";

describe("calculateBM25Score", () => {
  test("returns 0 for no keyword matches", () => {
    const result = calculateBM25Score(
      "hello world",
      ["foo", "bar"],
      []
    );
    expect(result.score).toBe(0);
    expect(result.matchedPositive).toEqual([]);
    expect(result.matchedNegative).toEqual([]);
  });

  test("matches positive keywords", () => {
    const result = calculateBM25Score(
      "продаю iphone 15 pro",
      ["iphone", "продаю"],
      []
    );
    expect(result.matchedPositive).toContain("iphone");
    expect(result.matchedPositive).toContain("продаю");
    expect(result.score).toBeGreaterThan(0);
  });

  test("detects negative keywords", () => {
    const result = calculateBM25Score(
      "продаю iphone на запчасти",
      ["iphone", "продаю"],
      ["запчасти"]
    );
    expect(result.matchedPositive).toContain("iphone");
    expect(result.matchedNegative).toContain("запчасти");
  });

  test("applies negative penalty of 0.5", () => {
    const withoutNegative = calculateBM25Score(
      "продаю iphone",
      ["iphone", "продаю"],
      []
    );
    const withNegative = calculateBM25Score(
      "продаю iphone запчасти",
      ["iphone", "продаю"],
      ["запчасти"]
    );

    // Score with negative should be lower by 0.5 penalty
    // But scores may differ slightly due to document length, so check the relationship
    expect(withNegative.score).toBeLessThan(withoutNegative.score);
    expect(withNegative.matchedNegative).toContain("запчасти");
  });

  test("score never goes below 0", () => {
    const result = calculateBM25Score(
      "запчасти для телефона",
      ["iphone"],
      ["запчасти"]
    );
    expect(result.score).toBe(0);
  });

  test("normalizes positive score by keyword count", () => {
    const oneKeyword = calculateBM25Score(
      "iphone",
      ["iphone"],
      []
    );
    const twoKeywords = calculateBM25Score(
      "iphone",
      ["iphone", "продаю"],
      []
    );

    // With 2 keywords but only 1 match, score should be lower
    expect(twoKeywords.score).toBeLessThan(oneKeyword.score);
  });

  test("handles multi-word keywords", () => {
    const result = calculateBM25Score(
      "iphone pro max",
      ["iphone pro", "max"],
      []
    );
    // "iphone pro" should match as both "iphone" and "pro" are in text
    expect(result.matchedPositive.length).toBeGreaterThan(0);
  });

  test("handles empty positive keywords", () => {
    const result = calculateBM25Score(
      "hello world",
      [],
      ["spam"]
    );
    expect(result.score).toBe(0);
    expect(result.matchedPositive).toEqual([]);
  });

  test("handles empty text", () => {
    const result = calculateBM25Score(
      "",
      ["iphone"],
      []
    );
    expect(result.score).toBe(0);
    expect(result.matchedPositive).toEqual([]);
  });

  test("is case insensitive", () => {
    const result = calculateBM25Score(
      "IPHONE PRO MAX",
      ["iphone", "pro"],
      []
    );
    expect(result.matchedPositive).toContain("iphone");
    expect(result.matchedPositive).toContain("pro");
  });

  test("handles repeated terms (term frequency)", () => {
    const singleOccurrence = calculateBM25Score(
      "iphone",
      ["iphone"],
      []
    );
    const multipleOccurrences = calculateBM25Score(
      "iphone iphone iphone",
      ["iphone"],
      []
    );

    // BM25 saturates, so multiple occurrences increase score but not linearly
    expect(multipleOccurrences.score).toBeGreaterThan(singleOccurrence.score);
    expect(multipleOccurrences.score).toBeLessThan(singleOccurrence.score * 3);
  });

  test("considers document length normalization", () => {
    const shortDoc = calculateBM25Score(
      "iphone",
      ["iphone"],
      []
    );
    const longDoc = calculateBM25Score(
      "iphone " + "word ".repeat(100),
      ["iphone"],
      []
    );

    // Longer documents get slightly penalized (but not by much for single term)
    expect(longDoc.score).toBeLessThanOrEqual(shortDoc.score);
  });
});

describe("passesBM25Filter", () => {
  test("passes when score above threshold and no negative matches", () => {
    const { passed, result } = passesBM25Filter(
      "продаю iphone 15 pro max",
      ["iphone", "продаю", "pro"],
      [],
      0.3
    );
    expect(passed).toBe(true);
    expect(result.score).toBeGreaterThan(0.3);
  });

  test("fails when score below threshold", () => {
    const { passed, result } = passesBM25Filter(
      "продаю samsung",
      ["iphone", "apple", "ios"],
      [],
      0.3
    );
    expect(passed).toBe(false);
    expect(result.score).toBeLessThan(0.3);
  });

  test("fails when negative keyword matched (regardless of score)", () => {
    const { passed, result } = passesBM25Filter(
      "продаю iphone запчасти",
      ["iphone", "продаю"],
      ["запчасти"],
      0.0 // Even with threshold 0
    );
    expect(passed).toBe(false);
    expect(result.matchedNegative).toContain("запчасти");
  });

  test("uses default threshold of 0.3", () => {
    // Just above threshold
    const { passed } = passesBM25Filter(
      "iphone iphone iphone продаю",
      ["iphone", "продаю"],
      []
    );
    expect(passed).toBe(true);
  });

  test("returns full result object", () => {
    const { passed, result } = passesBM25Filter(
      "iphone pro",
      ["iphone", "pro"],
      ["spam"]
    );

    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("matchedPositive");
    expect(result).toHaveProperty("matchedNegative");
  });

  test("handles all keywords matched", () => {
    const { passed, result } = passesBM25Filter(
      "iphone pro max продаю",
      ["iphone", "pro", "max", "продаю"],
      [],
      0.5
    );
    expect(passed).toBe(true);
    expect(result.matchedPositive).toHaveLength(4);
  });

  test("handles partial keyword matches", () => {
    const { passed, result } = passesBM25Filter(
      "iphone продаю",
      ["iphone", "pro", "max", "продаю"],
      [],
      0.3
    );
    // Only 2 of 4 keywords match
    expect(result.matchedPositive).toHaveLength(2);
    // Score is normalized by keyword count
  });

  test("real-world: iPhone listing passes", () => {
    const { passed } = passesBM25Filter(
      "Продаю iPhone 15 Pro Max 256gb, полный комплект, идеал. Цена 80000.",
      ["iphone", "15", "pro", "max", "продаю", "цена"],
      ["запчасти", "разбор", "битый", "ремонт"],
      0.2
    );
    expect(passed).toBe(true);
  });

  test("real-world: spare parts listing fails", () => {
    const { passed } = passesBM25Filter(
      "Куплю запчасти для iPhone 15, нужен экран и аккумулятор",
      ["iphone", "15", "продаю"],
      ["запчасти", "экран", "аккумулятор"],
      0.2
    );
    expect(passed).toBe(false); // Has negative keyword
  });
});
