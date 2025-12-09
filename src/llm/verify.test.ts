import { describe, test, expect, mock, beforeEach } from "bun:test";
import type { VerificationResult } from "./verify.ts";

// Unit tests for VerificationResult type structure
describe("VerificationResult", () => {
  test("has correct structure", () => {
    const result: VerificationResult = {
      isMatch: true,
      confidence: 0.85,
      label: "matched",
    };

    expect(result.isMatch).toBe(true);
    expect(result.confidence).toBe(0.85);
    expect(result.label).toBe("matched");
  });

  test("handles non-match", () => {
    const result: VerificationResult = {
      isMatch: false,
      confidence: 0.3,
      label: "not matched",
    };

    expect(result.isMatch).toBe(false);
    expect(result.confidence).toBeLessThan(0.5);
  });

  test("handles error state", () => {
    const result: VerificationResult = {
      isMatch: false,
      confidence: 0,
      label: "error",
    };

    expect(result.isMatch).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.label).toBe("error");
  });
});

// Helper to create mock zero-shot result
const createZeroShotResult = (matchScore: number) => ({
  labels: [
    `This message matches: test description`,
    "This message does not match the search criteria",
  ],
  scores: [matchScore, 1 - matchScore],
  sequence: "test text",
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

// Mock the HuggingFace module
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockZeroShotClassification: ReturnType<typeof mock<any>> = mock(() => Promise.resolve(createZeroShotResult(0.8)));

mock.module("@huggingface/inference", () => ({
  InferenceClient: class MockInferenceClient {
    zeroShotClassification = (...args: unknown[]) => mockZeroShotClassification(...args);
  },
}));

// Tests for verifyMatch with mocked HuggingFace API
describe("verifyMatch with mocked HF API", () => {
  beforeEach(() => {
    // Reset mock implementation before each test
    mockZeroShotClassification = mock(() => Promise.resolve(createZeroShotResult(0.8)));
  });

  test("returns isMatch: true when confidence > 0.6", async () => {
    mockZeroShotClassification = mock(() => Promise.resolve(createZeroShotResult(0.75)));

    // Re-import to pick up mocked module
    const { verifyMatch } = await import("./verify.ts");
    const message = createMockMessage("Продаю iPhone 15 Pro Max");
    const subscription = createMockSubscription(1, "iPhone для продажи");

    const result = await verifyMatch(message, subscription);

    expect(result.isMatch).toBe(true);
    expect(result.confidence).toBe(0.75);
  });

  test("returns isMatch: false when confidence < 0.6", async () => {
    mockZeroShotClassification = mock(() => Promise.resolve(createZeroShotResult(0.45)));

    const { verifyMatch } = await import("./verify.ts");
    const message = createMockMessage("Куплю запчасти для телефона");
    const subscription = createMockSubscription(1, "iPhone для продажи");

    const result = await verifyMatch(message, subscription);

    expect(result.isMatch).toBe(false);
    expect(result.confidence).toBe(0.45);
  });

  test("returns isMatch: false when confidence exactly 0.6 (boundary)", async () => {
    mockZeroShotClassification = mock(() => Promise.resolve(createZeroShotResult(0.6)));

    const { verifyMatch } = await import("./verify.ts");
    const message = createMockMessage("Телефон в хорошем состоянии");
    const subscription = createMockSubscription(1, "iPhone для продажи");

    const result = await verifyMatch(message, subscription);

    // > 0.6, not >= 0.6, so 0.6 should be false
    expect(result.isMatch).toBe(false);
    expect(result.confidence).toBe(0.6);
  });

  test("returns isMatch: true when confidence just above threshold (0.61)", async () => {
    mockZeroShotClassification = mock(() => Promise.resolve(createZeroShotResult(0.61)));

    const { verifyMatch } = await import("./verify.ts");
    const message = createMockMessage("iPhone 15 продаю срочно");
    const subscription = createMockSubscription(1, "iPhone для продажи");

    const result = await verifyMatch(message, subscription);

    expect(result.isMatch).toBe(true);
    expect(result.confidence).toBe(0.61);
  });

  test("handles invalid response structure", async () => {
    mockZeroShotClassification = mock(() => Promise.resolve({ invalid: "response" }));

    const { verifyMatch } = await import("./verify.ts");
    const message = createMockMessage("Test message");
    const subscription = createMockSubscription(1, "Test description");

    const result = await verifyMatch(message, subscription);

    expect(result.isMatch).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.label).toBe("invalid_response");
  });

  test("handles response as array (batch mode)", async () => {
    mockZeroShotClassification = mock(() => Promise.resolve([createZeroShotResult(0.85)]));

    const { verifyMatch } = await import("./verify.ts");
    const message = createMockMessage("iPhone 15 Pro Max новый");
    const subscription = createMockSubscription(1, "iPhone для продажи");

    const result = await verifyMatch(message, subscription);

    expect(result.isMatch).toBe(true);
    expect(result.confidence).toBe(0.85);
  });

  test("handles empty labels array", async () => {
    mockZeroShotClassification = mock(() =>
      Promise.resolve({
        labels: [],
        scores: [],
        sequence: "test",
      })
    );

    const { verifyMatch } = await import("./verify.ts");
    const message = createMockMessage("Test");
    const subscription = createMockSubscription(1, "Test");

    const result = await verifyMatch(message, subscription);

    // matchIndex will be -1, matchScore will be 0
    expect(result.isMatch).toBe(false);
    expect(result.confidence).toBe(0);
  });
});

// Tests for verifyMatches (batch verification)
describe("verifyMatches with mocked HF API", () => {
  beforeEach(() => {
    mockZeroShotClassification = mock(() => Promise.resolve(createZeroShotResult(0.8)));
  });

  test("processes multiple subscriptions", async () => {
    let callCount = 0;
    mockZeroShotClassification = mock(() => {
      callCount++;
      // First subscription matches, second doesn't
      const score = callCount === 1 ? 0.8 : 0.3;
      return Promise.resolve(createZeroShotResult(score));
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
    mockZeroShotClassification = mock(() => {
      callCount++;
      if (callCount === 2) {
        return Promise.reject(new Error("API error"));
      }
      return Promise.resolve(createZeroShotResult(0.8));
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
});
