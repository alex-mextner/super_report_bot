import { describe, test, expect, mock, beforeEach } from "bun:test";
import type { DeepSeekVerificationResult } from "./deepseek.ts";

// Helper to create mock DeepSeek result
const createDeepSeekResult = (isMatch: boolean, confidence: number): DeepSeekVerificationResult => ({
  isMatch,
  confidence,
  reasoning: isMatch ? "Message matches criteria" : "Message does not match",
});

const createMockMessage = (text: string) => ({
  id: 1,
  group_id: -100123456,
  group_title: "Test Group",
  text,
  sender_name: "Test User",
  timestamp: new Date(),
});

const createMockSubscription = (id: number, llm_description: string) => ({
  id,
  user_id: 1,
  original_query: "test query",
  positive_keywords: ["test"],
  negative_keywords: [] as string[],
  llm_description,
  is_active: 1,
  created_at: "2024-01-01 00:00:00",
});

// Mock the DeepSeek module
type DeepSeekMockFn = (text: string, description: string) => Promise<DeepSeekVerificationResult>;
let mockVerifyWithDeepSeek: ReturnType<typeof mock<DeepSeekMockFn>>;

mock.module("./deepseek.ts", () => ({
  verifyWithDeepSeek: (text: string, description: string) => mockVerifyWithDeepSeek(text, description),
  checkDeepSeekHealth: () => Promise.resolve(true),
}));

// Tests for verifyMatch with mocked DeepSeek API
describe("verifyMatch with mocked DeepSeek API", () => {
  beforeEach(() => {
    // Reset mock implementation before each test
    mockVerifyWithDeepSeek = mock(() => Promise.resolve(createDeepSeekResult(true, 0.8)));
  });

  test("returns isMatch: true when DeepSeek returns match with confidence >= 0.7", async () => {
    mockVerifyWithDeepSeek = mock(() => Promise.resolve(createDeepSeekResult(true, 0.85)));

    // Re-import to pick up mocked module
    const { verifyMatch } = await import("./verify.ts");
    const message = createMockMessage("Продаю iPhone 15 Pro Max");
    const subscription = createMockSubscription(1, "iPhone для продажи");

    const result = await verifyMatch(message, subscription);

    expect(result.isMatch).toBe(true);
    expect(result.confidence).toBe(0.85);
  });

  test("returns isMatch: false when DeepSeek returns no match", async () => {
    mockVerifyWithDeepSeek = mock(() => Promise.resolve(createDeepSeekResult(false, 0.3)));

    const { verifyMatch } = await import("./verify.ts");
    const message = createMockMessage("Куплю запчасти для телефона");
    const subscription = createMockSubscription(1, "iPhone для продажи");

    const result = await verifyMatch(message, subscription);

    expect(result.isMatch).toBe(false);
    expect(result.confidence).toBe(0.3);
  });

  test("returns isMatch: false when confidence below 0.7 threshold even if DeepSeek says match", async () => {
    // DeepSeek says match but confidence is too low
    mockVerifyWithDeepSeek = mock(() => Promise.resolve(createDeepSeekResult(true, 0.5)));

    const { verifyMatch } = await import("./verify.ts");
    const message = createMockMessage("Телефон в хорошем состоянии");
    const subscription = createMockSubscription(1, "iPhone для продажи");

    const result = await verifyMatch(message, subscription);

    // isMatch should be false because confidence < 0.7
    expect(result.isMatch).toBe(false);
    expect(result.confidence).toBe(0.5);
  });

  test("returns isMatch: true when confidence exactly 0.7 (boundary)", async () => {
    mockVerifyWithDeepSeek = mock(() => Promise.resolve(createDeepSeekResult(true, 0.7)));

    const { verifyMatch } = await import("./verify.ts");
    const message = createMockMessage("iPhone 15 продаю срочно");
    const subscription = createMockSubscription(1, "iPhone для продажи");

    const result = await verifyMatch(message, subscription);

    // >= 0.7 threshold, so 0.7 should pass
    expect(result.isMatch).toBe(true);
    expect(result.confidence).toBe(0.7);
  });

  test("handles DeepSeek API error", async () => {
    mockVerifyWithDeepSeek = mock(() => Promise.reject(new Error("DeepSeek API error")));

    const { verifyMatch } = await import("./verify.ts");
    const message = createMockMessage("Test message");
    const subscription = createMockSubscription(1, "Test description");

    const result = await verifyMatch(message, subscription);

    expect(result.isMatch).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.label).toBe("error");
  });

  test("uses subscription llm_description for verification", async () => {
    let capturedDescription = "";
    mockVerifyWithDeepSeek = mock((text: string, description: string) => {
      capturedDescription = description;
      return Promise.resolve(createDeepSeekResult(true, 0.9));
    });

    const { verifyMatch } = await import("./verify.ts");
    const message = createMockMessage("iPhone 15 Pro Max новый");
    const subscription = createMockSubscription(1, "Объявления о продаже iPhone");

    await verifyMatch(message, subscription);

    expect(capturedDescription).toBe("Объявления о продаже iPhone");
  });

});

// Tests for verifyMatches (batch verification)
describe("verifyMatches with mocked DeepSeek API", () => {
  beforeEach(() => {
    mockVerifyWithDeepSeek = mock(() => Promise.resolve(createDeepSeekResult(true, 0.8)));
  });

  test("processes multiple subscriptions", async () => {
    let callCount = 0;
    mockVerifyWithDeepSeek = mock(() => {
      callCount++;
      // First subscription matches, second doesn't
      if (callCount === 1) {
        return Promise.resolve(createDeepSeekResult(true, 0.85));
      }
      return Promise.resolve(createDeepSeekResult(false, 0.3));
    });

    const { verifyMatches } = await import("./verify.ts");
    const message = createMockMessage("iPhone 15 Pro");
    const subscriptions = [
      createMockSubscription(1, "iPhone для продажи"),
      createMockSubscription(2, "Samsung для продажи"),
    ];

    const results = await verifyMatches(message, subscriptions);

    expect(results.size).toBe(2);
    expect(results.get(1)?.isMatch).toBe(true);
    expect(results.get(2)?.isMatch).toBe(false);
  });

  test("handles error for one subscription without failing others", async () => {
    let callCount = 0;
    mockVerifyWithDeepSeek = mock(() => {
      callCount++;
      if (callCount === 2) {
        return Promise.reject(new Error("API error"));
      }
      return Promise.resolve(createDeepSeekResult(true, 0.85));
    });

    const { verifyMatches } = await import("./verify.ts");
    const message = createMockMessage("Test");
    const subscriptions = [
      createMockSubscription(1, "Test 1"),
      createMockSubscription(2, "Test 2"),
      createMockSubscription(3, "Test 3"),
    ];

    const results = await verifyMatches(message, subscriptions);

    expect(results.size).toBe(3);
    expect(results.get(1)?.isMatch).toBe(true);
    // Subscription 2 failed, should have error result
    expect(results.get(2)?.isMatch).toBe(false);
    expect(results.get(2)?.label).toBe("error");
    expect(results.get(3)?.isMatch).toBe(true);
  });

  test("returns empty map for empty subscriptions", async () => {
    const { verifyMatches } = await import("./verify.ts");
    const message = createMockMessage("Test");

    const results = await verifyMatches(message, []);

    expect(results.size).toBe(0);
  });
});
