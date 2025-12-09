/**
 * Integration test for bot subscription creation flow
 *
 * Tests the full user journey:
 * 1. User sends "Робот пылесос"
 * 2. Bot asks 3 clarification questions
 * 3. User answers each question
 * 4. Bot shows examples for rating
 * 5. User can request AI correction
 *
 * LLM and Telegram API are mocked, FSM is real.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK DATA
// ═══════════════════════════════════════════════════════════════════════════════

const TEST_USER_ID = 12345;

const MOCK_QUESTIONS = [
  "Укажите ценовой диапазон (например, до 15 000 рублей, 20-40 тыс)?",
  "Какие характеристики важны (с мойкой пола, самоочисткой, навигацией LIDAR)?",
  "Интересуют новые, б/у или любые?",
];

const MOCK_KEYWORDS_RESULT = {
  positive_keywords: ["робот", "пылесос", "xiaomi", "мойка", "б/у"],
  negative_keywords: ["новый"],
  llm_description: "Б/у робот-пылесос Xiaomi с функцией мойки пола, бюджет 10-15 тыс динар",
};

const MOCK_SIMILAR_MESSAGES = [
  {
    id: 1,
    text: "Робот пылесос iRobot Roomba Max 705 Combo белый\nАбсолютно новый, не вскрывался\n130 000 RSD",
    groupId: 123,
    groupTitle: "Сербская Барахолка",
    score: 0.85,
  },
  {
    id: 2,
    text: "Робот пылесос Xiaomi с мойкой пола, б/у в отличном состоянии\n15 000 RSD",
    groupId: 123,
    groupTitle: "Сербская Барахолка",
    score: 0.92,
  },
  {
    id: 3,
    text: "Продам робот пылесос iRobot Roomba J7+\nУ робота ошибка 76\n20 000 RSD",
    groupId: 123,
    groupTitle: "Сербская Барахолка",
    score: 0.78,
  },
];

const MOCK_CACHED_MESSAGES = MOCK_SIMILAR_MESSAGES.map((m) => ({
  id: m.id,
  group_id: m.groupId,
  group_title: m.groupTitle,
  text: m.text,
  sender_name: "Test User",
  sender_username: "testuser",
  timestamp: new Date(),
}));

const MOCK_GROUPS = [{ id: 123, title: "Сербская Барахолка", telegram_id: -100123 }];

// ═══════════════════════════════════════════════════════════════════════════════
// MOCKS - must be before imports
// ═══════════════════════════════════════════════════════════════════════════════

// LLM Clarify
mock.module("../llm/clarify.ts", () => ({
  analyzeQueryAndGenerateQuestions: () =>
    Promise.resolve({
      needsClarification: true,
      questions: MOCK_QUESTIONS,
      reasoning: "Query needs clarification about price, features, and condition",
    }),
  generateClarificationQuestions: () => Promise.resolve(MOCK_QUESTIONS),
  formatClarificationContext: (questions: string[], answers: string[]) =>
    questions.map((q, i) => `Q: ${q}\nA: ${answers[i] || ""}`).join("\n"),
}));

// LLM Keywords
mock.module("../llm/keywords.ts", () => ({
  generateKeywords: () => Promise.resolve(MOCK_KEYWORDS_RESULT),
  generateKeywordsWithRatings: () => Promise.resolve(MOCK_KEYWORDS_RESULT),
  generateKeywordsFallback: (query: string) => ({
    positive_keywords: query.toLowerCase().split(/\s+/),
    negative_keywords: [],
    llm_description: query,
  }),
  generateDraftKeywords: () => Promise.resolve(["робот", "пылесос"]),
  generateExampleMessages: () => Promise.resolve([]),
  generatedToRatingExamples: () => [],
  correctDescription: () =>
    Promise.resolve({
      description: "Б/у робот-пылесос с мойкой, самоочистка опционально",
      summary: "Добавлено уточнение про самоочистку",
    }),
}));

// LLM Edit
mock.module("../llm/edit.ts", () => ({
  interpretEditCommand: () =>
    Promise.resolve({
      positive_keywords: MOCK_KEYWORDS_RESULT.positive_keywords,
      negative_keywords: MOCK_KEYWORDS_RESULT.negative_keywords,
      llm_description: MOCK_KEYWORDS_RESULT.llm_description,
      summary: "No changes",
    }),
}));

// LLM Embeddings
mock.module("../llm/embeddings.ts", () => ({
  generateKeywordEmbeddings: () => Promise.resolve(null),
  checkBgeHealth: () => Promise.resolve(true),
}));

// Similar messages
mock.module("./similar.ts", () => ({
  findSimilarWithFallback: () => MOCK_SIMILAR_MESSAGES,
  toRatingExamples: (msgs: typeof MOCK_SIMILAR_MESSAGES) =>
    msgs.map((m) => ({
      id: m.id,
      text: m.text,
      groupId: m.groupId,
      groupTitle: m.groupTitle,
      isGenerated: false,
    })),
}));

// Examples
mock.module("./examples.ts", () => ({
  getExamplesForSubscription: () =>
    MOCK_SIMILAR_MESSAGES.map((m) => ({
      id: m.id,
      text: m.text,
      groupId: m.groupId,
      groupTitle: m.groupTitle,
      isFromCache: true,
    })),
}));

// Message cache
mock.module("../cache/messages.ts", () => ({
  getMessages: () => MOCK_CACHED_MESSAGES,
}));

// Listener (userbot)
mock.module("../listener/index.ts", () => ({
  invalidateSubscriptionsCache: () => {},
  isUserbotMember: () => true,
  ensureUserbotInGroup: () => Promise.resolve(true),
  scanFromCache: () => Promise.resolve([]),
}));

// Database - mock queries object
const mockCreateSubscription = mock(() => 1);
const mockSetSubscriptionGroups = mock(() => {});

// FSM state storage (in-memory for tests)
const fsmStateStore = new Map<number, string>();

mock.module("../db/index.ts", () => ({
  queries: {
    getOrCreateUser: () => ({ id: 1, telegram_id: TEST_USER_ID }),
    getUserMode: () => "normal" as const,
    getUserGroups: () => MOCK_GROUPS,
    createSubscription: mockCreateSubscription,
    setSubscriptionGroups: mockSetSubscriptionGroups,
    getSubscriptionById: () => null,
    getSubscriptionByIdOnly: () => null,
    updateKeywordEmbeddings: () => {},
    // FSM persistence
    getUserStateSnapshot: (telegramId: number) => fsmStateStore.get(telegramId) || null,
    saveUserStateSnapshot: (telegramId: number, snapshot: string) => {
      fsmStateStore.set(telegramId, snapshot);
    },
    deleteUserState: (telegramId: number) => {
      fsmStateStore.delete(telegramId);
    },
  },
}));

// ═══════════════════════════════════════════════════════════════════════════════
// IMPORTS - after mocks
// ═══════════════════════════════════════════════════════════════════════════════

import { clearActor, send, getCurrentState, getFsmContext } from "../fsm/adapter.ts";

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK CONTEXT
// ═══════════════════════════════════════════════════════════════════════════════

interface SentMessage {
  text: string;
  options?: {
    reply_markup?: unknown;
  };
}

class MockContext {
  public sentMessages: SentMessage[] = [];
  public editedMessages: SentMessage[] = [];
  public answers: Array<{ text?: string }> = [];

  constructor(
    public from: { id: number } | undefined,
    public text: string | undefined,
    public data: string | undefined = undefined
  ) {}

  send = async (text: string, options?: { reply_markup?: unknown }) => {
    this.sentMessages.push({ text: String(text), options });
  };

  editText = async (text: string, options?: { reply_markup?: unknown }) => {
    this.editedMessages.push({ text: String(text), options });
  };

  answer = async (opts?: { text?: string }) => {
    this.answers.push(opts || {});
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

// We need to dynamically import the bot module to get access to handlers
// Since handlers are inline, we'll test via FSM state changes and mock verification

function getAllSentTexts(ctx: MockContext): string[] {
  return [...ctx.sentMessages.map((m) => m.text), ...ctx.editedMessages.map((m) => m.text)];
}

function containsText(texts: string[], substring: string): boolean {
  return texts.some((t) => t.includes(substring));
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("Bot Integration: Robot Vacuum Subscription Flow", () => {
  beforeEach(() => {
    // Clear in-memory FSM state storage
    fsmStateStore.clear();
    // Clear FSM actor cache
    clearActor(TEST_USER_ID);
    // Reset mocks
    mockCreateSubscription.mockClear();
    mockSetSubscriptionGroups.mockClear();
  });

  afterEach(() => {
    clearActor(TEST_USER_ID);
  });

  describe("FSM State Transitions", () => {
    test("initial state is idle", () => {
      const state = getCurrentState(TEST_USER_ID);
      expect(state).toBe("idle");
    });

    test("START_CLARIFICATION transitions to clarifyingQuery", () => {
      send(TEST_USER_ID, {
        type: "START_CLARIFICATION",
        data: {
          originalQuery: "Робот пылесос",
          questions: MOCK_QUESTIONS,
          answers: [],
          currentIndex: 0,
        },
      });

      expect(getCurrentState(TEST_USER_ID)).toBe("clarifyingQuery");

      const context = getFsmContext(TEST_USER_ID);
      expect(context.clarification?.questions).toEqual(MOCK_QUESTIONS);
      expect(context.clarification?.currentIndex).toBe(0);
    });

    test("ANSWER advances question index", () => {
      // Start clarification
      send(TEST_USER_ID, {
        type: "START_CLARIFICATION",
        data: {
          originalQuery: "Робот пылесос",
          questions: MOCK_QUESTIONS,
          answers: [],
          currentIndex: 0,
        },
      });

      // Answer first question
      send(TEST_USER_ID, { type: "ANSWER", text: "Около 10—15 тыс динар" });

      const context = getFsmContext(TEST_USER_ID);
      expect(context.clarification?.currentIndex).toBe(1);
      expect(context.clarification?.answers).toContain("Около 10—15 тыс динар");
    });

    test("last ANSWER transitions to ratingExamples", () => {
      // Start clarification
      send(TEST_USER_ID, {
        type: "START_CLARIFICATION",
        data: {
          originalQuery: "Робот пылесос",
          questions: MOCK_QUESTIONS,
          answers: [],
          currentIndex: 0,
        },
      });

      // Answer all 3 questions
      send(TEST_USER_ID, { type: "ANSWER", text: "Около 10—15 тыс динар" });
      send(TEST_USER_ID, { type: "ANSWER", text: "С мойкой, Xiaomi" });
      send(TEST_USER_ID, { type: "ANSWER", text: "Б/у" });

      // After all answers, should be in ratingExamples
      expect(getCurrentState(TEST_USER_ID)).toBe("ratingExamples");
    });

    test("START_RATING sets up rating examples", () => {
      const examples = {
        messages: MOCK_SIMILAR_MESSAGES.map((m) => ({
          id: m.id,
          text: m.text,
          groupId: m.groupId,
          groupTitle: m.groupTitle,
          isGenerated: false,
        })),
        ratings: [],
        currentIndex: 0,
      };

      send(TEST_USER_ID, {
        type: "START_RATING",
        examples,
        pendingSub: {
          originalQuery: "Робот пылесос",
          positiveKeywords: [],
          negativeKeywords: [],
          llmDescription: "",
        },
      });

      expect(getCurrentState(TEST_USER_ID)).toBe("ratingExamples");

      const context = getFsmContext(TEST_USER_ID);
      expect(context.ratingExamples?.messages.length).toBe(3);
      expect(context.pendingSub?.originalQuery).toBe("Робот пылесос");
    });

    test("RATE advances through examples", () => {
      // Setup rating state
      const examples = {
        messages: MOCK_SIMILAR_MESSAGES.map((m) => ({
          id: m.id,
          text: m.text,
          groupId: m.groupId,
          groupTitle: m.groupTitle,
          isGenerated: false,
        })),
        ratings: [],
        currentIndex: 0,
      };

      send(TEST_USER_ID, {
        type: "START_RATING",
        examples,
        pendingSub: {
          originalQuery: "Робот пылесос",
          positiveKeywords: [],
          negativeKeywords: [],
          llmDescription: "",
        },
      });

      // Rate first example
      send(TEST_USER_ID, { type: "RATE", messageId: 1, rating: "hot" });

      const context = getFsmContext(TEST_USER_ID);
      expect(context.ratingExamples?.currentIndex).toBe(1);
      expect(context.ratingExamples?.ratings.length).toBe(1);
      expect(context.ratingExamples?.ratings[0]?.rating).toBe("hot");
    });

    test("last RATE transitions to awaitingConfirmation", () => {
      // Setup with just 1 example for simplicity
      const examples = {
        messages: [
          {
            id: 1,
            text: "Робот пылесос Xiaomi",
            groupId: 123,
            groupTitle: "Test",
            isGenerated: false,
          },
        ],
        ratings: [],
        currentIndex: 0,
      };

      send(TEST_USER_ID, {
        type: "START_RATING",
        examples,
        pendingSub: {
          originalQuery: "Робот пылесос",
          positiveKeywords: [],
          negativeKeywords: [],
          llmDescription: "",
        },
      });

      // Rate the only example
      send(TEST_USER_ID, { type: "RATE", messageId: 1, rating: "hot" });

      // Should transition to awaitingConfirmation
      expect(getCurrentState(TEST_USER_ID)).toBe("awaitingConfirmation");
    });

    test("KEYWORDS_GENERATED in awaitingConfirmation updates pendingSub", () => {
      // First get to awaitingConfirmation state
      const examples = {
        messages: [
          {
            id: 1,
            text: "Test",
            groupId: 123,
            groupTitle: "Test",
            isGenerated: false,
          },
        ],
        ratings: [],
        currentIndex: 0,
      };

      send(TEST_USER_ID, {
        type: "START_RATING",
        examples,
        pendingSub: {
          originalQuery: "Робот пылесос",
          positiveKeywords: [],
          negativeKeywords: [],
          llmDescription: "",
        },
      });

      send(TEST_USER_ID, { type: "RATE", messageId: 1, rating: "hot" });
      expect(getCurrentState(TEST_USER_ID)).toBe("awaitingConfirmation");

      // Now send KEYWORDS_GENERATED with full data
      send(TEST_USER_ID, {
        type: "KEYWORDS_GENERATED",
        pendingSub: {
          originalQuery: "Робот пылесос",
          positiveKeywords: MOCK_KEYWORDS_RESULT.positive_keywords,
          negativeKeywords: MOCK_KEYWORDS_RESULT.negative_keywords,
          llmDescription: MOCK_KEYWORDS_RESULT.llm_description,
        },
      });

      const context = getFsmContext(TEST_USER_ID);
      expect(context.pendingSub?.llmDescription).toBe(MOCK_KEYWORDS_RESULT.llm_description);
      expect(context.pendingSub?.positiveKeywords).toEqual(MOCK_KEYWORDS_RESULT.positive_keywords);
    });

    test("START_AI_CORRECTION transitions to correctingPendingAi", () => {
      // Setup awaitingConfirmation state with pendingSub
      send(TEST_USER_ID, {
        type: "KEYWORDS_GENERATED",
        pendingSub: {
          originalQuery: "Робот пылесос",
          positiveKeywords: MOCK_KEYWORDS_RESULT.positive_keywords,
          negativeKeywords: MOCK_KEYWORDS_RESULT.negative_keywords,
          llmDescription: MOCK_KEYWORDS_RESULT.llm_description,
        },
      });

      // Note: KEYWORDS_GENERATED from idle goes to awaitingConfirmation
      expect(getCurrentState(TEST_USER_ID)).toBe("awaitingConfirmation");

      // Start AI correction
      send(TEST_USER_ID, {
        type: "START_AI_CORRECTION",
        data: {
          mode: "normal" as const,
          current: {
            positiveKeywords: MOCK_KEYWORDS_RESULT.positive_keywords,
            negativeKeywords: MOCK_KEYWORDS_RESULT.negative_keywords,
            llmDescription: MOCK_KEYWORDS_RESULT.llm_description,
          },
          conversation: [],
        },
      });

      expect(getCurrentState(TEST_USER_ID)).toBe("correctingPendingAi");
    });
  });

  describe("Full Flow Simulation", () => {
    test("complete flow: query → clarification → rating → confirmation", () => {
      // 1. Start clarification (simulates user sending "Робот пылесос")
      send(TEST_USER_ID, {
        type: "START_CLARIFICATION",
        data: {
          originalQuery: "Робот пылесос",
          questions: MOCK_QUESTIONS,
          answers: [],
          currentIndex: 0,
        },
      });
      expect(getCurrentState(TEST_USER_ID)).toBe("clarifyingQuery");

      // 2. Answer first question: "Около 10—15 тыс динар"
      send(TEST_USER_ID, { type: "ANSWER", text: "Около 10—15 тыс динар" });
      expect(getCurrentState(TEST_USER_ID)).toBe("clarifyingQuery");
      expect(getFsmContext(TEST_USER_ID).clarification?.currentIndex).toBe(1);

      // 3. Answer second question: "С мойкой, Xiaomi"
      send(TEST_USER_ID, { type: "ANSWER", text: "С мойкой, Xiaomi" });
      expect(getCurrentState(TEST_USER_ID)).toBe("clarifyingQuery");
      expect(getFsmContext(TEST_USER_ID).clarification?.currentIndex).toBe(2);

      // 4. Answer third question: "Б/у"
      send(TEST_USER_ID, { type: "ANSWER", text: "Б/у" });
      // After last answer, transitions to ratingExamples
      expect(getCurrentState(TEST_USER_ID)).toBe("ratingExamples");

      // 5. Start rating with examples (bot would do this automatically)
      send(TEST_USER_ID, {
        type: "START_RATING",
        examples: {
          messages: MOCK_SIMILAR_MESSAGES.map((m) => ({
            id: m.id,
            text: m.text,
            groupId: m.groupId,
            groupTitle: m.groupTitle,
            isGenerated: false,
          })),
          ratings: [],
          currentIndex: 0,
        },
      });

      // 6. Rate examples
      send(TEST_USER_ID, { type: "RATE", messageId: 1, rating: "cold" }); // Not what we want
      send(TEST_USER_ID, { type: "RATE", messageId: 2, rating: "hot" }); // Perfect match
      send(TEST_USER_ID, { type: "RATE", messageId: 3, rating: "warm" }); // Close but has issues

      // After rating all, transitions to awaitingConfirmation
      expect(getCurrentState(TEST_USER_ID)).toBe("awaitingConfirmation");

      // Check ratings were recorded (ratingExamples still exists until KEYWORDS_GENERATED clears it)
      const context = getFsmContext(TEST_USER_ID);
      expect(context.ratingExamples?.ratings.length).toBe(3);
      expect(context.ratingExamples?.ratings[0]?.rating).toBe("cold");
      expect(context.ratingExamples?.ratings[1]?.rating).toBe("hot");
      expect(context.ratingExamples?.ratings[2]?.rating).toBe("warm");

      // 7. Keywords generated (bot would call LLM)
      send(TEST_USER_ID, {
        type: "KEYWORDS_GENERATED",
        pendingSub: {
          originalQuery: "Робот пылесос",
          positiveKeywords: MOCK_KEYWORDS_RESULT.positive_keywords,
          negativeKeywords: MOCK_KEYWORDS_RESULT.negative_keywords,
          llmDescription: MOCK_KEYWORDS_RESULT.llm_description,
        },
      });

      // Verify final state
      const finalContext = getFsmContext(TEST_USER_ID);
      expect(finalContext.pendingSub?.originalQuery).toBe("Робот пылесос");
      expect(finalContext.pendingSub?.llmDescription).toBe(MOCK_KEYWORDS_RESULT.llm_description);
      expect(finalContext.pendingSub?.positiveKeywords).toContain("робот");
      expect(finalContext.pendingSub?.positiveKeywords).toContain("xiaomi");
    });

    test("clarification answers are preserved", () => {
      send(TEST_USER_ID, {
        type: "START_CLARIFICATION",
        data: {
          originalQuery: "Робот пылесос",
          questions: MOCK_QUESTIONS,
          answers: [],
          currentIndex: 0,
        },
      });

      send(TEST_USER_ID, { type: "ANSWER", text: "Около 10—15 тыс динар" });
      send(TEST_USER_ID, { type: "ANSWER", text: "С мойкой, Xiaomi" });
      send(TEST_USER_ID, { type: "ANSWER", text: "Б/у" });

      // After transition to ratingExamples, clarification should still exist
      // (it's cleared only after KEYWORDS_GENERATED)
      const context = getFsmContext(TEST_USER_ID);
      expect(context.clarification?.answers).toEqual([
        "Около 10—15 тыс динар",
        "С мойкой, Xiaomi",
        "Б/у",
      ]);
    });
  });
});
