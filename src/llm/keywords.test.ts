import { describe, test, expect, beforeEach, spyOn } from "bun:test";
import { generateKeywordsFallback } from "./keywords.ts";
import * as llmIndex from "./index.ts";

describe("generateKeywordsFallback", () => {
  test("extracts words from query", () => {
    const result = generateKeywordsFallback("iphone 15 pro max");
    expect(result.positive_keywords).toContain("iphone");
    expect(result.positive_keywords).toContain("pro");
    expect(result.positive_keywords).toContain("max");
  });

  test("filters short words (<=2 chars)", () => {
    const result = generateKeywordsFallback("я и ты мы");
    expect(result.positive_keywords).toEqual([]);
  });

  test("converts to lowercase", () => {
    const result = generateKeywordsFallback("IPHONE PRO MAX");
    expect(result.positive_keywords).toEqual(["iphone", "pro", "max"]);
  });

  test("removes special characters", () => {
    const result = generateKeywordsFallback("iphone, pro! max?");
    expect(result.positive_keywords).toEqual(["iphone", "pro", "max"]);
  });

  test("returns empty negative keywords", () => {
    const result = generateKeywordsFallback("any query");
    expect(result.negative_keywords).toEqual([]);
  });

  test("uses query as llm_description", () => {
    const query = "продаю iphone 15 pro max";
    const result = generateKeywordsFallback(query);
    expect(result.llm_description).toBe(query);
  });

  test("handles cyrillic text", () => {
    const result = generateKeywordsFallback("продаю телефон срочно");
    expect(result.positive_keywords).toContain("продаю");
    expect(result.positive_keywords).toContain("телефон");
    expect(result.positive_keywords).toContain("срочно");
  });

  test("handles empty query", () => {
    const result = generateKeywordsFallback("");
    expect(result.positive_keywords).toEqual([]);
    expect(result.negative_keywords).toEqual([]);
    expect(result.llm_description).toBe("");
  });

  test("handles query with only short words", () => {
    const result = generateKeywordsFallback("a b c d");
    expect(result.positive_keywords).toEqual([]);
  });

  test("handles mixed content", () => {
    const result = generateKeywordsFallback("iPhone 15 за 50k в Москве");
    expect(result.positive_keywords).toContain("iphone");
    expect(result.positive_keywords).toContain("50k");
    expect(result.positive_keywords).toContain("москве");
  });
});

// Note: generateKeywords tests require mocking the HuggingFace API
// For integration tests, use real API calls with HF_TOKEN
// Unit tests for response parsing are covered via generateKeywordsFallback
// and the parsing logic is tested implicitly through integration tests
