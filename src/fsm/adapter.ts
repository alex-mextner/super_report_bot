/**
 * Adapter layer for gradual migration from old UserState to XState FSM.
 *
 * Usage:
 * 1. Replace `userStates` Map with `actors` Map
 * 2. Replace `getUserState(userId)` with `getState(userId)`
 * 3. Replace `setUserState(userId, state)` with `send(userId, event)`
 *
 * The adapter automatically persists state to SQLite.
 */

import {
  createUserActor,
  getContext,
  getStateValue,
  isInState,
  type UserActor,
  type StateValue,
} from "./index";
import type { BotContext, PendingSubscription, GroupData } from "./context";
import type { BotEvent } from "./events";
import type { UserMode, UserState, PendingGroup, ExampleRating, RatingExample } from "../types";
import { queries } from "../db";

// In-memory cache of actors (state is persisted to DB)
const actors = new Map<number, UserActor>();

/**
 * Get or create actor for user
 */
export function getActor(telegramId: number): UserActor {
  let actor = actors.get(telegramId);
  if (!actor) {
    // Ensure user exists in DB first
    queries.getOrCreateUser(telegramId);
    const mode = queries.getUserMode(telegramId);
    actor = createUserActor(telegramId, mode);
    actors.set(telegramId, actor);
  }
  return actor;
}

/**
 * Send event to user's FSM
 */
export function send(telegramId: number, event: BotEvent): void {
  const actor = getActor(telegramId);
  actor.send(event);
}

/**
 * Get current state value
 */
export function getCurrentState(telegramId: number): StateValue {
  const actor = getActor(telegramId);
  return getStateValue(actor) as StateValue;
}

/**
 * Check if user is in specific state
 */
export function checkState(telegramId: number, state: StateValue): boolean {
  const actor = getActor(telegramId);
  return isInState(actor, state);
}

/**
 * Get FSM context
 */
export function getFsmContext(telegramId: number): BotContext {
  const actor = getActor(telegramId);
  return getContext(actor);
}

// ============================================================
// COMPATIBILITY LAYER - maps old UserState to new FSM
// ============================================================

// Map FSM state to old step names
const stateToStepMap: Record<StateValue, UserState["step"]> = {
  idle: "idle",
  clarifyingQuery: "clarifying_query",
  ratingExamples: "rating_examples",
  awaitingConfirmation: "awaiting_confirmation",
  correctingPendingAi: "correcting_pending_ai",
  addingPositive: "adding_positive",
  addingNegative: "adding_negative",
  removingPositive: "removing_positive",
  removingNegative: "removing_negative",
  selectingGroups: "selecting_groups",
  addingGroup: "adding_group",
  awaitingInviteLink: "awaiting_invite_link",
  editingSubPositive: "editing_sub_positive",
  editingSubNegative: "editing_sub_negative",
  editingSubDescription: "editing_sub_description",
  editingSubAi: "editing_sub_ai",
};

/**
 * Convert FSM context to old UserState format for backwards compatibility
 */
export function getState(telegramId: number): UserState {
  const actor = getActor(telegramId);
  const ctx = getContext(actor);
  const stateValue = getStateValue(actor) as StateValue;

  const step = stateToStepMap[stateValue] || "idle";

  // Convert FSM context to old UserState format
  const userState: UserState = { step };

  if (ctx.pendingSub) {
    userState.pending_subscription = {
      original_query: ctx.pendingSub.originalQuery,
      positive_keywords: ctx.pendingSub.positiveKeywords,
      negative_keywords: ctx.pendingSub.negativeKeywords,
      llm_description: ctx.pendingSub.llmDescription,
    };
  }

  if (ctx.clarification) {
    userState.clarification = {
      original_query: ctx.clarification.originalQuery,
      questions: ctx.clarification.questions,
      answers: ctx.clarification.answers,
      current_index: ctx.clarification.currentIndex,
    };
  }

  if (ctx.ratingExamples) {
    userState.pending_examples = {
      messages: ctx.ratingExamples.messages.map((m) => ({
        id: m.id,
        text: m.text,
        groupId: m.groupId,
        groupTitle: m.groupTitle,
        isGenerated: m.isGenerated,
      })),
      ratings: ctx.ratingExamples.ratings,
      current_index: ctx.ratingExamples.currentIndex,
    };
  }

  if (ctx.selectedGroups.length > 0) {
    userState.selected_groups = ctx.selectedGroups.map((g) => ({ id: g.id, title: g.title }));
  }

  if (ctx.availableGroups.length > 0) {
    userState.available_groups = ctx.availableGroups.map((g) => ({ id: g.id, title: g.title }));
  }

  if (ctx.editingSubscriptionId !== null) {
    userState.editing_subscription_id = ctx.editingSubscriptionId;
  }

  if (ctx.pendingAiEdit) {
    userState.pending_ai_edit = {
      subscription_id: ctx.pendingAiEdit.subscriptionId,
      current: {
        positive_keywords: ctx.pendingAiEdit.current.positiveKeywords,
        negative_keywords: ctx.pendingAiEdit.current.negativeKeywords,
        llm_description: ctx.pendingAiEdit.current.llmDescription,
      },
      proposed: ctx.pendingAiEdit.proposed
        ? {
            positive_keywords: ctx.pendingAiEdit.proposed.positiveKeywords,
            negative_keywords: ctx.pendingAiEdit.proposed.negativeKeywords,
            llm_description: ctx.pendingAiEdit.proposed.llmDescription,
          }
        : undefined,
      conversation: ctx.pendingAiEdit.conversation,
    };
  }

  if (ctx.pendingAiCorrection) {
    userState.pending_ai_correction = {
      mode: ctx.pendingAiCorrection.mode,
      current: {
        positive_keywords: ctx.pendingAiCorrection.current.positiveKeywords,
        negative_keywords: ctx.pendingAiCorrection.current.negativeKeywords,
        llm_description: ctx.pendingAiCorrection.current.llmDescription,
      },
      proposed: ctx.pendingAiCorrection.proposed
        ? {
            positive_keywords: ctx.pendingAiCorrection.proposed.positiveKeywords,
            negative_keywords: ctx.pendingAiCorrection.proposed.negativeKeywords,
            llm_description: ctx.pendingAiCorrection.proposed.llmDescription,
          }
        : undefined,
      conversation: ctx.pendingAiCorrection.conversation,
    };
  }

  if (ctx.pendingGroups.length > 0) {
    userState.pending_groups = ctx.pendingGroups;
  }

  if (ctx.currentPendingGroup) {
    userState.current_pending_group = ctx.currentPendingGroup;
  }

  if (ctx.draftKeywords) {
    userState.draft_keywords = ctx.draftKeywords;
  }

  return userState;
}

/**
 * Set state using old UserState format (converts to FSM events)
 * This is for backwards compatibility during migration.
 *
 * @deprecated Use send() with specific events instead
 */
export function setState(telegramId: number, state: UserState): void {
  const actor = getActor(telegramId);

  // First, reset to idle if needed
  if (state.step === "idle") {
    actor.send({ type: "CANCEL" });
    return;
  }

  // Convert old state to FSM events
  // This is a simplified conversion - for full migration,
  // replace setUserState calls with specific event sends

  if (state.step === "awaiting_confirmation" && state.pending_subscription) {
    actor.send({
      type: "KEYWORDS_GENERATED",
      pendingSub: {
        originalQuery: state.pending_subscription.original_query,
        positiveKeywords: state.pending_subscription.positive_keywords,
        negativeKeywords: state.pending_subscription.negative_keywords,
        llmDescription: state.pending_subscription.llm_description,
      },
    });
  }

  if (state.step === "rating_examples" && state.pending_examples) {
    actor.send({
      type: "START_RATING",
      examples: {
        messages: state.pending_examples.messages.map((m) => ({
          id: m.id,
          text: m.text,
          groupId: m.groupId,
          groupTitle: m.groupTitle,
          isGenerated: m.isGenerated,
        })),
        ratings: state.pending_examples.ratings,
        currentIndex: state.pending_examples.current_index,
      },
    });
  }

  if (state.step === "clarifying_query" && state.clarification) {
    actor.send({
      type: "START_CLARIFICATION",
      data: {
        originalQuery: state.clarification.original_query,
        questions: state.clarification.questions,
        answers: state.clarification.answers,
        currentIndex: state.clarification.current_index,
      },
    });
  }

  if (state.step === "selecting_groups" && state.available_groups) {
    actor.send({
      type: "START_GROUP_SELECTION",
      available: state.available_groups.map((g) => ({ id: g.id, title: g.title })),
    });
  }

  if (state.step === "adding_group") {
    actor.send({ type: "ADDGROUP" });
  }

  if (state.step === "editing_sub_positive" && state.editing_subscription_id) {
    actor.send({ type: "EDIT_SUB_POSITIVE", subscriptionId: state.editing_subscription_id });
  }

  if (state.step === "editing_sub_negative" && state.editing_subscription_id) {
    actor.send({ type: "EDIT_SUB_NEGATIVE", subscriptionId: state.editing_subscription_id });
  }

  if (state.step === "editing_sub_description" && state.editing_subscription_id) {
    actor.send({ type: "EDIT_SUB_DESCRIPTION", subscriptionId: state.editing_subscription_id });
  }

  if (state.step === "editing_sub_ai" && state.pending_ai_edit) {
    actor.send({
      type: "EDIT_SUB_AI",
      data: {
        subscriptionId: state.pending_ai_edit.subscription_id,
        current: {
          positiveKeywords: state.pending_ai_edit.current.positive_keywords,
          negativeKeywords: state.pending_ai_edit.current.negative_keywords,
          llmDescription: state.pending_ai_edit.current.llm_description,
        },
        proposed: state.pending_ai_edit.proposed
          ? {
              positiveKeywords: state.pending_ai_edit.proposed.positive_keywords,
              negativeKeywords: state.pending_ai_edit.proposed.negative_keywords,
              llmDescription: state.pending_ai_edit.proposed.llm_description,
            }
          : undefined,
        conversation: state.pending_ai_edit.conversation,
      },
    });
  }

  if (state.step === "adding_positive") {
    actor.send({ type: "ADD_POSITIVE" });
  }

  if (state.step === "adding_negative") {
    actor.send({ type: "ADD_NEGATIVE" });
  }

  if (state.step === "removing_positive") {
    actor.send({ type: "REMOVE_POSITIVE" });
  }

  if (state.step === "removing_negative") {
    actor.send({ type: "REMOVE_NEGATIVE" });
  }
}

/**
 * Clear actor from cache (for cleanup)
 */
export function clearActor(telegramId: number): void {
  const actor = actors.get(telegramId);
  if (actor) {
    actor.stop();
    actors.delete(telegramId);
  }
}

/**
 * Get all active actors count (for monitoring)
 */
export function getActiveActorsCount(): number {
  return actors.size;
}
