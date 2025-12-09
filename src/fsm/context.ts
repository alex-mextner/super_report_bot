import type { UserMode, ExampleRating, PendingGroup } from "../types";

// Pending subscription data during creation flow
export interface PendingSubscription {
  originalQuery: string;
  positiveKeywords: string[];
  negativeKeywords: string[];
  llmDescription: string;
}

// Clarification questions flow
export interface ClarificationData {
  originalQuery: string;
  questions: string[];
  answers: string[];
  currentIndex: number;
}

// Rating examples flow
export interface RatingExamplesData {
  messages: Array<{
    id: number;
    text: string;
    groupId: number;
    groupTitle: string;
    isGenerated: boolean;
  }>;
  ratings: Array<{
    messageId: number;
    text: string;
    rating: ExampleRating;
  }>;
  currentIndex: number;
}

// AI editing flow (for existing subscriptions)
export interface AiEditData {
  subscriptionId: number;
  current: {
    positiveKeywords: string[];
    negativeKeywords: string[];
    llmDescription: string;
  };
  proposed?: {
    positiveKeywords: string[];
    negativeKeywords: string[];
    llmDescription: string;
  };
  conversation: Array<{ role: "user" | "assistant"; content: string }>;
}

// AI correction flow (for pending subscription during creation)
export interface AiCorrectionData {
  mode: UserMode;
  current: {
    positiveKeywords: string[];
    negativeKeywords: string[];
    llmDescription: string;
  };
  proposed?: {
    positiveKeywords: string[];
    negativeKeywords: string[];
    llmDescription: string;
  };
  conversation: Array<{ role: "user" | "assistant"; content: string }>;
}

// Group selection
export interface GroupData {
  id: number;
  title: string;
  isChannel?: boolean;
}

// FSM Context - all data stored during conversation
export interface BotContext {
  // User info
  telegramId: number;
  userMode: UserMode;

  // Subscription creation flow
  pendingSub: PendingSubscription | null;
  clarification: ClarificationData | null;
  ratingExamples: RatingExamplesData | null;
  draftKeywords: string[] | null;

  // Group selection
  availableGroups: GroupData[];
  selectedGroups: GroupData[];

  // Adding groups flow (/addgroup)
  pendingGroups: PendingGroup[];
  currentPendingGroup: PendingGroup | null;

  // Editing existing subscription
  editingSubscriptionId: number | null;
  pendingAiEdit: AiEditData | null;

  // AI correction for pending subscription
  pendingAiCorrection: AiCorrectionData | null;
}

// Initial context factory
export function createInitialContext(telegramId: number, userMode: UserMode = "normal"): BotContext {
  return {
    telegramId,
    userMode,
    pendingSub: null,
    clarification: null,
    ratingExamples: null,
    draftKeywords: null,
    availableGroups: [],
    selectedGroups: [],
    pendingGroups: [],
    currentPendingGroup: null,
    editingSubscriptionId: null,
    pendingAiEdit: null,
    pendingAiCorrection: null,
  };
}
