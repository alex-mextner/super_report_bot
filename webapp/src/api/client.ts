const API_BASE = import.meta.env.VITE_API_URL || "";

// Get initData immediately from Telegram WebApp if available
const initData = (window as any).Telegram?.WebApp?.initData || "";

console.log("[API] Module loaded", {
  hasInitData: !!initData,
  length: initData.length,
  hasTelegram: !!(window as any).Telegram,
});

// setInitData is no longer needed but kept for compatibility
export function setInitData(_data: string) {
  // No-op, we get initData directly from window.Telegram.WebApp
}

// Export initData for SSE endpoints
export function getInitData(): string {
  return initData;
}

export async function apiClient<T>(endpoint: string, options?: RequestInit): Promise<T> {
  console.log("[API]", endpoint, { hasInitData: !!initData, initDataLength: initData.length });

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      "X-Telegram-Init-Data": initData,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("[API] Error", endpoint, response.status, text);
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  console.log("[API] Response", endpoint, data);
  return data as T;
}

// === Admin Users API Types ===

export interface AdminUser {
  id: number;
  first_name: string | null;
  username: string | null;
  last_active: number | null;
  created_at: string;
}

export interface AdminBotMessage {
  id: number;
  direction: "incoming" | "outgoing";
  message_type: string;
  text: string | null;
  command: string | null;
  callback_data: string | null;
  created_at: number;
}

// === Admin Users API Functions ===

export async function getAdminUsers(): Promise<{ items: AdminUser[] }> {
  return apiClient("/api/admin/users");
}

export async function getUserMessages(
  telegramId: number,
  opts?: { offset?: number; limit?: number }
): Promise<{ items: AdminBotMessage[] }> {
  const { offset = 0, limit = 100 } = opts || {};
  return apiClient(`/api/admin/users/${telegramId}/messages?offset=${offset}&limit=${limit}`);
}

export async function sendMessageToUser(
  telegramId: number,
  text: string
): Promise<{ success: boolean }> {
  return apiClient(`/api/admin/users/${telegramId}/send`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

// Build SSE URL with initData in query string
export function buildSSEUrl(endpoint: string): string {
  const base = API_BASE || "";
  const encodedInitData = encodeURIComponent(initData);
  return `${base}${endpoint}?initData=${encodedInitData}`;
}
