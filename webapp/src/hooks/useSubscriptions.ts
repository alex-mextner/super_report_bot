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

  return {
    subscriptions,
    loading,
    error,
    refetch: fetchSubscriptions,
    deleteSubscription,
  };
}
