import { useState, useEffect, useCallback } from "react";
import { apiClient } from "../api/client";
import type {
  AdminSubscription,
  AdminSubscriptionsResponse,
  SubscriptionGroup,
} from "../types";

export function useAdminSubscriptions() {
  const [subscriptions, setSubscriptions] = useState<AdminSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSubscriptions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient<AdminSubscriptionsResponse>(
        "/api/admin/subscriptions"
      );
      setSubscriptions(data.items);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load subscriptions"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSubscriptions();
  }, [fetchSubscriptions]);

  const updateKeywords = useCallback(
    async (id: number, positive: string[], negative: string[]) => {
      try {
        await apiClient(`/api/admin/subscriptions/${id}/keywords`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ positive, negative }),
        });
        // Update local state
        setSubscriptions((prev) =>
          prev.map((sub) =>
            sub.id === id
              ? { ...sub, positive_keywords: positive, negative_keywords: negative }
              : sub
          )
        );
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update keywords");
        return false;
      }
    },
    []
  );

  const updateGroups = useCallback(
    async (id: number, groups: SubscriptionGroup[]) => {
      try {
        await apiClient(`/api/admin/subscriptions/${id}/groups`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groups }),
        });
        // Update local state
        setSubscriptions((prev) =>
          prev.map((sub) => (sub.id === id ? { ...sub, groups } : sub))
        );
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update groups");
        return false;
      }
    },
    []
  );

  return {
    subscriptions,
    loading,
    error,
    refetch: fetchSubscriptions,
    updateKeywords,
    updateGroups,
  };
}
