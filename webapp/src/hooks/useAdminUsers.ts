import { useState, useEffect, useCallback } from "react";
import {
  getAdminUsers,
  buildSSEUrl,
  type AdminUser,
} from "../api/client";

interface UserActivityEvent {
  telegram_id: number;
  last_active: number;
  first_name: string | null;
  username: string | null;
}

export function useAdminUsers() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initial fetch
  const fetchUsers = useCallback(async () => {
    try {
      const data = await getAdminUsers();
      setUsers(data.items);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // SSE subscription for realtime updates
  useEffect(() => {
    fetchUsers();

    const sseUrl = buildSSEUrl("/api/admin/users/stream");
    const eventSource = new EventSource(sseUrl);

    eventSource.addEventListener("user_activity", (event) => {
      const data: UserActivityEvent = JSON.parse(event.data);

      setUsers((prev) => {
        // Find existing user or add new one
        const existingIndex = prev.findIndex((u) => u.id === data.telegram_id);

        if (existingIndex >= 0) {
          // Update existing user
          const updated = [...prev];
          updated[existingIndex] = {
            ...updated[existingIndex],
            last_active: data.last_active,
            first_name: data.first_name ?? updated[existingIndex].first_name,
            username: data.username ?? updated[existingIndex].username,
          };
          return updated;
        } else {
          // Add new user
          return [
            ...prev,
            {
              id: data.telegram_id,
              first_name: data.first_name,
              username: data.username,
              last_active: data.last_active,
              created_at: new Date().toISOString(),
            },
          ];
        }
      });
    });

    eventSource.onerror = (e) => {
      console.error("[SSE] Connection error", e);
      // EventSource will auto-reconnect
    };

    return () => {
      eventSource.close();
    };
  }, [fetchUsers]);

  // Sort users: online first (< 10 sec), then by last_active desc
  const sortedUsers = [...users].sort((a, b) => {
    const now = Math.floor(Date.now() / 1000);
    const aOnline = a.last_active && now - a.last_active < 10;
    const bOnline = b.last_active && now - b.last_active < 10;

    if (aOnline && !bOnline) return -1;
    if (!aOnline && bOnline) return 1;

    // Both online or both offline - sort by last_active desc
    const aActive = a.last_active ?? 0;
    const bActive = b.last_active ?? 0;
    return bActive - aActive;
  });

  return { users: sortedUsers, loading, error, refetch: fetchUsers };
}
