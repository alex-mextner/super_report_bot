/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *                     THE TELEGRAM BOT STATE MACHINE
 *
 *              A story of user journeys through subscription creation
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This file describes the heart of the bot - a finite state machine that guides
 * users through various conversational flows. Think of it as a choose-your-own-
 * adventure book where each state is a page, and each event is a choice that
 * takes you to the next page.
 *
 * The machine handles several user journeys:
 *
 * 1. SUBSCRIPTION CREATION - The main flow where users describe what messages
 *    they want to find, rate examples, confirm keywords, and select groups.
 *
 * 2. GROUP MANAGEMENT - Adding new Telegram groups to monitor, handling both
 *    public groups (easy) and private groups (requires invite links).
 *
 * 3. SUBSCRIPTION EDITING - Modifying existing subscriptions, either manually
 *    or with AI assistance.
 *
 * 4. AI CORRECTION - Letting AI help refine keywords during creation.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { setup, assign } from "xstate";
import type { BotContext } from "./context";
import type { BotEvent } from "./events";
import * as guards from "./guards";
import * as actions from "./actions";

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *                              MACHINE SETUP
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Before we define states and transitions, we need to register all the guards
 * (conditions that determine which transition to take) and actions (side effects
 * that modify the context when transitions occur).
 *
 * XState v5 requires explicit registration - no magic strings allowed.
 */
export const userMachine = setup({
  /**
   * Type declarations tell TypeScript what shape our context and events have.
   * This enables full type safety throughout the state machine.
   */
  types: {
    context: {} as BotContext,
    events: {} as BotEvent,
  },

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *                                GUARDS
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * Guards are boolean functions that determine whether a transition should occur.
   * They're like bouncers at a club - they check if you meet the criteria before
   * letting you through to the next state.
   */
  guards: {
    /**
     * Is the user in "advanced" mode?
     * Advanced users get extra features like clarification questions.
     */
    isAdvancedMode: guards.isAdvancedMode,

    /**
     * Does the user have any groups to choose from?
     * If not, we skip the group selection step entirely.
     */
    hasAvailableGroups: guards.hasAvailableGroups,

    /**
     * Have all example messages been rated?
     * Once the user rates the last example, we move to confirmation.
     */
    allExamplesRated: guards.allExamplesRated,

    /**
     * Have all clarification questions been answered?
     * Advanced mode asks questions before showing examples.
     */
    allQuestionsAnswered: guards.allQuestionsAnswered,

    /**
     * Is the current pending group a private group that needs an invite link?
     * Public groups don't need invite links - we can just join them.
     */
    needsInviteLink: guards.needsInviteLink,

    /**
     * Do we have a pending subscription in progress?
     * Used to ensure we don't lose data mid-flow.
     */
    hasPendingSub: guards.hasPendingSub,

    /**
     * Does the pending subscription have positive keywords?
     * Can't remove what doesn't exist.
     */
    hasPositiveKeywords: guards.hasPositiveKeywords,

    /**
     * Does the pending subscription have negative keywords?
     * Can't remove what doesn't exist.
     */
    hasNegativeKeywords: guards.hasNegativeKeywords,

    /**
     * Has the AI proposed changes during editing?
     * The user can only apply changes if AI has suggested something.
     */
    hasProposedAiEdit: guards.hasProposedAiEdit,

    /**
     * Has the AI proposed corrections during subscription creation?
     * Similar to above, but for the creation flow instead of editing.
     */
    hasProposedAiCorrection: guards.hasProposedAiCorrection,

    /**
     * Has the user selected at least one group?
     * We need groups to monitor for the subscription to work.
     */
    hasSelectedGroups: guards.hasSelectedGroups,
  },

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *                               ACTIONS
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * Actions modify the machine's context when transitions occur. They're wrapped
   * in `assign()` because XState requires explicit assignment functions for
   * context updates. Think of them as the "what happens" when you make a choice.
   */
  actions: {
    /**
     * Reset everything to a clean slate.
     * Called when user cancels or completes a flow.
     */
    clearContext: assign(actions.clearContext),

    // ═══════════════════════════════════════════════════════════════════════════
    // CLARIFICATION FLOW ACTIONS
    // These handle the Q&A process for advanced users
    // ═══════════════════════════════════════════════════════════════════════════

    /** Initialize the clarification flow with questions from LLM */
    startClarification: assign(actions.startClarification),

    /** Store user's answer and advance to next question */
    assignAnswer: assign(actions.assignAnswer),

    /** User doesn't want to answer this question - store empty and move on */
    skipQuestion: assign(actions.skipQuestion),

    // ═══════════════════════════════════════════════════════════════════════════
    // RATING FLOW ACTIONS
    // Users rate example messages as hot/warm/cold
    // ═══════════════════════════════════════════════════════════════════════════

    /** Initialize rating flow with example messages */
    startRating: assign(actions.startRating),

    /** Store user's rating for current example */
    assignRating: assign(actions.assignRating),

    // ═══════════════════════════════════════════════════════════════════════════
    // PENDING SUBSCRIPTION ACTIONS
    // Managing the subscription being created
    // ═══════════════════════════════════════════════════════════════════════════

    /** LLM has generated keywords - store them and clear temporary flow data */
    setKeywordsGenerated: assign(actions.setKeywordsGenerated),

    /** Update pending subscription directly (after regeneration) */
    setPendingSub: assign(actions.setPendingSub),

    /** Update draft keywords during the flow */
    updateDraftKeywords: assign(actions.updateDraftKeywords),

    // ═══════════════════════════════════════════════════════════════════════════
    // KEYWORD EDITING ACTIONS
    // Adding and removing keywords from pending subscription
    // ═══════════════════════════════════════════════════════════════════════════

    /** Append new positive keywords to the list */
    addPositiveKeywords: assign(actions.addPositiveKeywords),

    /** Append new negative keywords to the list */
    addNegativeKeywords: assign(actions.addNegativeKeywords),

    /** Remove a positive keyword by index */
    removePositiveKeyword: assign(actions.removePositiveKeyword),

    /** Remove a negative keyword by index */
    removeNegativeKeyword: assign(actions.removeNegativeKeyword),

    // ═══════════════════════════════════════════════════════════════════════════
    // GROUP SELECTION ACTIONS
    // Picking which groups to monitor for the subscription
    // ═══════════════════════════════════════════════════════════════════════════

    /** Initialize group selection with available groups */
    startGroupSelection: assign(actions.startGroupSelection),

    /** Toggle a single group on/off */
    toggleGroup: assign(actions.toggleGroup),

    /** Select all available groups at once */
    selectAllGroups: assign(actions.selectAllGroups),

    /** Deselect all groups */
    deselectAllGroups: assign(actions.deselectAllGroups),

    // ═══════════════════════════════════════════════════════════════════════════
    // ADDING GROUPS ACTIONS
    // The /addgroup command flow for adding new groups to monitor
    // ═══════════════════════════════════════════════════════════════════════════

    /** User shared a chat - either add it to pending or ask for invite link */
    setChatShared: assign(actions.setChatShared),

    /** User provided an invite link for a private group */
    setInviteLink: assign(actions.setInviteLink),

    /** Bot successfully joined a group - add to pending list */
    addJoinedGroup: assign(actions.addJoinedGroup),

    /** User wants to skip providing invite link */
    skipInvite: assign(actions.skipInvite),

    /** Clean up after the adding groups flow completes */
    clearAddingGroups: assign(actions.clearAddingGroups),

    // ═══════════════════════════════════════════════════════════════════════════
    // SUBSCRIPTION EDITING ACTIONS
    // Modifying existing subscriptions (positive, negative, description, AI)
    // ═══════════════════════════════════════════════════════════════════════════

    /** Start editing positive keywords of existing subscription */
    setEditingPositive: assign(actions.setEditingPositive),

    /** Start editing negative keywords of existing subscription */
    setEditingNegative: assign(actions.setEditingNegative),

    /** Start editing description of existing subscription */
    setEditingDescription: assign(actions.setEditingDescription),

    /** Start AI-assisted editing with current subscription data */
    setAiEdit: assign(actions.setAiEdit),

    /** Add user message to AI conversation history */
    updateAiConversation: assign(actions.updateAiConversation),

    /** AI has proposed new keywords - store them for user approval */
    setAiProposed: assign(actions.setAiProposed),

    /** Clean up after editing flow completes */
    clearEditing: assign(actions.clearEditing),

    // ═══════════════════════════════════════════════════════════════════════════
    // AI CORRECTION ACTIONS
    // AI-assisted correction during subscription creation (not editing)
    // ═══════════════════════════════════════════════════════════════════════════

    /** Start AI correction flow with current pending subscription data */
    startAiCorrection: assign(actions.startAiCorrection),

    /** Add user message to AI correction conversation */
    updateAiCorrectionConversation: assign(actions.updateAiCorrectionConversation),

    /** AI has proposed corrections - store for user approval */
    setAiCorrectionProposed: assign(actions.setAiCorrectionProposed),

    /** Apply AI's proposed corrections to pending subscription */
    applyAiCorrection: assign(actions.applyAiCorrection),

    // ═══════════════════════════════════════════════════════════════════════════
    // USER MODE ACTION
    // ═══════════════════════════════════════════════════════════════════════════

    /** Change user's mode (normal/advanced) */
    setUserMode: assign(actions.setUserMode),
  },
}).createMachine({
  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                         THE STATE MACHINE DEFINITION
   * ═══════════════════════════════════════════════════════════════════════════════
   *
   * Here begins the actual state machine - a directed graph where nodes are states
   * and edges are transitions triggered by events.
   *
   * The machine ID identifies this machine in logs and debugging tools.
   */
  id: "userBot",

  /**
   * Every story has a beginning. Ours starts in the "idle" state, where the bot
   * patiently waits for the user to do something.
   */
  initial: "idle",

  /**
   * The context is initialized from input when the actor is created.
   * This allows each user to have their own isolated state machine instance.
   */
  context: ({ input }) => input as BotContext,

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                                 STATES
   * ═══════════════════════════════════════════════════════════════════════════════
   *
   * Each state represents a point in the user's journey. The user can only be
   * in one state at a time. States define which events they respond to and
   * where those events lead.
   */
  states: {
    /**
     * ═════════════════════════════════════════════════════════════════════════════
     *                              STATE: IDLE
     * ═════════════════════════════════════════════════════════════════════════════
     *
     * The resting state. The user isn't doing anything special - just hanging out.
     * From here, they can start various flows:
     *
     *   - Create a new subscription (TEXT_QUERY → clarifying/rating)
     *   - Add groups to monitor (ADDGROUP → addingGroup)
     *   - Edit an existing subscription (EDIT_SUB_* → editing states)
     *   - Change their mode (SET_USER_MODE - stays in idle)
     *
     * Think of this as the main menu of the bot.
     */
    idle: {
      on: {
        /**
         * User sends a text query to create a new subscription.
         *
         * The path depends on user mode:
         * - Advanced users go to clarification questions first
         * - Normal users skip straight to rating examples
         *
         * Note: This is a guarded transition with multiple targets.
         * XState evaluates guards in order and takes the first matching one.
         */
        TEXT_QUERY: [
          { target: "clarifyingQuery", guard: "isAdvancedMode" },
          { target: "ratingExamples" },
        ],

        /**
         * Handler has found example messages and wants to start the rating flow.
         * This is called programmatically after searching for similar messages.
         */
        START_RATING: {
          target: "ratingExamples",
          actions: "startRating",
        },

        /**
         * Handler wants to start clarification flow (advanced mode only).
         * Called programmatically with pre-generated questions.
         */
        START_CLARIFICATION: {
          target: "clarifyingQuery",
          actions: "startClarification",
        },

        /**
         * Keywords have already been generated (e.g., from previous session).
         * Skip directly to confirmation screen.
         */
        KEYWORDS_GENERATED: {
          target: "awaitingConfirmation",
          actions: "setKeywordsGenerated",
        },

        /**
         * User ran /addgroup command.
         * Start the flow for adding new groups to monitor.
         */
        ADDGROUP: { target: "addingGroup" },

        /**
         * User wants to edit positive keywords of an existing subscription.
         * The subscription ID is stored in context for the handler to use.
         */
        EDIT_SUB_POSITIVE: {
          target: "editingSubPositive",
          actions: "setEditingPositive",
        },

        /**
         * User wants to edit negative keywords of an existing subscription.
         */
        EDIT_SUB_NEGATIVE: {
          target: "editingSubNegative",
          actions: "setEditingNegative",
        },

        /**
         * User wants to edit the LLM description of an existing subscription.
         */
        EDIT_SUB_DESCRIPTION: {
          target: "editingSubDescription",
          actions: "setEditingDescription",
        },

        /**
         * User wants AI help to edit an existing subscription.
         * Opens a conversational flow with the AI.
         */
        EDIT_SUB_AI: {
          target: "editingSubAi",
          actions: "setAiEdit",
        },

        /**
         * Admin changed user's mode (normal/advanced).
         * This doesn't change state - just updates context.
         */
        SET_USER_MODE: {
          actions: "setUserMode",
        },
      },
    },

    /**
     * ═════════════════════════════════════════════════════════════════════════════
     *                         STATE: CLARIFYING_QUERY
     * ═════════════════════════════════════════════════════════════════════════════
     *
     * Advanced mode only. The LLM has generated clarification questions to better
     * understand what the user wants. We ask them one by one.
     *
     * Example questions:
     *   - "Do you want B2B or B2C clients?"
     *   - "What price range are you interested in?"
     *   - "Which regions should we focus on?"
     *
     * User can answer or skip each question. Once all questions are handled,
     * we move to rating examples.
     */
    clarifyingQuery: {
      on: {
        /**
         * User answered the current question.
         *
         * If this was the last question (guard passes), we move to rating.
         * Otherwise, we stay here and show the next question.
         *
         * Note: Guard is checked AFTER action runs, so currentIndex is
         * already incremented when we check allQuestionsAnswered.
         */
        ANSWER: [
          {
            target: "ratingExamples",
            guard: "allQuestionsAnswered",
            actions: "assignAnswer",
          },
          {
            target: "clarifyingQuery",
            actions: "assignAnswer",
          },
        ],

        /**
         * User wants to skip this question.
         * Same logic as ANSWER - check if all done, otherwise stay.
         */
        SKIP_QUESTION: [
          {
            target: "ratingExamples",
            guard: "allQuestionsAnswered",
            actions: "skipQuestion",
          },
          {
            target: "clarifyingQuery",
            actions: "skipQuestion",
          },
        ],

        /**
         * User wants to abort the whole process.
         * Clear everything and go back to idle.
         */
        CANCEL: {
          target: "idle",
          actions: "clearContext",
        },
      },
    },

    /**
     * ═════════════════════════════════════════════════════════════════════════════
     *                          STATE: RATING_EXAMPLES
     * ═════════════════════════════════════════════════════════════════════════════
     *
     * The user rates example messages found in monitored groups.
     * This helps the LLM understand what they're looking for.
     *
     * Rating scale:
     *   - HOT: "Yes! This is exactly what I want"
     *   - WARM: "This is close, but not quite"
     *   - COLD: "No, I don't want messages like this"
     *
     * The ratings are used to refine keyword generation.
     */
    ratingExamples: {
      on: {
        /**
         * User rated the current example.
         *
         * If all examples are rated, proceed to confirmation.
         * Otherwise, show the next example.
         */
        RATE: [
          {
            target: "awaitingConfirmation",
            guard: "allExamplesRated",
            actions: "assignRating",
          },
          {
            target: "ratingExamples",
            actions: "assignRating",
          },
        ],

        /**
         * Handler wants to initialize rating with examples.
         * This can happen when we're already in ratingExamples
         * (e.g., after clarification flow auto-transitions here).
         * Just update the context with examples data.
         */
        START_RATING: {
          actions: "startRating",
        },

        /**
         * User doesn't want to rate examples - skip the whole thing.
         * Proceed directly to confirmation.
         */
        SKIP_RATING: {
          target: "awaitingConfirmation",
        },

        /**
         * Keywords generated asynchronously while user was rating.
         * The LLM finished processing in the background - store results
         * and proceed to confirmation.
         */
        KEYWORDS_GENERATED: {
          target: "awaitingConfirmation",
          actions: "setKeywordsGenerated",
        },

        /**
         * User aborts. Clear everything.
         */
        CANCEL: {
          target: "idle",
          actions: "clearContext",
        },
      },
    },

    /**
     * ═════════════════════════════════════════════════════════════════════════════
     *                       STATE: AWAITING_CONFIRMATION
     * ═════════════════════════════════════════════════════════════════════════════
     *
     * The LLM has generated keywords and description. Now we show them to the user
     * and ask for confirmation.
     *
     * The user sees:
     *   - Positive keywords (what to look for)
     *   - Negative keywords (what to exclude)
     *   - LLM description (semantic understanding)
     *
     * From here, user can:
     *   - Confirm and proceed to group selection
     *   - Cancel the whole thing
     *   - Regenerate keywords with fresh LLM call
     *   - Manually add/remove keywords
     *   - Ask AI for help refining keywords
     */
    awaitingConfirmation: {
      on: {
        /**
         * User confirms the keywords are good.
         *
         * If there are groups to select from, go to group selection.
         * Otherwise, save the subscription and return to idle.
         * (Handler takes care of the actual saving)
         */
        CONFIRM: [
          {
            target: "selectingGroups",
            guard: "hasAvailableGroups",
          },
          {
            target: "idle",
            // Subscription saved by handler when no groups to select
          },
        ],

        /**
         * User changed their mind - cancel everything.
         */
        CANCEL: {
          target: "idle",
          actions: "clearContext",
        },

        /**
         * User wants different keywords - regenerate with fresh LLM call.
         * We stay in the same state - handler will call SET_PENDING_SUB
         * with new keywords.
         */
        REGENERATE: {
          target: "awaitingConfirmation",
          // Handler regenerates keywords and sends SET_PENDING_SUB
        },

        /**
         * Manual keyword editing - branch to appropriate sub-flow.
         */
        ADD_POSITIVE: { target: "addingPositive" },
        ADD_NEGATIVE: { target: "addingNegative" },
        REMOVE_POSITIVE: { target: "removingPositive" },
        REMOVE_NEGATIVE: { target: "removingNegative" },

        /**
         * User wants AI help to refine the keywords.
         * Opens a conversational flow where they can describe
         * what they want to change.
         */
        START_AI_CORRECTION: {
          target: "correctingPendingAi",
          actions: "startAiCorrection",
        },

        /**
         * Handler updated the pending subscription (after regenerate).
         * Just update context, stay in same state.
         */
        SET_PENDING_SUB: {
          actions: "setPendingSub",
        },

        /**
         * Handler wants to start group selection with a specific list.
         * Used when programmatically providing available groups.
         */
        START_GROUP_SELECTION: {
          target: "selectingGroups",
          actions: "startGroupSelection",
        },
      },
    },

    /**
     * ═════════════════════════════════════════════════════════════════════════════
     *                       STATE: CORRECTING_PENDING_AI
     * ═════════════════════════════════════════════════════════════════════════════
     *
     * AI-assisted correction during subscription creation.
     *
     * The user has a conversation with the AI:
     *   User: "Add more keywords about discounts"
     *   AI: "Here's my proposal..." (proposes new keywords)
     *   User: "Perfect!" (applies changes)
     *
     * This is different from editingSubAi - this is for NEW subscriptions,
     * not existing ones.
     */
    correctingPendingAi: {
      on: {
        /**
         * User sends a message to the AI.
         * We store it in conversation history for context.
         */
        TEXT_AI_COMMAND: {
          target: "correctingPendingAi",
          actions: "updateAiCorrectionConversation",
        },

        /**
         * AI has processed user's request and proposes changes.
         * We store the proposal for user to review.
         */
        AI_CORRECTION_PROPOSED: {
          target: "correctingPendingAi",
          actions: "setAiCorrectionProposed",
        },

        /**
         * User likes the AI's proposal - apply it to pending subscription.
         * Return to confirmation screen with updated keywords.
         */
        APPLY_AI_CORRECTION: {
          target: "awaitingConfirmation",
          actions: "applyAiCorrection",
        },

        /**
         * User doesn't want AI help anymore.
         * Return to confirmation without applying changes.
         */
        CANCEL: {
          target: "awaitingConfirmation",
        },
      },
    },

    /**
     * ═════════════════════════════════════════════════════════════════════════════
     *                         STATE: ADDING_POSITIVE
     * ═════════════════════════════════════════════════════════════════════════════
     *
     * User is adding new positive keywords to the pending subscription.
     * They type keywords (comma-separated) and we add them to the list.
     *
     * Positive keywords = what messages should contain to match.
     */
    addingPositive: {
      on: {
        /**
         * User typed keywords to add.
         * Add them and return to confirmation.
         */
        TEXT_KEYWORDS: {
          target: "awaitingConfirmation",
          actions: "addPositiveKeywords",
        },

        /**
         * User changed their mind - go back without adding.
         */
        BACK_TO_CONFIRM: { target: "awaitingConfirmation" },
        CANCEL: { target: "awaitingConfirmation" },
      },
    },

    /**
     * ═════════════════════════════════════════════════════════════════════════════
     *                         STATE: ADDING_NEGATIVE
     * ═════════════════════════════════════════════════════════════════════════════
     *
     * User is adding new negative keywords to the pending subscription.
     *
     * Negative keywords = what messages should NOT contain to match.
     * These act as filters to exclude unwanted results.
     */
    addingNegative: {
      on: {
        TEXT_KEYWORDS: {
          target: "awaitingConfirmation",
          actions: "addNegativeKeywords",
        },
        BACK_TO_CONFIRM: { target: "awaitingConfirmation" },
        CANCEL: { target: "awaitingConfirmation" },
      },
    },

    /**
     * ═════════════════════════════════════════════════════════════════════════════
     *                        STATE: REMOVING_POSITIVE
     * ═════════════════════════════════════════════════════════════════════════════
     *
     * User is removing positive keywords one by one.
     * We show them an inline keyboard with all keywords as buttons.
     * Click to remove.
     *
     * This state loops back to itself - user can remove multiple keywords
     * before going back to confirmation.
     */
    removingPositive: {
      on: {
        /**
         * User clicked a keyword to remove.
         * Remove it by index and stay in this state for more removals.
         */
        REMOVE_KEYWORD: {
          target: "removingPositive",
          actions: "removePositiveKeyword",
        },

        /**
         * User is done removing - go back to confirmation.
         */
        BACK_TO_CONFIRM: { target: "awaitingConfirmation" },
        CANCEL: { target: "awaitingConfirmation" },
      },
    },

    /**
     * ═════════════════════════════════════════════════════════════════════════════
     *                        STATE: REMOVING_NEGATIVE
     * ═════════════════════════════════════════════════════════════════════════════
     *
     * Same as removingPositive, but for negative keywords.
     */
    removingNegative: {
      on: {
        REMOVE_KEYWORD: {
          target: "removingNegative",
          actions: "removeNegativeKeyword",
        },
        BACK_TO_CONFIRM: { target: "awaitingConfirmation" },
        CANCEL: { target: "awaitingConfirmation" },
      },
    },

    /**
     * ═════════════════════════════════════════════════════════════════════════════
     *                        STATE: SELECTING_GROUPS
     * ═════════════════════════════════════════════════════════════════════════════
     *
     * User picks which groups to monitor for this subscription.
     * They see a list of available groups with checkboxes (toggle on/off).
     *
     * By default, all groups are selected. User can:
     *   - Toggle individual groups
     *   - Select all / deselect all
     *   - Confirm their selection
     *   - Skip (monitor no specific groups - will use defaults)
     */
    selectingGroups: {
      on: {
        /**
         * Toggle a single group on/off.
         * Stay in state for more toggles.
         */
        TOGGLE_GROUP: {
          target: "selectingGroups",
          actions: "toggleGroup",
        },

        /**
         * Select all available groups at once.
         */
        SELECT_ALL: {
          target: "selectingGroups",
          actions: "selectAllGroups",
        },

        /**
         * Deselect all groups.
         */
        DESELECT_ALL: {
          target: "selectingGroups",
          actions: "deselectAllGroups",
        },

        /**
         * User confirms their group selection.
         * Handler saves the subscription with selected groups.
         */
        CONFIRM_GROUPS: {
          target: "idle",
          // Subscription saved by handler
        },

        /**
         * User wants to skip group selection.
         * Subscription is saved with no specific groups (or defaults).
         */
        SKIP_GROUPS: {
          target: "idle",
          // Subscription saved by handler with empty groups
        },

        /**
         * User cancels the whole subscription creation.
         */
        CANCEL: {
          target: "idle",
          actions: "clearContext",
        },
      },
    },

    /**
     * ═════════════════════════════════════════════════════════════════════════════
     *                          STATE: ADDING_GROUP
     * ═════════════════════════════════════════════════════════════════════════════
     *
     * The /addgroup flow. User wants to add new Telegram groups for monitoring.
     *
     * Flow:
     * 1. User shares a chat via Telegram's chat picker
     * 2. If it's a private group → ask for invite link
     * 3. If it's public → we can join directly
     * 4. Bot attempts to join the group
     * 5. Repeat for more groups, or user says "done"
     *
     * This state handles the "share chat → join" loop.
     */
    addingGroup: {
      on: {
        /**
         * User shared a chat through Telegram's chat picker.
         *
         * If it's a private group that needs an invite link, go ask for it.
         * Otherwise, try to join and stay here for more groups.
         */
        CHAT_SHARED: [
          {
            target: "awaitingInviteLink",
            guard: "needsInviteLink",
            actions: "setChatShared",
          },
          {
            target: "addingGroup",
            actions: "setChatShared",
          },
        ],

        /**
         * Bot successfully joined a group.
         * Add it to the pending list and stay here for more.
         */
        GROUP_JOINED: {
          target: "addingGroup",
          actions: "addJoinedGroup",
        },

        /**
         * User is done adding groups.
         * Clean up and return to idle.
         */
        DONE_ADDING_GROUPS: {
          target: "idle",
          actions: "clearAddingGroups",
        },

        /**
         * User cancels the flow.
         */
        CANCEL: {
          target: "idle",
          actions: "clearAddingGroups",
        },
      },
    },

    /**
     * ═════════════════════════════════════════════════════════════════════════════
     *                      STATE: AWAITING_INVITE_LINK
     * ═════════════════════════════════════════════════════════════════════════════
     *
     * The user shared a private group, and we need an invite link to join.
     *
     * We're waiting for them to either:
     *   - Provide an invite link (t.me/+xyz or t.me/joinchat/xyz)
     *   - Skip this group
     *   - Cancel the whole flow
     */
    awaitingInviteLink: {
      on: {
        /**
         * User provided an invite link.
         * Store it and return to addingGroup for the join attempt.
         */
        INVITE_LINK: {
          target: "addingGroup",
          actions: "setInviteLink",
        },

        /**
         * User doesn't want to share the invite link.
         * Clear the pending group and return to addingGroup.
         */
        SKIP_INVITE: {
          target: "addingGroup",
          actions: "skipInvite",
        },

        /**
         * User cancels the whole flow.
         */
        CANCEL: {
          target: "idle",
          actions: "clearAddingGroups",
        },
      },
    },

    /**
     * ═════════════════════════════════════════════════════════════════════════════
     *                      STATE: EDITING_SUB_POSITIVE
     * ═════════════════════════════════════════════════════════════════════════════
     *
     * User is replacing positive keywords of an EXISTING subscription.
     * (Not creating a new one)
     *
     * They type new keywords, handler updates the database.
     */
    editingSubPositive: {
      on: {
        /**
         * User typed new positive keywords.
         * Handler updates DB, we return to idle.
         */
        TEXT_KEYWORDS: {
          target: "idle",
          actions: "clearEditing",
          // Handler updates DB
        },

        /**
         * User cancels editing.
         */
        CANCEL: {
          target: "idle",
          actions: "clearEditing",
        },
      },
    },

    /**
     * ═════════════════════════════════════════════════════════════════════════════
     *                      STATE: EDITING_SUB_NEGATIVE
     * ═════════════════════════════════════════════════════════════════════════════
     *
     * Same as editingSubPositive, but for negative keywords.
     */
    editingSubNegative: {
      on: {
        TEXT_KEYWORDS: {
          target: "idle",
          actions: "clearEditing",
          // Handler updates DB
        },
        CANCEL: {
          target: "idle",
          actions: "clearEditing",
        },
      },
    },

    /**
     * ═════════════════════════════════════════════════════════════════════════════
     *                     STATE: EDITING_SUB_DESCRIPTION
     * ═════════════════════════════════════════════════════════════════════════════
     *
     * User is editing the LLM description of an existing subscription.
     * This is the semantic description used for zero-shot classification.
     */
    editingSubDescription: {
      on: {
        /**
         * User typed a new description.
         */
        TEXT_DESCRIPTION: {
          target: "idle",
          actions: "clearEditing",
          // Handler updates DB
        },
        CANCEL: {
          target: "idle",
          actions: "clearEditing",
        },
      },
    },

    /**
     * ═════════════════════════════════════════════════════════════════════════════
     *                         STATE: EDITING_SUB_AI
     * ═════════════════════════════════════════════════════════════════════════════
     *
     * AI-assisted editing of an EXISTING subscription.
     *
     * The user has a conversation with AI to refine their subscription:
     *   User: "I'm getting too many results about office rent, exclude those"
     *   AI: "Here's what I suggest..." (proposes changes)
     *   User: "Apply it!" (user clicks apply button)
     *
     * Similar to correctingPendingAi, but for existing subscriptions.
     */
    editingSubAi: {
      on: {
        /**
         * User sends a message to the AI.
         */
        TEXT_AI_COMMAND: {
          target: "editingSubAi",
          actions: "updateAiConversation",
        },

        /**
         * AI proposes changes to the subscription.
         */
        AI_PROPOSED: {
          target: "editingSubAi",
          actions: "setAiProposed",
        },

        /**
         * User approves AI's proposed changes.
         * Handler applies them to the database.
         */
        APPLY_AI_EDIT: {
          target: "idle",
          actions: "clearEditing",
          // Handler applies changes to DB
        },

        /**
         * User cancels without applying.
         */
        CANCEL: {
          target: "idle",
          actions: "clearEditing",
        },
      },
    },
  },
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *                                 EXPORTS
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Export types for use in other parts of the application.
 */

/** The machine type for creating actors */
export type UserMachine = typeof userMachine;

/** The snapshot type for persistence */
export type UserMachineSnapshot = ReturnType<typeof userMachine.getInitialSnapshot>;
