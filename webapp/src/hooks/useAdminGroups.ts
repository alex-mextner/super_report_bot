import { useState, useEffect, useCallback } from "react";
import { apiClient } from "../api/client";

export interface AvailableGroup {
  id: number;
  title: string | null;
}

interface AdminGroupsResponse {
  items: AvailableGroup[];
}

export function useAdminGroups() {
  const [groups, setGroups] = useState<AvailableGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGroups = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient<AdminGroupsResponse>("/api/admin/groups");
      setGroups(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load groups");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  return {
    groups,
    loading,
    error,
    refetch: fetchGroups,
  };
}
