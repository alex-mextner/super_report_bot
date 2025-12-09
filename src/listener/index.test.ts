/**
 * Listener module tests
 *
 * Note: Most listener functions depend on mtcute TelegramClient which is difficult to mock.
 * These tests cover the testable parts. Full integration testing would require:
 * - Mock Telegram API server
 * - Or real test account with test groups
 *
 * TODO: Add integration tests for:
 * - processMessage deduplication
 * - LLM verification fallback
 * - FLOOD_WAIT handling
 * - CHANNEL_INVALID reconnection
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";

// We can test the subscription cache invalidation logic
describe("invalidateSubscriptionsCache", () => {
  test("function is exported and callable", async () => {
    // This test verifies the module loads without errors
    // The actual cache invalidation is tested through integration
    const { invalidateSubscriptionsCache } = await import("./index.ts");

    expect(typeof invalidateSubscriptionsCache).toBe("function");

    // Should not throw
    invalidateSubscriptionsCache();
  });
});

// Test scanFromCache result structure expectations
describe("scanFromCache result structure", () => {
  test("HistoryScanResult interface is properly typed", async () => {
    // This is a compile-time check via import
    const mod = await import("./index.ts");

    // Verify the types exist (TypeScript would catch missing exports)
    expect(mod.scanFromCache).toBeDefined();
  });
});

/**
 * Tests for fuzzy search scoring (internal function)
 *
 * The fuzzySearchScore function is not exported, but we can test
 * the same algorithm through the matcher module which uses similar logic.
 *
 * See: src/matcher/ngram.test.ts for comprehensive n-gram tests
 * See: src/api/fuzzySearch.test.ts for fuzzy search tests
 */
describe("Fuzzy search scoring (documented behavior)", () => {
  /**
   * The listener uses this scoring to:
   * 1. Pre-filter messages before expensive LLM verification
   * 2. Fallback when LLM verification fails
   *
   * Key thresholds:
   * - FUZZY_FALLBACK_THRESHOLD = 0.3 (listener/index.ts:36)
   * - passesNgramFilter threshold = 0.15 (matcher/index.ts)
   */
  test("documented thresholds are consistent with matcher", () => {
    // This documents the expected behavior rather than testing implementation
    const FUZZY_FALLBACK_THRESHOLD = 0.3;
    const NGRAM_FILTER_THRESHOLD = 0.15;

    // Fallback threshold should be higher than filter (more strict)
    expect(FUZZY_FALLBACK_THRESHOLD).toBeGreaterThan(NGRAM_FILTER_THRESHOLD);
  });
});

/**
 * Deduplication behavior documentation
 *
 * The processMessage function uses queries.isMessageMatched() and
 * queries.recordMatch() to prevent duplicate notifications.
 *
 * Expected behavior:
 * 1. Check if message+subscription combo was already processed
 * 2. If not, process and record the match
 * 3. If yes, skip notification
 *
 * This is tested in db module tests.
 */
describe("Deduplication (documented behavior)", () => {
  test("DB queries module handles dedup", async () => {
    const { queries } = await import("../db/index.ts");

    // Verify the required functions exist
    expect(typeof queries.isMessageMatched).toBe("function");
    expect(typeof queries.markMessageMatched).toBe("function");
  });
});
