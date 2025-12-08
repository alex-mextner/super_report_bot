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
