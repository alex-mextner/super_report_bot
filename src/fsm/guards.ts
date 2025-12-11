/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *                        FSM GUARDS - DECISION MAKERS
 *
 *                   "Should we go left or right at this fork?"
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Guards are the "if-then" logic of the state machine. They answer yes/no
 * questions that help decide which path to take.
 *
 * Imagine you're at a crossroads and there's a guard asking questions:
 *   - "Are you an advanced user?" → Yes? Go ask clarification questions first.
 *   - "Do you have groups to select?" → No? Skip group selection entirely.
 *   - "All examples rated?" → Yes? Move to confirmation screen.
 *
 * Guards never change anything - they only observe and answer.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import type { BotContext } from "./context";
import type { BotEvent } from "./events";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *                           USER MODE CHECK
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Is this user in "advanced" mode?
 *
 * Normal users get a streamlined experience:
 * - Skip clarification questions
 * - Simplified keyword editing
 *
 * Advanced users get full control:
 * - Clarification questions before keyword generation
 * - Can edit individual keywords
 * - More detailed AI interactions
 *
 * Business decision: Most users want simplicity, power users want control.
 */
export function isAdvancedMode({ context }: { context: BotContext }): boolean {
  return context.userMode === "advanced";
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *                         GROUP AVAILABILITY CHECK
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Does this user have any groups we can monitor?
 *
 * If yes → Show group selection screen after confirmation
 * If no  → Skip group selection, save subscription immediately
 *
 * Business decision: Don't waste user's time on an empty selection screen.
 * If they have no groups, they need to add some first (/addgroup command).
 */
export function hasAvailableGroups({ context }: { context: BotContext }): boolean {
  return context.availableGroups.length > 0;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *                      RATING PROGRESS CHECK
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Has the user finished rating all example messages?
 *
 * We show users 3-5 example messages and ask "Is this what you want?"
 * This guard checks if they've rated the last one.
 *
 * If yes → Move to keyword confirmation screen
 * If no  → Show the next example to rate
 *
 * Business decision: Each rating improves AI understanding. We want them
 * to rate all examples, but don't force them (there's a skip button too).
 */
export function allExamplesRated({ context }: { context: BotContext }): boolean {
  // No examples? Consider it "done"
  if (!context.ratingExamples) return true;

  // Check if AFTER this rating all examples will be rated
  // We use +1 because guard runs BEFORE action increments currentIndex
  return context.ratingExamples.currentIndex + 1 >= context.ratingExamples.messages.length;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *                    CLARIFICATION PROGRESS CHECK
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Has the user answered (or skipped) all clarification questions?
 *
 * Advanced mode flow:
 * 1. User enters query
 * 2. AI generates 2-3 clarification questions
 * 3. User answers each one (or skips)
 * 4. Once all done → proceed to rating examples
 *
 * If yes → Move to rating examples
 * If no  → Ask the next question
 *
 * Business decision: More context = better keywords. But respect user's time -
 * they can skip questions they don't want to answer.
 */
export function allQuestionsAnswered({ context }: { context: BotContext }): boolean {
  // No clarification data? Consider it "done"
  if (!context.clarification) return true;

  // Check if AFTER this answer all questions will be answered
  // We use +1 because guard runs BEFORE action increments currentIndex
  return context.clarification.currentIndex + 1 >= context.clarification.questions.length;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *                      INVITE LINK NEEDED CHECK
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Does the group the user just shared require an invite link?
 *
 * Telegram groups can be:
 * - Public: Anyone can join via @username
 * - Private: Need an invite link (t.me/+xxx)
 *
 * For public groups, we can join immediately.
 * For private groups, we need to ask the user for the invite link.
 *
 * If yes → Show "Please send invite link" prompt
 * If no  → Proceed with joining the group
 *
 * Business decision: We need to be in the group to monitor messages.
 * Private groups require special handling.
 */
export function needsInviteLink({
  context,
  event,
}: {
  context: BotContext;
  event?: BotEvent;
}): boolean {
  // Check if the shared group needs an invite link
  // We check the EVENT because guard runs BEFORE action sets currentPendingGroup
  if (event?.type === "CHAT_SHARED") {
    return event.group.needsInviteLink;
  }
  // Fallback to context for other events (or when called without event in tests)
  return context.currentPendingGroup?.needsInviteLink ?? false;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *                    PENDING SUBSCRIPTION CHECK
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Do we have a subscription currently being created?
 *
 * This is a safety check to ensure we don't lose data.
 * The pending subscription holds all the work-in-progress data:
 * - Original query
 * - Generated keywords
 * - LLM description
 *
 * If yes → We can proceed with confirmation/editing
 * If no  → Something went wrong, may need to restart
 *
 * Business decision: Never lose user's work. If pending data exists,
 * protect it until explicitly confirmed or cancelled.
 */
export function hasPendingSub({ context }: { context: BotContext }): boolean {
  return context.pendingSub !== null;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *                   POSITIVE KEYWORDS EXISTENCE CHECK
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Does the pending subscription have any positive keywords?
 *
 * Used when user wants to remove positive keywords.
 * Can't remove from an empty list!
 *
 * If yes → Show removal keyboard with keywords
 * If no  → Nothing to remove, disable the button or skip
 *
 * Business decision: Don't show confusing empty removal screens.
 */
export function hasPositiveKeywords({ context }: { context: BotContext }): boolean {
  return (context.pendingSub?.positiveKeywords.length ?? 0) > 0;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *                   NEGATIVE KEYWORDS EXISTENCE CHECK
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Does the pending subscription have any negative keywords?
 *
 * Same logic as positive keywords - can't remove what doesn't exist.
 *
 * Negative keywords are used to filter OUT unwanted messages.
 * Example: If looking for "sellers", negative keywords might include "куплю", "ищу"
 */
export function hasNegativeKeywords({ context }: { context: BotContext }): boolean {
  return (context.pendingSub?.negativeKeywords.length ?? 0) > 0;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *                    AI EDIT PROPOSAL CHECK
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Has the AI proposed changes during subscription editing?
 *
 * When user asks AI for help editing their subscription:
 * 1. User: "Remove office rental keywords"
 * 2. AI: "Here's my proposal: [shows changes]" → proposed = {...}
 * 3. User can then approve or continue chatting
 *
 * If yes → "Apply" button becomes active
 * If no  → User needs to chat more before they can apply
 *
 * Business decision: Only let users apply changes when AI has actually
 * proposed something. Prevents accidental empty updates.
 */
export function hasProposedAiEdit({ context }: { context: BotContext }): boolean {
  return context.pendingAiEdit?.proposed !== undefined;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *                  AI CORRECTION PROPOSAL CHECK
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Has the AI proposed corrections for a subscription being created?
 *
 * Same concept as hasProposedAiEdit, but for NEW subscriptions
 * (during creation, before saving to database).
 *
 * User sees generated keywords, doesn't like them, asks AI for help:
 * 1. User: "Add more synonyms"
 * 2. AI: "Here's my proposal..." → proposed = {...}
 * 3. User approves → changes applied to pending subscription
 *
 * If yes → "Apply corrections" button becomes active
 * If no  → Keep chatting with AI
 */
export function hasProposedAiCorrection({ context }: { context: BotContext }): boolean {
  return context.pendingAiCorrection?.proposed !== undefined;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *                    SELECTED GROUPS CHECK
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Has the user selected at least one group?
 *
 * When creating a subscription, users pick which groups to monitor.
 * A subscription without groups is useless - there's nothing to monitor!
 *
 * If yes → Subscription can be saved with selected groups
 * If no  → May want to warn user or use defaults
 *
 * Business decision: Technically we allow 0 groups (subscription applies
 * to all groups), but this check helps validate user intent.
 */
export function hasSelectedGroups({ context }: { context: BotContext }): boolean {
  return context.selectedGroups.length > 0;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *                  METADATA COLLECTION GUARDS
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Is the current metadata step the last one (currency)?
 *
 * After currency step:
 * - If queue is empty → return to addingGroup state
 * - If queue has more → process next group
 *
 * Used to decide whether METADATA_SKIP/METADATA_TEXT should
 * finish the current group's metadata collection.
 */
export function isLastMetadataStep({ context }: { context: BotContext }): boolean {
  return context.pendingGroupMetadata?.step === "currency";
}

/**
 * Does the metadata queue have more groups to process?
 *
 * After finishing one group's metadata:
 * - If more groups → start next group's metadata
 * - If empty → return to addingGroup
 */
export function hasMoreGroupsInQueue({ context }: { context: BotContext }): boolean {
  return (context.metadataQueue?.groups.length ?? 0) > 1;
}

/**
 * Combined guard: is this the last metadata step AND are there more groups in queue?
 *
 * Used to determine if we should process the next group from queue.
 */
export function isLastStepWithMoreGroups({ context }: { context: BotContext }): boolean {
  return isLastMetadataStep({ context }) && hasMoreGroupsInQueue({ context });
}
