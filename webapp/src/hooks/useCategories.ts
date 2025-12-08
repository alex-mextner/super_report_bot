import { useState, useEffect } from "react";
import { apiClient } from "../api/client";
import type { Category } from "../types";

export function useCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetch() {
      try {
        setLoading(true);
        const data = await apiClient<Category[]>("/api/categories");
        setCategories(data);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load categories");
      } finally {
        setLoading(false);
      }
    }

    fetch();
  }, []);

  return { categories, loading, error };
}
