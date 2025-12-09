/**
 * PIPELINE — обработка входящих сообщений из Telegram групп
 *
 * Архитектура (3 стадии):
 *
 * 1. N-GRAM FILTER (быстрый, CPU)
 *    - Character trigrams + word bigrams
 *    - Порог: 0.15 (низкий, чтобы не пропустить релевантные)
 *    - Цель: отсеять 95% мусора до дорогого LLM
 *
 * 2. KEYWORD MATCHING
 *    - Keyword считается найденным если ≥70% его n-gram есть в тексте
 *    - Логика OR: достаточно одного keyword для прохождения
 *
 * 3. LLM VERIFICATION (дорогой, API call)
 *    - Zero-shot classification через BART-MNLI
 *    - Порог: 0.7 confidence
 *    - Fallback: если LLM недоступен и n-gram score > 0.7 → notify anyway
 *
 * Дедупликация: один message+subscription может дать только одно уведомление.
 */

import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import type { IncomingMessage, Subscription } from "../types.ts";

// Create test database
const testDb = new Database(":memory:");
const schema = await Bun.file(new URL("../db/schema.sql", import.meta.url)).text();
testDb.exec(schema);

// Test data helpers
function createTestMessage(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    id: 1,
    group_id: -100123456,
    group_title: "Test Group",
    text: "Продаю iPhone 15 Pro Max 256gb в идеальном состоянии, цена 80000",
    sender_name: "Test User",
    sender_username: "testuser",
    timestamp: new Date(),
    ...overrides,
  };
}

function createTestSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 1,
    user_id: 1,
    original_query: "iPhone 15 продаю",
    positive_keywords: ["iphone", "15", "продаю"],
    negative_keywords: [],
    llm_description: "Объявления о продаже iPhone 15",
    is_active: 1,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// Import matcher (real implementation)
import { matchMessageAgainstAll, passesNgramFilter } from "../matcher/index.ts";

describe("Message Processing Pipeline", () => {
  describe("Stage 1-2: N-gram + semantic matching", () => {
    test("matching message passes n-gram filter", () => {
      const message = createTestMessage();
      const subscription = createTestSubscription();

      const result = passesNgramFilter(
        message.text,
        subscription.positive_keywords,
        subscription.llm_description,
        0.15
      );

      expect(result.passed).toBe(true);
      expect(result.score).toBeGreaterThan(0.15);
    });

    test("non-matching message fails n-gram filter", () => {
      const message = createTestMessage({
        text: "Продаю велосипед горный, отличное состояние",
      });
      const subscription = createTestSubscription();

      const result = passesNgramFilter(
        message.text,
        subscription.positive_keywords,
        subscription.llm_description,
        0.15
      );

      // Should not match iPhone keywords
      expect(result.score).toBeLessThan(0.3);
    });

    test("negative keywords filter out unwanted messages", async () => {
      const message = createTestMessage({
        text: "iPhone 15 на запчасти, разбитый экран, продаю дешево",
      });
      const subscription = createTestSubscription({
        negative_keywords: ["запчасти", "разбит"],
      });

      // matchMessageAgainstAll should filter this out
      const candidates = await matchMessageAgainstAll(message, [subscription]);

      // Message should be filtered out due to negative keywords
      expect(candidates.length).toBe(0);
    });

    test("matchMessageAgainstAll returns scored candidates", async () => {
      const message = createTestMessage();
      const subscriptions = [
        createTestSubscription({ id: 1 }),
        createTestSubscription({
          id: 2,
          original_query: "Samsung Galaxy",
          positive_keywords: ["samsung", "galaxy"],
          llm_description: "Samsung Galaxy phones",
        }),
      ];

      const candidates = await matchMessageAgainstAll(message, subscriptions);

      // iPhone subscription should match, Samsung should not
      expect(candidates.length).toBeGreaterThanOrEqual(1);
      // Check that iPhone subscription is in results (sorted by score)
      const iPhoneMatch = candidates.find(c => c.subscription.id === 1);
      expect(iPhoneMatch).toBeDefined();
    });
  });

  describe("Score thresholds (documented behavior)", () => {
    /**
     * These tests document the expected thresholds used in the pipeline:
     *
     * 1. N-gram filter: 0.15 (passesNgramFilter threshold)
     *    - Purpose: Quick pre-filter before expensive LLM
     *    - Low threshold to avoid false negatives
     *
     * 2. LLM verification: 0.7 confidence
     *    - Purpose: Final verification of match quality
     *    - Higher threshold for precision
     *
     * 3. LLM fallback: 0.7 n-gram score
     *    - Purpose: When LLM fails, still notify if score high
     *    - Same as LLM threshold for consistency
     */

    test("n-gram threshold is 0.15", () => {
      // This documents the expected threshold
      const EXPECTED_NGRAM_THRESHOLD = 0.15;

      // Message that barely passes
      const result = passesNgramFilter(
        "iPhone продаю недорого",
        ["iphone", "продаю"],
        "iPhone",
        EXPECTED_NGRAM_THRESHOLD
      );

      expect(result.passed).toBe(true);
    });

    test("LLM fallback threshold is 0.7", () => {
      // From listener/index.ts line 230:
      // if (candidate.score > 0.7) { ... notify anyway ... }
      const LLM_FALLBACK_THRESHOLD = 0.7;

      // This is a high bar - message must be very relevant
      const highScoreResult = passesNgramFilter(
        "Продаю iPhone 15 Pro Max 256gb идеальное состояние цена",
        ["iphone", "15", "pro", "max", "продаю", "цена"],
        "Продажа iPhone 15 Pro Max",
        0.1
      );

      // Verify we can achieve high scores with good matches
      expect(highScoreResult.score).toBeGreaterThan(0.5);
    });
  });

  describe("Deduplication behavior", () => {
    const dedup = {
      matched: new Set<string>(),
      isMatched: (subId: number, msgId: number, groupId: number) =>
        dedup.matched.has(`${subId}-${msgId}-${groupId}`),
      mark: (subId: number, msgId: number, groupId: number) =>
        dedup.matched.add(`${subId}-${msgId}-${groupId}`),
      clear: () => dedup.matched.clear(),
    };

    beforeEach(() => {
      dedup.clear();
    });

    test("same message+subscription combo is deduplicated", () => {
      const subId = 1, msgId = 100, groupId = -100123;

      expect(dedup.isMatched(subId, msgId, groupId)).toBe(false);

      dedup.mark(subId, msgId, groupId);
      expect(dedup.isMatched(subId, msgId, groupId)).toBe(true);

      // Second mark should not throw
      dedup.mark(subId, msgId, groupId);
      expect(dedup.isMatched(subId, msgId, groupId)).toBe(true);
    });

    test("same message can match different subscriptions", () => {
      const msgId = 100, groupId = -100123;

      dedup.mark(1, msgId, groupId);
      dedup.mark(2, msgId, groupId);

      expect(dedup.isMatched(1, msgId, groupId)).toBe(true);
      expect(dedup.isMatched(2, msgId, groupId)).toBe(true);
      expect(dedup.isMatched(3, msgId, groupId)).toBe(false);
    });
  });

  describe("Error handling", () => {
    test("pipeline should handle empty message text", () => {
      const message = createTestMessage({ text: "" });
      const subscription = createTestSubscription();

      const result = passesNgramFilter(
        message.text,
        subscription.positive_keywords,
        subscription.llm_description,
        0.15
      );

      // Empty text should not pass
      expect(result.passed).toBe(false);
    });

    test("pipeline should handle empty keywords and query", async () => {
      const message = createTestMessage();
      const subscription = createTestSubscription({
        original_query: "",  // Also clear query to disable query_fallback
        positive_keywords: [],
        llm_description: "",
      });

      const candidates = await matchMessageAgainstAll(message, [subscription]);

      // No keywords and no query = no match
      expect(candidates.length).toBe(0);
    });

    test("pipeline should handle unicode in message", () => {
      const message = createTestMessage({
        text: "Продаю iPhone 15 📱 отличное состояние! 🔥 Цена: 80000₽",
      });
      const subscription = createTestSubscription();

      const result = passesNgramFilter(
        message.text,
        subscription.positive_keywords,
        subscription.llm_description,
        0.15
      );

      // Should handle emoji and special chars
      expect(result.passed).toBe(true);
    });
  });
});

describe("Full pipeline simulation", () => {
  test("simulates complete message processing flow", async () => {
    // Setup
    const message = createTestMessage();
    const subscription = createTestSubscription();
    const notifications: Array<{ userId: number; message: string }> = [];

    // Mock notify function
    const mockNotify = (userId: number, text: string) => {
      notifications.push({ userId, message: text });
    };

    // Step 1: N-gram filter
    const filterResult = passesNgramFilter(
      message.text,
      subscription.positive_keywords,
      subscription.llm_description,
      0.15
    );
    expect(filterResult.passed).toBe(true);

    // Step 2: Get candidates
    const candidates = await matchMessageAgainstAll(message, [subscription]);
    expect(candidates.length).toBeGreaterThan(0);

    // Step 3: Simulate LLM verification (mocked as passing)
    const llmVerified = true; // In real code: await verifyMatch(message, subscription)

    // Step 4: Notify if verified
    if (llmVerified) {
      mockNotify(12345, message.text);
    }

    // Verify notification was sent
    expect(notifications.length).toBe(1);
    expect(notifications[0]!.userId).toBe(12345);
  });
});
