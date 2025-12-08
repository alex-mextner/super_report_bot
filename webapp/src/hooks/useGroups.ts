import { useState, useEffect } from "react";
import { apiClient } from "../api/client";

export interface Group {
  id: number;
  title: string;
  count: number;
}

export function useGroups() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetch() {
      try {
        setLoading(true);
        const data = await apiClient<Group[]>("/api/groups");
        setGroups(data);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load groups");
      } finally {
        setLoading(false);
      }
    }

    fetch();
  }, []);

  return { groups, loading, error };
}
