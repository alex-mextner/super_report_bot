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
    | "awaiting_confirmation"
    | "editing_keywords"
    | "selecting_groups"
    | "adding_group"
    | "awaiting_invite_link";
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
