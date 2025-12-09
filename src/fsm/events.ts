/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *                        FSM EVENTS - USER ACTIONS
 *
 *                  Everything a user can do in the bot
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Events are like buttons in a video game. Each event represents something
 * the user did (or something that happened in the system).
 *
 * When an event happens, the state machine decides:
 * 1. Should we respond to this event in the current state?
 * 2. If yes, what state do we move to next?
 * 3. What data do we need to save?
 *
 * Example:
 *   User clicks "Confirm" button → CONFIRM event fires
 *   State machine: "We're in awaitingConfirmation, CONFIRM moves us to selectingGroups"
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import type { ExampleRating, PendingGroup, UserMode } from "../types";
import type {
  GroupData,
  PendingSubscription,
  AiEditData,
  AiCorrectionData,
  RatingExamplesData,
  ClarificationData,
  PendingOperation,
} from "./context";

/**
 * All possible events that can happen in the bot.
 *
 * Each event has a `type` (the event name) and optional payload data.
 * The type is used to match the event to transitions in the state machine.
 */
export type BotEvent =
  // ═══════════════════════════════════════════════════════════════════════════
  //                    SUBSCRIPTION CREATION EVENTS
  //
  //        These events drive the main subscription creation flow
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * User typed a search query to create a new subscription.
   *
   * Example: User types "Ищу клиентов на ремонт квартир в Москве"
   *
   * This kicks off the whole subscription creation flow:
   * - For normal users: straight to rating examples
   * - For advanced users: clarification questions first
   */
  | { type: "TEXT_QUERY"; text: string }

  /**
   * System found example messages and wants to show them for rating.
   *
   * Called by the bot handler after searching groups for similar messages.
   * The examples are shown to the user one by one for hot/warm/cold rating.
   *
   * pendingSub is optional - if provided, it's stored in context along with examples.
   * This allows startRatingFlow to send a single event instead of
   * KEYWORDS_GENERATED followed by START_RATING.
   */
  | { type: "START_RATING"; examples: RatingExamplesData; pendingSub?: PendingSubscription }

  /**
   * User rated an example message.
   *
   * Ratings help the AI understand what the user actually wants:
   * - "hot" = exactly what I'm looking for
   * - "warm" = kind of relevant
   * - "cold" = not what I want
   */
  | { type: "RATE"; messageId: number; rating: ExampleRating }

  /**
   * User wants to skip rating examples.
   *
   * Some users don't want to rate - they just want to see the keywords.
   * We proceed directly to showing generated keywords.
   */
  | { type: "SKIP_RATING" }

  /**
   * AI finished generating keywords for the subscription.
   *
   * This can happen:
   * - After rating examples
   * - After clarification questions
   * - When restoring a saved session
   *
   * Contains all the generated data: keywords + description.
   */
  | { type: "KEYWORDS_GENERATED"; pendingSub: PendingSubscription }

  /**
   * User confirms the generated keywords are good.
   *
   * "Yes, these keywords look right, let's proceed!"
   * Next step depends on whether there are groups to select.
   */
  | { type: "CONFIRM" }

  /**
   * User wants to cancel the current operation.
   *
   * This is the universal "abort" button. Works in almost every state.
   * Clears any pending data and returns to idle.
   */
  | { type: "CANCEL" }

  /**
   * User wants to regenerate keywords with a fresh AI call.
   *
   * "I don't like these keywords, give me different ones!"
   * The handler makes a new AI call and sends SET_PENDING_SUB with results.
   */
  | { type: "REGENERATE" }

  // ═══════════════════════════════════════════════════════════════════════════
  //                     CLARIFICATION FLOW EVENTS
  //
  //                For advanced users: follow-up questions
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * System wants to start asking clarification questions.
   *
   * Used in advanced mode to get more context from the user.
   * Contains pre-generated questions from the AI.
   */
  | { type: "START_CLARIFICATION"; data: ClarificationData }

  /**
   * User answered a clarification question.
   *
   * The answer is stored and we move to the next question
   * (or to rating examples if this was the last question).
   */
  | { type: "ANSWER"; text: string }

  /**
   * User wants to skip the current clarification question.
   *
   * "I don't want to answer this one, ask me the next question"
   * We store an empty answer and move on.
   */
  | { type: "SKIP_QUESTION" }

  // ═══════════════════════════════════════════════════════════════════════════
  //                   KEYWORD EDITING EVENTS
  //
  //              Manual editing of keywords during confirmation
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * User wants to add positive keywords.
   *
   * Opens the "add positive keywords" input mode.
   */
  | { type: "ADD_POSITIVE" }

  /**
   * User wants to add negative keywords.
   *
   * Opens the "add negative keywords" input mode.
   */
  | { type: "ADD_NEGATIVE" }

  /**
   * User wants to remove positive keywords.
   *
   * Shows a keyboard with all positive keywords to remove.
   */
  | { type: "REMOVE_POSITIVE" }

  /**
   * User wants to remove negative keywords.
   *
   * Shows a keyboard with all negative keywords to remove.
   */
  | { type: "REMOVE_NEGATIVE" }

  /**
   * User typed new keywords to add.
   *
   * Can be comma-separated: "квартира, дом, аренда"
   * Used in both addingPositive and addingNegative states.
   */
  | { type: "TEXT_KEYWORDS"; keywords: string[] }

  /**
   * User clicked a keyword to remove it.
   *
   * Identified by index (0-based) in the keywords array.
   * Used in both removingPositive and removingNegative states.
   */
  | { type: "REMOVE_KEYWORD"; index: number }

  /**
   * User wants to go back to the confirmation screen.
   *
   * Used from keyword editing states to return without making changes.
   */
  | { type: "BACK_TO_CONFIRM" }

  // ═══════════════════════════════════════════════════════════════════════════
  //                      GROUP SELECTION EVENTS
  //
  //                  Choosing which groups to monitor
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * System wants to start group selection with a list of available groups.
   *
   * Called by handler with the user's monitored groups.
   * All groups are pre-selected by default.
   */
  | { type: "START_GROUP_SELECTION"; available: GroupData[] }

  /**
   * User clicked a group to toggle its selection.
   *
   * If selected → deselect it
   * If not selected → select it
   */
  | { type: "TOGGLE_GROUP"; groupId: number }

  /**
   * User wants to select ALL available groups.
   *
   * Quick action: "Monitor this subscription in all my groups"
   */
  | { type: "SELECT_ALL" }

  /**
   * User wants to deselect ALL groups.
   *
   * Quick action to start fresh with selections.
   */
  | { type: "DESELECT_ALL" }

  /**
   * User confirms their group selection.
   *
   * "These are the groups I want to monitor, save the subscription!"
   */
  | { type: "CONFIRM_GROUPS" }

  /**
   * User wants to skip group selection.
   *
   * "I don't want to limit by groups, use defaults"
   */
  | { type: "SKIP_GROUPS" }

  // ═══════════════════════════════════════════════════════════════════════════
  //                     ADDING GROUPS EVENTS
  //
  //                    The /addgroup command flow
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * User ran the /addgroup command.
   *
   * Starts the flow for adding new Telegram groups to monitor.
   */
  | { type: "ADDGROUP" }

  /**
   * User shared a chat through Telegram's chat picker.
   *
   * Contains info about the shared group - whether we can join it
   * directly or need an invite link.
   */
  | { type: "CHAT_SHARED"; group: PendingGroup }

  /**
   * User provided an invite link for a private group.
   *
   * We'll use this link to join the group.
   * Format: t.me/+xyz or t.me/joinchat/xyz
   */
  | { type: "INVITE_LINK"; link: string }

  /**
   * User wants to skip providing an invite link.
   *
   * "I don't want to share the invite link, skip this group"
   */
  | { type: "SKIP_INVITE" }

  /**
   * Bot successfully joined a group.
   *
   * Called by handler after the join attempt succeeds.
   * The group is added to the monitoring list.
   */
  | { type: "GROUP_JOINED"; group: PendingGroup }

  /**
   * User is done adding groups.
   *
   * "I've added all the groups I want, finish this flow"
   */
  | { type: "DONE_ADDING_GROUPS" }

  // ═══════════════════════════════════════════════════════════════════════════
  //                  EDITING EXISTING SUBSCRIPTION EVENTS
  //
  //                 Modifying subscriptions after creation
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * User wants to edit positive keywords of an existing subscription.
   *
   * Opens text input for new positive keywords.
   */
  | { type: "EDIT_SUB_POSITIVE"; subscriptionId: number }

  /**
   * User wants to edit negative keywords of an existing subscription.
   *
   * Opens text input for new negative keywords.
   */
  | { type: "EDIT_SUB_NEGATIVE"; subscriptionId: number }

  /**
   * User wants to edit the description of an existing subscription.
   *
   * Opens text input for the new AI description.
   */
  | { type: "EDIT_SUB_DESCRIPTION"; subscriptionId: number }

  /**
   * User wants AI help to edit an existing subscription.
   *
   * Opens conversational AI editing mode.
   * Contains current subscription data for context.
   */
  | { type: "EDIT_SUB_AI"; data: AiEditData }

  /**
   * User typed a new description for the subscription.
   *
   * Used in editingSubDescription state.
   */
  | { type: "TEXT_DESCRIPTION"; text: string }

  /**
   * User sent a message to the AI during editing.
   *
   * Example: "Add 'ремонт' to positive keywords"
   * The AI will process this and propose changes.
   */
  | { type: "TEXT_AI_COMMAND"; text: string }

  /**
   * AI has proposed changes to the subscription.
   *
   * Shows the user what AI wants to change.
   * User can approve or continue the conversation.
   */
  | { type: "AI_PROPOSED"; proposed: AiEditData["proposed"] }

  /**
   * User approves AI's proposed changes for existing subscription.
   *
   * "Apply these changes to my subscription!"
   * Handler will update the database.
   */
  | { type: "APPLY_AI_EDIT" }

  // ═══════════════════════════════════════════════════════════════════════════
  //                AI CORRECTION EVENTS (DURING CREATION)
  //
  //                  AI help while creating new subscription
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * User wants AI help to refine the pending subscription.
   *
   * Different from EDIT_SUB_AI - this is for NEW subscriptions,
   * not yet saved to the database.
   */
  | { type: "START_AI_CORRECTION"; data: AiCorrectionData }

  /**
   * AI proposed corrections for the pending subscription.
   *
   * Shows user the suggested changes to keywords/description.
   */
  | { type: "AI_CORRECTION_PROPOSED"; proposed: AiCorrectionData["proposed"] }

  /**
   * User approves AI's corrections for pending subscription.
   *
   * The corrections are applied to pendingSub and we return
   * to the confirmation screen with updated data.
   */
  | { type: "APPLY_AI_CORRECTION" }

  // ═══════════════════════════════════════════════════════════════════════════
  //                       INTERNAL/SYSTEM EVENTS
  //
  //                   Events triggered by the system, not user
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Admin changed the user's mode.
   *
   * - "normal": Simplified UX
   * - "advanced": Full control with clarification questions
   */
  | { type: "SET_USER_MODE"; mode: UserMode }

  /**
   * Handler wants to update the pending subscription.
   *
   * Used after regeneration completes - updates the displayed keywords.
   */
  | { type: "SET_PENDING_SUB"; pendingSub: PendingSubscription }

  /**
   * Handler wants to update draft keywords.
   *
   * Used during intermediate processing before finalization.
   */
  | { type: "UPDATE_DRAFT_KEYWORDS"; keywords: string[] }

  // ═══════════════════════════════════════════════════════════════════════════
  //                       OPERATION RECOVERY EVENTS
  //
  //                  Track long-running operations for recovery
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Mark that a long-running operation (LLM call) has started.
   *
   * This is persisted to the database, so if the bot restarts mid-operation,
   * we can recover and retry the operation.
   */
  | { type: "START_OPERATION"; operation: PendingOperation }

  /**
   * Clear the pending operation marker.
   *
   * Called after an operation completes (success or failure).
   */
  | { type: "CLEAR_OPERATION" }

  /**
   * Save the original query before starting analysis.
   *
   * This allows recovery to retry the analysis if bot restarts mid-operation.
   */
  | { type: "SAVE_QUERY"; query: string };
