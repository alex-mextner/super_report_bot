import { useState, useEffect, useCallback } from "react";
import { apiClient } from "../api/client";

export interface PresetGroup {
  id: number;
  title: string | null;
  city: string | null;
}

export interface Preset {
  id: number;
  region_code: string;
  region_name: string;
  country_code: string | null;
  currency: string | null;
  group_count: number;
  groups: PresetGroup[];
}

export interface PresetCreate {
  region_code: string;
  region_name: string;
  country_code?: string;
  currency?: string;
}

export interface PresetUpdate {
  region_code?: string;
  region_name?: string;
  country_code?: string | null;
  currency?: string | null;
}

export interface AvailableGroup {
  id: number;
  title: string | null;
  city: string | null;
}

interface PresetsResponse {
  items: Preset[];
}

interface AvailableGroupsResponse {
  items: AvailableGroup[];
  cityFilter: string | undefined;
}

interface CitiesResponse {
  items: string[];
}

export function useAdminPresets() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPresets = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient<PresetsResponse>("/api/admin/presets");
      setPresets(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load presets");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCities = useCallback(async () => {
    try {
      const data = await apiClient<CitiesResponse>("/api/admin/cities");
      setCities(data.items);
    } catch (err) {
      console.error("Failed to load cities:", err);
    }
  }, []);

  const createPreset = useCallback(async (data: PresetCreate): Promise<number | null> => {
    try {
      const result = await apiClient<{ id: number }>("/api/admin/presets", {
        method: "POST",
        body: JSON.stringify(data),
      });
      await fetchPresets();
      return result.id;
    } catch (err) {
      console.error("Failed to create preset:", err);
      return null;
    }
  }, [fetchPresets]);

  const updatePreset = useCallback(async (id: number, data: PresetUpdate): Promise<boolean> => {
    try {
      await apiClient<{ success: boolean }>(`/api/admin/presets/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
      setPresets((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                region_code: data.region_code ?? p.region_code,
                region_name: data.region_name ?? p.region_name,
                country_code: data.country_code !== undefined ? data.country_code : p.country_code,
                currency: data.currency !== undefined ? data.currency : p.currency,
              }
            : p
        )
      );
      return true;
    } catch (err) {
      console.error("Failed to update preset:", err);
      return false;
    }
  }, []);

  const deletePreset = useCallback(async (id: number): Promise<boolean> => {
    try {
      await apiClient<{ success: boolean }>(`/api/admin/presets/${id}`, {
        method: "DELETE",
      });
      setPresets((prev) => prev.filter((p) => p.id !== id));
      return true;
    } catch (err) {
      console.error("Failed to delete preset:", err);
      return false;
    }
  }, []);

  const getAvailableGroups = useCallback(async (presetId: number, cityFilter?: string): Promise<AvailableGroup[]> => {
    try {
      const url = cityFilter
        ? `/api/admin/presets/${presetId}/available-groups?city=${encodeURIComponent(cityFilter)}`
        : `/api/admin/presets/${presetId}/available-groups`;
      const data = await apiClient<AvailableGroupsResponse>(url);
      return data.items;
    } catch (err) {
      console.error("Failed to load available groups:", err);
      return [];
    }
  }, []);

  const addGroupToPreset = useCallback(async (presetId: number, groupId: number): Promise<boolean> => {
    try {
      await apiClient<{ success: boolean }>(`/api/admin/presets/${presetId}/groups`, {
        method: "POST",
        body: JSON.stringify({ group_id: groupId }),
      });
      await fetchPresets();
      return true;
    } catch (err) {
      console.error("Failed to add group to preset:", err);
      return false;
    }
  }, [fetchPresets]);

  const removeGroupFromPreset = useCallback(async (presetId: number, groupId: number): Promise<boolean> => {
    try {
      await apiClient<{ success: boolean }>(`/api/admin/presets/${presetId}/groups/${groupId}`, {
        method: "DELETE",
      });
      setPresets((prev) =>
        prev.map((p) =>
          p.id === presetId
            ? {
                ...p,
                group_count: p.group_count - 1,
                groups: p.groups.filter((g) => g.id !== groupId),
              }
            : p
        )
      );
      return true;
    } catch (err) {
      console.error("Failed to remove group from preset:", err);
      return false;
    }
  }, []);

  useEffect(() => {
    fetchPresets();
    fetchCities();
  }, [fetchPresets, fetchCities]);

  return {
    presets,
    cities,
    loading,
    error,
    refetch: fetchPresets,
    createPreset,
    updatePreset,
    deletePreset,
    getAvailableGroups,
    addGroupToPreset,
    removeGroupFromPreset,
  };
}
