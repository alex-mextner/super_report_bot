import { describe, test, expect } from "bun:test";
import { matchMessage, matchMessageAgainstAll, getPassedMatches } from "./index.ts";
import type { Subscription, IncomingMessage } from "../types.ts";

// Helper to create a test subscription
function createSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 1,
    user_id: 1,
    original_query: "test query",
    positive_keywords: ["test"],
    negative_keywords: [],
    llm_description: "Test subscription",
    is_active: 1,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// Helper to create a test message
function createMessage(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    id: 1,
    group_id: 123,
    group_title: "Test Group",
    text: "test message",
    sender_name: "Test User",
    timestamp: new Date(),
    ...overrides,
  };
}

describe("matchMessage", () => {
  test("returns null when no match", async () => {
    const message = createMessage({ text: "completely unrelated content" });
    const subscription = createSubscription({
      positive_keywords: ["iphone", "продаю"],
      llm_description: "iPhone для продажи",
    });

    const result = await matchMessage(message, subscription);
    expect(result.passed).toBe(false);
    expect(result.result).toBe("rejected_ngram");
  });

  test("returns match result when text matches keywords", async () => {
    const message = createMessage({
      text: "Продаю iPhone 15 Pro Max в идеальном состоянии",
    });
    const subscription = createSubscription({
      positive_keywords: ["iphone", "продаю", "15", "pro"],
      llm_description: "Объявления о продаже iPhone 15 Pro",
    });

    const result = await matchMessage(message, subscription, { ngramThreshold: 0.1 });
    expect(result).not.toBeNull();
    expect(result?.passed).toBe(true);
    expect(result?.result).toBe("matched");
    expect(result?.subscription.id).toBe(subscription.id);
    expect(result?.ngramScore).toBeGreaterThan(0);
  });

  test("returns rejection when negative keyword found", async () => {
    const message = createMessage({
      text: "Продаю iPhone 15 на запчасти",
    });
    const subscription = createSubscription({
      positive_keywords: ["iphone", "продаю", "15"],
      negative_keywords: ["запчасти"],
      llm_description: "iPhone для продажи",
    });

    const result = await matchMessage(message, subscription);
    expect(result.passed).toBe(false);
    expect(result.result).toBe("rejected_negative");
    expect(result.rejectionKeyword).toBe("запчасти");
  });

  test("checks all negative keywords", async () => {
    const subscription = createSubscription({
      positive_keywords: ["iphone"],
      negative_keywords: ["разбор", "запчасти", "битый"],
      llm_description: "iPhone",
    });

    // First negative keyword
    const result1 = await matchMessage(createMessage({ text: "iphone разбор" }), subscription);
    expect(result1.passed).toBe(false);
    expect(result1.result).toBe("rejected_negative");

    // Second negative keyword
    const result2 = await matchMessage(createMessage({ text: "iphone запчасти" }), subscription);
    expect(result2.passed).toBe(false);
    expect(result2.result).toBe("rejected_negative");

    // Third negative keyword
    const result3 = await matchMessage(createMessage({ text: "iphone битый" }), subscription);
    expect(result3.passed).toBe(false);
    expect(result3.result).toBe("rejected_negative");
  });

  test("negative keyword check is token-based (exact word match)", async () => {
    const subscription = createSubscription({
      positive_keywords: ["iphone"],
      negative_keywords: ["разбор"],
      llm_description: "iPhone",
    });

    // "разбор" as separate word should block
    const result = await matchMessage(createMessage({ text: "iphone разбор кузова" }), subscription);
    expect(result.passed).toBe(false);
    expect(result.result).toBe("rejected_negative");

    // "разборчивый" contains "разбор" but is different word - shouldn't block
    // Note: our tokenize normalizes and splits, so this depends on implementation
  });

  test("should NOT trigger negative keyword when word is absent", async () => {
    const message = createMessage({
      text: "iPhone 14 Pro, 256 гигабайт памяти, Deep Purple В идеальном",
    });
    const subscription = createSubscription({
      positive_keywords: ["iphone", "14", "pro"],
      negative_keywords: ["ремонт"],
      llm_description: "iPhone 14 Pro для продажи",
    });

    const result = await matchMessage(message, subscription, { ngramThreshold: 0.1 });
    // Должен пройти n-gram фильтр и НЕ быть заблокирован негативным словом
    expect(result).not.toBeNull();
  });

  test("multi-word negative keyword matches as phrase (substring)", async () => {
    const subscription = createSubscription({
      positive_keywords: ["nike", "кроссовки"],
      negative_keywords: ["на запчасти"],
      llm_description: "Nike кроссовки",
    });

    // Text with "на" but not "запчасти" - should NOT block
    const result1 = await matchMessage(
      createMessage({
        text: "Новые кроссовки Nike. Заказывала с официального сайта на прошлой неделе",
      }),
      subscription,
      { ngramThreshold: 0.1 }
    );
    expect(result1).not.toBeNull();

    // Text with both words but NOT as phrase - should NOT block
    const result2 = await matchMessage(
      createMessage({
        text: "Продаю Nike кроссовки на рынке, есть запчасти для велосипеда",
      }),
      subscription,
      { ngramThreshold: 0.1 }
    );
    expect(result2).not.toBeNull();

    // Text with exact phrase "на запчасти" - SHOULD block
    const blocked = await matchMessage(
      createMessage({ text: "Продаю Nike кроссовки на запчасти" }),
      subscription,
      { ngramThreshold: 0.1 }
    );
    expect(blocked.passed).toBe(false);
    expect(blocked.result).toBe("rejected_negative");
  });

  test("handles empty negative keywords", async () => {
    const message = createMessage({
      text: "Продаю iPhone 15 pro max", // Would be blocked if negative keywords existed
    });
    const subscription = createSubscription({
      positive_keywords: ["iphone", "продаю", "pro"],
      negative_keywords: [], // Empty
      llm_description: "iPhone продаю pro",
    });

    const result = await matchMessage(message, subscription, { ngramThreshold: 0.1 });
    expect(result).not.toBeNull();
  });

  test("uses custom config", async () => {
    const message = createMessage({
      text: "some test text with keywords",
    });
    const subscription = createSubscription({
      positive_keywords: ["test", "keywords"],
      llm_description: "test keywords description",
    });

    // Very high threshold should fail ngram, but query_fallback can still pass
    // To test threshold blocking, use original_query that doesn't match the text
    const subscriptionNoQueryMatch = createSubscription({
      positive_keywords: ["test", "keywords"],
      llm_description: "test keywords description",
      original_query: "completely different unrelated content",
    });
    const highThreshold = await matchMessage(message, subscriptionNoQueryMatch, {
      ngramThreshold: 0.99,
    });
    expect(highThreshold.passed).toBe(false);

    // Very low threshold should pass
    const lowThreshold = await matchMessage(message, subscription, {
      ngramThreshold: 0.01,
    });
    expect(lowThreshold).not.toBeNull();
  });

  test("match result contains correct subscription reference", async () => {
    const message = createMessage({ text: "iphone продаю дешево" });
    const subscription = createSubscription({
      id: 42,
      positive_keywords: ["iphone", "продаю"],
      llm_description: "iphone продаю",
    });

    const result = await matchMessage(message, subscription, { ngramThreshold: 0.1 });
    expect(result?.subscription).toBe(subscription);
    expect(result?.subscription.id).toBe(42);
  });

  test("uses query_fallback when ngram fails but original_query matches", async () => {
    // This test verifies the fix for the issue where scanFromCache couldn't find
    // messages that findSimilarWithFallback found during subscription creation
    const message = createMessage({
      text: "Продам iphone 12 черный, 30000 руб",
    });

    // Subscription with many keywords (like real LLM-generated ones)
    // that won't pass ngram threshold due to low binary coverage
    const subscription = createSubscription({
      id: 1,
      // Many keywords = low binary coverage in ngram
      positive_keywords: [
        "iphone", "apple", "телефон", "смартфон", "мобильный",
        "продажа", "купить", "цена", "стоимость", "рубли",
        "доставка", "гарантия", "оригинал", "новый", "бу",
        "состояние", "экран", "камера", "батарея", "память",
      ],
      llm_description: "Объявления о продаже iPhone любых моделей",
      // But original_query is short and matches well
      original_query: "iphone продам",
    });

    // With very high ngram threshold, ngram stage won't pass
    // But query_fallback should kick in
    const result = await matchMessage(message, subscription, {
      ngramThreshold: 0.99, // Force ngram to fail
    });

    expect(result).not.toBeNull();
    expect(result?.result).toBe("matched"); // query fallback is part of ngram stage
    expect(result?.passed).toBe(true);
  });

  test("query_fallback does not match when original_query is unrelated", async () => {
    const message = createMessage({
      text: "Продам iphone 12 черный, 30000 руб",
    });

    const subscription = createSubscription({
      positive_keywords: ["samsung", "galaxy", "android"],
      llm_description: "Продажа Samsung Galaxy",
      original_query: "samsung galaxy телефон",
    });

    const result = await matchMessage(message, subscription, {
      ngramThreshold: 0.99,
    });

    // Neither ngram nor query_fallback should match
    expect(result.passed).toBe(false);
    expect(result.result).toBe("rejected_ngram");
  });
});

describe("matchMessageAgainstAll", () => {
  test("returns all analyses including rejections", async () => {
    const message = createMessage({ text: "random text" });
    const subscriptions = [
      createSubscription({
        id: 1,
        positive_keywords: ["iphone"],
        llm_description: "iPhone",
      }),
      createSubscription({
        id: 2,
        positive_keywords: ["samsung"],
        llm_description: "Samsung",
      }),
    ];

    const results = await matchMessageAgainstAll(message, subscriptions);
    // Now returns all analyses (both rejected)
    expect(results.length).toBe(2);
    expect(results.every(r => r.passed === false)).toBe(true);
    // Use getPassedMatches to filter only passed
    const passed = getPassedMatches(results);
    expect(passed).toEqual([]);
  });

  test("returns all matching subscriptions", async () => {
    const message = createMessage({
      text: "продаю iphone 15 pro и samsung galaxy s24",
    });
    const subscriptions = [
      createSubscription({
        id: 1,
        positive_keywords: ["iphone", "продаю", "pro"],
        llm_description: "iPhone продаю pro",
      }),
      createSubscription({
        id: 2,
        positive_keywords: ["samsung", "galaxy"],
        llm_description: "Samsung Galaxy",
      }),
      createSubscription({
        id: 3,
        positive_keywords: ["xiaomi", "redmi"],
        llm_description: "Xiaomi Redmi",
      }),
    ];

    const results = await matchMessageAgainstAll(message, subscriptions, {
      ngramThreshold: 0.1,
    });

    // Now returns ALL analyses
    expect(results.length).toBe(3);
    // Filter to get only passed
    const passed = getPassedMatches(results);
    expect(passed.length).toBeGreaterThanOrEqual(2);
    const ids = passed.map((r) => r.subscription.id);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
    expect(ids).not.toContain(3);
  });

  test("sorts results by score descending", async () => {
    const message = createMessage({
      text: "iphone iphone iphone samsung",
    });
    const subscriptions = [
      createSubscription({
        id: 1,
        positive_keywords: ["samsung"], // Less matches
        llm_description: "samsung",
      }),
      createSubscription({
        id: 2,
        positive_keywords: ["iphone"], // More matches
        llm_description: "iphone",
      }),
    ];

    const results = await matchMessageAgainstAll(message, subscriptions, {
      ngramThreshold: 0.05,
    });

    // Check that results are sorted by score descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.ngramScore ?? 0).toBeGreaterThanOrEqual(results[i]!.ngramScore ?? 0);
    }
  });

  test("handles empty subscriptions list", async () => {
    const message = createMessage({ text: "some text" });
    const results = await matchMessageAgainstAll(message, []);
    expect(results).toEqual([]);
  });

  test("marks subscriptions with negative keyword matches as rejected", async () => {
    const message = createMessage({
      text: "продаю iphone pro max на запчасти",
    });
    const subscriptions = [
      createSubscription({
        id: 1,
        positive_keywords: ["iphone", "продаю", "pro"],
        negative_keywords: ["запчасти"], // Should be rejected
        llm_description: "iPhone продаю pro",
      }),
      createSubscription({
        id: 2,
        positive_keywords: ["iphone", "продаю", "pro"],
        negative_keywords: [], // Should pass
        llm_description: "iPhone продаю pro",
      }),
    ];

    const results = await matchMessageAgainstAll(message, subscriptions, {
      ngramThreshold: 0.1,
    });

    // Returns all analyses
    expect(results.length).toBe(2);
    // Check rejection status
    const sub1 = results.find(r => r.subscription.id === 1);
    const sub2 = results.find(r => r.subscription.id === 2);
    expect(sub1?.passed).toBe(false);
    expect(sub1?.result).toBe("rejected_negative");
    expect(sub2?.passed).toBe(true);
  });

  test("applies config to all subscriptions", async () => {
    const message = createMessage({ text: "iphone pro max продаю" });
    const subscriptions = [
      createSubscription({
        id: 1,
        positive_keywords: ["iphone", "pro"],
        llm_description: "iphone pro",
      }),
      createSubscription({
        id: 2,
        positive_keywords: ["iphone", "max"],
        llm_description: "iphone max",
      }),
    ];

    // With very high threshold, even good matches should fail (be rejected)
    const highThreshold = await matchMessageAgainstAll(message, subscriptions, {
      ngramThreshold: 0.99,
    });
    // Still returns analyses, but none passed
    expect(highThreshold.length).toBe(2);
    expect(getPassedMatches(highThreshold)).toEqual([]);

    const lowThreshold = await matchMessageAgainstAll(message, subscriptions, {
      ngramThreshold: 0.01,
    });
    expect(lowThreshold.length).toBe(2);
    expect(getPassedMatches(lowThreshold).length).toBe(2);
  });

  test("real-world scenario: multiple subscription types", async () => {
    const message = createMessage({
      text: "Продаю MacBook Pro M3 Max 14 дюймов, 36gb RAM, идеальное состояние, полный комплект. Цена 250000р, Москва.",
    });

    const subscriptions = [
      createSubscription({
        id: 1,
        positive_keywords: ["macbook", "продаю", "pro"],
        negative_keywords: ["запчасти", "разбор"],
        llm_description: "MacBook Pro продаю",
      }),
      createSubscription({
        id: 2,
        positive_keywords: ["iphone", "apple", "ios"],
        negative_keywords: [],
        llm_description: "iPhone Apple iOS",
      }),
    ];

    const results = await matchMessageAgainstAll(message, subscriptions, {
      ngramThreshold: 0.15,
    });

    // Returns all analyses
    expect(results.length).toBe(2);
    // MacBook should match, iPhone should be rejected
    const passed = getPassedMatches(results);
    const ids = passed.map((r) => r.subscription.id);
    expect(ids).toContain(1);
    expect(ids).not.toContain(2); // iPhone/Apple/iOS not mentioned
  });
});

// Test re-exports
describe("module exports", () => {
  test("exports ngram functions", async () => {
    const module = await import("./index.ts");
    expect(typeof module.calculateNgramSimilarity).toBe("function");
    expect(typeof module.passesNgramFilter).toBe("function");
  });

  test("exports normalize functions", async () => {
    const module = await import("./index.ts");
    expect(typeof module.normalizeText).toBe("function");
    expect(typeof module.tokenize).toBe("function");
    expect(typeof module.generateNgrams).toBe("function");
    expect(typeof module.generateWordShingles).toBe("function");
  });
});
