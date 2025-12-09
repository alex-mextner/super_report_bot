import type { ExampleRating, PendingGroup, UserMode } from "../types";
import type { GroupData, PendingSubscription, AiEditData, AiCorrectionData, RatingExamplesData, ClarificationData } from "./context";

// All possible events for the FSM
export type BotEvent =
  // === Subscription creation ===
  | { type: "TEXT_QUERY"; text: string }
  | { type: "START_RATING"; examples: RatingExamplesData }
  | { type: "RATE"; messageId: number; rating: ExampleRating }
  | { type: "SKIP_RATING" }
  | { type: "KEYWORDS_GENERATED"; pendingSub: PendingSubscription }
  | { type: "CONFIRM" }
  | { type: "CANCEL" }
  | { type: "REGENERATE" }

  // === Clarification flow ===
  | { type: "START_CLARIFICATION"; data: ClarificationData }
  | { type: "ANSWER"; text: string }
  | { type: "SKIP_QUESTION" }

  // === Keyword editing during confirmation ===
  | { type: "ADD_POSITIVE" }
  | { type: "ADD_NEGATIVE" }
  | { type: "REMOVE_POSITIVE" }
  | { type: "REMOVE_NEGATIVE" }
  | { type: "TEXT_KEYWORDS"; keywords: string[] }
  | { type: "REMOVE_KEYWORD"; index: number }
  | { type: "BACK_TO_CONFIRM" }

  // === Group selection ===
  | { type: "START_GROUP_SELECTION"; available: GroupData[] }
  | { type: "TOGGLE_GROUP"; groupId: number }
  | { type: "SELECT_ALL" }
  | { type: "DESELECT_ALL" }
  | { type: "CONFIRM_GROUPS" }
  | { type: "SKIP_GROUPS" }

  // === Adding groups (/addgroup) ===
  | { type: "ADDGROUP" }
  | { type: "CHAT_SHARED"; group: PendingGroup }
  | { type: "INVITE_LINK"; link: string }
  | { type: "SKIP_INVITE" }
  | { type: "GROUP_JOINED"; group: PendingGroup }
  | { type: "DONE_ADDING_GROUPS" }

  // === Editing existing subscription ===
  | { type: "EDIT_SUB_POSITIVE"; subscriptionId: number }
  | { type: "EDIT_SUB_NEGATIVE"; subscriptionId: number }
  | { type: "EDIT_SUB_DESCRIPTION"; subscriptionId: number }
  | { type: "EDIT_SUB_AI"; data: AiEditData }
  | { type: "TEXT_DESCRIPTION"; text: string }
  | { type: "TEXT_AI_COMMAND"; text: string }
  | { type: "AI_PROPOSED"; proposed: AiEditData["proposed"] }
  | { type: "APPLY_AI_EDIT" }

  // === AI correction for pending subscription ===
  | { type: "START_AI_CORRECTION"; data: AiCorrectionData }
  | { type: "AI_CORRECTION_PROPOSED"; proposed: AiCorrectionData["proposed"] }
  | { type: "APPLY_AI_CORRECTION" }

  // === Context updates (internal) ===
  | { type: "SET_USER_MODE"; mode: UserMode }
  | { type: "SET_PENDING_SUB"; pendingSub: PendingSubscription }
  | { type: "UPDATE_DRAFT_KEYWORDS"; keywords: string[] };
