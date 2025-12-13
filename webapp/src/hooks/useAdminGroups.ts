import { useState, useEffect, useCallback } from "react";
import { apiClient } from "../api/client";

export interface AvailableGroup {
  id: number;
  title: string | null;
}

export interface AdminGroupWithMetadata {
  id: number;
  title: string | null;
  username: string | null;
  country: string | null;
  city: string | null;
  currency: string | null;
  is_marketplace: boolean;
  created_at: string;
}

export interface GroupMetadataUpdate {
  title?: string;
  country?: string;
  city?: string;
  currency?: string;
  is_marketplace?: boolean;
}

interface AdminGroupsResponse {
  items: AdminGroupWithMetadata[];
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

// Extended hook for AdminGroupsPage
export function useAdminGroupsWithMetadata() {
  const [groups, setGroups] = useState<AdminGroupWithMetadata[]>([]);
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

  const updateGroup = useCallback(async (id: number, data: GroupMetadataUpdate): Promise<boolean> => {
    try {
      await apiClient<{ success: boolean }>(`/api/admin/groups/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
      // Update local state
      setGroups((prev) =>
        prev.map((g) =>
          g.id === id
            ? {
                ...g,
                title: data.title ?? g.title,
                country: data.country ?? g.country,
                city: data.city ?? g.city,
                currency: data.currency ?? g.currency,
                is_marketplace: data.is_marketplace ?? g.is_marketplace,
              }
            : g
        )
      );
      return true;
    } catch (err) {
      console.error("Failed to update group:", err);
      return false;
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
    updateGroup,
  };
}
