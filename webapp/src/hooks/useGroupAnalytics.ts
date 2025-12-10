import { useState, useEffect } from "react";
import { apiClient } from "../api/client";

export interface TopSeller {
  senderId: number;
  senderName: string | null;
  senderUsername: string | null;
  postCount: number;
}

export interface CategoryCount {
  categoryCode: string;
  categoryName: string;
  count: number;
}

export interface ActivityPoint {
  date: string;
  count: number;
}

export interface PriceStats {
  categoryCode: string;
  categoryName: string;
  currency: string;
  min: number;
  max: number;
  avg: number;
  count: number;
}

export interface GroupStats {
  uniqueSellersCount: number;
  topSellers: TopSeller[];
  categoryCounts: CategoryCount[];
  activityByDay: ActivityPoint[];
  pricesByCategory: PriceStats[];
  botFoundPosts: {
    matched: number;
    notified: number;
  };
  totalMessages: number;
  periodDays: number;
}

export interface GroupAnalytics {
  groupId: number;
  groupTitle: string;
  stats: GroupStats;
  insights: string | null;
  computedAt: number;
  insightsGeneratedAt: number | null;
}

export function useGroupAnalytics(groupId: number | null) {
  const [analytics, setAnalytics] = useState<GroupAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchTrigger, setFetchTrigger] = useState(0);

  useEffect(() => {
    if (!groupId) {
      setAnalytics(null);
      setLoading(false);
      setError(null);
      return;
    }

    async function doFetch() {
      try {
        setLoading(true);
        const data = await apiClient<GroupAnalytics>(`/api/analytics/${groupId}`);
        setAnalytics(data);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load analytics");
        setAnalytics(null);
      } finally {
        setLoading(false);
      }
    }

    doFetch();
  }, [groupId, fetchTrigger]);

  const refetch = () => setFetchTrigger((n) => n + 1);

  return { analytics, loading, error, refetch };
}
