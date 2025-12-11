/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *                         FSM ACTIONS - THE CONSEQUENCES
 *
 *                    "What actually happens when you make a choice"
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Actions are the side effects that occur when transitioning between states.
 * Think of them as the "consequences" of user decisions.
 *
 * User clicks "Rate Hot" → machine transitions → assignRating ACTION runs
 * → their rating is saved in context
 *
 * Actions in XState v5 are pure functions that return new context values.
 * They receive the current context and the event that triggered them.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import type { BotContext } from "./context";
import type { BotEvent } from "./events";

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *                           CLEAR CONTEXT
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * The "reset button" - clears all temporary data when user cancels or completes
 * a flow. Returns the context to a clean slate while preserving user identity.
 *
 * When is this called?
 * - User clicks Cancel during subscription creation
 * - User finishes creating a subscription (data no longer needed)
 * - User abandons a flow mid-way
 *
 * What gets cleared:
 * - Pending subscription data
 * - Clarification questions and answers
 * - Rating examples and ratings
 * - Selected groups
 * - All editing state
 *
 * What stays:
 * - telegramId (user identity)
 * - userMode (user preference)
 */
export const clearContext = {
  pendingSub: () => null as BotContext["pendingSub"],
  clarification: () => null as BotContext["clarification"],
  ratingExamples: () => null as BotContext["ratingExamples"],
  draftKeywords: () => null as BotContext["draftKeywords"],
  selectedGroups: () => [] as BotContext["selectedGroups"],
  pendingGroups: () => [] as BotContext["pendingGroups"],
  currentPendingGroup: () => null as BotContext["currentPendingGroup"],
  editingSubscriptionId: () => null as BotContext["editingSubscriptionId"],
  pendingAiEdit: () => null as BotContext["pendingAiEdit"],
  pendingAiCorrection: () => null as BotContext["pendingAiCorrection"],
  pendingOperation: () => null as BotContext["pendingOperation"],
};

// ═══════════════════════════════════════════════════════════════════════════════
//                      CLARIFICATION FLOW ACTIONS
//
//        For advanced users: asking follow-up questions to understand
//        what they're looking for
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Start asking clarification questions.
 *
 * When an advanced user enters a search query, the AI generates 2-3 questions
 * to better understand their intent. This action initializes that flow.
 *
 * Example:
 *   User: "Find me clients"
 *   AI generates: ["B2B or B2C?", "What industry?", "What location?"]
 *   This action stores those questions and sets currentIndex to 0
 */
export const startClarification = {
  clarification: ({ event }: { event: BotEvent }) => {
    if (event.type === "START_CLARIFICATION") return event.data;
    return null;
  },
};

/**
 * Store user's answer to the current clarification question.
 *
 * When user answers a question, we:
 * 1. Add their answer to the answers array
 * 2. Increment currentIndex to move to next question
 *
 * Example:
 *   currentIndex: 0, answers: []
 *   User answers "B2B"
 *   currentIndex: 1, answers: ["B2B"]
 */
export const assignAnswer = {
  clarification: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (!context.clarification || event.type !== "ANSWER") return context.clarification;
    return {
      ...context.clarification,
      answers: [...context.clarification.answers, event.text],
      currentIndex: context.clarification.currentIndex + 1,
    };
  },
};

/**
 * User skipped a clarification question.
 *
 * We store an empty string as the answer (preserves array alignment)
 * and move to the next question.
 *
 * Business decision: Let users skip questions they don't know how to answer.
 * An empty answer is still useful context for the AI.
 */
export const skipQuestion = {
  clarification: ({ context }: { context: BotContext }) => {
    if (!context.clarification) return context.clarification;
    return {
      ...context.clarification,
      answers: [...context.clarification.answers, ""],
      currentIndex: context.clarification.currentIndex + 1,
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
//                        RATING EXAMPLES ACTIONS
//
//        Users rate example messages to help AI understand their intent
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Start the example rating flow.
 *
 * After searching groups for similar messages, we show users 3-5 examples
 * and ask them to rate each one as hot/warm/cold.
 *
 * This initializes the flow with the found examples.
 * If pendingSub is provided, it's also stored in context.
 */
export const startRating = {
  ratingExamples: ({ event }: { event: BotEvent }) => {
    if (event.type === "START_RATING") return event.examples;
    return null;
  },
  pendingSub: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (event.type === "START_RATING" && event.pendingSub) return event.pendingSub;
    return context.pendingSub; // Keep existing if not provided
  },
};

/**
 * Store user's rating for the current example.
 *
 * When user rates an example (hot/warm/cold), we:
 * 1. Add the rating to the ratings array with the message details
 * 2. Increment currentIndex to show next example
 *
 * The ratings help AI understand:
 * - Hot: "More like this please"
 * - Warm: "On the right track"
 * - Cold: "Not what I'm looking for"
 */
export const assignRating = {
  ratingExamples: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (!context.ratingExamples || event.type !== "RATE") return context.ratingExamples;

    // Get the current example being rated
    const example = context.ratingExamples.messages[context.ratingExamples.currentIndex];

    return {
      ...context.ratingExamples,
      ratings: [
        ...context.ratingExamples.ratings,
        {
          messageId: event.messageId,
          text: example?.text ?? "",
          rating: event.rating,
        },
      ],
      currentIndex: context.ratingExamples.currentIndex + 1,
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
//                    PENDING SUBSCRIPTION ACTIONS
//
//         Managing the subscription being created (before it's saved)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * AI finished generating keywords - store them.
 *
 * This is a pivotal moment in the flow. The AI has analyzed:
 * - The user's original query
 * - Clarification answers (if any)
 * - Example ratings (if any)
 *
 * And produced:
 * - Positive keywords (what to look for)
 * - Negative keywords (what to filter out)
 * - LLM description (semantic understanding)
 *
 * We also clear temporary flow data (clarification, rating) since
 * it's now baked into the keywords.
 */
export const setKeywordsGenerated = {
  pendingSub: ({ event }: { event: BotEvent }) => {
    if (event.type === "KEYWORDS_GENERATED") return event.pendingSub;
    return null;
  },
  // Clear intermediate flow data - it's served its purpose
  ratingExamples: () => null as BotContext["ratingExamples"],
  clarification: () => null as BotContext["clarification"],
};

/**
 * Directly update the pending subscription.
 *
 * Used after regenerating keywords - the handler makes a new AI call
 * and sends the new results via this action.
 */
export const setPendingSub = {
  pendingSub: ({ event }: { event: BotEvent }) => {
    if (event.type === "SET_PENDING_SUB") return event.pendingSub;
    return null;
  },
};

/**
 * Update draft keywords during the flow.
 *
 * Draft keywords are an intermediate state during keyword refinement.
 * Not used in most flows, but available for special cases.
 */
export const updateDraftKeywords = {
  draftKeywords: ({ event }: { event: BotEvent }) => {
    if (event.type === "UPDATE_DRAFT_KEYWORDS") return event.keywords;
    return null;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
//                       KEYWORD EDITING ACTIONS
//
//              Manual adding/removing of keywords during confirmation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Add new positive keywords to the pending subscription.
 *
 * User types keywords (comma-separated), we append them to the existing list.
 *
 * Example:
 *   Current: ["iPhone", "продам"]
 *   User adds: ["Москва", "новый"]
 *   Result: ["iPhone", "продам", "Москва", "новый"]
 */
export const addPositiveKeywords = {
  pendingSub: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (!context.pendingSub || event.type !== "TEXT_KEYWORDS") return context.pendingSub;
    return {
      ...context.pendingSub,
      positiveKeywords: [...context.pendingSub.positiveKeywords, ...event.keywords],
    };
  },
};

/**
 * Add new negative keywords to the pending subscription.
 *
 * Same logic as positive, but these keywords FILTER OUT messages.
 *
 * Example:
 *   User looking for sellers adds: ["куплю", "ищу"]
 *   Now messages containing "куплю" or "ищу" (buyers) will be filtered out
 */
export const addNegativeKeywords = {
  pendingSub: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (!context.pendingSub || event.type !== "TEXT_KEYWORDS") return context.pendingSub;
    return {
      ...context.pendingSub,
      negativeKeywords: [...context.pendingSub.negativeKeywords, ...event.keywords],
    };
  },
};

/**
 * Remove a positive keyword by its index.
 *
 * User clicked a keyword button to remove it. We identify it by position
 * in the array (0-indexed).
 *
 * Example:
 *   Keywords: ["iPhone", "продам", "Москва"] (indexes: 0, 1, 2)
 *   User removes index 1 ("продам")
 *   Result: ["iPhone", "Москва"]
 */
export const removePositiveKeyword = {
  pendingSub: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (!context.pendingSub || event.type !== "REMOVE_KEYWORD") return context.pendingSub;
    return {
      ...context.pendingSub,
      positiveKeywords: context.pendingSub.positiveKeywords.filter(
        (_: string, i: number) => i !== event.index
      ),
    };
  },
};

/**
 * Remove a negative keyword by its index.
 *
 * Same logic as positive keyword removal.
 */
export const removeNegativeKeyword = {
  pendingSub: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (!context.pendingSub || event.type !== "REMOVE_KEYWORD") return context.pendingSub;
    return {
      ...context.pendingSub,
      negativeKeywords: context.pendingSub.negativeKeywords.filter(
        (_: string, i: number) => i !== event.index
      ),
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
//                       GROUP SELECTION ACTIONS
//
//         Choosing which groups to monitor for the subscription
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Initialize group selection with available groups.
 *
 * When user confirms keywords, we show them a list of groups to choose from.
 * By default, ALL groups are selected (user can deselect ones they don't want).
 *
 * Business decision: Default to "all selected" because most users want
 * their subscription to apply everywhere. It's easier to deselect a few
 * than to select many.
 */
export const startGroupSelection = {
  availableGroups: ({ event }: { event: BotEvent }) => {
    if (event.type === "START_GROUP_SELECTION") return event.available;
    return [];
  },
  // Pre-select all groups by default
  selectedGroups: ({ event }: { event: BotEvent }) => {
    if (event.type === "START_GROUP_SELECTION") return event.available;
    return [];
  },
};

/**
 * Toggle a single group's selection.
 *
 * If it's selected → deselect it
 * If it's not selected → select it
 *
 * Like clicking a checkbox.
 */
export const toggleGroup = {
  selectedGroups: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (event.type !== "TOGGLE_GROUP") return context.selectedGroups;

    // Check if group is currently selected
    const exists = context.selectedGroups.some((g) => g.id === event.groupId);

    if (exists) {
      // Deselect: remove from list
      return context.selectedGroups.filter((g) => g.id !== event.groupId);
    }

    // Select: add to list (find it in available groups first)
    const group = context.availableGroups.find((g) => g.id === event.groupId);
    return group ? [...context.selectedGroups, group] : context.selectedGroups;
  },
};

/**
 * Select all available groups at once.
 *
 * Quick action for users who want to monitor everywhere.
 * Just copy the entire availableGroups array.
 */
export const selectAllGroups = {
  selectedGroups: ({ context }: { context: BotContext }) => [...context.availableGroups],
};

/**
 * Deselect all groups.
 *
 * Quick action to start fresh with selections.
 * User might want to pick just 1-2 specific groups.
 */
export const deselectAllGroups = {
  selectedGroups: () => [] as BotContext["selectedGroups"],
};

// ═══════════════════════════════════════════════════════════════════════════════
//                      ADDING GROUPS ACTIONS
//
//               The /addgroup flow for adding new monitored groups
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Handle when user shares a chat through Telegram's picker.
 *
 * Two possible outcomes:
 * 1. Public group → add directly to pendingGroups
 * 2. Private group → set as currentPendingGroup, ask for invite link
 *
 * The needsInviteLink flag in the group determines the path.
 */
export const setChatShared = {
  // If needs invite link, store as current pending group
  currentPendingGroup: ({ event }: { event: BotEvent }) => {
    if (event.type === "CHAT_SHARED" && event.group.needsInviteLink) return event.group;
    return null;
  },
  // If doesn't need invite link, add directly to pending groups list
  pendingGroups: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (event.type === "CHAT_SHARED" && !event.group.needsInviteLink) {
      return [...context.pendingGroups, event.group];
    }
    return context.pendingGroups;
  },
};

/**
 * User provided an invite link for a private group.
 *
 * We store the link with the current pending group so the handler
 * can use it to join the group.
 */
export const setInviteLink = {
  currentPendingGroup: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (!context.currentPendingGroup || event.type !== "INVITE_LINK") {
      return context.currentPendingGroup;
    }
    return { ...context.currentPendingGroup, inviteLink: event.link };
  },
};

/**
 * Bot successfully joined a group.
 *
 * The handler attempted to join and it worked. Add to pending groups list
 * and clear the current pending group.
 */
export const addJoinedGroup = {
  pendingGroups: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (event.type === "GROUP_JOINED") return [...context.pendingGroups, event.group];
    return context.pendingGroups;
  },
  // Clear the current pending group since it's now processed
  currentPendingGroup: () => null as BotContext["currentPendingGroup"],
};

/**
 * User skipped providing an invite link.
 *
 * They don't want to share the link - clear the pending group
 * and continue without it.
 */
export const skipInvite = {
  currentPendingGroup: () => null as BotContext["currentPendingGroup"],
};

/**
 * Clean up after the adding groups flow completes.
 *
 * Called when user says "done" or cancels.
 * Clears all group-adding related state.
 */
export const clearAddingGroups = {
  pendingGroups: () => [] as BotContext["pendingGroups"],
  currentPendingGroup: () => null as BotContext["currentPendingGroup"],
};

// ═══════════════════════════════════════════════════════════════════════════════
//                    EDITING EXISTING SUBSCRIPTION ACTIONS
//
//              Modifying subscriptions that are already saved
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Start editing positive keywords of an existing subscription.
 *
 * Store the subscription ID so the handler knows which one to update.
 */
export const setEditingPositive = {
  editingSubscriptionId: ({ event }: { event: BotEvent }) => {
    if (event.type === "EDIT_SUB_POSITIVE") return event.subscriptionId;
    return null;
  },
};

/**
 * Start editing negative keywords of an existing subscription.
 */
export const setEditingNegative = {
  editingSubscriptionId: ({ event }: { event: BotEvent }) => {
    if (event.type === "EDIT_SUB_NEGATIVE") return event.subscriptionId;
    return null;
  },
};

/**
 * Start editing description of an existing subscription.
 */
export const setEditingDescription = {
  editingSubscriptionId: ({ event }: { event: BotEvent }) => {
    if (event.type === "EDIT_SUB_DESCRIPTION") return event.subscriptionId;
    return null;
  },
};

/**
 * Start AI-assisted editing with current subscription data.
 *
 * The event contains the full AiEditData including:
 * - Subscription ID
 * - Current keywords and description
 * - Empty conversation history
 */
export const setAiEdit = {
  pendingAiEdit: ({ event }: { event: BotEvent }) => {
    if (event.type === "EDIT_SUB_AI") return event.data;
    return null;
  },
};

/**
 * Add user's message to AI editing conversation.
 *
 * When user says something like "Add more synonyms", we store it
 * in the conversation history for context.
 */
export const updateAiConversation = {
  pendingAiEdit: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (!context.pendingAiEdit || event.type !== "TEXT_AI_COMMAND") {
      return context.pendingAiEdit;
    }
    return {
      ...context.pendingAiEdit,
      conversation: [
        ...context.pendingAiEdit.conversation,
        { role: "user" as const, content: event.text },
      ],
    };
  },
};

/**
 * AI has proposed changes - store them for user approval.
 *
 * The handler calls the AI, gets suggestions, and sends them here.
 * User can then review and approve or continue chatting.
 */
export const setAiProposed = {
  pendingAiEdit: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (!context.pendingAiEdit || event.type !== "AI_PROPOSED") {
      return context.pendingAiEdit;
    }
    return { ...context.pendingAiEdit, proposed: event.proposed };
  },
};

/**
 * Clean up after editing flow completes.
 *
 * Called after user applies changes or cancels.
 */
export const clearEditing = {
  editingSubscriptionId: () => null as BotContext["editingSubscriptionId"],
  pendingAiEdit: () => null as BotContext["pendingAiEdit"],
};

// ═══════════════════════════════════════════════════════════════════════════════
//                  AI CORRECTION ACTIONS (DURING CREATION)
//
//         AI help for a subscription being created (not yet saved)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Start AI correction flow with current pending subscription data.
 *
 * User sees generated keywords, doesn't like them, clicks "AI Help".
 * This initializes the conversational correction flow.
 */
export const startAiCorrection = {
  pendingAiCorrection: ({ event }: { event: BotEvent }) => {
    if (event.type === "START_AI_CORRECTION") return event.data;
    return null;
  },
};

/**
 * Add user's message to AI correction conversation.
 *
 * Same concept as updateAiConversation, but for the creation flow.
 */
export const updateAiCorrectionConversation = {
  pendingAiCorrection: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (!context.pendingAiCorrection || event.type !== "TEXT_AI_COMMAND") {
      return context.pendingAiCorrection;
    }
    return {
      ...context.pendingAiCorrection,
      conversation: [
        ...context.pendingAiCorrection.conversation,
        { role: "user" as const, content: event.text },
      ],
    };
  },
};

/**
 * AI proposed corrections - store for user approval.
 */
export const setAiCorrectionProposed = {
  pendingAiCorrection: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (!context.pendingAiCorrection || event.type !== "AI_CORRECTION_PROPOSED") {
      return context.pendingAiCorrection;
    }
    return { ...context.pendingAiCorrection, proposed: event.proposed };
  },
};

/**
 * Apply AI's proposed corrections to the pending subscription.
 *
 * User approved the AI's suggestions. We take the proposed changes
 * and apply them to pendingSub, then clear the correction flow.
 *
 * This is the "merge" operation - AI corrections → pending subscription.
 */
export const applyAiCorrection = {
  // Update pending subscription with AI's proposed changes
  pendingSub: ({ context }: { context: BotContext }) => {
    if (!context.pendingAiCorrection?.proposed || !context.pendingSub) {
      return context.pendingSub;
    }
    return {
      ...context.pendingSub,
      positiveKeywords: context.pendingAiCorrection.proposed.positiveKeywords,
      negativeKeywords: context.pendingAiCorrection.proposed.negativeKeywords,
      llmDescription: context.pendingAiCorrection.proposed.llmDescription,
    };
  },
  // Clear the correction flow
  pendingAiCorrection: () => null as BotContext["pendingAiCorrection"],
};

// ═══════════════════════════════════════════════════════════════════════════════
//                          USER MODE ACTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Change user's mode (normal/advanced).
 *
 * Usually set by admins. Affects how the subscription creation flow works:
 * - Normal: Streamlined, fewer questions
 * - Advanced: Full control, clarification questions
 */
export const setUserMode = {
  userMode: ({ event }: { event: BotEvent }) => {
    if (event.type === "SET_USER_MODE") return event.mode;
    return "normal" as const;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
//                      OPERATION RECOVERY ACTIONS
//
//         Track long-running operations so we can resume them after restart
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Mark that a long-running operation has started.
 *
 * Called before starting LLM calls like keyword generation or AI correction.
 * The operation info is persisted to the database, so if the bot crashes,
 * we can find and resume these operations on startup.
 */
export const startOperation = {
  pendingOperation: ({ event }: { event: BotEvent }) => {
    if (event.type === "START_OPERATION") return event.operation;
    return null;
  },
};

/**
 * Clear the pending operation marker.
 *
 * Called after an operation completes (whether success or failure).
 * Indicates that no operation is in progress for this user.
 */
export const clearOperation = {
  pendingOperation: () => null as BotContext["pendingOperation"],
};

/**
 * Save the original query before analysis starts.
 *
 * This allows recovery to retry the analysis with the same query
 * if the bot restarts mid-operation.
 */
export const saveQuery = {
  pendingSub: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (event.type === "SAVE_QUERY") {
      return {
        originalQuery: event.query,
        positiveKeywords: context.pendingSub?.positiveKeywords ?? [],
        negativeKeywords: context.pendingSub?.negativeKeywords ?? [],
        llmDescription: context.pendingSub?.llmDescription ?? "",
      };
    }
    return context.pendingSub;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
//                      PENDING QUERY ACTIONS
//
//       For saving user's query when they try to create subscription
//       without having any groups. Query is processed after addgroup flow.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Save the user's query when they don't have groups yet.
 *
 * When user sends a subscription query but has no groups to monitor,
 * we save the query and redirect them to add groups first.
 * After they add groups, we'll process this saved query.
 */
export const savePendingQuery = {
  pendingQuery: ({ event }: { event: BotEvent }) => {
    if (event.type === "SAVE_PENDING_QUERY") return event.query;
    return null;
  },
};

/**
 * Clear the pending query after it's been processed.
 *
 * Called after the query has been processed (either successfully
 * or when user cancels the flow).
 */
export const clearPendingQuery = {
  pendingQuery: () => null as BotContext["pendingQuery"],
};

// ═══════════════════════════════════════════════════════════════════════════════
//                    GROUP METADATA COLLECTION ACTIONS
//
//       Collecting marketplace/country/city/currency info after adding a group
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Initialize queue of groups for metadata collection.
 *
 * Used when multiple groups added via links. Sets up the queue,
 * then START_METADATA_COLLECTION is called for each one.
 */
export const startMetadataQueue = {
  metadataQueue: ({ event }: { event: BotEvent }) => {
    if (event.type === "START_METADATA_QUEUE") {
      return { groups: event.groups };
    }
    return null;
  },
};

/**
 * Start metadata collection for a single group.
 *
 * Initializes pendingGroupMetadata with group info and pre-filled values.
 * First step is always "marketplace".
 */
export const startMetadataCollection = {
  pendingGroupMetadata: ({ event }: { event: BotEvent }) => {
    if (event.type === "START_METADATA_COLLECTION") {
      return {
        groupId: event.groupId,
        groupTitle: event.groupTitle,
        step: "marketplace" as const,
        isMarketplace: null,
        country: null,
        city: null,
        currency: null,
        prefilled: event.prefilled ?? {},
        awaitingTextInput: false,
      };
    }
    return null;
  },
};

/**
 * User answered Yes/No to marketplace question.
 *
 * Store the answer and advance to "country" step.
 */
export const setMetadataMarketplace = {
  pendingGroupMetadata: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (!context.pendingGroupMetadata || event.type !== "METADATA_MARKETPLACE") {
      return context.pendingGroupMetadata;
    }
    return {
      ...context.pendingGroupMetadata,
      isMarketplace: event.isMarketplace,
      step: "country" as const,
      awaitingTextInput: false,
    };
  },
};

/**
 * User entered text for current step (country/city/currency).
 *
 * Handler normalizes the text before sending this event.
 * Store the value and advance to next step.
 */
export const setMetadataText = {
  pendingGroupMetadata: ({ context, event }: { context: BotContext; event: BotEvent }) => {
    if (!context.pendingGroupMetadata || event.type !== "METADATA_TEXT") {
      return context.pendingGroupMetadata;
    }

    const meta = context.pendingGroupMetadata;
    const text = event.text;

    switch (meta.step) {
      case "country":
        return { ...meta, country: text, step: "city" as const, awaitingTextInput: false };
      case "city":
        return { ...meta, city: text, step: "currency" as const, awaitingTextInput: false };
      case "currency":
        // Stay on currency, METADATA_DONE will transition out
        return { ...meta, currency: text, awaitingTextInput: false };
      default:
        return meta;
    }
  },
};

/**
 * User confirmed pre-filled value.
 *
 * Take the pre-filled value for current step and advance.
 */
export const confirmPrefilledMetadata = {
  pendingGroupMetadata: ({ context }: { context: BotContext }) => {
    if (!context.pendingGroupMetadata) return null;

    const meta = context.pendingGroupMetadata;

    switch (meta.step) {
      case "country":
        return {
          ...meta,
          country: meta.prefilled.country ?? null,
          step: "city" as const,
          awaitingTextInput: false,
        };
      case "city":
        return {
          ...meta,
          city: meta.prefilled.city ?? null,
          step: "currency" as const,
          awaitingTextInput: false,
        };
      case "currency":
        // Currency prefill comes from country's default, stored separately
        return meta;
      default:
        return meta;
    }
  },
};

/**
 * User wants to change pre-filled value.
 *
 * Switch to text input mode for current step.
 */
export const changePrefilledMetadata = {
  pendingGroupMetadata: ({ context }: { context: BotContext }) => {
    if (!context.pendingGroupMetadata) return null;
    return {
      ...context.pendingGroupMetadata,
      awaitingTextInput: true,
    };
  },
};

/**
 * User skipped current metadata question.
 *
 * Advance to next step without storing a value.
 */
export const skipMetadataStep = {
  pendingGroupMetadata: ({ context }: { context: BotContext }) => {
    if (!context.pendingGroupMetadata) return null;

    const meta = context.pendingGroupMetadata;

    const nextStep: Record<string, "country" | "city" | "currency"> = {
      marketplace: "country",
      country: "city",
      city: "currency",
    };

    const next = nextStep[meta.step];
    if (next) {
      return { ...meta, step: next, awaitingTextInput: false };
    }
    // currency is last step, stay there
    return meta;
  },
};

/**
 * Clear metadata collection state.
 *
 * Called after all metadata questions answered or when cancelling.
 */
export const clearGroupMetadata = {
  pendingGroupMetadata: () => null as BotContext["pendingGroupMetadata"],
};

/**
 * Move to next group in metadata queue.
 *
 * Removes the first group from queue (it's been processed).
 */
export const advanceMetadataQueue = {
  metadataQueue: ({ context }: { context: BotContext }) => {
    if (!context.metadataQueue) return null;
    const remaining = context.metadataQueue.groups.slice(1);
    if (remaining.length === 0) return null;
    return { groups: remaining };
  },
};

/**
 * Clear metadata queue.
 *
 * Called when all groups processed or when cancelling.
 */
export const clearMetadataQueue = {
  metadataQueue: () => null as BotContext["metadataQueue"],
};
