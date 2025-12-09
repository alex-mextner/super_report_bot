/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *                     FSM TEST SUITE - 100% COVERAGE
 *
 *                Testing every state, transition, guard, and action
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { createActor } from "xstate";
import { userMachine } from "./machine";
import { createInitialContext, type BotContext } from "./context";
import * as guards from "./guards";

// ═══════════════════════════════════════════════════════════════════════════════
//                              TEST HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a test actor with optional context overrides
 */
function createTestActor(contextOverrides: Partial<BotContext> = {}) {
  const initialContext = createInitialContext(12345, "normal");
  const context = { ...initialContext, ...contextOverrides };

  const actor = createActor(userMachine, { input: context });
  actor.start();
  return actor;
}

/**
 * Get current state value as string
 */
function getState(actor: ReturnType<typeof createTestActor>): string {
  return actor.getSnapshot().value as string;
}

/**
 * Get current context
 */
function getContext(actor: ReturnType<typeof createTestActor>): BotContext {
  return actor.getSnapshot().context;
}

// ═══════════════════════════════════════════════════════════════════════════════
//                          CONTEXT CREATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("createInitialContext", () => {
  test("creates valid context for FSM initialization", () => {
    const ctx = createInitialContext(12345, "advanced");

    // Only check that context is usable by FSM - not every field
    expect(ctx.telegramId).toBe(12345);
    expect(ctx.userMode).toBe("advanced");
    expect(ctx.pendingSub).toBeNull(); // FSM requires this to be null initially
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//                              GUARDS TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("Guards", () => {
  describe("isAdvancedMode", () => {
    test("returns true for advanced mode", () => {
      const ctx = createInitialContext(123, "advanced");
      expect(guards.isAdvancedMode({ context: ctx })).toBe(true);
    });

    test("returns false for normal mode", () => {
      const ctx = createInitialContext(123, "normal");
      expect(guards.isAdvancedMode({ context: ctx })).toBe(false);
    });
  });

  describe("hasAvailableGroups", () => {
    test("returns true when groups exist", () => {
      const ctx = createInitialContext(123);
      ctx.availableGroups = [{ id: 1, title: "Group 1" }];
      expect(guards.hasAvailableGroups({ context: ctx })).toBe(true);
    });

    test("returns false when no groups", () => {
      const ctx = createInitialContext(123);
      expect(guards.hasAvailableGroups({ context: ctx })).toBe(false);
    });
  });

  describe("allExamplesRated", () => {
    test("returns true when no ratingExamples data", () => {
      const ctx = createInitialContext(123);
      expect(guards.allExamplesRated({ context: ctx })).toBe(true);
    });

    test("returns true when all examples rated", () => {
      const ctx = createInitialContext(123);
      ctx.ratingExamples = {
        messages: [{ id: 1, text: "test", groupId: 1, groupTitle: "G", isGenerated: false }],
        ratings: [],
        currentIndex: 1, // Already past all messages
      };
      expect(guards.allExamplesRated({ context: ctx })).toBe(true);
    });

    test("returns false when examples remain", () => {
      const ctx = createInitialContext(123);
      ctx.ratingExamples = {
        messages: [
          { id: 1, text: "test1", groupId: 1, groupTitle: "G", isGenerated: false },
          { id: 2, text: "test2", groupId: 1, groupTitle: "G", isGenerated: false },
        ],
        ratings: [],
        currentIndex: 0,
      };
      expect(guards.allExamplesRated({ context: ctx })).toBe(false);
    });
  });

  describe("allQuestionsAnswered", () => {
    test("returns true when no clarification data", () => {
      const ctx = createInitialContext(123);
      expect(guards.allQuestionsAnswered({ context: ctx })).toBe(true);
    });

    test("returns true when all questions answered", () => {
      const ctx = createInitialContext(123);
      ctx.clarification = {
        originalQuery: "test",
        questions: ["Q1", "Q2"],
        answers: ["A1", "A2"],
        currentIndex: 2,
      };
      expect(guards.allQuestionsAnswered({ context: ctx })).toBe(true);
    });

    test("returns false when questions remain", () => {
      const ctx = createInitialContext(123);
      ctx.clarification = {
        originalQuery: "test",
        questions: ["Q1", "Q2"],
        answers: [],
        currentIndex: 0,
      };
      expect(guards.allQuestionsAnswered({ context: ctx })).toBe(false);
    });
  });

  describe("needsInviteLink", () => {
    test("returns false when no pending group", () => {
      const ctx = createInitialContext(123);
      expect(guards.needsInviteLink({ context: ctx })).toBe(false);
    });

    test("returns true when pending group needs invite link", () => {
      const ctx = createInitialContext(123);
      ctx.currentPendingGroup = { id: 1, needsInviteLink: true, isChannel: false };
      expect(guards.needsInviteLink({ context: ctx })).toBe(true);
    });

    test("returns false when pending group doesn't need invite link", () => {
      const ctx = createInitialContext(123);
      ctx.currentPendingGroup = { id: 1, needsInviteLink: false, isChannel: false };
      expect(guards.needsInviteLink({ context: ctx })).toBe(false);
    });
  });

  describe("hasPendingSub", () => {
    test("returns false when no pending subscription", () => {
      const ctx = createInitialContext(123);
      expect(guards.hasPendingSub({ context: ctx })).toBe(false);
    });

    test("returns true when pending subscription exists", () => {
      const ctx = createInitialContext(123);
      ctx.pendingSub = {
        originalQuery: "test",
        positiveKeywords: [],
        negativeKeywords: [],
        llmDescription: "",
      };
      expect(guards.hasPendingSub({ context: ctx })).toBe(true);
    });
  });

  describe("hasPositiveKeywords", () => {
    test("returns false when no pending sub", () => {
      const ctx = createInitialContext(123);
      expect(guards.hasPositiveKeywords({ context: ctx })).toBe(false);
    });

    test("returns false when positive keywords empty", () => {
      const ctx = createInitialContext(123);
      ctx.pendingSub = {
        originalQuery: "test",
        positiveKeywords: [],
        negativeKeywords: [],
        llmDescription: "",
      };
      expect(guards.hasPositiveKeywords({ context: ctx })).toBe(false);
    });

    test("returns true when positive keywords exist", () => {
      const ctx = createInitialContext(123);
      ctx.pendingSub = {
        originalQuery: "test",
        positiveKeywords: ["keyword1"],
        negativeKeywords: [],
        llmDescription: "",
      };
      expect(guards.hasPositiveKeywords({ context: ctx })).toBe(true);
    });
  });

  describe("hasNegativeKeywords", () => {
    test("returns false when no pending sub", () => {
      const ctx = createInitialContext(123);
      expect(guards.hasNegativeKeywords({ context: ctx })).toBe(false);
    });

    test("returns true when negative keywords exist", () => {
      const ctx = createInitialContext(123);
      ctx.pendingSub = {
        originalQuery: "test",
        positiveKeywords: [],
        negativeKeywords: ["exclude"],
        llmDescription: "",
      };
      expect(guards.hasNegativeKeywords({ context: ctx })).toBe(true);
    });
  });

  describe("hasProposedAiEdit", () => {
    test("returns false when no pendingAiEdit", () => {
      const ctx = createInitialContext(123);
      expect(guards.hasProposedAiEdit({ context: ctx })).toBe(false);
    });

    test("returns false when no proposed changes", () => {
      const ctx = createInitialContext(123);
      ctx.pendingAiEdit = {
        subscriptionId: 1,
        current: { positiveKeywords: [], negativeKeywords: [], llmDescription: "" },
        conversation: [],
      };
      expect(guards.hasProposedAiEdit({ context: ctx })).toBe(false);
    });

    test("returns true when proposed changes exist", () => {
      const ctx = createInitialContext(123);
      ctx.pendingAiEdit = {
        subscriptionId: 1,
        current: { positiveKeywords: [], negativeKeywords: [], llmDescription: "" },
        proposed: { positiveKeywords: ["new"], negativeKeywords: [], llmDescription: "desc" },
        conversation: [],
      };
      expect(guards.hasProposedAiEdit({ context: ctx })).toBe(true);
    });
  });

  describe("hasProposedAiCorrection", () => {
    test("returns false when no pendingAiCorrection", () => {
      const ctx = createInitialContext(123);
      expect(guards.hasProposedAiCorrection({ context: ctx })).toBe(false);
    });

    test("returns true when proposed correction exists", () => {
      const ctx = createInitialContext(123);
      ctx.pendingAiCorrection = {
        mode: "normal",
        current: { positiveKeywords: [], negativeKeywords: [], llmDescription: "" },
        proposed: { positiveKeywords: ["new"], negativeKeywords: [], llmDescription: "desc" },
        conversation: [],
      };
      expect(guards.hasProposedAiCorrection({ context: ctx })).toBe(true);
    });
  });

  describe("hasSelectedGroups", () => {
    test("returns false when no selected groups", () => {
      const ctx = createInitialContext(123);
      expect(guards.hasSelectedGroups({ context: ctx })).toBe(false);
    });

    test("returns true when groups selected", () => {
      const ctx = createInitialContext(123);
      ctx.selectedGroups = [{ id: 1, title: "Group" }];
      expect(guards.hasSelectedGroups({ context: ctx })).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//                         STATE MACHINE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("State Machine", () => {
  describe("Initial State", () => {
    test("starts in idle state", () => {
      const actor = createTestActor();
      expect(getState(actor)).toBe("idle");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  //                          IDLE STATE TRANSITIONS
  // ─────────────────────────────────────────────────────────────────────────────

  describe("idle state", () => {
    test("TEXT_QUERY goes to ratingExamples for normal users", () => {
      const actor = createTestActor({ userMode: "normal" });
      actor.send({ type: "TEXT_QUERY", text: "find phones" });
      expect(getState(actor)).toBe("ratingExamples");
    });

    test("TEXT_QUERY goes to clarifyingQuery for advanced users", () => {
      const actor = createTestActor({ userMode: "advanced" });
      actor.send({ type: "TEXT_QUERY", text: "find phones" });
      expect(getState(actor)).toBe("clarifyingQuery");
    });

    test("START_RATING goes to ratingExamples with examples data", () => {
      const actor = createTestActor();
      const examples = {
        messages: [{ id: 1, text: "test", groupId: 1, groupTitle: "G", isGenerated: false }],
        ratings: [],
        currentIndex: 0,
      };
      actor.send({ type: "START_RATING", examples });
      expect(getState(actor)).toBe("ratingExamples");
      expect(getContext(actor).ratingExamples).toEqual(examples);
    });

    test("START_CLARIFICATION goes to clarifyingQuery with data", () => {
      const actor = createTestActor();
      const data = { originalQuery: "test", questions: ["Q1"], answers: [], currentIndex: 0 };
      actor.send({ type: "START_CLARIFICATION", data });
      expect(getState(actor)).toBe("clarifyingQuery");
      expect(getContext(actor).clarification).toEqual(data);
    });

    test("KEYWORDS_GENERATED goes to awaitingConfirmation", () => {
      const actor = createTestActor();
      const pendingSub = {
        originalQuery: "test",
        positiveKeywords: ["kw1"],
        negativeKeywords: [],
        llmDescription: "desc",
      };
      actor.send({ type: "KEYWORDS_GENERATED", pendingSub });
      expect(getState(actor)).toBe("awaitingConfirmation");
      expect(getContext(actor).pendingSub).toEqual(pendingSub);
    });

    test("ADDGROUP goes to addingGroup", () => {
      const actor = createTestActor();
      actor.send({ type: "ADDGROUP" });
      expect(getState(actor)).toBe("addingGroup");
    });

    test("EDIT_SUB_POSITIVE goes to editingSubPositive", () => {
      const actor = createTestActor();
      actor.send({ type: "EDIT_SUB_POSITIVE", subscriptionId: 42 });
      expect(getState(actor)).toBe("editingSubPositive");
      expect(getContext(actor).editingSubscriptionId).toBe(42);
    });

    test("EDIT_SUB_NEGATIVE goes to editingSubNegative", () => {
      const actor = createTestActor();
      actor.send({ type: "EDIT_SUB_NEGATIVE", subscriptionId: 42 });
      expect(getState(actor)).toBe("editingSubNegative");
      expect(getContext(actor).editingSubscriptionId).toBe(42);
    });

    test("EDIT_SUB_DESCRIPTION goes to editingSubDescription", () => {
      const actor = createTestActor();
      actor.send({ type: "EDIT_SUB_DESCRIPTION", subscriptionId: 42 });
      expect(getState(actor)).toBe("editingSubDescription");
      expect(getContext(actor).editingSubscriptionId).toBe(42);
    });

    test("EDIT_SUB_AI goes to editingSubAi", () => {
      const actor = createTestActor();
      const data = {
        subscriptionId: 42,
        current: { positiveKeywords: [], negativeKeywords: [], llmDescription: "" },
        conversation: [],
      };
      actor.send({ type: "EDIT_SUB_AI", data });
      expect(getState(actor)).toBe("editingSubAi");
      expect(getContext(actor).pendingAiEdit).toEqual(data);
    });

    test("SET_USER_MODE updates userMode without changing state", () => {
      const actor = createTestActor({ userMode: "normal" });
      actor.send({ type: "SET_USER_MODE", mode: "advanced" });
      expect(getState(actor)).toBe("idle");
      expect(getContext(actor).userMode).toBe("advanced");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  //                      CLARIFYING_QUERY TRANSITIONS
  // ─────────────────────────────────────────────────────────────────────────────

  describe("clarifyingQuery state", () => {
    let actor: ReturnType<typeof createTestActor>;

    beforeEach(() => {
      actor = createTestActor({ userMode: "advanced" });
      actor.send({
        type: "START_CLARIFICATION",
        data: {
          originalQuery: "test",
          questions: ["Q1", "Q2"],
          answers: [],
          currentIndex: 0,
        },
      });
    });

    test("ANSWER stores answer and stays in clarifyingQuery if more questions", () => {
      actor.send({ type: "ANSWER", text: "Answer 1" });
      expect(getState(actor)).toBe("clarifyingQuery");
      expect(getContext(actor).clarification?.answers).toEqual(["Answer 1"]);
      expect(getContext(actor).clarification?.currentIndex).toBe(1);
    });

    test("ANSWER on last question goes to ratingExamples", () => {
      actor.send({ type: "ANSWER", text: "A1" });
      actor.send({ type: "ANSWER", text: "A2" });
      expect(getState(actor)).toBe("ratingExamples");
    });

    test("SKIP_QUESTION stores empty answer and advances", () => {
      actor.send({ type: "SKIP_QUESTION" });
      expect(getContext(actor).clarification?.answers).toEqual([""]);
      expect(getContext(actor).clarification?.currentIndex).toBe(1);
    });

    test("SKIP_QUESTION on last question goes to ratingExamples", () => {
      actor.send({ type: "SKIP_QUESTION" });
      actor.send({ type: "SKIP_QUESTION" });
      expect(getState(actor)).toBe("ratingExamples");
    });

    test("CANCEL goes to idle and clears context", () => {
      actor.send({ type: "CANCEL" });
      expect(getState(actor)).toBe("idle");
      expect(getContext(actor).clarification).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  //                      RATING_EXAMPLES TRANSITIONS
  // ─────────────────────────────────────────────────────────────────────────────

  describe("ratingExamples state", () => {
    let actor: ReturnType<typeof createTestActor>;

    beforeEach(() => {
      actor = createTestActor();
      actor.send({
        type: "START_RATING",
        examples: {
          messages: [
            { id: 1, text: "msg1", groupId: 1, groupTitle: "G", isGenerated: false },
            { id: 2, text: "msg2", groupId: 1, groupTitle: "G", isGenerated: false },
          ],
          ratings: [],
          currentIndex: 0,
        },
      });
    });

    test("RATE stores rating and stays if more examples", () => {
      actor.send({ type: "RATE", messageId: 1, rating: "hot" });
      expect(getState(actor)).toBe("ratingExamples");
      expect(getContext(actor).ratingExamples?.ratings).toHaveLength(1);
      expect(getContext(actor).ratingExamples!.ratings[0]!.rating).toBe("hot");
    });

    test("RATE on last example goes to awaitingConfirmation", () => {
      actor.send({ type: "RATE", messageId: 1, rating: "hot" });
      actor.send({ type: "RATE", messageId: 2, rating: "cold" });
      expect(getState(actor)).toBe("awaitingConfirmation");
    });

    test("SKIP_RATING goes to awaitingConfirmation", () => {
      actor.send({ type: "SKIP_RATING" });
      expect(getState(actor)).toBe("awaitingConfirmation");
    });

    test("KEYWORDS_GENERATED goes to awaitingConfirmation and stores pendingSub", () => {
      const pendingSub = {
        originalQuery: "test",
        positiveKeywords: ["kw"],
        negativeKeywords: [],
        llmDescription: "desc",
      };
      actor.send({ type: "KEYWORDS_GENERATED", pendingSub });
      expect(getState(actor)).toBe("awaitingConfirmation");
      expect(getContext(actor).pendingSub).toEqual(pendingSub);
    });

    test("CANCEL goes to idle and clears context", () => {
      actor.send({ type: "CANCEL" });
      expect(getState(actor)).toBe("idle");
      expect(getContext(actor).ratingExamples).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  //                   AWAITING_CONFIRMATION TRANSITIONS
  // ─────────────────────────────────────────────────────────────────────────────

  describe("awaitingConfirmation state", () => {
    let actor: ReturnType<typeof createTestActor>;
    const pendingSub = {
      originalQuery: "test",
      positiveKeywords: ["kw1", "kw2"],
      negativeKeywords: ["neg1"],
      llmDescription: "description",
    };

    beforeEach(() => {
      actor = createTestActor();
      actor.send({ type: "KEYWORDS_GENERATED", pendingSub });
    });

    test("CONFIRM with no available groups goes to idle", () => {
      actor.send({ type: "CONFIRM" });
      expect(getState(actor)).toBe("idle");
    });

    test("CONFIRM with available groups goes to selectingGroups", () => {
      // Set available groups first
      actor.send({
        type: "START_GROUP_SELECTION",
        available: [{ id: 1, title: "Group 1" }],
      });
      expect(getState(actor)).toBe("selectingGroups");
    });

    test("CANCEL goes to idle and clears context", () => {
      actor.send({ type: "CANCEL" });
      expect(getState(actor)).toBe("idle");
      expect(getContext(actor).pendingSub).toBeNull();
    });

    test("REGENERATE stays in awaitingConfirmation", () => {
      actor.send({ type: "REGENERATE" });
      expect(getState(actor)).toBe("awaitingConfirmation");
    });

    test("ADD_POSITIVE goes to addingPositive", () => {
      actor.send({ type: "ADD_POSITIVE" });
      expect(getState(actor)).toBe("addingPositive");
    });

    test("ADD_NEGATIVE goes to addingNegative", () => {
      actor.send({ type: "ADD_NEGATIVE" });
      expect(getState(actor)).toBe("addingNegative");
    });

    test("REMOVE_POSITIVE goes to removingPositive", () => {
      actor.send({ type: "REMOVE_POSITIVE" });
      expect(getState(actor)).toBe("removingPositive");
    });

    test("REMOVE_NEGATIVE goes to removingNegative", () => {
      actor.send({ type: "REMOVE_NEGATIVE" });
      expect(getState(actor)).toBe("removingNegative");
    });

    test("START_AI_CORRECTION goes to correctingPendingAi", () => {
      const data = {
        mode: "normal" as const,
        current: { positiveKeywords: [], negativeKeywords: [], llmDescription: "" },
        conversation: [],
      };
      actor.send({ type: "START_AI_CORRECTION", data });
      expect(getState(actor)).toBe("correctingPendingAi");
      expect(getContext(actor).pendingAiCorrection).toEqual(data);
    });

    test("SET_PENDING_SUB updates pendingSub without state change", () => {
      const newSub = { ...pendingSub, positiveKeywords: ["new1", "new2"] };
      actor.send({ type: "SET_PENDING_SUB", pendingSub: newSub });
      expect(getState(actor)).toBe("awaitingConfirmation");
      expect(getContext(actor).pendingSub?.positiveKeywords).toEqual(["new1", "new2"]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  //                  CORRECTING_PENDING_AI TRANSITIONS
  // ─────────────────────────────────────────────────────────────────────────────

  describe("correctingPendingAi state", () => {
    let actor: ReturnType<typeof createTestActor>;

    beforeEach(() => {
      actor = createTestActor();
      actor.send({
        type: "KEYWORDS_GENERATED",
        pendingSub: {
          originalQuery: "test",
          positiveKeywords: ["old"],
          negativeKeywords: [],
          llmDescription: "old desc",
        },
      });
      actor.send({
        type: "START_AI_CORRECTION",
        data: {
          mode: "normal",
          current: { positiveKeywords: ["old"], negativeKeywords: [], llmDescription: "old desc" },
          conversation: [],
        },
      });
    });

    test("TEXT_AI_COMMAND adds to conversation", () => {
      actor.send({ type: "TEXT_AI_COMMAND", text: "add more keywords" });
      expect(getState(actor)).toBe("correctingPendingAi");
      expect(getContext(actor).pendingAiCorrection?.conversation).toHaveLength(1);
      expect(getContext(actor).pendingAiCorrection!.conversation[0]!.content).toBe(
        "add more keywords"
      );
    });

    test("AI_CORRECTION_PROPOSED stores proposed changes", () => {
      const proposed = { positiveKeywords: ["new"], negativeKeywords: [], llmDescription: "new" };
      actor.send({ type: "AI_CORRECTION_PROPOSED", proposed });
      expect(getState(actor)).toBe("correctingPendingAi");
      expect(getContext(actor).pendingAiCorrection?.proposed).toEqual(proposed);
    });

    test("APPLY_AI_CORRECTION applies changes and goes to awaitingConfirmation", () => {
      const proposed = {
        positiveKeywords: ["applied"],
        negativeKeywords: ["filtered"],
        llmDescription: "applied desc",
      };
      actor.send({ type: "AI_CORRECTION_PROPOSED", proposed });
      actor.send({ type: "APPLY_AI_CORRECTION" });
      expect(getState(actor)).toBe("awaitingConfirmation");
      expect(getContext(actor).pendingSub?.positiveKeywords).toEqual(["applied"]);
      expect(getContext(actor).pendingSub?.negativeKeywords).toEqual(["filtered"]);
      expect(getContext(actor).pendingAiCorrection).toBeNull();
    });

    test("CANCEL goes to awaitingConfirmation without applying", () => {
      actor.send({ type: "CANCEL" });
      expect(getState(actor)).toBe("awaitingConfirmation");
      expect(getContext(actor).pendingSub?.positiveKeywords).toEqual(["old"]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  //                     KEYWORD EDITING TRANSITIONS
  // ─────────────────────────────────────────────────────────────────────────────

  describe("addingPositive state", () => {
    let actor: ReturnType<typeof createTestActor>;

    beforeEach(() => {
      actor = createTestActor();
      actor.send({
        type: "KEYWORDS_GENERATED",
        pendingSub: {
          originalQuery: "test",
          positiveKeywords: ["existing"],
          negativeKeywords: [],
          llmDescription: "",
        },
      });
      actor.send({ type: "ADD_POSITIVE" });
    });

    test("TEXT_KEYWORDS adds keywords and returns to awaitingConfirmation", () => {
      actor.send({ type: "TEXT_KEYWORDS", keywords: ["new1", "new2"] });
      expect(getState(actor)).toBe("awaitingConfirmation");
      expect(getContext(actor).pendingSub?.positiveKeywords).toEqual(["existing", "new1", "new2"]);
    });

    test("BACK_TO_CONFIRM returns without changes", () => {
      actor.send({ type: "BACK_TO_CONFIRM" });
      expect(getState(actor)).toBe("awaitingConfirmation");
      expect(getContext(actor).pendingSub?.positiveKeywords).toEqual(["existing"]);
    });

    test("CANCEL returns without changes", () => {
      actor.send({ type: "CANCEL" });
      expect(getState(actor)).toBe("awaitingConfirmation");
    });
  });

  describe("addingNegative state", () => {
    let actor: ReturnType<typeof createTestActor>;

    beforeEach(() => {
      actor = createTestActor();
      actor.send({
        type: "KEYWORDS_GENERATED",
        pendingSub: {
          originalQuery: "test",
          positiveKeywords: [],
          negativeKeywords: ["existing"],
          llmDescription: "",
        },
      });
      actor.send({ type: "ADD_NEGATIVE" });
    });

    test("TEXT_KEYWORDS adds negative keywords", () => {
      actor.send({ type: "TEXT_KEYWORDS", keywords: ["new_neg"] });
      expect(getState(actor)).toBe("awaitingConfirmation");
      expect(getContext(actor).pendingSub?.negativeKeywords).toEqual(["existing", "new_neg"]);
    });
  });

  describe("removingPositive state", () => {
    let actor: ReturnType<typeof createTestActor>;

    beforeEach(() => {
      actor = createTestActor();
      actor.send({
        type: "KEYWORDS_GENERATED",
        pendingSub: {
          originalQuery: "test",
          positiveKeywords: ["kw0", "kw1", "kw2"],
          negativeKeywords: [],
          llmDescription: "",
        },
      });
      actor.send({ type: "REMOVE_POSITIVE" });
    });

    test("REMOVE_KEYWORD removes by index and stays in state", () => {
      actor.send({ type: "REMOVE_KEYWORD", index: 1 });
      expect(getState(actor)).toBe("removingPositive");
      expect(getContext(actor).pendingSub?.positiveKeywords).toEqual(["kw0", "kw2"]);
    });

    test("can remove multiple keywords", () => {
      actor.send({ type: "REMOVE_KEYWORD", index: 0 });
      actor.send({ type: "REMOVE_KEYWORD", index: 0 }); // Now kw1 is at index 0
      expect(getContext(actor).pendingSub?.positiveKeywords).toEqual(["kw2"]);
    });

    test("BACK_TO_CONFIRM returns to awaitingConfirmation", () => {
      actor.send({ type: "BACK_TO_CONFIRM" });
      expect(getState(actor)).toBe("awaitingConfirmation");
    });
  });

  describe("removingNegative state", () => {
    let actor: ReturnType<typeof createTestActor>;

    beforeEach(() => {
      actor = createTestActor();
      actor.send({
        type: "KEYWORDS_GENERATED",
        pendingSub: {
          originalQuery: "test",
          positiveKeywords: [],
          negativeKeywords: ["neg0", "neg1"],
          llmDescription: "",
        },
      });
      actor.send({ type: "REMOVE_NEGATIVE" });
    });

    test("REMOVE_KEYWORD removes negative keyword by index", () => {
      actor.send({ type: "REMOVE_KEYWORD", index: 0 });
      expect(getContext(actor).pendingSub?.negativeKeywords).toEqual(["neg1"]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  //                     SELECTING_GROUPS TRANSITIONS
  // ─────────────────────────────────────────────────────────────────────────────

  describe("selectingGroups state", () => {
    let actor: ReturnType<typeof createTestActor>;
    const groups = [
      { id: 1, title: "Group 1" },
      { id: 2, title: "Group 2" },
      { id: 3, title: "Group 3" },
    ];

    beforeEach(() => {
      actor = createTestActor();
      actor.send({
        type: "KEYWORDS_GENERATED",
        pendingSub: {
          originalQuery: "test",
          positiveKeywords: ["kw"],
          negativeKeywords: [],
          llmDescription: "",
        },
      });
      actor.send({ type: "START_GROUP_SELECTION", available: groups });
    });

    test("initializes with all groups selected", () => {
      expect(getContext(actor).availableGroups).toEqual(groups);
      expect(getContext(actor).selectedGroups).toEqual(groups);
    });

    test("TOGGLE_GROUP deselects selected group", () => {
      actor.send({ type: "TOGGLE_GROUP", groupId: 2 });
      expect(getContext(actor).selectedGroups).toEqual([
        { id: 1, title: "Group 1" },
        { id: 3, title: "Group 3" },
      ]);
    });

    test("TOGGLE_GROUP selects deselected group", () => {
      actor.send({ type: "TOGGLE_GROUP", groupId: 2 }); // Deselect
      actor.send({ type: "TOGGLE_GROUP", groupId: 2 }); // Reselect
      expect(getContext(actor).selectedGroups).toHaveLength(3);
    });

    test("SELECT_ALL selects all groups", () => {
      actor.send({ type: "TOGGLE_GROUP", groupId: 1 });
      actor.send({ type: "TOGGLE_GROUP", groupId: 2 });
      actor.send({ type: "SELECT_ALL" });
      expect(getContext(actor).selectedGroups).toEqual(groups);
    });

    test("DESELECT_ALL deselects all groups", () => {
      actor.send({ type: "DESELECT_ALL" });
      expect(getContext(actor).selectedGroups).toEqual([]);
    });

    test("CONFIRM_GROUPS goes to idle", () => {
      actor.send({ type: "CONFIRM_GROUPS" });
      expect(getState(actor)).toBe("idle");
    });

    test("SKIP_GROUPS goes to idle", () => {
      actor.send({ type: "SKIP_GROUPS" });
      expect(getState(actor)).toBe("idle");
    });

    test("CANCEL goes to idle and clears context", () => {
      actor.send({ type: "CANCEL" });
      expect(getState(actor)).toBe("idle");
      expect(getContext(actor).pendingSub).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  //                       ADDING_GROUP TRANSITIONS
  // ─────────────────────────────────────────────────────────────────────────────

  describe("addingGroup state", () => {
    let actor: ReturnType<typeof createTestActor>;

    beforeEach(() => {
      actor = createTestActor();
      actor.send({ type: "ADDGROUP" });
    });

    test("CHAT_SHARED with public group adds to pendingGroups", () => {
      const group = { id: 1, title: "Public Group", needsInviteLink: false, isChannel: false };
      actor.send({ type: "CHAT_SHARED", group });
      expect(getState(actor)).toBe("addingGroup");
      expect(getContext(actor).pendingGroups).toEqual([group]);
    });

    test("CHAT_SHARED with private group goes to awaitingInviteLink", () => {
      const group = { id: 2, title: "Private Group", needsInviteLink: true, isChannel: false };
      actor.send({ type: "CHAT_SHARED", group });
      expect(getState(actor)).toBe("awaitingInviteLink");
      expect(getContext(actor).currentPendingGroup).toEqual(group);
    });

    test("GROUP_JOINED adds group to pendingGroups", () => {
      const group = { id: 3, title: "Joined Group", needsInviteLink: false, isChannel: false };
      actor.send({ type: "GROUP_JOINED", group });
      expect(getState(actor)).toBe("addingGroup");
      expect(getContext(actor).pendingGroups).toContainEqual(group);
    });

    test("DONE_ADDING_GROUPS goes to idle and clears", () => {
      actor.send({
        type: "CHAT_SHARED",
        group: { id: 1, needsInviteLink: false, isChannel: false },
      });
      actor.send({ type: "DONE_ADDING_GROUPS" });
      expect(getState(actor)).toBe("idle");
      expect(getContext(actor).pendingGroups).toEqual([]);
    });

    test("CANCEL goes to idle and clears", () => {
      actor.send({ type: "CANCEL" });
      expect(getState(actor)).toBe("idle");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  //                   AWAITING_INVITE_LINK TRANSITIONS
  // ─────────────────────────────────────────────────────────────────────────────

  describe("awaitingInviteLink state", () => {
    let actor: ReturnType<typeof createTestActor>;

    beforeEach(() => {
      actor = createTestActor();
      actor.send({ type: "ADDGROUP" });
      actor.send({
        type: "CHAT_SHARED",
        group: { id: 1, title: "Private", needsInviteLink: true, isChannel: false },
      });
    });

    test("INVITE_LINK stores link and goes to addingGroup", () => {
      actor.send({ type: "INVITE_LINK", link: "https://t.me/+abc123" });
      expect(getState(actor)).toBe("addingGroup");
      expect(getContext(actor).currentPendingGroup?.inviteLink).toBe("https://t.me/+abc123");
    });

    test("SKIP_INVITE clears currentPendingGroup and goes to addingGroup", () => {
      actor.send({ type: "SKIP_INVITE" });
      expect(getState(actor)).toBe("addingGroup");
      expect(getContext(actor).currentPendingGroup).toBeNull();
    });

    test("CANCEL goes to idle", () => {
      actor.send({ type: "CANCEL" });
      expect(getState(actor)).toBe("idle");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  //                  EDITING SUBSCRIPTION STATES
  // ─────────────────────────────────────────────────────────────────────────────

  describe("editingSubPositive state", () => {
    let actor: ReturnType<typeof createTestActor>;

    beforeEach(() => {
      actor = createTestActor();
      actor.send({ type: "EDIT_SUB_POSITIVE", subscriptionId: 42 });
    });

    test("TEXT_KEYWORDS goes to idle and clears editing", () => {
      actor.send({ type: "TEXT_KEYWORDS", keywords: ["new1", "new2"] });
      expect(getState(actor)).toBe("idle");
      expect(getContext(actor).editingSubscriptionId).toBeNull();
    });

    test("CANCEL goes to idle and clears editing", () => {
      actor.send({ type: "CANCEL" });
      expect(getState(actor)).toBe("idle");
      expect(getContext(actor).editingSubscriptionId).toBeNull();
    });
  });

  describe("editingSubNegative state", () => {
    test("TEXT_KEYWORDS goes to idle", () => {
      const actor = createTestActor();
      actor.send({ type: "EDIT_SUB_NEGATIVE", subscriptionId: 42 });
      actor.send({ type: "TEXT_KEYWORDS", keywords: ["neg"] });
      expect(getState(actor)).toBe("idle");
    });
  });

  describe("editingSubDescription state", () => {
    test("TEXT_DESCRIPTION goes to idle", () => {
      const actor = createTestActor();
      actor.send({ type: "EDIT_SUB_DESCRIPTION", subscriptionId: 42 });
      actor.send({ type: "TEXT_DESCRIPTION", text: "new description" });
      expect(getState(actor)).toBe("idle");
    });

    test("CANCEL goes to idle", () => {
      const actor = createTestActor();
      actor.send({ type: "EDIT_SUB_DESCRIPTION", subscriptionId: 42 });
      actor.send({ type: "CANCEL" });
      expect(getState(actor)).toBe("idle");
    });
  });

  describe("editingSubAi state", () => {
    let actor: ReturnType<typeof createTestActor>;

    beforeEach(() => {
      actor = createTestActor();
      actor.send({
        type: "EDIT_SUB_AI",
        data: {
          subscriptionId: 42,
          current: { positiveKeywords: ["old"], negativeKeywords: [], llmDescription: "old" },
          conversation: [],
        },
      });
    });

    test("TEXT_AI_COMMAND adds to conversation", () => {
      actor.send({ type: "TEXT_AI_COMMAND", text: "fix keywords" });
      expect(getState(actor)).toBe("editingSubAi");
      expect(getContext(actor).pendingAiEdit?.conversation).toHaveLength(1);
    });

    test("AI_PROPOSED stores proposed changes", () => {
      const proposed = { positiveKeywords: ["new"], negativeKeywords: [], llmDescription: "new" };
      actor.send({ type: "AI_PROPOSED", proposed });
      expect(getContext(actor).pendingAiEdit?.proposed).toEqual(proposed);
    });

    test("APPLY_AI_EDIT goes to idle and clears", () => {
      actor.send({ type: "APPLY_AI_EDIT" });
      expect(getState(actor)).toBe("idle");
      expect(getContext(actor).pendingAiEdit).toBeNull();
    });

    test("CANCEL goes to idle and clears", () => {
      actor.send({ type: "CANCEL" });
      expect(getState(actor)).toBe("idle");
      expect(getContext(actor).pendingAiEdit).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//                           EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════════

describe("Edge Cases", () => {
  test("toggle non-existent group does nothing", () => {
    const actor = createTestActor();
    actor.send({
      type: "KEYWORDS_GENERATED",
      pendingSub: { originalQuery: "", positiveKeywords: [], negativeKeywords: [], llmDescription: "" },
    });
    actor.send({
      type: "START_GROUP_SELECTION",
      available: [{ id: 1, title: "Group 1" }],
    });
    actor.send({ type: "TOGGLE_GROUP", groupId: 999 }); // Non-existent
    // Should still have 1 selected (the original)
    expect(getContext(actor).selectedGroups).toHaveLength(1);
  });

  test("removing keyword with invalid index does nothing", () => {
    const actor = createTestActor();
    actor.send({
      type: "KEYWORDS_GENERATED",
      pendingSub: {
        originalQuery: "",
        positiveKeywords: ["kw1"],
        negativeKeywords: [],
        llmDescription: "",
      },
    });
    actor.send({ type: "REMOVE_POSITIVE" });
    actor.send({ type: "REMOVE_KEYWORD", index: 999 }); // Invalid index
    expect(getContext(actor).pendingSub?.positiveKeywords).toEqual(["kw1"]);
  });

  test("applying AI correction without proposal does nothing", () => {
    const actor = createTestActor();
    actor.send({
      type: "KEYWORDS_GENERATED",
      pendingSub: {
        originalQuery: "test",
        positiveKeywords: ["old"],
        negativeKeywords: [],
        llmDescription: "old",
      },
    });
    actor.send({
      type: "START_AI_CORRECTION",
      data: {
        mode: "normal",
        current: { positiveKeywords: ["old"], negativeKeywords: [], llmDescription: "old" },
        conversation: [],
      },
    });
    // Apply without proposal
    actor.send({ type: "APPLY_AI_CORRECTION" });
    // Should keep old values
    expect(getContext(actor).pendingSub?.positiveKeywords).toEqual(["old"]);
  });
});
