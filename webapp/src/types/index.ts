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
  text: string;
  category_code: string | null;
  price_raw: string | null;
  price_normalized: number | null;
  sender_id: number | null;
  sender_name: string | null;
  message_date: number;
  messageLink: string;
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

export interface ProductsResponse {
  items: Product[];
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface SimilarProduct extends Product {
  priceDiff: number | null;
}

export interface SimilarResponse {
  items: SimilarProduct[];
}
