// Database types
export interface User {
  id: number;
  telegram_id: number;
  created_at: string;
}

export interface Subscription {
  id: number;
  user_id: number;
  original_query: string;
  positive_keywords: string[]; // stored as JSON in DB
  negative_keywords: string[]; // stored as JSON in DB
  disabled_negative_keywords?: string[]; // stored as JSON in DB, for toggle feature
  llm_description: string;
  is_active: number; // SQLite boolean
  created_at: string;
}

export interface MonitoredGroup {
  id: number;
  telegram_id: number;
  title: string | null;
  added_at: string;
}

export interface MatchedMessage {
  id: number;
  subscription_id: number;
  message_id: number;
  group_id: number;
  matched_at: string;
}

// Matcher types
export interface MatchResult {
  subscription: Subscription;
  score: number;
  stage: "bm25" | "ngram" | "llm";
  passed: boolean;
}

export interface KeywordGenerationResult {
  positive_keywords: string[];
  negative_keywords: string[];
  llm_description: string;
}

// Pending group during selection flow
export interface PendingGroup {
  id: number;
  title?: string;
  username?: string;
  needsInviteLink: boolean;
  inviteLink?: string;
  isChannel: boolean;
}

// Bot state for conversation flow
export interface UserState {
  step:
    | "idle"
    | "clarifying_query"
    | "awaiting_confirmation"
    | "editing_keywords"
    | "selecting_groups"
    | "adding_group"
    | "awaiting_invite_link"
    // States for editing existing subscriptions
    | "editing_sub_positive"
    | "editing_sub_negative"
    | "editing_sub_description"
    | "editing_sub_ai";
  // Clarification flow data
  clarification?: {
    original_query: string;
    questions: string[];
    answers: string[];
    current_index: number;
  };
  pending_subscription?: {
    original_query: string;
    positive_keywords: string[];
    negative_keywords: string[];
    llm_description: string;
  };
  pending_groups?: PendingGroup[];
  current_pending_group?: PendingGroup; // group awaiting invite link
  selected_groups?: { id: number; title: string }[];
  available_groups?: { id: number; title: string }[];
  // ID of subscription being edited
  editing_subscription_id?: number;
  // AI editing flow data
  pending_ai_edit?: {
    subscription_id: number;
    current: {
      positive_keywords: string[];
      negative_keywords: string[];
      llm_description: string;
    };
    proposed?: {
      positive_keywords: string[];
      negative_keywords: string[];
      llm_description: string;
    };
    conversation: Array<{ role: "user" | "assistant"; content: string }>;
  };
}

// Message from monitored group
export interface IncomingMessage {
  id: number;
  group_id: number;
  group_title: string;
  text: string;
  sender_name: string;
  timestamp: Date;
}
