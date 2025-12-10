import { useState, useEffect, useCallback } from "react";
import { apiClient } from "../api/client";
import type { Subscription, SubscriptionsResponse } from "../types";

export function useSubscriptions() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSubscriptions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient<SubscriptionsResponse>("/api/subscriptions");
      setSubscriptions(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load subscriptions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSubscriptions();
  }, [fetchSubscriptions]);

  const deleteSubscription = useCallback(async (id: number) => {
    try {
      await apiClient<{ success: boolean }>(`/api/subscriptions/${id}`, {
        method: "DELETE",
      });
      // Remove from local state
      setSubscriptions((prev) => prev.filter((s) => s.id !== id));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete subscription");
      return false;
    }
  }, []);

  const updateKeywords = useCallback(
    async (id: number, positive: string[], negative: string[]) => {
      try {
        await apiClient(`/api/subscriptions/${id}/keywords`, {
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

  return {
    subscriptions,
    loading,
    error,
    refetch: fetchSubscriptions,
    deleteSubscription,
    updateKeywords,
  };
}
