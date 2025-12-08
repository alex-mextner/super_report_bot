const API_BASE = import.meta.env.VITE_API_URL || "";

let initData = "";

export function setInitData(data: string) {
  initData = data;
}

export async function apiClient<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      "X-Telegram-Init-Data": initData,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}
