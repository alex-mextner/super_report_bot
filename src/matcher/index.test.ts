import { describe, test, expect } from "bun:test";
import { matchMessage, matchMessageAgainstAll } from "./index.ts";
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
  test("returns null when no match", () => {
    const message = createMessage({ text: "completely unrelated content" });
    const subscription = createSubscription({
      positive_keywords: ["iphone", "продаю"],
      llm_description: "iPhone для продажи",
    });

    const result = matchMessage(message, subscription);
    expect(result).toBeNull();
  });

  test("returns match result when text matches keywords", () => {
    const message = createMessage({
      text: "Продаю iPhone 15 Pro Max в идеальном состоянии",
    });
    const subscription = createSubscription({
      positive_keywords: ["iphone", "продаю", "15", "pro"],
      llm_description: "Объявления о продаже iPhone 15 Pro",
    });

    const result = matchMessage(message, subscription, { ngramThreshold: 0.1 });
    expect(result).not.toBeNull();
    expect(result?.passed).toBe(true);
    expect(result?.stage).toBe("ngram");
    expect(result?.subscription.id).toBe(subscription.id);
    expect(result?.score).toBeGreaterThan(0);
  });

  test("returns null when negative keyword found", () => {
    const message = createMessage({
      text: "Продаю iPhone 15 на запчасти",
    });
    const subscription = createSubscription({
      positive_keywords: ["iphone", "продаю", "15"],
      negative_keywords: ["запчасти"],
      llm_description: "iPhone для продажи",
    });

    const result = matchMessage(message, subscription);
    expect(result).toBeNull();
  });

  test("checks all negative keywords", () => {
    const subscription = createSubscription({
      positive_keywords: ["iphone"],
      negative_keywords: ["разбор", "запчасти", "битый"],
      llm_description: "iPhone",
    });

    // First negative keyword
    expect(
      matchMessage(createMessage({ text: "iphone разбор" }), subscription)
    ).toBeNull();

    // Second negative keyword
    expect(
      matchMessage(createMessage({ text: "iphone запчасти" }), subscription)
    ).toBeNull();

    // Third negative keyword
    expect(
      matchMessage(createMessage({ text: "iphone битый" }), subscription)
    ).toBeNull();
  });

  test("negative keyword check is token-based (exact word match)", () => {
    const subscription = createSubscription({
      positive_keywords: ["iphone"],
      negative_keywords: ["разбор"],
      llm_description: "iPhone",
    });

    // "разбор" as separate word should block
    expect(
      matchMessage(createMessage({ text: "iphone разбор кузова" }), subscription)
    ).toBeNull();

    // "разборчивый" contains "разбор" but is different word - shouldn't block
    // Note: our tokenize normalizes and splits, so this depends on implementation
  });

  test("handles empty negative keywords", () => {
    const message = createMessage({
      text: "Продаю iPhone 15 pro max", // Would be blocked if negative keywords existed
    });
    const subscription = createSubscription({
      positive_keywords: ["iphone", "продаю", "pro"],
      negative_keywords: [], // Empty
      llm_description: "iPhone продаю pro",
    });

    const result = matchMessage(message, subscription, { ngramThreshold: 0.1 });
    expect(result).not.toBeNull();
  });

  test("uses custom config", () => {
    const message = createMessage({
      text: "some test text with keywords",
    });
    const subscription = createSubscription({
      positive_keywords: ["test", "keywords"],
      llm_description: "test keywords description",
    });

    // Very high threshold should fail
    const highThreshold = matchMessage(message, subscription, {
      ngramThreshold: 0.99,
    });
    expect(highThreshold).toBeNull();

    // Very low threshold should pass
    const lowThreshold = matchMessage(message, subscription, {
      ngramThreshold: 0.01,
    });
    expect(lowThreshold).not.toBeNull();
  });

  test("match result contains correct subscription reference", () => {
    const message = createMessage({ text: "iphone продаю дешево" });
    const subscription = createSubscription({
      id: 42,
      positive_keywords: ["iphone", "продаю"],
      llm_description: "iphone продаю",
    });

    const result = matchMessage(message, subscription, { ngramThreshold: 0.1 });
    expect(result?.subscription).toBe(subscription);
    expect(result?.subscription.id).toBe(42);
  });
});

describe("matchMessageAgainstAll", () => {
  test("returns empty array when no matches", () => {
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

    const results = matchMessageAgainstAll(message, subscriptions);
    expect(results).toEqual([]);
  });

  test("returns all matching subscriptions", () => {
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

    const results = matchMessageAgainstAll(message, subscriptions, {
      ngramThreshold: 0.1,
    });

    expect(results.length).toBeGreaterThanOrEqual(2);
    const ids = results.map((r) => r.subscription.id);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
    expect(ids).not.toContain(3);
  });

  test("sorts results by score descending", () => {
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

    const results = matchMessageAgainstAll(message, subscriptions, {
      ngramThreshold: 0.05,
    });

    // Check that results are sorted by score descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });

  test("handles empty subscriptions list", () => {
    const message = createMessage({ text: "some text" });
    const results = matchMessageAgainstAll(message, []);
    expect(results).toEqual([]);
  });

  test("filters out subscriptions with negative keyword matches", () => {
    const message = createMessage({
      text: "продаю iphone pro max на запчасти",
    });
    const subscriptions = [
      createSubscription({
        id: 1,
        positive_keywords: ["iphone", "продаю", "pro"],
        negative_keywords: ["запчасти"], // Should be filtered
        llm_description: "iPhone продаю pro",
      }),
      createSubscription({
        id: 2,
        positive_keywords: ["iphone", "продаю", "pro"],
        negative_keywords: [], // Should match
        llm_description: "iPhone продаю pro",
      }),
    ];

    const results = matchMessageAgainstAll(message, subscriptions, {
      ngramThreshold: 0.1,
    });

    const ids = results.map((r) => r.subscription.id);
    expect(ids).not.toContain(1); // Filtered by negative keyword
    expect(ids).toContain(2); // Passed
  });

  test("applies config to all subscriptions", () => {
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

    // With very high threshold, even good matches should fail
    const highThreshold = matchMessageAgainstAll(message, subscriptions, {
      ngramThreshold: 0.99,
    });
    expect(highThreshold).toEqual([]);

    const lowThreshold = matchMessageAgainstAll(message, subscriptions, {
      ngramThreshold: 0.01,
    });
    expect(lowThreshold.length).toBe(2);
  });

  test("real-world scenario: multiple subscription types", () => {
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

    const results = matchMessageAgainstAll(message, subscriptions, {
      ngramThreshold: 0.15,
    });

    // Should match MacBook subscription
    const ids = results.map((r) => r.subscription.id);
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
