import { useState, useCallback } from "react";
import { apiClient } from "../api/client";

interface AnalysisResult {
  category: string;
  price: string | null;
  currency: string | null;
  contacts: string[];
}

interface BatchResult {
  id: number;
  result: AnalysisResult;
}

interface BatchResponse {
  results: BatchResult[];
}

export function useAnalyzeBatch() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Map<number, AnalysisResult>>(new Map());

  const analyzeBatch = useCallback(async (groupId?: number, limit = 50) => {
    setLoading(true);
    setError(null);

    try {
      const data = await apiClient<BatchResponse>("/api/analyze-batch", {
        method: "POST",
        body: JSON.stringify({ group_id: groupId, limit }),
      });

      const resultsMap = new Map<number, AnalysisResult>();
      for (const item of data.results) {
        resultsMap.set(item.id, item.result);
      }
      setResults(resultsMap);
      return resultsMap;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Analysis failed";
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const getResult = useCallback(
    (id: number): AnalysisResult | undefined => results.get(id),
    [results]
  );

  const reset = useCallback(() => {
    setResults(new Map());
    setError(null);
  }, []);

  return { analyzeBatch, loading, error, results, getResult, reset, hasResults: results.size > 0 };
}
