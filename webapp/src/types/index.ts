export interface Category {
  id: number;
  code: string;
  name_ru: string;
}

export interface Product {
  id: number;
  message_id: number;
  group_id: number;
  group_title: string;
  topic_id: number | null;
  topic_title: string | null;
  text: string;
  category_code: string | null;
  price_raw: string | null;
  price_normalized: number | null;
  sender_id: number | null;
  sender_name: string | null;
  message_date: number;
  messageLink: string;
  // Search-related fields (only present when searching)
  _score?: number;
  _matchType?: "exact" | "good" | "partial";
}

export interface SellerContact {
  id: number;
  contact_type: string;
  contact_value: string;
  source: string;
}

export interface ProductWithContacts extends Product {
  contacts: SellerContact[];
}

export interface SearchStats {
  exactCount: number;
  goodCount: number;
  partialCount: number;
}

export interface ProductsResponse {
  items: Product[];
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
  searchStats?: SearchStats;
}

export interface SimilarProduct extends Product {
  priceDiff: number | null;
}

export interface SimilarResponse {
  items: SimilarProduct[];
}

// Subscription types
export interface SubscriptionGroup {
  id: number;
  title: string;
}

export interface Subscription {
  id: number;
  original_query: string;
  positive_keywords: string[];
  negative_keywords: string[];
  llm_description: string;
  is_active: number;
  created_at: string;
  groups: SubscriptionGroup[];
}

export interface SubscriptionsResponse {
  items: Subscription[];
}
