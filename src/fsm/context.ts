/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *                           FSM CONTEXT - THE BOT'S MEMORY
 *
 *                    What the bot remembers during a conversation
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Imagine the bot has a notepad. Every time a user interacts with it, the bot
 * writes down important things on this notepad so it doesn't forget what
 * they were doing.
 *
 * This file defines the structure of that notepad - what can be written on it.
 *
 * Without this memory, the bot would forget everything between messages.
 * "What subscription were we creating? What groups did you want? No idea!"
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import type { UserMode, ExampleRating, PendingGroup } from "../types";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *                          PENDING OPERATION
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Tracks long-running async operations (LLM calls) that could be interrupted
 * by a bot restart. When the bot restarts, it checks for pending operations
 * and resumes them automatically.
 *
 * Example: User sends a query, bot shows "Generating keywords...", then crashes.
 * On restart, bot sees pendingOperation and retries the keyword generation.
 */
export type PendingOperationType =
  | "GENERATE_KEYWORDS"
  | "GENERATE_QUESTIONS"
  | "AI_CORRECT"
  | "AI_EDIT"
  | "GENERATE_EXAMPLES";

export interface PendingOperation {
  /** What type of operation was interrupted */
  type: PendingOperationType;

  /** When the operation started (timestamp) */
  startedAt: number;

  /** Message ID to edit with progress/result (the "Generating..." message) */
  messageId?: number;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *                          PENDING SUBSCRIPTION
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * When a user is creating a new subscription, we need to remember:
 *
 * - What they originally asked for (their query)
 * - What keywords we generated to find matching messages
 * - What keywords should exclude messages
 * - A description for the AI to understand semantically
 *
 * Example:
 *   User says: "I want to find people selling iPhones in Moscow"
 *
 *   We remember:
 *     originalQuery: "I want to find people selling iPhones in Moscow"
 *     positiveKeywords: ["iPhone", "продам", "Москва", "телефон"]
 *     negativeKeywords: ["куплю", "ищу", "нужен"]
 *     llmDescription: "Messages from people selling Apple iPhones in Moscow"
 */
export interface PendingSubscription {
  /** The original text the user typed when creating the subscription */
  originalQuery: string;

  /**
   * Keywords that SHOULD appear in matching messages.
   * More matches = higher relevance score.
   */
  positiveKeywords: string[];

  /**
   * Keywords that should NOT appear in matching messages.
   * If a message contains these, it's filtered out.
   * Example: "куплю" when user wants sellers, not buyers.
   */
  negativeKeywords: string[];

  /**
   * A human-readable description for semantic matching.
   * The AI uses this to understand intent, not just keywords.
   * Example: "Posts about selling used Apple devices in Russian cities"
   */
  llmDescription: string;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *                        CLARIFICATION QUESTIONS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * For advanced users, we ask follow-up questions to better understand
 * what they're looking for.
 *
 * Example flow:
 *   User: "Find me clients"
 *   Bot: "What type of clients - B2B or B2C?"
 *   User: "B2B"
 *   Bot: "What industry?"
 *   User: "IT"
 *   (now we have better context for keyword generation)
 *
 * We store the conversation here so we don't lose track of where we are.
 */
export interface ClarificationData {
  /** The user's original search query */
  originalQuery: string;

  /** List of questions the AI generated to clarify the request */
  questions: string[];

  /** User's answers (parallel array - answer[0] is for question[0]) */
  answers: string[];

  /** Which question we're currently asking (0-indexed) */
  currentIndex: number;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *                         RATING EXAMPLES FLOW
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * To help generate better keywords, we show users example messages
 * from their groups and ask: "Is this what you want?"
 *
 * Rating scale:
 *   - HOT: "Yes! Find me more like this"
 *   - WARM: "Kind of, but not exactly"
 *   - COLD: "No, I don't want messages like this"
 *
 * This helps the AI understand the user's intent better than
 * just their text description.
 */
export interface RatingExamplesData {
  /**
   * Example messages to show the user.
   * Can be real messages from groups or AI-generated examples.
   */
  messages: Array<{
    /** Unique identifier for this example */
    id: number;

    /** The message text to display */
    text: string;

    /** Which Telegram group this came from */
    groupId: number;

    /** Human-readable group name */
    groupTitle: string;

    /**
     * Was this generated by AI or found in real groups?
     * Generated = we couldn't find good real examples
     */
    isGenerated: boolean;

    /**
     * Was this message soft-deleted in the original group?
     * Shown with "(удалено)" label but still useful for ratings
     */
    isDeleted?: boolean;
  }>;

  /**
   * User's ratings for each example they've seen so far.
   * Grows as they rate more examples.
   */
  ratings: Array<{
    /** Which message was rated */
    messageId: number;

    /** The text that was rated (for reference) */
    text: string;

    /** How relevant is this message: hot/warm/cold */
    rating: ExampleRating;
  }>;

  /** Which example we're currently showing (0-indexed) */
  currentIndex: number;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *                      AI-ASSISTED SUBSCRIPTION EDITING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Users can ask AI to help modify their existing subscription.
 * It's like having a conversation with a helpful assistant:
 *
 *   User: "I'm getting too many results about office rentals, remove those"
 *   AI: "Got it! I'll add 'аренда офиса' to negative keywords. Here's
 *        my proposal: [shows updated keywords]"
 *   User: "Perfect, apply it!"
 *
 * We store the conversation and proposed changes here.
 */
export interface AiEditData {
  /** Which subscription is being edited */
  subscriptionId: number;

  /**
   * The current state of the subscription BEFORE any AI changes.
   * This is our "backup" in case user cancels.
   */
  current: {
    positiveKeywords: string[];
    negativeKeywords: string[];
    llmDescription: string;
  };

  /**
   * What the AI is suggesting as changes.
   * Undefined until AI makes its first proposal.
   */
  proposed?: {
    positiveKeywords: string[];
    negativeKeywords: string[];
    llmDescription: string;
  };

  /**
   * The full conversation history between user and AI.
   * This gives the AI context for follow-up requests.
   *
   * Example:
   *   [
   *     { role: "user", content: "Remove office rental results" },
   *     { role: "assistant", content: "I'll add negative keywords..." },
   *     { role: "user", content: "Also add more about IT companies" },
   *   ]
   */
  conversation: Array<{ role: "user" | "assistant"; content: string }>;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *                   AI CORRECTION DURING SUBSCRIPTION CREATION
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Similar to AiEditData, but used during NEW subscription creation
 * (before it's saved to the database).
 *
 * The user sees the generated keywords, doesn't like them, and asks
 * AI for help: "Add more synonyms for 'apartment'" or "The negative
 * keywords are too aggressive, tone them down"
 */
export interface AiCorrectionData {
  /**
   * User's mode affects what AI can change:
   * - "normal": AI can only edit description
   * - "advanced": AI can edit everything (keywords + description)
   */
  mode: UserMode;

  /** Current pending subscription data (before AI changes) */
  current: {
    positiveKeywords: string[];
    negativeKeywords: string[];
    llmDescription: string;
  };

  /** AI's proposed changes (undefined until first proposal) */
  proposed?: {
    positiveKeywords: string[];
    negativeKeywords: string[];
    llmDescription: string;
  };

  /** Conversation history with the AI */
  conversation: Array<{ role: "user" | "assistant"; content: string }>;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *                              GROUP DATA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Information about a Telegram group the user can monitor.
 *
 * Users can select which groups to monitor for each subscription.
 * Not all subscriptions need all groups - maybe you only want
 * "iPhone sales" notifications from specific buying/selling groups.
 */
export interface GroupData {
  /** Telegram's internal group ID */
  id: number;

  /** Human-readable group name */
  title: string;

  /**
   * Is this a Telegram channel (vs a regular group)?
   * Channels work slightly differently - they're broadcast-only.
   */
  isChannel?: boolean;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *                        THE MAIN CONTEXT OBJECT
 *
 *                   Everything the bot remembers about a user
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This is the "notepad" we mentioned at the top. Every user has their own
 * notepad, stored in the database and loaded when they send a message.
 *
 * When the user types something, we:
 * 1. Load their context from the database
 * 2. Figure out what state they're in (idle? creating subscription?)
 * 3. Process their message based on the state
 * 4. Update context with any changes
 * 5. Save it back to the database
 *
 * If the user comes back tomorrow, we still remember where they left off.
 */
export interface BotContext {
  // ═══════════════════════════════════════════════════════════════════════════
  //                            USER IDENTITY
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Telegram user ID - the unique identifier for this user.
   * Never changes for a given account.
   */
  telegramId: number;

  /**
   * User's experience level mode:
   * - "normal": Simplified flow, fewer questions
   * - "advanced": Full control, clarification questions, more options
   *
   * Admins can change this for users.
   */
  userMode: UserMode;

  // ═══════════════════════════════════════════════════════════════════════════
  //                     SUBSCRIPTION CREATION FLOW
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * The subscription currently being created (not yet saved).
   * Null when user isn't creating a subscription.
   */
  pendingSub: PendingSubscription | null;

  /**
   * Clarification questions flow data (advanced mode only).
   * Null when not asking clarification questions.
   */
  clarification: ClarificationData | null;

  /**
   * Rating examples flow data.
   * Null when not rating examples.
   */
  ratingExamples: RatingExamplesData | null;

  /**
   * Draft keywords being worked on before finalizing.
   * Used for intermediate states during keyword refinement.
   */
  draftKeywords: string[] | null;

  // ═══════════════════════════════════════════════════════════════════════════
  //                          GROUP SELECTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Groups the user CAN choose from.
   * Populated when entering group selection screen.
   */
  availableGroups: GroupData[];

  /**
   * Groups the user HAS selected for their subscription.
   * Starts as all groups selected, user can toggle.
   */
  selectedGroups: GroupData[];

  // ═══════════════════════════════════════════════════════════════════════════
  //                       ADDING NEW GROUPS FLOW
  //                      (the /addgroup command)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Groups the user has shared that we're processing.
   * The bot needs to join these groups to monitor them.
   */
  pendingGroups: PendingGroup[];

  /**
   * A single group that needs special handling (invite link required).
   * Set when user shares a private group we can't auto-join.
   */
  currentPendingGroup: PendingGroup | null;

  // ═══════════════════════════════════════════════════════════════════════════
  //                    EDITING EXISTING SUBSCRIPTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Which existing subscription is being edited.
   * Null when not editing anything.
   */
  editingSubscriptionId: number | null;

  /**
   * AI-assisted editing session data.
   * Null when not using AI editing.
   */
  pendingAiEdit: AiEditData | null;

  // ═══════════════════════════════════════════════════════════════════════════
  //                    AI CORRECTION DURING CREATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * AI correction session for a subscription being created.
   * Different from pendingAiEdit - this is BEFORE saving to DB.
   */
  pendingAiCorrection: AiCorrectionData | null;

  // ═══════════════════════════════════════════════════════════════════════════
  //                    PENDING QUERY (for addgroup-first flow)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * User's query saved when they try to create subscription without groups.
   * After adding groups via /addgroup flow, this query will be processed.
   */
  pendingQuery: string | null;

  // ═══════════════════════════════════════════════════════════════════════════
  //                    OPERATION RECOVERY
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Tracks an in-progress async operation (LLM call) for recovery on restart.
   * Set before starting a long operation, cleared after completion.
   */
  pendingOperation: PendingOperation | null;

  // ═══════════════════════════════════════════════════════════════════════════
  //                    DELETION FEEDBACK COLLECTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Subscription being deleted, waiting for feedback.
   * After user clicks "Delete", we ask for feedback before returning to idle.
   */
  feedbackSubscriptionId: number | null;

  /**
   * Original query of the subscription being deleted.
   * Stored for admin notification.
   */
  feedbackSubscriptionQuery: string | null;

  /**
   * User's answer to "Did you manage to buy?" question.
   */
  feedbackOutcome: "bought" | "not_bought" | "complicated" | null;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *                           FACTORY FUNCTION
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Creates a fresh, empty context for a new user.
 *
 * Called when:
 * - A user interacts with the bot for the first time
 * - We need to reset a user's state (they got stuck, want to start over)
 *
 * Everything starts as null/empty - the "blank notepad".
 */
export function createInitialContext(
  telegramId: number,
  userMode: UserMode = "normal"
): BotContext {
  return {
    // User identity
    telegramId,
    userMode,

    // Subscription creation - nothing pending
    pendingSub: null,
    clarification: null,
    ratingExamples: null,
    draftKeywords: null,

    // Group selection - no groups yet
    availableGroups: [],
    selectedGroups: [],

    // Adding groups - nothing pending
    pendingGroups: [],
    currentPendingGroup: null,

    // Editing - not editing anything
    editingSubscriptionId: null,
    pendingAiEdit: null,

    // AI correction - no session
    pendingAiCorrection: null,

    // Pending query - no saved query
    pendingQuery: null,

    // Operation recovery - no pending operation
    pendingOperation: null,

    // Deletion feedback - nothing pending
    feedbackSubscriptionId: null,
    feedbackSubscriptionQuery: null,
    feedbackOutcome: null,
  };
}
